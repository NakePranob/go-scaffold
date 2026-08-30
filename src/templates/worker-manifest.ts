import { QueueBackend } from "../types";

// output paths are relative to the project root
type Entry = { template: string; output: string };

// The SMTP client on its own. `add auth` installs just this when the project
// has no worker: mail/task.go is the piece that knows about the queue, and
// pulling it in would drag platform/queue along with it.
export const MAIL_CLIENT_ONLY: Entry[] = [
  { template: "add/worker/internal/platform/mail/mail.go.hbs", output: "internal/platform/mail/mail.go" },
];

const SHARED: Entry[] = [
  { template: "add/worker/internal/platform/queue/queue.go.hbs", output: "internal/platform/queue/queue.go" },
  ...MAIL_CLIENT_ONLY,
  { template: "add/worker/internal/platform/mail/task.go.hbs", output: "internal/platform/mail/task.go" },
  { template: "add/worker/cmd/worker/main.go.hbs", output: "cmd/worker/main.go" },
];

// Only the chosen backend's adapter is written: an unused adapter would drag
// its whole dependency tree into go.mod for nothing. Swapping later means
// re-running `add worker` with the other backend, or copying the adapter in
// by hand — the queue.go contract it implements does not change.
const RIVER: Entry[] = [
  { template: "add/worker/internal/platform/queue/river.go.hbs", output: "internal/platform/queue/river.go" },
  { template: "add/worker/internal/platform/queue/river_test.go.hbs", output: "internal/platform/queue/river_test.go" },
];

const ASYNQ: Entry[] = [
  { template: "add/worker/internal/platform/queue/asynq.go.hbs", output: "internal/platform/queue/asynq.go" },
  // Redis only comes along when it is actually the queue's backing store.
  { template: "add/worker/internal/platform/cache/redis.go.hbs", output: "internal/platform/cache/redis.go" },
];

export function workerFiles(backend: QueueBackend): Entry[] {
  return [...SHARED, ...(backend === "river" ? RIVER : ASYNQ)];
}
