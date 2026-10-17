// Local, opt-in inference measurements. Never downloads models or edits settings/history.
import { open } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export function options(args) {
  const result = {
    url: "http://127.0.0.1:8080",
    rows: [0, 64, 256],
    timeout: 240000,
    start: false,
    output: null,
  };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--start") result.start = true;
    else if (key === "--url") result.url = args[++i];
    else if (key === "--rows") result.rows = args[++i]?.split(",").map(Number);
    else if (key === "--timeout") result.timeout = Number(args[++i]);
    else if (key === "--output") result.output = args[++i];
    else throw Error(`Unknown option: ${key}`);
  }
  const url = new URL(result.url);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw Error("Use a plain loopback http://127.0.0.1:PORT URL");
  if (
    !result.rows?.length ||
    result.rows.length > 8 ||
    result.rows.some((n) => !Number.isInteger(n) || n < 0 || n > 512)
  )
    throw Error("Rows must contain 1–8 integers between 0 and 512");
  if (
    !Number.isInteger(result.timeout) ||
    result.timeout < 1000 ||
    result.timeout > 900000
  )
    throw Error("Timeout must be 1000–900000 ms");
  if (result.output === undefined) throw Error("--output needs a file path");
  result.url = url.origin;
  return result;
}
export function makePrompt(rows) {
  const lines = Array.from(
    { length: rows },
    (_, i) =>
      `Record ${i + 1}: item ${String((i * 7919) % 10000).padStart(4, "0")} has status archived.`,
  );
  lines.splice(
    Math.floor(rows / 2),
    0,
    "The verification code is STRATA-7391.",
  );
  return (
    lines.join("\n") +
    "\nReturn only the verification code, with no explanation."
  );
}

export function memorySummary(samples) {
  const system = samples
    .map((s) => s.system?.usedBytes)
    .filter(Number.isFinite);
  const available = samples
    .map((s) => s.system?.availableBytes)
    .filter(Number.isFinite);
  const engine = samples
    .map((s) => s.engine?.usedBytes)
    .filter(Number.isFinite);
  return {
    sampledSystemPeakBytes: system.length ? Math.max(...system) : null,
    sampledEnginePeakBytes: engine.length ? Math.max(...engine) : null,
    sampledMinimumAvailableBytes: available.length
      ? Math.min(...available)
      : null,
    samples: samples.length,
  };
}

