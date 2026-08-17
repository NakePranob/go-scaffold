import { select } from "@inquirer/prompts";
import { QueueBackend } from "../types";

// The one decision `add worker` cannot make for you: where jobs live. It
// drives which adapter is written, whether Redis is added to the project at
// all, and whether an enqueue can join a database transaction.
export async function promptQueueBackend(): Promise<QueueBackend> {
  return select<QueueBackend>({
    message: "Where should background jobs be stored?",
    default: "river",
    choices: [
      {
        name: "Postgres (River)",
        value: "river",
        description: "no extra service to run; a job is only delivered if the transaction that enqueued it commits",
      },
      {
        name: "Redis (Asynq)",
        value: "asynq",
        description: "higher throughput and shareable across languages; needs a Redis server, and an enqueue cannot join a database transaction",
      },
    ],
  });
}
