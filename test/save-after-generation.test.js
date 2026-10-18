import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveAfterGeneration } from '../examples/save-after-generation.js';
test('later save failure reuses generation and reopens the saved result', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'save-recovery-'));
  try {
    const result = await saveAfterGeneration(directory);
    assert.equal(result.generationCalls, 1); assert.equal(result.saveCalls, 2);
    assert.equal(result.firstStatus, 'failed'); assert.equal(result.finalStatus, 'completed');
    assert.equal(result.saved.saved, true);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
