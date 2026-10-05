import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runTask, inspectTask, TaskError, contentHash } from "../src/index.js";
async function sandbox(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "task-recovery-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
test("resume reuses completed outputs and requires explicit exhausted-step retry", () =>
  sandbox(async (stateDir) => {
    let first = 0,
      second = 0;
    const keys = [];
    const config = {
      id: "demo",
      input: { x: 1 },
      stateDir,
      maxAttempts: 1,
      steps: [
        {
          id: "one",
          run: async () => {
            first++;
            return 7;
          },
        },
        {
          id: "two",
          run: async ({ results, idempotencyKey }) => {
            keys.push(idempotencyKey);
            if (++second === 1) throw Error("private error");
            return results.one + 1;
          },
        },
      ],
    };
    await assert.rejects(runTask(config), (e) => e.code === "STEP_EXHAUSTED");
    await assert.rejects(runTask(config), (e) => e.code === "STEP_EXHAUSTED");
    assert.equal(second, 1);
    assert.ok(
      !(await fs.readFile(path.join(stateDir, "demo.json"), "utf8")).includes(
        "private error",
      ),
    );
    const r = await runTask({ ...config, retryFailed: true });
    assert.equal(first, 1);
    assert.equal(r.results.two, 8);
    assert.equal(keys[0], keys[1]);
  }));
test("input mismatch and corrupt output are rejected without altering checkpoint", () =>
  sandbox(async (stateDir) => {
    const c = {
      id: "demo",
      input: { x: 1 },
      stateDir,
      steps: [{ id: "one", run: async () => ({ value: 1 }) }],
    };
    await runTask(c);
    const file = path.join(stateDir, "demo.json"),
      before = await fs.readFile(file, "utf8");
    await assert.rejects(
      runTask({ ...c, input: { x: 2 } }),
      (e) => e.code === "CHECKPOINT_MISMATCH",
    );
    assert.equal(await fs.readFile(file, "utf8"), before);
    const state = JSON.parse(before);
    state.steps.one.result.value = 2;
    await fs.writeFile(file, JSON.stringify(state));
    await assert.rejects(runTask(c), (e) => e.code === "INVALID_CHECKPOINT");
  }));
test("same task cannot run concurrently", () =>
  sandbox(async (stateDir) => {
    let release, entered;
    const ready = new Promise((r) => (entered = r));
    const config = {
      id: "demo",
      input: {},
      stateDir,
      steps: [
        {
          id: "one",
          run: async () => {
            entered();
            await new Promise((r) => (release = r));
            return 1;
          },
        },
      ],
    };
    const running = runTask(config);
    await ready;
    await assert.rejects(runTask(config), (e) => e.code === "LOCKED");
    release();
    await running;
  }));
test("cancellation saves a completed return and prevents the next step", () =>
  sandbox(async (stateDir) => {
    const controller = new AbortController();
    let next = 0;
    const c = {
      id: "demo",
      input: {},
      stateDir,
      signal: controller.signal,
      steps: [
        {
          id: "one",
          run: async () => {
            controller.abort();
            return 7;
          },
        },
        {
          id: "two",
          run: async () => {
            next++;
            return 8;
          },
        },
      ],
    };
    await assert.rejects(runTask(c), (e) => e.code === "ABORTED");
    assert.equal(next, 0);
    assert.equal(
      (await inspectTask(stateDir, "demo")).steps.one.status,
      "completed",
    );
    const r = await runTask({ ...c, signal: undefined });
    assert.equal(r.results.one, 7);
    assert.equal(next, 1);
  }));
test("temporary errors retry; permanent errors stop and observer errors do not rerun", () =>
  sandbox(async (stateDir) => {
    let count = 0;
    await runTask({
      id: "demo",
      input: {},
      stateDir,
      baseDelayMs: 0,
      steps: [
        {
          id: "one",
          run: async () => {
            if (++count === 1) throw Error();
            return 1;
          },
        },
      ],
      onEvent: () => {
        throw Error("observer");
      },
    });
    assert.equal(count, 2);
    let permanent = 0;
    await assert.rejects(
      runTask({
        id: "other",
        input: {},
        stateDir,
        steps: [
          {
            id: "one",
            run: async () => {
              permanent++;
              throw new TaskError("PERMANENT", "x");
            },
          },
        ],
        shouldRetry: () => false,
      }),
    );
    assert.equal(permanent, 1);
  }));
test("JSON identity is stable and invalid results never become completed", () =>
  sandbox(async (stateDir) => {
    assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }));
    await assert.rejects(
      runTask({
        id: "demo",
        input: {},
        stateDir,
        steps: [{ id: "one", run: async () => undefined }],
      }),
      (e) => e.code === "STEP_EXHAUSTED",
    );
    assert.equal((await inspectTask(stateDir, "demo")).steps.one.attempts, 1);
  }));
