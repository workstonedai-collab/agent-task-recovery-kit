import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTask, inspectTask, TaskError } from '../src/index.js';

export async function saveAfterGeneration(stateDir = '.demo-state/save-after-generation') {
  let generationCalls = 0, saveCalls = 0;
  const options = { id: 'fictional-report', input: { topic: 'A community garden' }, workflowVersion: '1', stateDir,
    maxAttempts: 1, steps: [
      { id: 'generate', run: async () => { generationCalls++; return { text: 'Fictional local output. No model request.' }; } },
      { id: 'save', run: async ({ results }) => {
        saveCalls++;
        if (saveCalls === 1) throw new TaskError('DEMO_SAVE_FAILURE', 'Synthetic storage failure');
        return { saved: true, content: results.generate.text };
      } },
    ] };
  try { await runTask(options); } catch (error) { if (error.code !== 'STEP_EXHAUSTED') throw error; }
  const failed = await inspectTask(stateDir, options.id);
  await runTask({ ...options, retryFailed: true });
  // Inspect through a new read; no generator call is needed to reopen the result.
  const reopened = await inspectTask(stateDir, options.id);
  return { generationCalls, saveCalls, firstStatus: failed.status, finalStatus: reopened.status,
    saved: reopened.steps.save.result };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await saveAfterGeneration(), null, 2));
}
