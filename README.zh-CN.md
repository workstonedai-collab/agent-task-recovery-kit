# Agent Task Recovery Kit · 长任务恢复工具

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/workstonedai-collab/agent-task-recovery-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/workstonedai-collab/agent-task-recovery-kit/actions/workflows/ci.yml) · [Apache-2.0](LICENSE) · Node.js 22.12+

**保存每个已完成步骤，失败后接续运行，并把重试控制在明确预算内。**

Agent Task Recovery Kit 是一个本地、顺序执行的 JavaScript 任务运行器。适合包含多个较贵步骤的采集、处理或 Agent 流程：后续步骤失败时，可以复用之前已保存的成果。你提供步骤函数，工具负责保存 JSON 结果、核对身份、有界重试和恢复。

无需模型依赖、队列服务器或云服务。步骤做什么、状态存在哪里都由你决定。

## 新增示例

新增 `node examples/save-after-generation.js`：虚构生成完成并保存检查点，后续
保存故意失败，显式继续后重新读取结果。全新状态输出 `generationCalls: 1`、
`saveCalls: 2`。生成检查点落盘前崩溃仍可能重复执行；示例不调用模型。

## 阅读导航

- [一个具体使用场景](#一个具体使用场景)
- [体验一次失败与恢复](#体验一次失败与恢复)
- [接入自己的步骤](#接入自己的步骤)
- [明确控制恢复行为](#明确控制恢复行为)
- [主动查看、重试与取消](#主动查看重试与取消)
- [常见问题](#常见问题)
- [状态与并发](#状态与并发)
- [恢复能力的边界](#恢复能力的边界)
- [开发与接入](#开发与接入)

## 一个具体使用场景

假设流程分成采集、处理、准备导出三步。采集已经完成，处理却失败了，直接从头重跑可能重复昂贵调用。本工具在步骤成功返回后保存结果，下一次调用可以复用采集成果，从未完成步骤继续。

```text
第一次：  collect ✓ [保存] → summarize ✗ [失败] → export [待执行]
下一次：  collect [复用]   → summarize ✓ [保存] → export ✓
```

适合本地研究脚本、分阶段数据准备，以及包含高成本中间产物的 Agent 任务。每一步仍是自己编写的普通异步 JavaScript 函数，工具负责包在外面的保存与恢复。

## 体验一次失败与恢复

需要 **Node.js 22.12+**，无运行时 npm 依赖。

```sh
git clone https://github.com/workstonedai-collab/agent-task-recovery-kit.git
cd agent-task-recovery-kit
npm ci
npm run demo
```

演示全部使用虚构本地内容：`collect` 完成，`summarize` 故意失败一次，第二次运行显式重试后继续。输出 `collectionCalls: 1` 表示第一阶段被复用。状态保存在 `.demo-state/offline-demo.json`。

再次运行演示会复用已经完成的结果。若想重演失败，在确认演示进程未运行后，只删除演示的 `.demo-state` 目录。

## 接入自己的步骤

```js
import { runTask } from './src/index.js';

const result = await runTask({
  id: 'notes-001',
  input: { topic: '公开产品更新' },
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

输入和输出须是 JSON 值：有限数值、字符串、布尔值、null、数组或普通对象。步骤至少返回 `null`，不要返回无法保存的 `undefined`。

## 明确控制恢复行为

| 参数或行为 | 含义 |
| --- | --- |
| `id` | 一个输入和工作流的稳定标识，只接受安全文件名字符 |
| `workflowVersion` | 步骤逻辑变化时更新；工具不对函数源码做哈希 |
| `maxAttempts` | 每步持久化尝试次数上限，默认 3 |
| `baseDelayMs`、`maxDelayMs` | 有上限的指数延迟，默认 100/5000 毫秒 |
| `shouldRetry(error, context)` | 对永久失败返回 false |
| `retryFailed: true` | 显式重置已失败步骤的尝试预算 |
| `signal` | 传给每步的协作式取消信号 |
| `idempotencyKey` | 同一输入和步骤的稳定幂等键，用于支持该机制的外部写入 |
| `inspectTask(stateDir, id)` | 只读取保存状态，不执行任务 |

同一任务 ID 下改变输入、有序步骤或版本会被拒绝。保存的成功结果带哈希，可以发现内容改动。观察事件回调失败不会重跑成功步骤。步骤返回成功后先保存，再在下一个执行边界处理取消。

## 主动查看、重试与取消

只查看保存状态，不执行任务：

```js
import { inspectTask } from './src/index.js';
const saved = await inspectTask('.demo-state', 'offline-demo');
console.log(saved.status, saved.steps.collect.status);
```

自己的流程恢复时，保持任务 ID、输入、有序步骤和版本相同，再次调用 `runTask`。完成步骤会复用；失败步骤是否重置预算，由你用 `retryFailed: true` 明确决定。不要在外层无限循环重试。

可以在配置里分类哪些错误可重试：

```js
shouldRetry: (error, { step_id, attempt }) => error.code === 'TEMPORARY'
```

步骤可抛出 `new TaskError('TEMPORARY', '...')`，或带 `code` 的错误。永久错误应让 `shouldRetry` 返回 false。`maxAttempts` 计算已保存的步骤尝试次数，不只计算本次进程中的次数。

取消时创建 `AbortController`，把 `signal` 交给 `runTask`，步骤内的联网或其他协作操作也应使用该信号。`abort()` 请求取消，无法强制杀掉忽略信号的任意操作。

### 保持任务身份清晰

| 发生什么变化 | 怎样处理 |
| --- | --- |
| 重启同一项工作 | 保持 ID、输入、步骤顺序和版本 |
| 换输入或换有序步骤 | 使用新的任务 ID |
| 步骤逻辑变化 | 更新 `workflowVersion`，并使用新的任务 ID |
| 外部写入需要重试 | 向支持它的接收端传入步骤 `idempotencyKey`，或自行实现去重 |

`stateDir` 应放在重命名和锁行为可靠的本地文件系统中。把它视为运行数据：按需备份，不纳入公开提交，并保护你选择保存的敏感输入和结果。

## 常见问题

| 错误或现象 | 怎样处理 |
| --- | --- |
| `STEP_EXHAUSTED` | 检查失败步骤，再决定修复、停止或显式重置预算 |
| `CHECKPOINT_MISMATCH` | 保留旧状态；输入、步骤或版本改变时使用新 ID |
| `INVALID_CHECKPOINT` | 保留并检查文件，不默默覆盖损坏或被改动的结果 |
| `LOCKED` | 查看锁的拥有者及活跃进程；确认原进程停止后，只清理对应锁 |
| `INVALID_DATA` / `INVALID_CONFIG` | 返回 JSON 值，修正任务 ID、唯一步骤及重试限制 |
| 演示输出 `collectionCalls: 0` | 已完成状态被复用，再次运行时属于预期行为 |
| 取消后没有立刻停止 | 正在运行的步骤需要配合 `AbortSignal` |

工具在任务完成时返回结果，失败时抛出错误，不会偷偷把失败转换为成功的空输出。完整恢复语义和外部写入边界见[状态协议](docs/state-contract.md)。

## 状态与并发

每个任务使用 JSON 和独占锁目录。锁存在时另一个进程不能运行同一任务；正常完成或错误退出会释放锁。强制杀掉进程可能留锁，应查看 `owner.json`，确认原进程停止后再手动清理对应锁。程序不会按随意超时自动抢锁。

临时文件加重命名可避免半截 JSON，不承诺断电下的 fsync 持久性。不同任务 ID 也不会自动协调同一个输出资源。错误正文不写入状态，只保留错误代码；你提供的输入和结果会在本地保存，应避免把密钥放进去。

## 恢复能力的边界

已保存的成功步骤会复用，但外部写入可能已经成功，进程却在写 checkpoint 前结束。应将操作设计为幂等，或把工具提供的幂等键交给支持它的服务。**本工具不保证只执行一次。**

取消需要步骤配合信号；忽略信号的步骤不能由库强制结束。首版面向可信单机顺序流程，不包含分布式 worker、调度平台、界面或完整 Agent 框架。详见[状态协议](docs/state-contract.md)。

## 开发与接入

```sh
npm test
```

测试覆盖缓存恢复、显式重试、稳定幂等键、输入不匹配与结果损坏、并发拒绝、取消边界及事件观察失败。CI 配置覆盖 Node 22/24 和三种桌面系统。

让自己的 Agent 接入时，说明步骤、需保存的 JSON、永久错误，以及需做幂等处理的外部动作；先用受控失败验证恢复，再接真实服务。

贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。项目代码使用 [Apache-2.0](LICENSE)。第三方依赖及数据保留自身条款。
