#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{path::PathBuf, sync::Arc};
use tauri::{Manager, State};
struct Runtime {
    studio: Arc<studio_core::Studio>,
    shutdown: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}
#[tauri::command]
fn connection(runtime: State<Runtime>) -> serde_json::Value {
    serde_json::json!({"url":format!("http://127.0.0.1:{}",runtime.studio.port),"token":runtime.studio.token})
}
#[tauri::command]
async fn float_panel(
    app: tauri::AppHandle,
    runtime: State<'_, Runtime>,
    panel: String,
) -> Result<(), String> {
    if !["engine", "api", "logs"].contains(&panel.as_str()) {
        return Err("Unknown panel".into());
    }
    let label = format!("panel-{panel}");
    if let Some(w) = app.get_webview_window(&label) {
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(format!("index.html?panel={panel}").into()),
    )
    .title(format!("Strata · {panel}"))
    .inner_size(if panel == "logs" { 780.0 } else { 380.0 }, 520.0)
    .min_inner_size(320.0, 320.0)
    .build()
    .map_err(|e| e.to_string())?;
    runtime
        .studio
        .document
        .write()
        .await
        .detached
        .push(panel.clone());
    let studio = runtime.studio.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let studio = studio.clone();
            let panel = panel.clone();
            tauri::async_runtime::spawn(async move {
                studio
                    .document
                    .write()
                    .await
                    .detached
                    .retain(|p| p != &panel);
            });
        }
    });
    Ok(())
}
#[tauri::command]
async fn dock_panel(
    app: tauri::AppHandle,
    runtime: State<'_, Runtime>,
    panel: String,
) -> Result<(), String> {
    runtime
        .studio
        .document
        .write()
        .await
        .detached
        .retain(|p| p != &panel);
    if let Some(w) = app.get_webview_window(&format!("panel-{panel}")) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let root = std::env::var_os("STRATA_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../Strata"));
            let studio = Arc::new(
                studio_core::Studio::new(root, 8080)
                    .with_storage(app.path().app_data_dir()?.join("studio.json")),
            );
            let listener = std::net::TcpListener::bind("127.0.0.1:8080")?;
            listener.set_nonblocking(true)?;
            let (tx, rx) = tokio::sync::oneshot::channel();
            let s = studio.clone();
            tauri::async_runtime::spawn(async move {
                let listener =
                    tokio::net::TcpListener::from_std(listener).expect("nonblocking listener");
                let _ = studio_core::serve(listener, s, async {
                    let _ = rx.await;
                })
                .await;
            });
            app.manage(Runtime {
                studio,
                shutdown: std::sync::Mutex::new(Some(tx)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connection,
            float_panel,
            dock_panel
        ])
        .build(tauri::generate_context!())
        .expect("Cannot start Strata Studio")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let runtime = app.state::<Runtime>();
                tauri::async_runtime::block_on(runtime.studio.stop()).ok();
                if let Some(tx) = runtime.shutdown.lock().unwrap().take() {
                    let _ = tx.send(());
                };
            }
        });
}
