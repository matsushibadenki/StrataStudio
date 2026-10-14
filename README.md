# Strata Studio

![Strata Studio](docs/images/stratastudio-image.png)

[日本語](README.ja.md) · [简体中文](README.zh-CN.md)

A Tauri 2 inference workbench and Rust API gateway for the existing [Strata](https://github.com/Niko1221/Strata) engine. macOS builds target Apple Silicon; inference uses Strata's native Metal backend. The upstream source in `Strata/` is unchanged.

## Run

```sh
npm ci
npm run desktop
```

The desktop app owns its loopback API server on `127.0.0.1:8080`. Do not run the standalone server at the same time.

For a browser workbench or a headless API gateway:

```sh
npm run build
cargo run -p studio-server --release
```

Open `http://127.0.0.1:8080`. For frontend development, run `npm run server` and `npm run dev` in separate terminals, then open `http://127.0.0.1:5180`.

## Connect the engine

Set the Strata directory, an absolute Python 3.10+ interpreter path with Strata's dependencies, and a `strata-*.json` configuration produced by upstream setup. Start the engine. The `.venv/bin/python` interpreter and existing configurations are detected on first launch.

For API testing without model files, select **Test engine**. This uses the upstream mock engine; its outputs and logged speeds are not real inference measurements.

Real inference requires the upstream Metal executable, prepared model pack, and tokenizer. Follow [Strata's Mac guide](Strata/docs/MAC.md) to prepare these. Studio does not download a model automatically. On the development Mac (32 GiB), upstream uses SSD expert streaming and keeps its memory protection defaults.

Panels can float into native windows, dock back through their header icon, or return when closed. Configuration, conversation, and in-flight generated text belong to Rust; all windows read that shared state. Configuration and conversation survive restart. Panel placement resets to docked after restart.

## API

Copy the **Session API key** from the API panel. The key rotates when Studio restarts and is not saved. Use it as `Authorization: Bearer`, `x-api-key`, or `x-studio-token`.

| Route                       | Behavior                                                            |
| --------------------------- | ------------------------------------------------------------------- |
| `GET /v1/models`            | Loaded model list                                                   |
| `POST /v1/chat/completions` | OpenAI-compatible JSON or SSE                                       |
| `POST /v1/messages`         | Anthropic-compatible JSON or SSE                                    |
| `POST /v1/responses`        | Upstream Responses API passthrough                                  |
| `GET /status`               | Upstream inference state                                            |
| `GET /health`               | Gateway health; does not imply the model is ready                   |
| `GET /studio/state`         | Authenticated shared application state, engine health, bounded logs |

Only loopback listeners are supported. The upstream Python server uses a separate private port and key. Responses stream through Rust without buffering the complete answer. Model weights, frame data, and GPU buffers never enter a WebView.

The standalone gateway accepts `STRATA_ROOT`, `STUDIO_PORT` (default `8080`), and `STUDIO_STATE_PATH` (default `.studio-state.json` in the working directory). The desktop app saves settings and conversation to its application data directory as `studio.json`. Saved state contains conversation text; remove that file to reset it.

## Build and verify

```sh
npm run build
cargo check --workspace --locked
cargo test -p studio-core --locked
npm run desktop:build -- --bundles app --no-sign
```

Production builds use Thin LTO, one codegen unit, and stripped symbols; the desktop build command targets `aarch64-apple-darwin` and macOS 15+. Signing/notarization requires the distributor's Apple credentials.

For end-to-end tests, keep the Rust server and Vite running, install the Playwright Chromium runtime (`npx playwright install chromium`), then run `npm run test:e2e`. `STUDIO_TEST_PYTHON` selects the test interpreter; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an existing Chromium installation. The test covers lifecycle, streamed GUI chat, API compatibility/authentication, three languages, and 320/375/414/768/1440px widths.

See [architecture](docs/ARCHITECTURE.md) and [roadmap](docs/ROADMAP.md).
