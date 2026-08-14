import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("generate method remains compatible with legacy concrete handlers and fakeRepo markers", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-legacy-method-"));
  try {
    run("node", [CLI, "create", "sample", "--defaults", "--no-docker"], scratch);
    const project = path.join(scratch, "sample");
    run("node", [CLI, "generate", "module", "orders", "--full"], project);

    const handlerPath = path.join(project, "internal", "app", "order", "handler.go");
    const modernHandler = readFileSync(handlerPath, "utf8");
    const legacyHandler = modernHandler
      .replace(/type service interface \{[\s\S]*?\/\/ go-scaffold:service-interface\n\}\n\n/, "")
      .replace('\t"context"\n', "")
      .replace('\t"sample/internal/app/order/model"\n', "")
      .replace('\t"github.com/google/uuid"\n', "")
      .replace("svc service", "svc *Service")
      .replace("func NewHandler(svc service", "func NewHandler(svc *Service");
    writeFileSync(handlerPath, legacyHandler);
    writeFileSync(
      path.join(project, "internal", "app", "order", "handler_test.go"),
      "package order\n"
    );

    const serviceTestPath = path.join(project, "internal", "app", "order", "service_test.go");
    const modernServiceTest = readFileSync(serviceTestPath, "utf8");
    const legacyServiceTest = modernServiceTest
      .replaceAll("repositoryStub", "fakeRepo")
      .replace("type fakeRepo struct {", "type fakeRepo struct {\n\terr error")
      .replace("\t// go-scaffold:repository-stub-fields\n", "")
      .replace(
        "// go-scaffold:repository-stub-methods",
        "// go-scaffold:fake-repo-methods"
      );
    writeFileSync(serviceTestPath, legacyServiceTest);

    run(
      "node",
      [CLI, "generate", "method", "orders", "findByStatus", "--type", "get", "--get-mode", "one", "--field", "status"],
      project
    );
    run("go", ["mod", "tidy"], project);
    run("go", ["test", "./..."], project);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
