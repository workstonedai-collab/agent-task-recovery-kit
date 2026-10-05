# State and recovery contract / 状态与恢复约定

This runner is for trusted local tasks on one machine. A task ID binds one JSON input, ordered step-ID list and explicit workflow version. Completed outputs are hashed and reused. Changes require a new ID. Function source is not hashed: bump workflowVersion when behavior changes.

State uses a temporary file and rename, avoiding partial JSON but providing no fsync durability promise during power loss. The exclusive task lock rejects simultaneous runs. A force-killed worker may leave a lock: inspect owner.json, verify the process has stopped, then manually clear that specific lock. Live locks are not stolen on an arbitrary timeout.

Attempts are persisted. retryFailed: true explicitly resets a failed step's budget; shouldRetry can reject permanent failures. Error text is not persisted, but inputs/results are stored, so keep credentials out of them. Hash checking detects accidental edits; it is not a signed authenticity guarantee against a malicious user who can rewrite the checkpoint.

Cancellation is cooperative. signal is passed to steps and honored at attempt boundaries and retry waits. A successful return is saved even if cancellation was requested during the step; a pending next step does not start. Work that ignores the signal cannot be forcibly cancelled by this library.

An external write may succeed before the checkpoint is saved. Use idempotencyKey with a receiver that supports it or implement idempotency yourself. No exactly-once guarantee is provided. Different task IDs do not coordinate shared resources. Distributed workers, scheduling, UI and AI providers are outside this release.

本工具用于可信单机任务。任务 ID 绑定 JSON 输入、有序步骤 ID 和显式版本。成功结果带哈希并复用；输入或逻辑改变时使用新 ID，逻辑变化还应更新 workflowVersion。哈希用于发现意外改动，不是针对恶意改写的签名认证。

状态通过临时文件与重命名保存，避免半截 JSON，不保证断电 fsync 持久性。同任务独占锁不自动过期；强制结束可能留锁，查看 owner.json 并确认进程已停止后再清理。尝试次数持久化；retryFailed 明确重置失败步骤预算，shouldRetry 可排除永久错误。错误正文不保存，但输入和结果会保存，应避免放入密钥。

取消须由步骤配合信号。成功返回先保存，再在执行边界处理取消。外部写入和本地保存之间仍可能中断，需实现幂等，不保证只执行一次。首版不包括分布式调度、界面或模型接入。
