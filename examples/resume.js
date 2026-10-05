// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 workstonedai-collab
import { runTask, TaskError } from "../src/index.js";
let failOnce = true,
  collectionCalls = 0;
const steps = [
  {
    id: "collect",
    run: async () => {
      collectionCalls++;
      return [{ title: "Synthetic note", url: "https://example.org/note" }];
    },
  },
  {
    id: "summarize",
    run: async ({ results, idempotencyKey }) => {
      if (failOnce) {
        failOnce = false;
        throw new TaskError("TEMPORARY", "Synthetic temporary failure");
      }
      return {
        summary: "A synthetic local result",
        source: results.collect[0].url,
        idempotencyKey,
      };
    },
  },
];
const config = {
  id: "offline-demo",
  input: { topic: "synthetic" },
  steps,
  maxAttempts: 1,
  onEvent: (e) => console.log(e.event, e.step_id || ""),
};
try {
  await runTask(config);
} catch (e) {
  if (e.code !== "STEP_EXHAUSTED") throw e;
  console.log("First run stopped. Saved collect stage is reusable.");
}
failOnce = false;
const recovered = await runTask({ ...config, retryFailed: true });
console.log({
  status: recovered.status,
  collectionCalls,
  results: recovered.results,
});
