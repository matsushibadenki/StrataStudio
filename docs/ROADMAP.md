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
- 🟠 [Next] Additional model families and runtime-specific import paths beyond the current Metal setup allowlist.
- 🔴 [Later] Multi-conversation library and history navigation.
- 🔴 [Later] Advanced panel reordering and floating tab groups.
- 🔴 [Later] Reasoning/tool-call presentation and measured telemetry views.
- 🔴 [Later] Rust/wgpu rendering for any future heavy GPU visualization; frame data retained natively.
- ⭕️ [Pending] Extended Metal memory-pressure, long-context, accuracy and SSD-streaming benchmarks; real inference checks so far use short requests on this development Mac.
- ⭕️ [Pending] Real-hardware validation of automatic profiles on Macs other than the 32 GiB M4; capacity boundaries are covered by automated tests.
- ⭕️ [Pending] Signed/notarized distribution: Apple distribution credentials have not been provided.

- 🟢 [Done] エンジンタブにStrataプロセスのphysical footprint、設定適用前の値、再起動後の増減を表示。停止・取得不可は「—」。

- 🟢 [Done] Mac全体・Strata単体のメモリ履歴グラフ（直近10分、2/5/10分切替、ホバー、設定・起動停止・推論イベント）。Rust共有Stateでチャット表示中も記録。
