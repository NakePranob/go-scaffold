import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");

function run(cwd, ...args) {
  return execFileSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
}

function go(cwd, ...args) {
  return execFileSync("go", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });
}

const CASES = [
  { preset: "default", single: "bare", list: "data-limit-offset-total", error: "error-object" },
  { preset: "envelope", single: "data", list: "data-meta", error: "error-object" },
  { preset: "items", single: "data", list: "items-total", error: "errors-array" },
  { preset: "problem", single: "bare", list: "data-limit-offset-total", error: "problem-json" },
];

function singleAssertion(shape) {
  return shape === "data"
    ? `var wrapper struct { Data map[string]any \`json:"data"\` }; if err := json.Unmarshal(w.Body.Bytes(), &wrapper); err != nil { t.Fatal(err) }; if wrapper.Data["id"] != "thing-1" { t.Fatalf("data = %#v", wrapper.Data) }`
    : `var body map[string]any; if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil { t.Fatal(err) }; if body["id"] != "thing-1" { t.Fatalf("body = %#v", body) }`;
}

function listAssertion(shape) {
  if (shape === "data-meta") {
    return `var body struct { Data []string \`json:"data"\`; Meta map[string]any \`json:"meta"\` }; if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil { t.Fatal(err) }; if len(body.Data) != 1 || body.Meta["limit"] != float64(20) || body.Meta["offset"] != float64(0) || body.Meta["total"] != float64(1) { t.Fatalf("body = %#v", body) }`;
  }
  if (shape === "items-total") {
    return `var body struct { Items []string \`json:"items"\`; Total int64 \`json:"total"\` }; if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil { t.Fatal(err) }; if len(body.Items) != 1 || body.Total != 1 { t.Fatalf("body = %#v", body) }`;
  }
  return `var body struct { Data []string \`json:"data"\`; Limit int \`json:"limit"\`; Offset int \`json:"offset"\`; Total int64 \`json:"total"\` }; if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil { t.Fatal(err) }; if len(body.Data) != 1 || body.Limit != 20 || body.Offset != 0 || body.Total != 1 { t.Fatalf("body = %#v", body) }`;
}

function errorAssertion(shape) {
  if (shape === "errors-array") {
    return `var body struct { Errors []struct { Code string \`json:"code"\` } \`json:"errors"\` }; if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil { t.Fatal(err) }; if len(body.Errors) != 1 || body.Errors[0].Code != "NOT_FOUND" { t.Fatalf("body = %#v", body) }`;
  }
  if (shape === "problem-json") {
    return `var body struct { Title string \`json:"title"\`; Status int \`json:"status"\` }; if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil { t.Fatal(err) }; if body.Title != "NOT_FOUND" || body.Status != 404 { t.Fatalf("body = %#v", body) }`;
  }
  return `var body struct { Error struct { Code string \`json:"code"\` } \`json:"error"\` }; if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil { t.Fatal(err) }; if body.Error.Code != "NOT_FOUND" { t.Fatalf("body = %#v", body) }`;
}

function httpxTest(singleShape, listShape) {
  return `package httpx

import (
\t"encoding/json"
\t"net/http"
\t"net/http/httptest"
\t"testing"

\t"{{MODULE}}/internal/shared/pagination"

\t"github.com/gin-gonic/gin"
)

func contextFor(method, target string) (*gin.Context, *httptest.ResponseRecorder) {
\tgin.SetMode(gin.TestMode)
\tw := httptest.NewRecorder()
\tc, _ := gin.CreateTestContext(w)
\tc.Request = httptest.NewRequest(method, target, nil)
\treturn c, w
}

func TestPresetWriters(t *testing.T) {
\tc, w := contextFor(http.MethodGet, "/")
\tOK(c, map[string]string{"id": "thing-1"})
\tif w.Code != http.StatusOK { t.Fatalf("OK status = %d", w.Code) }
\t{ ${singleAssertion(singleShape)} }

\tc, w = contextFor(http.MethodPost, "/")
\tCreated(c, map[string]string{"id": "thing-1"})
\tif w.Code != http.StatusCreated { t.Fatalf("Created status = %d", w.Code) }
\t{ ${singleAssertion(singleShape)} }

\tc, w = contextFor(http.MethodDelete, "/")
\tNoContent(c)
\tif w.Code != http.StatusNoContent || w.Body.Len() != 0 { t.Fatalf("NoContent = %d %q", w.Code, w.Body.String()) }

\tc, w = contextFor(http.MethodGet, "/")
\tPage(c, pagination.Params{Limit: 20, Offset: 0}, []string{"a"}, 1)
\tif w.Code != http.StatusOK { t.Fatalf("Page status = %d", w.Code) }
\t{ ${listAssertion(listShape)} }
}
`;
}

function middlewareTest(errorShape) {
  return `package middleware

import (
\t"encoding/json"
\t"net/http"
\t"net/http/httptest"
\t"testing"

\t"{{MODULE}}/internal/shared/apperror"

\t"github.com/gin-gonic/gin"
)

func TestPresetErrorShape(t *testing.T) {
\tgin.SetMode(gin.TestMode)
\tr := gin.New()
\tr.Use(RequestID())
\tr.Use(Error(false))
\tr.GET("/missing", func(c *gin.Context) { c.Error(apperror.NewNotFound("thing not found")) })

\tw := httptest.NewRecorder()
\tr.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/missing", nil))
\tif w.Code != http.StatusNotFound { t.Fatalf("status = %d", w.Code) }
\t${errorAssertion(errorShape)}
}
`;
}

for (const testCase of CASES) {
  test(`preset ${testCase.preset} writes the configured shapes`, { timeout: 120000 }, () => {
    const scratch = mkdtempSync(path.join(tmpdir(), `go-scaffold-qa-preset-${testCase.preset}-`));
    try {
      run(scratch, "create", `${testCase.preset}app`, "--defaults", "--no-docker", "--http-preset", testCase.preset);
      const project = path.join(scratch, `${testCase.preset}app`);
      const goModule = `${testCase.preset}app`;
      go(project, "mod", "tidy");
      writeFileSync(
        path.join(project, "internal", "shared", "httpx", "preset_qa_test.go"),
        httpxTest(testCase.single, testCase.list).replaceAll("{{MODULE}}", goModule),
      );
      writeFileSync(
        path.join(project, "internal", "shared", "middleware", "preset_qa_test.go"),
        middlewareTest(testCase.error).replaceAll("{{MODULE}}", goModule),
      );
      const result = go(project, "test", "-count=1", "./internal/shared/httpx", "./internal/shared/middleware");
      assert.match(result, /ok\s+/);
      const check = run(project, "check");
      assert.match(check, new RegExp(`http contract: ${testCase.preset}`));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