export async function benchmark(config, emit = console.error) {
  const report = {
    schema: 1,
    startedAt: new Date().toISOString(),
    kind: "synthetic-retrieval",
    tokenCounts: "engine-reported only; rows are not tokens",
    samples: [],
    cases: [],
  };
  let headers,
    started = false,
    interrupted = false,
    active;
  const onInterrupt = () => {
    interrupted = true;
    active?.abort();
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  async function api(path, init = {}, signal) {
    const response = await fetch(config.url + path, {
      ...init,
      headers: { ...headers, ...init.headers },
      signal: signal || AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(`${path}: HTTP ${response.status}`);
    }
    return response.json();
  }
  const state = () => api("/studio/state");
  const action = (action) =>
    api("/studio/action", { method: "POST", body: JSON.stringify({ action }) });
  let poll, memoryLimit, outputFile;
  try {
    if (config.output) outputFile = await open(config.output, "wx", 0o600);
    const session = await api("/studio/session", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:5180" },
    });
    headers = {
      "Content-Type": "application/json",
      "x-studio-token": session.token,
    };
    const initial = await state();
    if (
      initial.document.generating ||
      initial.preparation.running ||
      ["running", "cancelling"].includes(initial.preparation.status)
    )
      throw Error("Wait for the active generation/preparation to finish");
    if (initial.memoryUsage.current?.availableBytes < 2 * 1024 ** 3)
      throw Error("At least 2 GiB available memory is required to begin");
    if (initial.settings.mock)
      throw Error("Mock engine is not a real inference benchmark");
    report.environment = {
      architecture: initial.architecture,
      backend: initial.backend,
      memoryBytes: initial.memoryBytes,
      memoryTuning: initial.memoryTuning,
      initialStatus: initial.status,
    };
    if (initial.status === "offline") {
      if (!config.start)
        throw Error(
          "Engine is offline. Start it in the app or pass --start (stopped again afterward)",
        );
      // Remember ownership before starting: failures or interruption still trigger cleanup.
      started = true;
      await action("start");
    }
    const readyDeadline = performance.now() + config.timeout;
    let ready;
    do {
      if (interrupted) throw Error("Interrupted");
      ready = await state();
      if (ready.status === "ready") break;
      if (performance.now() > readyDeadline || ready.status === "offline")
        throw Error("Engine did not become ready");
      await new Promise((r) => setTimeout(r, 1000));
    } while (true);
    const models = await api("/v1/models");
    const model = models.data?.[0]?.id;
    if (!model) throw Error("Engine returned no model");
    report.model = model;
    const sample = async () => {
      const s = await state();
      report.samples.push({
        elapsedMs: Math.round(performance.now() - runStart),
        system: s.memoryUsage.current,
        engine: s.memoryUsage.engine.current,
      });
      if (s.memoryUsage.current?.availableBytes < 2 * 1024 ** 3) {
        memoryLimit =
          "Available system memory fell below 2 GiB; measurement stopped";
        active?.abort();
      }
    };
    const runStart = performance.now();
    await sample();
    // Sequential sampling avoids overlapping /studio/state requests on slow hardware.
    let sampling = true;
    poll = (async () => {
      while (sampling) {
        await new Promise((r) => setTimeout(r, 1000));
        if (sampling) await sample().catch(() => {});
      }
    })();
    try {
      for (const rows of config.rows) {
        if (interrupted) throw Error("Interrupted");
        if (memoryLimit) throw Error(memoryLimit);
        const prompt = makePrompt(rows),
          begin = performance.now();
        const entry = {
          rows,
          inputBytes: Buffer.byteLength(prompt),
          startedMs: Math.round(begin - runStart),
        };
        report.cases.push(entry);
        active = new AbortController();
        const timeout = setTimeout(() => active?.abort(), config.timeout);
        emit(`Measuring ${rows} filler rows…`);
        try {
          const result = await api(
            "/v1/chat/completions",
            {
              method: "POST",
              body: JSON.stringify({
                model,
                messages: [{ role: "user", content: prompt }],
                stream: false,
                temperature: 0,
                max_tokens: 64,
                chat_template_kwargs: { enable_thinking: false },
              }),
            },
            active.signal,
          );
          const choice = result.choices?.[0];
          if (!choice?.message || typeof choice.message.content !== "string")
            throw Error("Missing completion content");
          const answer = choice.message.content.trim();
          entry.status = "completed";
          entry.retrieval =
            answer === "STRATA-7391"
              ? "exact"
              : answer.includes("STRATA-7391")
                ? "contains"
                : answer
                  ? "incorrect"
                  : "unanswered";
          entry.finishReason = choice.finish_reason ?? null;
          entry.usage = result.usage ?? null;
          entry.timings = result.timings ?? null;
          // Store neither model text nor the user's messages/settings/session credentials.
        } catch (error) {
          entry.status = memoryLimit
            ? "memory-limit"
            : interrupted
              ? "interrupted"
              : active.signal.aborted
                ? "timeout"
                : "failed";
          entry.error = memoryLimit || error.message;
          throw Error(entry.error);
        } finally {
          clearTimeout(timeout);
          active = null;
          entry.elapsedMs = Math.round(performance.now() - begin);
          await sample().catch(() => {});
          entry.endedMs = Math.round(performance.now() - runStart);
          entry.memory = memorySummary(
            report.samples.filter(
              (s) =>
                s.elapsedMs >= entry.startedMs && s.elapsedMs <= entry.endedMs,
            ),
          );
        }
      }
    } finally {
      sampling = false;
      await poll;
    }
  } catch (error) {
    report.error = error.message;
  } finally {
    if (started) {
      try {
        await action("stop");
        report.engineRestored = true;
      } catch {
        report.engineRestored = false;
        report.cleanupError = "Engine stop failed; check the app";
      }
    }
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    report.finishedAt = new Date().toISOString();
    report.memory = memorySummary(report.samples);
    if (outputFile) {
      try {
        await outputFile.writeFile(JSON.stringify(report, null, 2) + "\n");
      } finally {
        await outputFile.close();
      }
    }
  }
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const report = await benchmark(options(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    if (report.error || report.cleanupError) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
