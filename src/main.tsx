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
  Layers,
  FolderOpen,
  FolderSearch,
  Download,
  Settings as SettingsIcon,
} from "lucide-react";
import { words, type Language } from "./i18n";
import { action, connect, desktop, request, streamChat, token } from "./client";
import "./style.css";
import { SetupDialog, type Inspection, type Preparation } from "./SetupDialog";
import type { Layout } from "./ResizeHandle";
import { AppMenus, type AppMenu } from "./AppMenus";
import {
  Modal,
  PreferencesDialog,
  type PreferenceTab,
} from "./PreferencesDialog";
import { ModelLibraryDialog } from "./ModelLibraryDialog";
import {
  MemoryControls,
  defaultMemory,
  type MemorySettings,
  type MemoryTuning,
} from "./MemoryControls";
import type { MemoryUsageState } from "./MemoryUsage";
type Settings = {
  strataRoot: string;
  python: string;
  config: string;
  mock: boolean;
  temperature: number;
  maxTokens: number;
  language: Language;
  modelDirectories: string[];
  metalMemory: MemorySettings;
};
type Message = { role: string; content: string };
type Snapshot = {
  status: "offline" | "starting" | "ready";
  settings: Settings;
  document: {
    messages: Message[];
    detached: string[];
    generating: boolean;
    layout: Layout;
  };
  preparation: Preparation;
  logs: string[];
  architecture: string;
  memoryBytes: number | null;
  memoryTuning: MemoryTuning;
  memoryUsage: MemoryUsageState;
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
  modelDirectories: [],
  metalMemory: defaultMemory,
};
const panelView = new URLSearchParams(location.search).get("panel");
function App() {
  const [modelsOpen, setModelsOpen] = useState(false);
  const [setupLocalView, setSetupLocalView] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferenceTab, setPreferenceTab] = useState<PreferenceTab>("general");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"chat" | "logs">("chat");
  const editor = useRef<{
    element: HTMLInputElement | HTMLTextAreaElement;
    start: number | null;
    end: number | null;
  } | null>(null);
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
  const [copied, setCopied] = useState("");
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const initialized = useRef(false);
  const draftRef = useRef(settings);
  const dirty = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const t = words[language];
  const preparing = ["running", "cancelling"].includes(
    snapshot?.preparation?.status || "",
  );
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
  async function inspectSetup() {
    const data: Inspection = await request("/studio/inspect").then((r) =>
      r.json(),
    );
    setInspection(data);
  }
  async function browse(kind: "root" | "config" | "python") {
    await run(async () => {
      const path = await invoke<string | null>("select_path", { kind });
      if (path) {
        update(kind === "root" ? "strataRoot" : kind, path);
        await persist();
      }
    });
  }
  async function openSetup() {
    setSetupLocalView(false);
    await run(async () => {
      if (!preparing) await persist();
      await inspectSetup();
      setSetupOpen(true);
    });
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
        draggable={desktop && !!panelView}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}
      >
        <h2>
          {icon}
          {t[id]}
        </h2>
        <div className="tools">
          {extra}
          {panelView &&
            button(
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
        {panelHeader(
          "engine",
          <Cpu />,
          <>
            <div className="process-buttons">
              <button
                className="primary"
                disabled={
                  pending || !online || status !== "offline" || preparing
                }
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
            {button(
              <FolderSearch />,
              t.localModels,
              () =>
                run(async () => {
                  if (dirty.current && !preparing) await persist();
                  setModelsOpen(true);
                }),
              !online || pending,
            )}
            {button(
              <Download />,
              preparing ? t.setupRunning : t.prepare,
              () => openSetup(),
              !online || pending,
            )}
          </>,
        )}
        <div className="panel-body">
          {snapshot?.backend === "Metal" && (
            <MemoryControls
              value={settings.metalMemory ?? defaultMemory}
              tuning={snapshot?.memoryTuning}
              usage={snapshot?.memoryUsage}
              memoryBytes={snapshot?.memoryBytes ?? null}
              language={language}
              disabled={preparing || pending || !online}
              running={status !== "offline"}
              generating={busy || !!snapshot?.document.generating}
              onRestart={async (value) => {
                await action("applyMemoryRestart", { memory: value });
                const next = { ...draftRef.current, metalMemory: value };
                draftRef.current = next;
                setSettings(next);
              }}
              onSave={async (value) => {
                update("metalMemory", value);
                await persist();
              }}
            />
          )}
          <label>
            {t.root}
            <div className="path-input">
              <input
                aria-label={t.root}
                value={settings.strataRoot}
                disabled={status !== "offline" || preparing}
                onChange={(e) => update("strataRoot", e.target.value)}
                onBlur={() =>
                  persist().catch((e: Error) => setError(e.message))
                }
              />
              {desktop
                ? button(
                    <FolderOpen />,
                    t.browse + " · " + t.root,
                    () => browse("root"),
                    status !== "offline" || preparing || pending,
                  )
                : null}
            </div>
          </label>
          <label>
            {t.config}
            <span title={t.configHelp}>
              <Info size={13} />
            </span>
            <div className="path-input">
              <input
                aria-label={t.config}
                value={settings.config}
                placeholder="strata-iq3_s.json"
                disabled={status !== "offline" || preparing}
                onBlur={() =>
                  persist().catch((e: Error) => setError(e.message))
                }
                onChange={(e) => update("config", e.target.value)}
              />
              {desktop
                ? button(
                    <FolderOpen />,
                    t.browse + " · " + t.config,
                    () => browse("config"),
                    status !== "offline" || preparing || pending,
                  )
                : null}
            </div>
          </label>
          <label>
            {t.python}
            <div className="path-input">
              <input
                aria-label={t.python}
                value={settings.python}
                disabled={status !== "offline" || preparing}
                onBlur={() =>
                  persist().catch((e: Error) => setError(e.message))
                }
                onChange={(e) => update("python", e.target.value)}
              />
              {desktop
                ? button(
                    <FolderOpen />,
                    t.browse + " · " + t.python,
                    () => browse("python"),
                    status !== "offline" || preparing || pending,
                  )
                : null}
            </div>
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
              disabled={status !== "offline" || preparing}
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
          <div className="divider" />
          <div className="value-row">
            <span>{t.status}</span>
            <span className={"status " + status}>
              <i />
              {t[status]}
            </span>
          </div>
          {preparing ? (
            <p className="test-label" role="status">
              {t.setupRunning}
            </p>
          ) : null}
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
              disabled={preparing}
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
              disabled={preparing}
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
      <section className="panel logs">
        {panelHeader(
          "logs",
          <FileText />,
          button(
            <Trash2 />,
            t.clear,
            () => run(() => action("clearLogs")),
            !online,
          ),
        )}
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
  function openPreferences(tab: PreferenceTab = "general") {
    setPreferenceTab(tab);
    setPreferencesOpen(true);
  }
  async function closePreferences() {
    try {
      if (dirty.current && !preparing) await persist();
      setPreferencesOpen(false);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }
  function captureEditor() {
    const element = document.activeElement;
    if (
      (element instanceof HTMLTextAreaElement ||
        element instanceof HTMLInputElement) &&
      !element.readOnly &&
      !element.disabled
    ) {
      editor.current = {
        element,
        start: element.selectionStart,
        end: element.selectionEnd,
      };
    }
  }
  async function edit(command: string) {
    if (workspaceTab === "logs") {
      if (command === "selectAll") {
        const log = document.querySelector(".log-lines");
        if (log) {
          const range = document.createRange();
          range.selectNodeContents(log);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      } else if (command === "copy") {
        await copy(window.getSelection()?.toString() || "", "logs");
      }
      return;
    }

    const saved = editor.current;
    const target = saved?.element.isConnected
      ? saved.element
      : document.querySelector<HTMLTextAreaElement>(".composer textarea");
    if (!target) return;
    target.focus();
    if (saved?.element === target && saved.start !== null && saved.end !== null)
      target.setSelectionRange(saved.start, saved.end);
    try {
      if (command === "paste") {
        const text = await navigator.clipboard.readText();
        document.execCommand("insertText", false, text);
      } else document.execCommand(command);
      captureEditor();
    } catch (e) {
      setError(String((e as Error).message));
    }
  }
  async function exportChat() {
    if (desktop) {
      await run(() => invoke("export_conversation"));
      return;
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, messages }, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "Strata-conversation.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const newChat = () => run(() => action("messages", { messages: [] }));
  const menus: AppMenu[] = [
    {
      label: "Strata Studio",
      icon: <Layers />,
      brand: true,
      items: [
        { label: t.about, action: () => setAboutOpen(true) },
        {
          label: t.preferences,
          shortcut: "⌘,",
          action: () => openPreferences(),
          separator: true,
        },
        {
          label: t.quit,
          shortcut: "⌘Q",
          action: () => run(() => invoke("quit_app")),
          disabled: !desktop,
          separator: true,
        },
      ],
    },
    {
      label: t.fileMenu,
      items: [
        {
          label: t.newChat,
          shortcut: "⌘N",
          action: newChat,
          disabled: !online || busy || snapshot?.document.generating,
        },
        {
          label: t.exportChat,
          action: exportChat,
          disabled: !messages.length || busy,
        },
        {
          label: t.preferences,
          shortcut: "⌘,",
          action: () => openPreferences(),
          separator: true,
        },
      ],
    },
    {
      label: t.editMenu,
      items: [
        {
          label: t.undo,
          shortcut: "⌘Z",
          action: () => edit("undo"),
          disabled: workspaceTab !== "chat",
        },
        {
          label: t.redo,
          shortcut: "⇧⌘Z",
          action: () => edit("redo"),
          disabled: workspaceTab !== "chat",
        },
        {
          label: t.cut,
          shortcut: "⌘X",
          action: () => edit("cut"),
          disabled: workspaceTab !== "chat",
          separator: true,
        },
        { label: t.copy, shortcut: "⌘C", action: () => edit("copy") },
        {
          label: t.paste,
          shortcut: "⌘V",
          action: () => edit("paste"),
          disabled: workspaceTab !== "chat",
        },
        {
          label: t.selectAll,
          shortcut: "⌘A",
          action: () => edit("selectAll"),
          separator: true,
        },
      ],
    },
    {
      label: t.viewMenu,
      items: [
        {
          label: t.chat,
          shortcut: "⌘1",
          selected: workspaceTab === "chat",
          action: () => setWorkspaceTab("chat"),
        },
        {
          label: t.logs,
          shortcut: "⌘2",
          selected: workspaceTab === "logs",
          action: () => setWorkspaceTab("logs"),
        },
      ],
    },
    {
      label: t.helpMenu,
      items: [{ label: t.about, action: () => setAboutOpen(true) }],
    },
  ];
  useEffect(() => {
    function shortcuts(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.isComposing) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === ",") {
        e.preventDefault();
        openPreferences();
      } else if (
        e.key.toLowerCase() === "n" &&
        online &&
        !busy &&
        !snapshot?.document.generating
      ) {
        e.preventDefault();
        newChat();
      } else if (["1", "2"].includes(e.key)) {
        e.preventDefault();
        setWorkspaceTab(e.key === "1" ? "chat" : "logs");
      }
    }
    document.addEventListener("keydown", shortcuts);
    return () => document.removeEventListener("keydown", shortcuts);
  });
  return (
    <div className={"workbench app-shell " + (panelView ? "floating" : "")}>
      <header className="app-header">
        <AppMenus menus={menus} onBeforeOpen={captureEditor} />
        {button(<SettingsIcon />, t.preferences, () => openPreferences())}
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
        <main className="workspace">
          <div
            className="workspace-content"
            role="tabpanel"
            id="workspace-content"
            aria-labelledby={"workspace-" + workspaceTab}
          >
            <div hidden={workspaceTab !== "chat"} className="workspace-page">
              {chat()}
            </div>
            <div hidden={workspaceTab !== "logs"} className="workspace-page">
              {logs()}
            </div>
          </div>
          <div
            className="workspace-tabs"
            role="tablist"
            aria-label={t.workspaceTabs}
          >
            {(["chat", "logs"] as const).map((id) => (
              <button
                key={id}
                role="tab"
                id={"workspace-" + id}
                aria-selected={workspaceTab === id}
                aria-controls="workspace-content"
                tabIndex={workspaceTab === id ? 0 : -1}
                onClick={() => setWorkspaceTab(id)}
                onKeyDown={(e) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  ) {
                    e.preventDefault();
                    const next =
                      e.key === "Home"
                        ? "chat"
                        : e.key === "End"
                          ? "logs"
                          : id === "chat"
                            ? "logs"
                            : "chat";
                    setWorkspaceTab(next);
                    document.getElementById("workspace-" + next)?.focus();
                  }
                }}
              >
                {id === "chat" ? <MessageSquare /> : <FileText />}
                {t[id]}
              </button>
            ))}
          </div>
        </main>
      )}
      {preferencesOpen && (
        <PreferencesDialog
          language={language}
          tab={preferenceTab}
          onTab={setPreferenceTab}
          onClose={closePreferences}
          error={error}
        >
          {preferenceTab === "general" ? (
            <section className="general-settings">
              <label>{t.language}</label>
              <nav className="language-options" aria-label={t.language}>
                {(["ja", "en", "zh"] as const).map((l) => (
                  <button
                    key={l}
                    aria-pressed={l === language}
                    disabled={!online || preparing}
                    onClick={() => changeLanguage(l)}
                  >
                    {l === "ja"
                      ? "日本語"
                      : l === "en"
                        ? "English"
                        : "简体中文"}
                  </button>
                ))}
              </nav>
            </section>
          ) : preferenceTab === "engine" ? (
            engine()
          ) : (
            api()
          )}
        </PreferencesDialog>
      )}
      {modelsOpen && (
        <ModelLibraryDialog
          language={language}
          directories={settings.modelDirectories || []}
          locked={preparing}
          engineOffline={status === "offline"}
          onUse={async (path) => {
            if (dirty.current) await persist();
            await action("useLocalModel", { path, confirmed: true });
            const next: Snapshot = await request("/studio/state").then((r) =>
              r.json(),
            );
            setSnapshot(next);
            setSettings(next.settings);
            draftRef.current = next.settings;
            dirty.current = false;
            setModelsOpen(false);
            if (["running", "cancelling"].includes(next.preparation.status)) {
              await inspectSetup();
              setSetupLocalView(true);
              setSetupOpen(true);
            }
          }}
          onDirectories={async (paths) => {
            update("modelDirectories", paths);
            await persist();
          }}
          onClose={() => setModelsOpen(false)}
        />
      )}
      {aboutOpen && (
        <Modal
          title={t.about}
          language={language}
          className="about-dialog"
          onClose={() => setAboutOpen(false)}
        >
          <div className="about-content">
            <Layers className="about-logo" />
            <h3>Strata Studio</h3>
            <p>{t.aboutDescription}</p>
            <dl>
              <dt>{t.version}</dt>
              <dd>0.1.0</dd>
              <dt>{t.platform}</dt>
              <dd>
                {snapshot?.architecture || "—"} / {snapshot?.backend || "—"}
              </dd>
            </dl>
            <small>Strata · MIT License</small>
          </div>
        </Modal>
      )}
      {setupOpen ? (
        <SetupDialog
          language={language}
          localView={setupLocalView}
          inspection={inspection}
          job={
            snapshot?.preparation || { status: "idle", model: "", error: null }
          }
          engineOffline={status === "offline"}
          config={settings.config}
          onModels={() => setModelsOpen(true)}
          onInspect={inspectSetup}
          onConfig={async (path) => {
            update("config", path);
            await persist();
            await inspectSetup();
          }}
          onPrepare={async (model) => {
            await action("prepare", { model, confirmed: true });
            const s = await request("/studio/state").then((r) => r.json());
            setSnapshot(s);
          }}
          onCancel={async () => {
            await action("cancelPreparation");
          }}
          onClose={() => setSetupOpen(false)}
        />
      ) : null}
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
