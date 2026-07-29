// output paths are relative to the project root
export const WORKER_FILES: { template: string; output: string }[] = [
  { template: "add/worker/internal/platform/cache/redis.go.hbs", output: "internal/platform/cache/redis.go" },
  { template: "add/worker/internal/platform/queue/client.go.hbs", output: "internal/platform/queue/client.go" },
  { template: "add/worker/internal/platform/queue/server.go.hbs", output: "internal/platform/queue/server.go" },
  { template: "add/worker/internal/platform/mail/mail.go.hbs", output: "internal/platform/mail/mail.go" },
  { template: "add/worker/internal/platform/mail/task.go.hbs", output: "internal/platform/mail/task.go" },
  { template: "add/worker/cmd/worker/main.go.hbs", output: "cmd/worker/main.go" },
];
