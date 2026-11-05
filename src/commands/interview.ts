import { presetChoices, presetDirs } from "../utils/http-contract";
import { cliVersion } from "../utils/version";

export interface InterviewOptions {
  presetDir?: string;
}

export function interview(options: InterviewOptions = {}): void {
  const dirs = presetDirs(options.presetDir);
  const presets = presetChoices(dirs);
  const output = {
    schemaVersion: 1,
    cliVersion: cliVersion(),
    questions: [
      {
        id: "project.name",
        type: "text",
        question: "Project name",
        description: "The directory name and, unless you override it, the Go module path.",
        default: "my-service",
        required: true,
      },
      {
        id: "project.goModule",
        type: "text",
        question: "Go module path",
        description: "Defaults to the project name.",
        default: "my-service",
        dependsOn: "project.name",
        required: true,
      },
      {
        id: "features.docker",
        type: "confirm",
        question: "Include Docker Compose for local PostgreSQL?",
        default: true,
      },
      {
        id: "features.openapiDocs",
        type: "confirm",
        question: "Include hand-written OpenAPI files?",
        default: true,
      },
      {
        id: "features.observability",
        type: "confirm",
        question: "Include Prometheus metrics and OpenTelemetry tracing?",
        default: false,
      },
      {
        id: "apiPrefix",
        type: "text",
        question: "API route prefix (blank for none, e.g. v1 or api/v1)",
        default: "",
      },
      {
        id: "http.preset",
        type: "select",
        question: "HTTP response contract",
        description: "The CLI freezes the selected shapes in go-scaffold.config.json.",
        options: presets.map((choice) => ({
          value: choice.value,
          label: choice.label,
          description: choice.description,
          source: choice.source,
          ...(choice.value === "default" ? { recommended: true, why: "Keeps the current wire format and generated FSD clients compatible." } : {}),
        })),
        default: "default",
      },
      {
        id: "architecture.moduleProfile",
        type: "select",
        question: "Default module profile",
        options: [
          { value: "lean", label: "Lean", description: "Minimal surface + one service; add endpoints as needed.", recommended: true },
          { value: "crud", label: "CRUD", description: "CRUD surface + one service." },
          { value: "cqrs", label: "CQRS", description: "Minimal surface + command/query handlers." },
        ],
        default: "lean",
      },
    ],
  };
  console.log(JSON.stringify(output, null, 2));
}
