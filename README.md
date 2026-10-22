# Agent Task Recovery Kit · 长任务恢复工具

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/workstonedai-collab/agent-task-recovery-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/workstonedai-collab/agent-task-recovery-kit/actions/workflows/ci.yml) · [Apache-2.0](LICENSE) · Node.js 22.12+

**Save each completed step, resume after a failure, and keep retries under an explicit budget.**

Agent Task Recovery Kit is a small local runner for sequential JavaScript tasks. It is useful when a collection, transformation or agent workflow has several expensive steps and a later failure should not deliberately restart the completed work. Provide your own step functions; the runner stores JSON outputs, checks their identity, retries within limits and reuses completed results on the next run.

There are no model/provider dependencies, queue servers or required cloud services. You decide what each step does and where local state is saved.

## Recent example / 新增示例

新增失败恢复示例：虚构生成结果先存入检查点，后续保存失败后显式重试并重开；不调用模型，检查点落盘前的崩溃仍可能重复生成。

New example: `node examples/save-after-generation.js` checkpoints a fictional
generation, fails a later save, then explicitly retries and reopens its result.
In fresh state it prints `generationCalls: 1` and `saveCalls: 2`. A crash before
the generation checkpoint is saved can still repeat that stage. No model is called.

## Contents

- [A concrete problem it solves](#a-concrete-problem-it-solves)
- [See a failure and recovery](#see-a-failure-and-recovery)
- [Add your own steps](#add-your-own-steps)
- [Important choices are explicit](#important-choices-are-explicit)
- [Inspect, retry and cancel deliberately](#inspect-retry-and-cancel-deliberately)
- [Troubleshooting](#troubleshooting)
- [State and concurrency](#state-and-concurrency)
- [What recovery can and cannot guarantee](#what-recovery-can-and-cannot-guarantee)
- [Development](#development)

## A concrete problem it solves

Suppose a workflow collects notes, transforms them and prepares an export. Collection is complete, but transformation fails. A blind restart may repeat an expensive call. This runner checkpoints successful returns so the next invocation can reuse collection and continue from the unfinished step.

```text
First run:   collect ✓ [saved] → summarize ✗ [failed] → export [pending]
Next run:    collect [cached]  → summarize ✓ [saved]  → export ✓
```

Useful cases include local research scripts, staged data preparation and agent tasks with costly intermediate outputs. Each step remains your ordinary async JavaScript function; the kit supplies persistence and recovery around it.

## See a failure and recovery

Requires Node.js **22.12+**. No runtime npm dependencies.

```sh
git clone https://github.com/workstonedai-collab/agent-task-recovery-kit.git
cd agent-task-recovery-kit
npm ci
npm run demo
```

The demo uses synthetic local content. `collect` succeeds, `summarize` deliberately fails once, and a second run resumes with an explicit retry. The printed `collectionCalls: 1` shows the first stage was reused. The checkpoint is `.demo-state/offline-demo.json`.

Running the demo again uses its completed checkpoint. To repeat the original failure, remove only the demo's `.demo-state` folder while no demo process is running.

## Add your own steps

```js
import { runTask } from './src/index.js';

const result = await runTask({
  id: 'notes-001',
  input: { topic: 'public product updates' },
  workflowVersion: '1',
  stateDir: './state',
  maxAttempts: 3,
  steps: [
    { id: 'collect', run: async ({ input, signal }) => {
      return [{ title: input.topic, url: 'https://example.org/update' }];
    } },
    { id: 'prepare', run: async ({ results, idempotencyKey, signal }) => {
      return { count: results.collect.length, title: results.collect[0].title };
    } },
  ],
  onEvent: event => console.log(event),
});
console.log(result.results);
```

Inputs and outputs must be JSON values: finite numbers, strings, booleans, null, arrays and plain objects. Return a result even if it is just `null`; `undefined` cannot be checkpointed.

## Important choices are explicit

| Option or behavior | Meaning |
| --- | --- |
| `id` | Stable identifier for one input and workflow; safe filename characters only |
| `workflowVersion` | Bump it when step behavior changes; function source is not hashed |
| `maxAttempts` | Persisted attempt limit for each step; default 3 |
| `baseDelayMs`, `maxDelayMs` | Capped exponential retry delay; defaults 100/5000 ms |
| `shouldRetry(error, context)` | Return false for permanent failures |
| `retryFailed: true` | Explicitly resets an exhausted failed step's attempt budget |
| `signal` | Cooperative cancellation passed to every step |
| `idempotencyKey` | Stable key for a step and input; use it for supported external writes |
| `inspectTask(stateDir, id)` | Read saved state without executing the task |

Changing the input, ordered step IDs or workflow version under the same task ID is rejected. Modified saved outputs are detected using content hashes. Observer errors do not rerun a successful step. Completed returns are saved before cancellation is honored at the next boundary.

## Inspect, retry and cancel deliberately

Read a checkpoint without executing the task:

```js
import { inspectTask } from './src/index.js';
const saved = await inspectTask('.demo-state', 'offline-demo');
console.log(saved.status, saved.steps.collect.status);
```

For your own workflow, call `runTask` again with the same ID, input, ordered steps and version. Completed steps are reused. If a step has failed, choose whether to reset its retry budget with `retryFailed: true`; do not create an endless outer retry loop.

You can classify retryable failures in the configuration:

```js
shouldRetry: (error, { step_id, attempt }) => error.code === 'TEMPORARY'
```

Steps may throw `new TaskError('TEMPORARY', '...')` or errors with a `code`. A permanent failure should return false from `shouldRetry`. `maxAttempts` counts attempts saved for the step, not just attempts in the current process.

For cancellation, create an `AbortController`, pass its `signal` to `runTask`, and use that signal inside network calls or other cooperative step operations. Calling `abort()` requests cancellation; it does not kill arbitrary work that ignores the signal.

### Keep task identity stable

| What changed? | What to do |
| --- | --- |
| Only restarting the same work | Reuse ID, input, step order and version |
| A different input or different ordered steps | Use a new task ID |
| Step logic changed | Bump `workflowVersion` and use a new task ID |
| External write is retried | Pass the step's `idempotencyKey` to a receiver that supports it, or implement your own deduplication |

Store `stateDir` on a local filesystem with reliable rename/lock behavior. Treat it as operational data: back it up according to your needs, keep it outside public commits, and protect any sensitive inputs/results you choose to save.

## Troubleshooting

| Error / symptom | What to do |
| --- | --- |
| `STEP_EXHAUSTED` | Inspect the failed step and decide whether to fix it, stop, or explicitly reset the retry budget |
| `CHECKPOINT_MISMATCH` | Preserve the old checkpoint; use a new ID for changed inputs, steps or versions |
| `INVALID_CHECKPOINT` | Preserve and inspect the file; do not silently overwrite altered or malformed results |
| `LOCKED` | Check the lock owner and active process; clear that specific lock only after the worker has stopped |
| `INVALID_DATA` / `INVALID_CONFIG` | Return JSON values and correct task IDs, unique steps and retry limits |
| The demo prints `collectionCalls: 0` | Its completed checkpoint was reused; this is expected on later runs |
| Cancelling does not stop immediately | The running step must cooperate with `AbortSignal` |

The library returns the result of a completed task or throws an error. It does not secretly turn a failure into a successful empty output. For detailed recovery semantics and side-effect boundaries, read [the state contract](docs/state-contract.md).

## State and concurrency

Each task uses a JSON checkpoint and exclusive lock directory. A second process cannot run the same task while it is locked. Normal completion and errors release the lock. A force-killed process may leave it behind: inspect `owner.json`, verify that worker has stopped, and only then manually clear that specific lock. The runner does not steal locks using an arbitrary expiry time.

The temporary-file/rename write avoids partially written JSON, but does not promise fsync durability during a power loss. Different task IDs do not automatically coordinate shared output resources. Error text is not saved; only a code is retained. Your input and step results are stored locally, so keep secrets out of them.

## What recovery can and cannot guarantee

A saved successful step is reused. An external action may nevertheless succeed just before a process dies, before the checkpoint is written. Make that action idempotent, using the provided key when the receiving service supports it. **This is not an exactly-once system.**

Cancellation is cooperative: a step that ignores its signal cannot be forcibly stopped. This release is for trusted local sequential workflows, not distributed workers, a scheduling platform, a UI or an agent framework. See [the full state contract](docs/state-contract.md).

## Development

```sh
npm test
```

Tests verify cached-stage recovery, explicit retry, stable keys, mismatch/corrupt-output rejection, concurrent-run refusal, cancellation boundaries and observer failure handling. CI is configured for Node 22/24 on Linux, macOS and Windows.

When asking your coding agent to integrate it, describe your steps, the JSON outputs to preserve, permanent errors and side effects that need idempotency. Ask it to test a controlled failure and recovery before connecting real providers.

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Project code is licensed under [Apache-2.0](LICENSE). Third-party dependencies and data retain their own terms.
