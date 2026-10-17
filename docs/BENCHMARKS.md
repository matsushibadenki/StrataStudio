# Local inference measurements

Use an existing prepared model and the running Studio app or standalone gateway. The script never prepares/downloads a model, changes settings, or writes chat messages. It sends only generated retrieval text through the authenticated loopback API. Mock engines are rejected.

```sh
npm run benchmark:inference -- --start --output /tmp/strata-benchmark.json
npm run test:benchmark
```

Without `--start`, the engine must already be ready. With it, an offline engine is started and stopped afterward, including on HTTP errors, timeout, SIGINT or SIGTERM. An engine that was already running stays running. SIGKILL or machine power loss cannot run cleanup. Stop errors are reported explicitly; inspect the Engine tab if cleanup fails. Do not run alongside another inference client.

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--url` | `http://127.0.0.1:8080` | Plain IPv4 loopback gateway URL only |
| `--rows` | `0,64,256` | 1–8 cases, each with 0–512 synthetic filler rows |
| `--timeout` | `240000` | Maximum milliseconds per request and startup readiness wait; 1000–900000 |
| `--start` | off | Start only if offline, and restore stopped state afterward |
| `--output` | none | New JSON file; existing files are never overwritten |

Each request asks for a known code inserted halfway through the filler records. Temperature is 0, reasoning is explicitly disabled, output is capped at 64 tokens. `rows` and `inputBytes` describe input construction, not token counts. `usage` and `timings` are copied from the engine response; absent fields remain absent/null. Elapsed time includes gateway/HTTP overhead. Retrieval reports `exact`, `contains`, `incorrect` or `unanswered`; completion status alone does not mean retrieval was correct. This small synthetic task is not a general model accuracy evaluation.

Mac and engine memory are sampled sequentially about once per second, using the gateway's cached native samples. The report includes timestamps and sampled peaks/minimum availability; brief peaks may be missed. Mac memory includes other apps and reclaimable caches. Engine memory sums physical footprints charged to the server's private process group, including its native Metal child; shared allocations can be charged to multiple processes. It is not unique physical pages or model file size. The report includes `processCount` and `rootBytes` to distinguish the group from Python alone. Do not compare legacy parent-only measurements with the new group totals.

The script stops measurement if reported available system memory falls below 2 GiB. This is a sampling guard, not a guarantee against memory pressure or swap. Requests stop at their timeout; partial failures remain in the JSON. Report files contain no chat text, model output, session key or full settings. They do include machine capacity, model ID and memory policy. Cold/warm caches and other processes can affect results; cases run sequentially without flushing caches.

日本語: 既存モデルを再利用し、短い入力から段階的に測定します。トークン数はエンジンの報告値のみで、行数から推定しません。メモリは約1秒間隔の標本値で、瞬間的なピークや共有領域の重複計上に注意してください。会話履歴と設定は変更しません。停止中から起動した場合は終了時に停止へ戻します。

简体中文：重复使用已有模型，从较短输入逐步测量。token数仅采用引擎报告值，不按行数估算。内存约每秒采样，可能遗漏瞬时峰值，共享分配也可能重复计入。不会修改对话和设置；从停止状态启动的引擎会在结束后停止。

## Apple M4 / 32 GiB observations · 2026-10-17

Existing `qwen3.8-flash-next-q2_0`, automatic 8,192 context, prompt chunk 64, 7 GB reserve, SSD streaming. No model downloads. Initial sequential run:

| Filler rows | Reported input / output tokens | HTTP elapsed | Retrieval |
| --- | --- | --- | --- |
| 0 | 35 / 8 | 15.651 s | Exact |
| 64 | 1,050 / 8 | 76.827 s | Exact |
| 256 | No final usage; engine log said 4,279 input tokens | 240.185 s, timeout | Not evaluated |

The initial run used parent-only engine memory; those memory samples are excluded from the [initial timing evidence](benchmarks/metal-m4-32g-20261017-initial.json). Timeout does not establish a retrieval/accuracy failure. The script restored the stopped engine state. This is one sequential run under other desktop activity, not an isolated performance comparison or a claim that the context limit was reached.

The [corrected-group-memory rerun](benchmarks/metal-m4-32g-20261017.json) used the same model and policy, with cases 0 and 64 and a 120-second request deadline. Both returned the exact code: 35/8 tokens in 10.913 s and 1,050/8 tokens in 89.637 s. All 99 engine memory samples counted two processes. Sampled group footprint peaked at 7.62 GiB; minimum reported Mac availability was 4.48 GiB. These are summed per-process footprint samples, not unique physical memory or continuous peaks. Different timings between runs are observations under desktop activity, not evidence that memory accounting changed inference performance.

Native Engine preferences showed the group total and graph, then “—” after the engine stopped. The full document (including six original messages, conversation summaries and layout) and settings matched the pre-run snapshot. No model downloads occurred. Verification: 55 Rust tests, nine benchmark HTTP/aggregation tests and Apple Silicon release build passed. Larger/sustained context, broader accuracy, SSD-throughput isolation and other Mac capacities remain unverified.
