import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  benchmark,
  options,
  makePrompt,
  memorySummary,
} from "./benchmark-inference.mjs";

test("bounds and loopback restriction", () => {
  assert.throws(() => options(["--url", "http://example.com"]));
  assert.throws(() => options(["--rows", "513"]));
  assert.throws(() => options(["--timeout", "0"]));
  assert.equal(makePrompt(256).match(/verification code is/g).length, 1);
});
async function fixture(
  t,
  {
    offline = true,
    fail = false,
    mock = false,
    delay = 0,
    lowMemory = false,
  } = {},
) {
  const actions = [],
    bodies = [];
  let running = !offline;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    let data;
    if (req.url === "/studio/session") data = { token: "DO-NOT-EXPORT" };
    else if (req.headers["x-studio-token"] !== "DO-NOT-EXPORT") {
      res.statusCode = 401;
      data = {};
    } else if (req.url === "/studio/action") {
      const { action } = JSON.parse(raw);
      actions.push(action);
      running = action === "start";
      data = { ok: true };
    } else if (req.url === "/studio/state")
      data = {
        status: running ? "ready" : "offline",
        document: { generating: false, messages: [{ content: "PRIVATE" }] },
        preparation: { running: false },
        settings: { mock },
        memoryUsage: {
          current: lowMemory ? { availableBytes: 1024 } : null,
          engine: { current: null },
        },
        memoryTuning: {},
        architecture: "fixture",
        backend: "fixture",
      };
    else if (req.url === "/v1/models") data = { data: [{ id: "fixture" }] };
    else if (req.url === "/v1/chat/completions") {
      bodies.push(JSON.parse(raw));
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (fail) {
        res.statusCode = 500;
        data = { error: "PRIVATE" };
      } else
        data = {
          choices: [
            { message: { content: "STRATA-7391" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 41, completion_tokens: 8 },
          timings: { predicted_per_second: 1.2 },
        };
    } else {
      res.statusCode = 404;
      data = {};
    }
    res.end(JSON.stringify(data));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  return {
    actions,
    bodies,
    config: options([
      "--url",
      `http://127.0.0.1:${server.address().port}`,
      "--rows",
      "0",
      "--start",
    ]),
  };
}
test("owned engine is stopped; reported counts retained; no private content exported", async (t) => {
  const f = await fixture(t);
  const r = await benchmark(f.config, () => {});
  assert.equal(r.error, undefined);
  assert.deepEqual(f.actions, ["start", "stop"]);
  assert.equal(r.cases[0].usage.prompt_tokens, 41);
  assert.equal(r.cases[0].retrieval, "exact");
  assert.equal(f.bodies[0].chat_template_kwargs.enable_thinking, false);
  assert(!JSON.stringify(r).includes("PRIVATE"));
  assert(!JSON.stringify(r).includes("DO-NOT-EXPORT"));
});
test("failure cleans up owned engine and does not export upstream error bodies", async (t) => {
  const f = await fixture(t, { fail: true });
  const r = await benchmark(f.config, () => {});
  assert.deepEqual(f.actions, ["start", "stop"]);
  assert.equal(r.cases[0].status, "failed");
  assert.equal(r.engineRestored, true);
  assert(!JSON.stringify(r).includes("PRIVATE"));
});
test("running engine stays running", async (t) => {
  const f = await fixture(t, { offline: false });
  const r = await benchmark(f.config, () => {});
  assert.equal(r.error, undefined);
  assert.deepEqual(f.actions, []);
});
test("mock engine is rejected before lifecycle changes", async (t) => {
  const f = await fixture(t, { mock: true });
  const r = await benchmark(f.config, () => {});
  assert.match(r.error, /Mock/);
  assert.deepEqual(f.actions, []);
});

test("memory summary retains missing readings and real zero values", () => {
  assert.equal(memorySummary([]).sampledEnginePeakBytes, null);
  const s = memorySummary([
    { system: { usedBytes: 20, availableBytes: 80 }, engine: { usedBytes: 0 } },
    {
      system: { usedBytes: 30, availableBytes: 70 },
      engine: { usedBytes: 12 },
    },
  ]);
  assert.equal(s.sampledEnginePeakBytes, 12);
  assert.equal(s.sampledMinimumAvailableBytes, 70);
});
test("timeout restores owned engine", async (t) => {
  const f = await fixture(t, { delay: 2000 });
  f.config.timeout = 1000;
  const r = await benchmark(f.config, () => {});
  assert.equal(r.cases[0].status, "timeout");
  assert.deepEqual(f.actions, ["start", "stop"]);
});
test("low available memory refuses startup", async (t) => {
  const f = await fixture(t, { lowMemory: true });
  const r = await benchmark(f.config, () => {});
  assert.match(r.error, /2 GiB/);
  assert.deepEqual(f.actions, []);
});

test("existing report is not overwritten and engine is not started", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "strata-benchmark-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "report.json");
  await writeFile(path, "keep");
  const f = await fixture(t);
  f.config.output = path;
  const r = await benchmark(f.config, () => {});
  assert.match(r.error, /EEXIST/);
  assert.deepEqual(f.actions, []);
  assert.equal(await readFile(path, "utf8"), "keep");
});
