import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import {
  Cpu,
  MessageSquare,
  Link,
  FileText,
  ExternalLink,
  PanelLeftClose,
  Play,
  Square,
  Send,
  Copy,
  Check,
  Info,
  Trash2,
  Plus,
  Monitor,
  ChevronDown,
  ChevronUp,
  Layers,
} from "lucide-react";
import { words, type Language } from "./i18n";
import { action, connect, desktop, request, streamChat, token } from "./client";
import "./style.css";
type Settings = {
  strataRoot: string;
  python: string;
  config: string;
  mock: boolean;
  temperature: number;
  maxTokens: number;
  language: Language;
};
type Message = { role: string; content: string };
type Snapshot = {
  status: "offline" | "starting" | "ready";
  settings: Settings;
  document: { messages: Message[]; detached: string[]; generating: boolean };
  logs: string[];
  architecture: string;
  memoryBytes: number | null;
  backend: string;
  endpoint: string;
  root: string;
  health: { model?: string } | null;
};
const defaults: Settings = {
  strataRoot: "",
  python: "python3",
  config: "",
  mock: false,
  temperature: 0.7,
  maxTokens: 512,
  language: "ja",
};
const panelView = new URLSearchParams(location.search).get("panel");
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [settings, setSettings] = useState<Settings>(defaults);
  const [language, setLanguage] = useState<Language>("ja");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState("");
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const initialized = useRef(false);
  const draftRef = useRef(settings);
  const dirty = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const t = words[language];
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
  }, [language]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (!initialized.current) {
          await connect();
        }
        const s: Snapshot = await request("/studio/state").then((r) =>
          r.json(),
        );
        if (!alive) return;
        setSnapshot(s);
        setOnline(true);
        setConnectionFailed(false);
        setLanguage(s.settings.language);
        if (!initialized.current || !dirty.current) {
          setSettings(s.settings);
          draftRef.current = s.settings;
          initialized.current = true;
        }
        if (!busyRef.current) setMessages(s.document.messages);
      } catch {
        if (alive) {
          setOnline(false);
          setConnectionFailed(true);
          initialized.current = false;
        }
      }
      if (alive) timer = setTimeout(poll, 1200);
    }
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages]);
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    const next = { ...draftRef.current, [key]: value };
    dirty.current = true;
    draftRef.current = next;
    setSettings(next);
  }
  async function persist() {
    await action("settings", { settings: draftRef.current });
    dirty.current = false;
  }
  async function run(fn: () => Promise<unknown>) {
    setError("");
    setPending(true);
    try {
      await fn();
      const s = await request("/studio/state").then((r) => r.json());
      setSnapshot(s);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setPending(false);
    }
  }
  async function changeLanguage(l: Language) {
    setLanguage(l);
    update("language", l);
    await run(persist);
  }
  async function float(panel: string) {
    if (!desktop) {
      setError(t.unavailable);
      return;
    }
    await run(() =>
      invoke(panelView ? "dock_panel" : "float_panel", { panel }),
    );
  }
  async function copy(value: string, id: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => setCopied(""), 1500);
    } catch (e) {
      setError(String(e));
    }
  }
  async function send() {
    if (
      !prompt.trim() ||
      busy ||
      snapshot?.document.generating ||
      snapshot?.status !== "ready"
    )
      return;
    setError("");
    const next = [...messages, { role: "user", content: prompt.trim() }];
    setPrompt("");
    busyRef.current = true;
    setBusy(true);
    const c = new AbortController();
    controller.current = c;
    let answer = "";
    setMessages([...next, { role: "assistant", content: "" }]);
    try {
      await persist();
      await streamChat(
        {
          model: snapshot.health?.model || "qwen3.8-flash-next",
          messages: next,
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          stream: true,
        },
        c.signal,
        (delta) => {
          answer += delta;
          setMessages([...next, { role: "assistant", content: answer }]);
        },
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      const final = answer
        ? [...next, { role: "assistant", content: answer }]
        : next;
      setMessages(final);
      busyRef.current = false;
      setBusy(false);
      controller.current = null;
    }
  }
  const status = online ? snapshot?.status || "offline" : "offline";
  function button(
    icon: React.ReactNode,
    title: string,
    onClick: () => void,
    disabled = false,
  ) {
    return (
      <button
        className="icon-button"
        title={title}
        aria-label={title}
        onClick={onClick}
        disabled={disabled}
      >
        {icon}
      </button>
    );
  }
  function panelHeader(
    id: "engine" | "api" | "logs",
    icon: React.ReactNode,
    extra?: React.ReactNode,
  ) {
    return (
      <header
        className="panel-header"
        draggable={desktop}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}
      >
        <h2>
          {icon}
          {t[id]}
        </h2>
        <div className="tools">
          {extra}
          {button(
            panelView ? <PanelLeftClose /> : <ExternalLink />,
            panelView ? t.dock : t.float,
            () => float(id),
          )}
        </div>
      </header>
    );
  }
  function engine() {
    return (
      <section className="panel engine">
        {panelHeader("engine", <Cpu />)}
        <div className="panel-body">
          <label>
            {t.root}
            <input
              aria-label={t.root}
              value={settings.strataRoot}
              disabled={status !== "offline"}
              onChange={(e) => update("strataRoot", e.target.value)}
              onBlur={() => persist().catch((e: Error) => setError(e.message))}
            />
          </label>
          <label>
            {t.config}
            <span title={t.configHelp}>
              <Info size={13} />
            </span>
            <input
              aria-label={t.config}
              value={settings.config}
              placeholder="strata-iq3_s.json"
              disabled={status !== "offline"}
              onBlur={() => persist().catch((e: Error) => setError(e.message))}
              onChange={(e) => update("config", e.target.value)}
            />
          </label>
          <label>
            {t.python}
            <input
              aria-label={t.python}
              value={settings.python}
              disabled={status !== "offline"}
              onBlur={() => persist().catch((e: Error) => setError(e.message))}
              onChange={(e) => update("python", e.target.value)}
            />
          </label>
          <div className="value-row">
            <span>{t.port}</span>
            <code>8080</code>
          </div>
          <div className="value-row">
            <span>{t.platform}</span>
            <code>
              {snapshot?.architecture || "—"} / {snapshot?.backend || "—"}
            </code>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.mock}
              disabled={status !== "offline"}
              onChange={(e) => {
                update("mock", e.target.checked);
                run(persist);
              }}
            />
            {t.mock}
            <span title={t.mockHelp}>
              <Info size={13} />
            </span>
          </label>
          <div className="process-buttons">
            <button
              className="primary"
              disabled={pending || !online || status !== "offline"}
              onClick={() =>
                run(async () => {
                  await persist();
                  await action("start");
                })
              }
            >
              <Play size={13} />
              {t.start}
            </button>
            <button
              disabled={pending || !online || status === "offline" || busy}
              onClick={() => run(() => action("stop"))}
            >
              <Square size={11} />
              {t.stop}
            </button>
          </div>
          <div className="divider" />
          <div className="value-row">
            <span>{t.status}</span>
            <span className={"status " + status}>
              <i />
              {t[status]}
            </span>
          </div>
          {settings.mock && status !== "offline" ? (
            <p className="test-label">{t.testMode}</p>
          ) : null}
        </div>
      </section>
    );
  }
  function api() {
    return (
      <section className="panel api">
        {panelHeader("api", <Link />)}
        <div className="panel-body">
          <label>
            {t.base}
            <div className="copy-field">
              <code>{snapshot?.endpoint || "http://127.0.0.1:8080/v1"}</code>
              {button(copied === "url" ? <Check /> : <Copy />, t.copy, () =>
                copy(snapshot?.endpoint || "", "url"),
              )}
            </div>
          </label>
          <label>
            {t.key}
            <div className="copy-field">
              <code>••••••••••••••••</code>
              {button(copied === "key" ? <Check /> : <Copy />, t.copy, () =>
                copy(token(), "key"),
              )}
            </div>
          </label>
          <div className="divider" />
          <h3>{t.endpoints}</h3>
          <div className="endpoint">
            <span>OpenAI</span>
            <code>/v1/chat/completions</code>
          </div>
          <div className="endpoint">
            <span>Anthropic</span>
            <code>/v1/messages</code>
          </div>
          <div className="endpoint">
            <span>Models</span>
            <code>/v1/models</code>
          </div>
          <div className="divider" />
          <h3>{t.request}</h3>
          <label className="value-row">
            {t.temperature}
            <input
              aria-label={t.temperature}
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={
                Number.isFinite(settings.temperature)
                  ? settings.temperature
                  : ""
              }
              onChange={(e) => update("temperature", e.target.valueAsNumber)}
              onBlur={() => persist().catch((e: Error) => setError(e.message))}
            />
          </label>
          <label className="value-row">
            {t.tokens}
            <input
              aria-label={t.tokens}
              type="number"
              min="1"
              max="262144"
              value={
                Number.isFinite(settings.maxTokens) ? settings.maxTokens : ""
              }
              onChange={(e) => update("maxTokens", e.target.valueAsNumber)}
              onBlur={() => persist().catch((e: Error) => setError(e.message))}
            />
          </label>
          <div className="model-name">
            <Layers size={15} />
            <code>{snapshot?.health?.model || "—"}</code>
          </div>
        </div>
      </section>
    );
  }
  function logs() {
    return (
      <section className={"panel logs " + (collapsed ? "collapsed" : "")}>
        {panelHeader(
          "logs",
          <FileText />,
          <>
            {button(
              <Trash2 />,
              t.clear,
              () => run(() => action("clearLogs")),
              !online,
            )}
            {button(collapsed ? <ChevronUp /> : <ChevronDown />, t.logs, () =>
              setCollapsed(!collapsed),
            )}
          </>,
        )}
        {!collapsed ? (
          <div className="log-lines">
            {snapshot?.logs.length ? (
              snapshot.logs.map((line, i) => (
                <div key={i}>
                  <span>{i + 1}</span>
                  <code>{line}</code>
                </div>
              ))
            ) : (
              <div>
                <span>1</span>
                <code>{t.none}</code>
              </div>
            )}
          </div>
        ) : null}
      </section>
    );
  }
  function chat() {
    return (
      <section className="panel chat">
        <header className="panel-header">
          <h2>
            <MessageSquare />
            {t.chat}
          </h2>
          {button(
            <Plus />,
            t.newChat,
            () =>
              run(async () => {
                await action("messages", { messages: [] });
                setMessages([]);
              }),
            busy || !online,
          )}
        </header>
        <div className="conversation" ref={scroll}>
          {messages.length ? (
            messages.map((m, i) => (
              <article className={"message " + m.role} key={i}>
                <div>{m.role === "user" ? t.you : "Strata"}</div>
                <p>{m.content || "…"}</p>
              </article>
            ))
          ) : (
            <div className="empty">
              <MessageSquare />
              <p>{t.empty}</p>
            </div>
          )}
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            aria-label={t.placeholder}
            placeholder={t.placeholder}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              className="primary"
              aria-label={t.cancel}
              title={t.cancel}
              onClick={() => controller.current?.abort()}
            >
              <Square />
            </button>
          ) : (
            <button
              className="primary"
              aria-label={t.send}
              title={t.send}
              disabled={
                status !== "ready" ||
                snapshot?.document.generating ||
                !prompt.trim()
              }
            >
              <Send />
            </button>
          )}
        </form>
      </section>
    );
  }
  return (
    <div className={"workbench " + (panelView ? "floating" : "")}>
      <header className="app-header">
        <h1>
          <Layers />
          Strata Studio
        </h1>
        <nav aria-label="Language">
          {(["ja", "en", "zh"] as Language[]).map((l) => (
            <button
              key={l}
              className={l === language ? "selected" : ""}
              disabled={!online}
              onClick={() => changeLanguage(l)}
            >
              {l === "ja" ? "日本語" : l === "en" ? "English" : "简体中文"}
            </button>
          ))}
        </nav>
      </header>
      {!online ? (
        <div className="notice" role="status">
          {connectionFailed ? t.connectionError : t.connecting}
        </div>
      ) : null}
      {error ? (
        <div className="notice error" role="alert">
          {error}
          {button(<Square />, t.clear, () => setError(""))}
        </div>
      ) : null}
      {panelView ? (
        <main className="floating-main">
          {panelView === "engine"
            ? engine()
            : panelView === "api"
              ? api()
              : logs()}
        </main>
      ) : (
        <>
          <main
            className="dock-layout"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const p = e.dataTransfer.getData("text/plain");
              if (["engine", "api", "logs"].includes(p) && desktop)
                run(() => invoke("dock_panel", { panel: p }));
            }}
          >
            {!snapshot?.document.detached.includes("engine") ? engine() : null}
            {chat()}
            {!snapshot?.document.detached.includes("api") ? api() : null}
          </main>
          {!snapshot?.document.detached.includes("logs") ? logs() : null}
        </>
      )}
      <footer className="statusbar">
        <span>Strata Studio</span>
        <span>
          <Monitor size={14} />
          {snapshot?.architecture || "—"} / {snapshot?.backend || "—"}
        </span>
        <span className={"status " + status}>
          <i />
          {t[status]}
        </span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
