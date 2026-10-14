use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::VecDeque, path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::{Mutex, RwLock},
};
use tower_http::{cors::CorsLayer, services::ServeDir};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub strata_root: String,
    pub python: String,
    pub config: String,
    pub mock: bool,
    pub temperature: f64,
    pub max_tokens: u32,
    pub language: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            strata_root: String::new(),
            python: "python3".into(),
            config: String::new(),
            mock: false,
            temperature: 0.7,
            max_tokens: 512,
            language: "ja".into(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub messages: Vec<Message>,
    pub detached: Vec<String>,
    #[serde(default)]
    pub generating: bool,
}
struct Process {
    child: Option<Child>,
    key: String,
    port: u16,
}
pub struct Studio {
    pub root: PathBuf,
    pub port: u16,
    pub token: String,
    pub settings: RwLock<Settings>,
    pub document: RwLock<Document>,
    process: Mutex<Process>,
    logs: Arc<Mutex<VecDeque<String>>>,
    client: reqwest::Client,
    storage: Mutex<Option<PathBuf>>,
    memory_bytes: Option<u64>,
}
impl Studio {
    pub fn new(root: PathBuf, port: u16) -> Self {
        let mut settings = Settings::default();
        settings.strata_root = root.to_string_lossy().into();
        if root.join(".venv/bin/python").exists() {
            settings.python = root.join(".venv/bin/python").to_string_lossy().into();
        } else if cfg!(target_os = "macos") {
            for candidate in ["/opt/homebrew/bin/python3", "/usr/local/bin/python3"] {
                if PathBuf::from(candidate).exists() {
                    settings.python = candidate.into();
                    break;
                }
            }
        }
        if let Ok(files) = std::fs::read_dir(&root) {
            let mut configs: Vec<_> = files
                .flatten()
                .map(|f| f.path())
                .filter(|p| {
                    p.file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with("strata-"))
                        && p.extension().is_some_and(|x| x == "json")
                })
                .collect();
            configs.sort();
            if let Some(p) = configs.first() {
                settings.config = p.to_string_lossy().into();
            }
        }
        Self {
            root,
            port,
            token: uuid::Uuid::new_v4().to_string(),
            settings: RwLock::new(settings),
            document: RwLock::new(Document::default()),
            process: Mutex::new(Process {
                child: None,
                key: String::new(),
                port: 0,
            }),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            client: reqwest::Client::new(),
            storage: Mutex::new(None),
            memory_bytes: if cfg!(target_os = "macos") {
                std::process::Command::new("/usr/sbin/sysctl")
                    .args(["-n", "hw.memsize"])
                    .output()
                    .ok()
                    .filter(|o| o.status.success())
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .and_then(|s| s.trim().parse::<u64>().ok())
            } else {
                None
            },
        }
    }
    pub fn with_storage(mut self, path: PathBuf) -> Self {
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                if let Ok(settings) = serde_json::from_value::<Settings>(value["settings"].clone())
                {
                    *self.settings.get_mut() = settings;
                }
                if let Ok(mut doc) = serde_json::from_value::<Document>(value["document"].clone()) {
                    doc.generating = false;
                    doc.detached.clear(); // Native windows do not survive a process restart.
                    *self.document.get_mut() = doc;
                }
            }
        }
        *self.storage.get_mut() = Some(path);
        self
    }
    async fn persist(&self) -> Result<(), String> {
        let storage = self.storage.lock().await;
        if let Some(path) = storage.as_ref() {
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            let data = serde_json::to_vec(&json!({"settings":*self.settings.read().await,"document":*self.document.read().await})).map_err(|e|e.to_string())?;
            let tmp = path.with_extension("tmp");
            tokio::fs::write(&tmp, data)
                .await
                .map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                tokio::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
                    .await
                    .map_err(|e| e.to_string())?;
            }
            tokio::fs::rename(tmp, path)
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub async fn stop(&self) -> Result<(), String> {
        let mut p = self.process.lock().await;
        if let Some(mut c) = p.child.take() {
            #[cfg(unix)]
            if let Some(id) = c.id() {
                unsafe {
                    libc::kill(-(id as i32), libc::SIGTERM);
                }
            }
            if tokio::time::timeout(Duration::from_secs(8), c.wait())
                .await
                .is_err()
            {
                #[cfg(unix)]
                if let Some(id) = c.id() {
                    unsafe {
                        libc::kill(-(id as i32), libc::SIGKILL);
                    }
                }
                let _ = c.kill().await;
            }
            push_log(&self.logs, "[studio] Process stopped".into()).await;
        }
        Ok(())
    }
    pub async fn start(&self) -> Result<(), String> {
        let mut p = self.process.lock().await;
        if let Some(c) = p.child.as_mut() {
            if c.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Err("Engine is already running".into());
            }
        }
        let s = self.settings.read().await.clone();
        let root = PathBuf::from(&s.strata_root);
        if !root.join("serve/server.py").exists() {
            return Err("Strata/serve/server.py not found; set STRATA_ROOT".into());
        }
        if !s.mock {
            if s.config.is_empty() || !PathBuf::from(&s.config).is_file() {
                return Err(
                    "Select an existing strata-*.json config produced by Strata/setup.sh".into(),
                );
            }
        }
        let probe = tokio::time::timeout(Duration::from_secs(10), Command::new(&s.python)
            .args(["-c", "import sys; assert sys.version_info >= (3,10), 'Python 3.10+ required'; import jinja2, regex, numpy, PIL"])
            .kill_on_drop(true).output()).await.map_err(|_| "Python check timed out")?
            .map_err(|e| format!("Cannot launch Python: {e}"))?;
        if !probe.status.success() {
            return Err(format!(
                "Python 3.10+ and Strata dependencies required: {}",
                String::from_utf8_lossy(&probe.stderr)
                    .chars()
                    .take(1000)
                    .collect::<String>()
            ));
        }
        // Reserve an ephemeral loopback port; do not attach to somebody else's engine.
        let reserve = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        p.port = reserve.local_addr().map_err(|e| e.to_string())?.port();
        p.key = uuid::Uuid::new_v4().to_string();
        let mut cmd = Command::new(&s.python);
        cmd.current_dir(&root)
            .args([
                "-u",
                "-m",
                "serve.server",
                "--host",
                "127.0.0.1",
                "--port",
                &p.port.to_string(),
                "--engine",
                if s.mock { "mock" } else { "strata" },
            ])
            .env("STRATA_API_KEY", &p.key)
            .kill_on_drop(true)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if !s.mock {
            cmd.args(["--config", &s.config]);
        }
        #[cfg(unix)]
        cmd.process_group(0);
        drop(reserve);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Cannot launch {}: {e}", s.python))?;
        if let Some(out) = child.stdout.take() {
            pump(out, self.logs.clone());
        }
        if let Some(out) = child.stderr.take() {
            pump(out, self.logs.clone());
        }
        p.child = Some(child);
        push_log(
            &self.logs,
            format!(
                "[studio] Starting {} on private port {}",
                if s.mock {
                    "test engine (no model)"
                } else {
                    "Strata"
                },
                p.port
            ),
        )
        .await;
        Ok(())
    }
    pub async fn snapshot(&self) -> Value {
        let (running, upstream, key) = {
            let mut p = self.process.lock().await;
            let running = p
                .child
                .as_mut()
                .is_some_and(|c| matches!(c.try_wait(), Ok(None)));
            (running, p.port, p.key.clone())
        };
        let health = if running {
            self.client
                .get(format!("http://127.0.0.1:{upstream}/health"))
                .bearer_auth(key)
                .timeout(Duration::from_secs(1))
                .send()
                .await
                .ok()
        } else {
            None
        };
        let health = match health {
            Some(h) => h.json::<Value>().await.ok(),
            None => None,
        };
        let status = if !running {
            "offline"
        } else if health.is_some() {
            "ready"
        } else {
            "starting"
        };
        json!({"status":status,"health":health,"settings":*self.settings.read().await,"document":*self.document.read().await,"logs":*self.logs.lock().await,"architecture":std::env::consts::ARCH,"memoryBytes":self.memory_bytes,"backend":if cfg!(all(target_os="macos",target_arch="aarch64")){"Metal"}else{"Strata"},"endpoint":format!("http://127.0.0.1:{}/v1",self.port),"root":self.root})
    }
}
fn pump<T: tokio::io::AsyncRead + Unpin + Send + 'static>(
    stream: T,
    logs: Arc<Mutex<VecDeque<String>>>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            push_log(&logs, line.chars().take(4096).collect()).await;
        }
    });
}
async fn push_log(logs: &Mutex<VecDeque<String>>, line: String) {
    let mut l = logs.lock().await;
    if l.len() >= 300 {
        l.pop_front();
    }
    l.push_back(line);
}
fn error(status: StatusCode, msg: impl ToString) -> Response {
    (
        status,
        Json(json!({"error":{"message":msg.to_string(),"type":"studio_error"}})),
    )
        .into_response()
}
fn authorized(h: &HeaderMap, s: &Studio) -> bool {
    h.get("x-studio-token").and_then(|x| x.to_str().ok()) == Some(&s.token)
}
async fn session(State(s): State<Arc<Studio>>, h: HeaderMap) -> Response {
    let origin = h.get("origin").and_then(|x| x.to_str().ok()).unwrap_or("");
    if origin != format!("http://127.0.0.1:{}", s.port) && origin != "http://127.0.0.1:5180" {
        return error(StatusCode::FORBIDDEN, "Untrusted origin");
    }
    Json(json!({"token":s.token,"url":format!("http://127.0.0.1:{}",s.port)})).into_response()
}
async fn snapshot(State(s): State<Arc<Studio>>, h: HeaderMap) -> Response {
    if !authorized(&h, &s) {
        return error(StatusCode::UNAUTHORIZED, "Studio token required");
    }
    Json(s.snapshot().await).into_response()
}
async fn action(State(s): State<Arc<Studio>>, h: HeaderMap, Json(v): Json<Value>) -> Response {
    if !authorized(&h, &s) {
        return error(StatusCode::UNAUTHORIZED, "Studio token required");
    }
    let result = match v["action"].as_str().unwrap_or("") {
        "start" => s.start().await,
        "stop" => s.stop().await,
        "settings" => match serde_json::from_value::<Settings>(v["settings"].clone()) {
            Ok(settings)
                if settings.max_tokens > 0
                    && settings.max_tokens <= 262144
                    && settings.temperature.is_finite()
                    && (0.0..=2.0).contains(&settings.temperature)
                    && ["en", "ja", "zh"].contains(&settings.language.as_str()) =>
            {
                *s.settings.write().await = settings;
                Ok(())
            }
            _ => Err("Invalid settings".into()),
        },
        "messages" => match serde_json::from_value::<Vec<Message>>(v["messages"].clone()) {
            Ok(m)
                if m.len() <= 1000
                    && m.iter().all(|x| {
                        ["system", "user", "assistant"].contains(&x.role.as_str())
                            && x.content.len() <= 1_000_000
                    }) =>
            {
                let mut d = s.document.write().await;
                if d.generating {
                    return error(StatusCode::CONFLICT, "Conversation is generating");
                }
                d.messages = m;
                Ok(())
            }
            _ => Err("Invalid messages".into()),
        },
        "detach" | "dock" => {
            let panel = v["panel"].as_str().unwrap_or("");
            if !["engine", "api", "logs"].contains(&panel) {
                Err("Invalid panel".into())
            } else {
                let mut d = s.document.write().await;
                d.detached.retain(|x| x != panel);
                if v["action"] == "detach" {
                    d.detached.push(panel.into());
                }
                Ok(())
            }
        }
        "clearLogs" => {
            s.logs.lock().await.clear();
            Ok(())
        }
        _ => Err("Unknown action".into()),
    };
    match result {
        Ok(()) => match s.persist().await {
            Ok(()) => Json(json!({"ok":true})).into_response(),
            Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e),
        },
        Err(e) => error(StatusCode::BAD_REQUEST, e),
    }
}
async fn proxy(State(s): State<Arc<Studio>>, req: Request) -> Response {
    let (parts, body) = req.into_parts();
    // Inference stays loopback-only; Studio clients authenticate with the process session token.
    let authenticated = authorized(&parts.headers, &s)
        || parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            == Some(format!("Bearer {}", s.token).as_str())
        || parts.headers.get("x-api-key").and_then(|v| v.to_str().ok()) == Some(&s.token);
    if !authenticated {
        return error(StatusCode::UNAUTHORIZED, "Use the Studio session API key");
    }
    let (port, key) = {
        let mut p = s.process.lock().await;
        if !p
            .child
            .as_mut()
            .is_some_and(|c| matches!(c.try_wait(), Ok(None)))
        {
            return error(StatusCode::SERVICE_UNAVAILABLE, "Engine is offline");
        }
        (p.port, p.key.clone())
    };
    let path = parts
        .uri
        .path_and_query()
        .map(|x| x.as_str())
        .unwrap_or("/");
    let body = match axum::body::to_bytes(body, 16 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return error(StatusCode::PAYLOAD_TOO_LARGE, "Request exceeds 16 MiB"),
    };
    let mut request = s
        .client
        .request(parts.method, format!("http://127.0.0.1:{port}{path}"))
        .bearer_auth(key)
        .body(body);
    for name in ["content-type", "anthropic-version", "anthropic-beta"] {
        if let Some(value) = parts.headers.get(name) {
            request = request.header(name, value);
        }
    }
    let upstream = match request.send().await {
        Ok(r) => r,
        Err(e) => return error(StatusCode::BAD_GATEWAY, e),
    };
    let status = upstream.status();
    let headers = upstream.headers().clone();
    let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
    *response.status_mut() = status;
    for name in ["content-type", "cache-control"] {
        if let Some(value) = headers.get(name) {
            response.headers_mut().insert(name, value.clone());
        }
    }
    response
}
// The conversation and in-flight generation live here, rather than in a WebView.
async fn chat(State(s): State<Arc<Studio>>, h: HeaderMap, Json(mut body): Json<Value>) -> Response {
    if !authorized(&h, &s) {
        return error(StatusCode::UNAUTHORIZED, "Studio token required");
    }
    let user = body["messages"]
        .as_array()
        .and_then(|a| a.last())
        .and_then(|v| serde_json::from_value::<Message>(v.clone()).ok());
    let user = match user {
        Some(m)
            if m.role == "user" && !m.content.trim().is_empty() && m.content.len() <= 1_000_000 =>
        {
            m
        }
        _ => return error(StatusCode::BAD_REQUEST, "Invalid user message"),
    };
    let (port, key) = {
        let mut p = s.process.lock().await;
        if !p
            .child
            .as_mut()
            .is_some_and(|c| matches!(c.try_wait(), Ok(None)))
        {
            return error(StatusCode::SERVICE_UNAVAILABLE, "Engine is offline");
        }
        (p.port, p.key.clone())
    };
    {
        let mut d = s.document.write().await;
        if d.generating {
            return error(StatusCode::CONFLICT, "A conversation is already generating");
        }
        if d.messages.len() >= 1000 {
            return error(StatusCode::BAD_REQUEST, "Start a new conversation");
        }
        d.generating = true;
        d.messages.push(user);
        body["messages"] = json!(d.messages);
        body["stream"] = json!(true);
        d.messages.push(Message {
            role: "assistant".into(),
            content: String::new(),
        });
    }
    let response = s
        .client
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await;
    let mut response = match response {
        Ok(r) if r.status().is_success() => r,
        other => {
            {
                let mut d = s.document.write().await;
                d.generating = false;
                d.messages.pop();
            }
            let _ = s.persist().await;
            return match other {
                Ok(r) => {
                    let status = r.status();
                    let bytes = r.bytes().await.unwrap_or_default();
                    (status, bytes).into_response()
                }
                Err(e) => error(StatusCode::BAD_GATEWAY, e),
            };
        }
    };
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(8);
    tokio::spawn(async move {
        let mut buffer = Vec::<u8>::new();
        loop {
            let chunk = tokio::select! {_ = tx.closed()=>break,chunk=response.chunk()=>chunk};
            match chunk {
                Ok(Some(bytes)) => {
                    buffer.extend_from_slice(&bytes);
                    while let Some(end) = buffer.windows(2).position(|w| w == b"\n\n") {
                        let event = buffer.drain(..end + 2).collect::<Vec<_>>();
                        if let Ok(text) = std::str::from_utf8(&event) {
                            for line in text.lines() {
                                if let Some(data) = line.strip_prefix("data:") {
                                    if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
                                        if let Some(delta) =
                                            v["choices"][0]["delta"]["content"].as_str()
                                        {
                                            let mut d = s.document.write().await;
                                            if let Some(last) = d.messages.last_mut() {
                                                last.content.push_str(delta);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if buffer.len() > 1024 * 1024 {
                        let _ = tx
                            .send(Err(std::io::Error::other("SSE event too large")))
                            .await;
                        break;
                    }
                    if tx.send(Ok(bytes)).await.is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = tx.send(Err(std::io::Error::other(e))).await;
                    break;
                }
            }
        }
        {
            let mut d = s.document.write().await;
            d.generating = false;
            if d.messages.last().is_some_and(|m| m.content.is_empty()) {
                d.messages.pop();
            }
        }
        if let Err(e) = s.persist().await {
            push_log(&s.logs, format!("[studio] Save failed: {e}")).await;
        }
    });
    let mut r = Response::new(Body::from_stream(
        tokio_stream::wrappers::ReceiverStream::new(rx),
    ));
    r.headers_mut()
        .insert("content-type", "text/event-stream".parse().unwrap());
    r.headers_mut()
        .insert("cache-control", "no-cache".parse().unwrap());
    r
}
pub fn router(s: Arc<Studio>) -> Router {
    Router::new()
        .route("/studio/session", post(session))
        .route("/studio/state", get(snapshot))
        .route("/studio/action", post(action))
        .route("/studio/chat", post(chat))
        .route(
            "/health",
            get(|| async { Json(json!({"service":"strata-studio","status":"ok"})) }),
        )
        .route("/v1/{*path}", axum::routing::any(proxy))
        .route("/status", get(proxy))
        .fallback_service(ServeDir::new("dist").append_index_html_on_directories(true))
        .layer(
            CorsLayer::new()
                .allow_origin([
                    "http://tauri.localhost".parse().unwrap(),
                    "https://tauri.localhost".parse().unwrap(),
                    "tauri://localhost".parse().unwrap(),
                    "http://127.0.0.1:5180".parse().unwrap(),
                ])
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
                .allow_headers([
                    axum::http::header::CONTENT_TYPE,
                    axum::http::HeaderName::from_static("x-studio-token"),
                ]),
        )
        .with_state(s)
}
pub async fn serve(
    listener: tokio::net::TcpListener,
    s: Arc<Studio>,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    axum::serve(listener, router(s))
        .with_graceful_shutdown(shutdown)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn refuses_missing_model_config() {
        let s = Studio::new(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../Strata"),
            8080,
        );
        s.settings.write().await.config.clear();
        assert!(s.start().await.unwrap_err().contains("config"));
    }
    #[test]
    fn authentication_requires_exact_token() {
        let s = Studio::new(PathBuf::new(), 8080);
        let mut h = HeaderMap::new();
        assert!(!authorized(&h, &s));
        h.insert("x-studio-token", s.token.parse().unwrap());
        assert!(authorized(&h, &s));
    }
    #[tokio::test]
    async fn saves_document_and_restores_without_stale_windows_or_generation() {
        let path = std::env::temp_dir().join(format!("studio-{}.json", uuid::Uuid::new_v4()));
        let s = Studio::new(PathBuf::new(), 8080).with_storage(path.clone());
        {
            let mut d = s.document.write().await;
            d.messages.push(Message {
                role: "user".into(),
                content: "保存する会話".into(),
            });
            d.detached.push("api".into());
            d.generating = true;
        }
        s.persist().await.unwrap();
        let restored = Studio::new(PathBuf::new(), 8080).with_storage(path.clone());
        let d = restored.document.read().await;
        assert_eq!(d.messages[0].content, "保存する会話");
        assert!(d.detached.is_empty());
        assert!(!d.generating);
        assert_ne!(s.token, restored.token);
        std::fs::remove_file(path).unwrap();
    }
}
