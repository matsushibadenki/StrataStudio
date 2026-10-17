# Roadmap

- 🟢 [Done] Strata structure and Metal/API integration points inspected; upstream source unchanged.
- 🟢 [Done] Tauri 2 desktop GUI and shared Rust Document/State.
- 🟢 [Done] Loopback Axum API gateway with separate session/private upstream keys.
- 🟢 [Done] Engine lifecycle, bounded logs, streamed Rust-owned conversation, cancellation on client disconnect.
- 🟢 [Done] Native floating/docking commands retained for compatibility; the main workspace now uses Chat/Logs tabs.
- 🟢 [Done] English, 日本語, 简体中文 UI and documentation.
- 🟢 [Done] Atomic settings/conversation persistence and transient-state reset.
- 🟢 [Done] Apple Silicon Release build configuration, Thin LTO, macOS 15+ deployment target.
- 🟢 [Done] Mock API integration, browser responsive checks and native window interaction checks.
- 🟢 [Done] In-app Metal model preparation: capacity review, explicit download consent, isolated Python environment, supervised job logs/cancel and automatic config application.
- 🟢 [Done] Native directory/config/Python pickers, installed-config discovery and connection diagnostics.
- 🟢 [Done] Desktop-style File/Edit/View/Help menus; logo menu for About, Preferences and clean app exit.
- 🟢 [Done] Tabbed Preferences for language, Engine and API; full-size Chat/Logs workspace with bottom tabs.
- 🟢 [Done] Conversation JSON export, editing commands, keyboard navigation and responsive menu placement.
- 🟢 [Done] Rust model inventory across Strata, LM Studio, Unsloth Studio, Ollama and persisted custom folders; settings/environment overrides, bounded read-only scans, deduplication, three-language library UI and metadata API.
- 🟢 [Done] Library selection and existing-config activation; validated complete Metal GGUF sets prepare through source links with model downloads blocked, isolated derived output, logs/cancel and config application.
- 🟢 [Done] Real Apple M4 / 32 GiB verification: Q2_0 download with SHA-256 checks, local-file reuse preparation, Metal engine startup, native GUI chat and OpenAI-compatible API inference. Tested with 8K context and prompt chunks of 64; see [verification evidence](LOCAL_INFERENCE_VERIFICATION.md).
- 🟢 [Done] Rust-owned Mac memory profiles: context/prompt-buffer limits applied after preparation/re-preparation and before Metal startup; smaller existing limits retained, atomic config updates, 25 core tests and real Q2_0 re-preparation verified. See [memory policy](MAC_MEMORY.md).
- 🟢 [Done] Engine preferences show automatic/active memory values with persistent manual context, prompt-batch and macOS reserve controls; validated Rust settings, running/preparation locks, auto restoration, 27 core tests and three-language responsive browser checks.
- 🟢 [Done] Engine Start/Stop controls moved above memory settings into a pinned toolbar; edit/apply/start/stop works without scrolling, verified in three languages at 1440, 390 and 320 px widths.
- 🟢 [Done] Apply & restart edits memory settings while running and performs validated stop/save/start in Rust; preparation/generation guards, failure reporting, 29 core tests and three-language one-action restart checks.
- 🟢 [Done] Live Mac system memory usage/availability with cached native Mach sampling, automatic before-change reference and deltas; missing readings stay unavailable, 32 core tests and three-language live/resize checks.
- ⭕️ [Pending] Additional model families beyond the current Metal setup allowlist: the checked-in Mac setup supports only Qwen3.8-Flash-Next GSQ-RCO/Unsloth variants; requires a compatible runtime and real model validation. Existing ready configs remain reusable.
- 🟢 [Done] Rust-owned multi-conversation library: non-destructive New Chat, automatic titles, search, resume, confirmed deletion, legacy migration and persistent history; summary-only snapshots, generation guards and stale-window conversation checks; 38 core tests, three-language responsive interaction checks, restart restoration and native legacy-conversation verification.
- 🟢 [Done] Workspace tab reordering by drag, arrow buttons and keyboard; whole Chat/Logs group floating/docking with shared Rust selection/order, persistent layout, close-to-dock recovery and native duplicate-window prevention. 46 core tests, three-language responsive/two-view checks and native Apple Silicon float/dock/close/restart verified; see [workspace controls](WORKSPACE.md).
- 🟢 [Done] Independent Chat/Logs groups with left/right/top/bottom docking, edge/center drag targets, merge, pointer/keyboard divider resize, persisted split/ratio, responsive stacking and per-group native float/return. Rust derives exact-once groups; 49 core tests, three-language split/merge/two-view checks, existing workspace regressions and native dual-floating/close/dock/shortcut/restart verification passed. See [workspace controls](WORKSPACE.md).
- 🟢 [Done] Direct docking from floating groups into main slots/placeholders or another floating host: destination stays open through merge/split, empty source hosts retire, siblings can return independently, and live generation survives transfer with target-side cancellation. Rust owns transient host routing; 53 core tests, cross-WebView payload/real Rust fixture checks, existing responsive regressions and native menu-driven host/lifecycle/stream checks passed.
- 🟢 [Done] Physical macOS cross-window drag verified with user-authorized CGEvent input: floating-to-main edge docking, floating-to-floating center merge and re-splitting within the retained native host. Trusted WebKit drop events and Rust host maps confirmed each result; original messages/settings/layout were preserved. Drag previews update synchronously, tolerate null relatedTarget within a slot, and recover on dragover; 54 core tests and browser docking regressions passed.
- 🔴 [Later] Recursive docking trees for future additional workspace panels and dragging tabs onto empty desktop space to create a new host.
- 🟢 [Done] Reasoning/tool-call presentation and per-request telemetry: separate reasoning/answer/tool data, response-reported usage and engine timings, gateway latency, completed/cancelled/error states, saved conversation metrics and a bounded 100-request chat/API log. 45 core tests, three-language responsive checks, restart restoration and real Q2_0 measurements verified; see [inference metrics](INFERENCE.md).
- 🔴 [Later] Rust/wgpu rendering for any future heavy GPU visualization; frame data retained natively.
- 🟠 [Next] Repeat longer-context Metal measurements with a larger explicit time budget, then extend retrieval coverage and SSD-streaming/memory-pressure runs. Initial 1,050-token retrieval completed, while the 256-row / logged 4,279-token case reached its 240-second limit; this is not a model accuracy failure. See [benchmark procedure](BENCHMARKS.md).
- ⭕️ [Pending] Real-hardware validation of automatic profiles on Macs other than the 32 GiB M4; capacity boundaries are covered by automated tests.
- ⭕️ [Pending] Signed/notarized distribution: Apple distribution credentials have not been provided.

- 🟢 [Done] エンジンタブにStrataプロセスのphysical footprint、設定適用前の値、再起動後の増減を表示。停止・取得不可は「—」。

- 🟢 [Done] Mac全体・Strata単体のメモリ履歴グラフ（直近10分、2/5/10分切替、ホバー、設定・起動停止・推論イベント）。Rust共有Stateでチャット表示中も記録。

- 🟢 [Done] General preferences persist conversation/composer text size (12–32 px) and light/dark appearance, with live preview, shared Rust settings, old-state defaults and native window theme integration; 40 core tests, three-language responsive checks and native restart persistence verified.

- 🟢 [Done] Opt-in local inference benchmark CLI: existing-model reuse, synthetic retrieval cases, engine-reported usage/timings, sampled memory, bounded request deadlines, interruption/owned-engine cleanup and private report files; nine HTTP/aggregation tests; real 35/1,050-token retrieval, memory samples and stopped-state restoration recorded in [benchmark evidence](BENCHMARKS.md).
- 🟢 [Done] Mac engine memory now sums the dedicated Python/Metal process group instead of Python alone, excluding unrelated groups; process count and parent footprint exposed in metadata, three-language help corrected; 55 core tests and real Q2_0 two-process samples/native display verified.
