import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CLI = path.join(ROOT, "bin", "go-scaffold.js");
const KEEP = process.env.QA_KEEP === "1";

function run(cwd, ...args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
}

function runResult(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function assertOk(result, label) {
  assert.equal(result.status, 0, `${label} exited ${result.status}\n${result.output}`);
}

function read(project, relativePath) {
  return readFileSync(path.join(project, relativePath), "utf8");
}

function write(project, relativePath, content) {
  const target = path.join(project, relativePath);
  writeFileSync(target, content);
}

function goFiles(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...goFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".go")) found.push(entryPath);
  }
  return found;
}

function filesUnder(directory, suffix) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(entryPath, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) found.push(entryPath);
  }
  return found;
}

function assertNoRawWriter(file) {
  const content = readFileSync(file, "utf8");
  assert.doesNotMatch(
    content,
    /\bc\.JSON\s*\(/,
    `${path.relative(ROOT, file)} still writes JSON with c.JSON(...)`
  );
  assert.doesNotMatch(
    content,
    /\bc\.Status\s*\(/,
    `${path.relative(ROOT, file)} still writes a status with c.Status(...)`
  );
}

function assertGenericModule(project, moduleDir) {
  const handlerDir = path.join(project, moduleDir, "adapters", "inbound", "http");
  const files = goFiles(handlerDir).filter((file) => !file.endsWith("_test.go"));
  assert.ok(files.length > 0, `${moduleDir} has no inbound handler files`);
  for (const file of files) assertNoRawWriter(file);

  const handler = read(project, path.join(moduleDir, "adapters", "inbound", "http", "handler.go"));
  assert.match(handler, /func appError\s*\(/, `${moduleDir} does not expose appError`);
  assert.match(handler, /apperror\.Translate\s*\(/, `${moduleDir} handler does not use apperror.Translate`);
  assert.doesNotMatch(handler, /func applicationError\s*\(/, `${moduleDir} still has applicationError`);
}

function assertGenericAuth(project, moduleDir) {
  const handlerDir = path.join(project, moduleDir, "adapters", "inbound", "http");
  const files = goFiles(handlerDir).filter((file) => !file.endsWith("_test.go"));
  assert.ok(files.length > 0, `${moduleDir} has no inbound handler files`);
  for (const file of files) assertNoRawWriter(file);

  const handler = read(project, path.join(moduleDir, "adapters", "inbound", "http", "handler.go"));
  assert.match(handler, /func appError\s*\(/, `${moduleDir} does not expose appError`);
  assert.doesNotMatch(handler, /func toHTTPError\s*\(/, `${moduleDir} still has toHTTPError`);
  assert.match(handler, /apperror\.(?:Translate|TranslateCoded)\s*\(/, `${moduleDir} does not use the shared translator`);
}

const ROUTE_CONTRACT_TEST = String.raw`package httpadapter

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"qaapp/internal/app/order/application"
	"qaapp/internal/app/order/domain"
	"qaapp/internal/app/order/ports"
	"qaapp/internal/shared/middleware"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type contractStub struct {
	listItems []domain.Order
	listTotal int64
	getErr    error
}

func (s contractStub) Create(context.Context, application.CreateInput) (*domain.Order, error) {
	return &domain.Order{}, nil
}

func (s contractStub) List(context.Context, ports.ListFilter) ([]domain.Order, int64, error) {
	return s.listItems, s.listTotal, nil
}

func (s contractStub) Get(_ context.Context, id uuid.UUID) (*domain.Order, error) {
	if s.getErr != nil {
		return nil, s.getErr
	}
	return &domain.Order{ID: id}, nil
}

func (s contractStub) Update(context.Context, uuid.UUID, application.UpdateInput) (*domain.Order, error) {
	return &domain.Order{}, nil
}

func (s contractStub) Delete(context.Context, uuid.UUID) error { return nil }

func (s contractStub) Approve(context.Context, uuid.UUID) error { return nil }

func contractRouter(stub application.ServicePort) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	r.Use(middleware.Error(false))
	NewHandler(stub).Register(r)
	return r
}

func serve(t *testing.T, r http.Handler, method, target, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("X-Request-ID", "qa-request-id")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var decoded map[string]any
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("%s %s returned non-JSON body %q: %v", method, target, w.Body.String(), err)
		}
	}
	return w, decoded
}

func TestHTTPJSONContract(t *testing.T) {
	t.Run("list uses data limit offset total", func(t *testing.T) {
		r := contractRouter(contractStub{listItems: []domain.Order{}, listTotal: 0})
		w, body := serve(t, r, http.MethodGet, "/orders?limit=20&offset=0", "")
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", w.Code)
		}
		if _, ok := body["data"].([]any); !ok {
			t.Fatalf("data is not an array: %#v", body["data"])
		}
		if body["limit"] != float64(20) || body["offset"] != float64(0) || body["total"] != float64(0) {
			t.Fatalf("pagination envelope = %#v", body)
		}
	})

	t.Run("item response is the resource object", func(t *testing.T) {
		r := contractRouter(contractStub{})
		w, body := serve(t, r, http.MethodGet, "/orders/"+uuid.NewString(), "")
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", w.Code)
		}
		for _, key := range []string{"id", "created_at", "version"} {
			if _, ok := body[key]; !ok {
				t.Fatalf("response missing %q: %#v", key, body)
			}
		}
	})

	t.Run("not found uses the error envelope with a module code", func(t *testing.T) {
		r := contractRouter(contractStub{getErr: domain.ErrNotFound})
		w, body := serve(t, r, http.MethodGet, "/orders/"+uuid.NewString(), "")
		if w.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", w.Code)
		}
		errObj, ok := body["error"].(map[string]any)
		if !ok {
			t.Fatalf("missing error envelope: %#v", body)
		}
		if errObj["code"] != "ORDER_NOT_FOUND" || errObj["message"] != "order not found" {
			t.Fatalf("error envelope = %#v", errObj)
		}
		if id, _ := errObj["request_id"].(string); id != "qa-request-id" {
			t.Fatalf("error request_id = %q, want qa-request-id", id)
		}
	})

	t.Run("invalid id uses VALIDATION_ERROR", func(t *testing.T) {
		r := contractRouter(contractStub{})
		w, body := serve(t, r, http.MethodGet, "/orders/not-a-uuid", "")
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", w.Code)
		}
		errObj := body["error"].(map[string]any)
		if errObj["code"] != "VALIDATION_ERROR" || errObj["message"] != "invalid id" {
			t.Fatalf("error envelope = %#v", errObj)
		}
	})

	t.Run("create returns 201 and the resource object", func(t *testing.T) {
		r := contractRouter(contractStub{})
		w, body := serve(t, r, http.MethodPost, "/orders", "{}")
		if w.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201 (body %q)", w.Code, w.Body.String())
		}
		for _, key := range []string{"id", "created_at", "version"} {
			if _, ok := body[key]; !ok {
				t.Fatalf("response missing %q: %#v", key, body)
			}
		}
	})

	t.Run("delete returns 204 with no body", func(t *testing.T) {
		r := contractRouter(contractStub{})
		w, _ := serve(t, r, http.MethodDelete, "/orders/"+uuid.NewString(), "")
		if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
			t.Fatalf("status = %d, body = %q; want 204 empty", w.Code, w.Body.String())
		}
	})
}

func TestHTTPJSONContractOverNetwork(t *testing.T) {
	server := httptest.NewServer(contractRouter(contractStub{listItems: []domain.Order{}, listTotal: 0}))
	defer server.Close()

	resp, err := http.Get(server.URL + "/orders?limit=20&offset=0")
	if err != nil {
		t.Fatalf("GET list: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want 200", resp.StatusCode)
	}
	if got := resp.Header.Get("Content-Type"); !strings.Contains(got, "application/json") {
		t.Fatalf("list content-type = %q, want application/json", got)
	}
	var listBody struct {
		Data   []json.RawMessage ` + "`json:\"data\"`" + `
		Limit  int               ` + "`json:\"limit\"`" + `
		Offset int               ` + "`json:\"offset\"`" + `
		Total  int64             ` + "`json:\"total\"`" + `
	}
	if err := json.NewDecoder(resp.Body).Decode(&listBody); err != nil {
		t.Fatalf("decode list body: %v", err)
	}
	if listBody.Data == nil || listBody.Limit != 20 || listBody.Offset != 0 || listBody.Total != 0 {
		t.Fatalf("list envelope = %#v", listBody)
	}

	req, err := http.NewRequest(http.MethodGet, server.URL+"/orders/not-a-uuid", nil)
	if err != nil {
		t.Fatalf("build invalid-id request: %v", err)
	}
	req.Header.Set("X-Request-ID", "qa-network-request")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET invalid id: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid-id status = %d, want 400", resp.StatusCode)
	}
	var errorBody struct {
		Error struct {
			Code      string ` + "`json:\"code\"`" + `
			Message   string ` + "`json:\"message\"`" + `
			RequestID string ` + "`json:\"request_id\"`" + `
		} ` + "`json:\"error\"`" + `
	}
	if err := json.NewDecoder(resp.Body).Decode(&errorBody); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if errorBody.Error.Code != "VALIDATION_ERROR" || errorBody.Error.Message != "invalid id" || errorBody.Error.RequestID != "qa-network-request" {
		t.Fatalf("error envelope = %#v", errorBody)
	}
}
`;

const APPERROR_CONTRACT_TEST = String.raw`package apperror

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
)

var errContractBoom = errors.New("contract boom")

func TestTranslateContract(t *testing.T) {
	rules := []Rule{
		{Err: errContractBoom, Status: http.StatusNotFound, Code: "THING_NOT_FOUND", Message: "thing not found"},
	}

	if got := Translate(nil, rules...); got != nil {
		t.Fatalf("Translate(nil) = %v, want nil", got)
	}

	translated := Translate(fmt.Errorf("load thing: %w", errContractBoom), rules...)
	var appErr *AppError
	if !errors.As(translated, &appErr) {
		t.Fatalf("Translate(wrapped sentinel) = %T, want *AppError", translated)
	}
	if appErr.HTTPStatus != http.StatusNotFound || appErr.Code != "THING_NOT_FOUND" || appErr.Message != "thing not found" {
		t.Fatalf("translated = %#v", appErr)
	}

	existing := NewConflict("already exists")
	if got := Translate(existing, rules...); got != existing {
		t.Fatalf("Translate(*AppError) = %#v, want the same pointer", got)
	}

	unknownCause := errors.New("database exploded")
	unknown := Translate(unknownCause, rules...)
	if !errors.As(unknown, &appErr) {
		t.Fatalf("Translate(unknown) = %T, want *AppError", unknown)
	}
	if appErr.HTTPStatus != http.StatusInternalServerError || appErr.Code != "INTERNAL" {
		t.Fatalf("unknown translated = %#v", appErr)
	}
	if !errors.Is(unknown, unknownCause) {
		t.Fatalf("unknown translated lost its cause: %v", unknown)
	}
}
`;

const HTTPX_CONTRACT_TEST = String.raw`package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"qaapp/internal/shared/pagination"

	"github.com/gin-gonic/gin"
)

func testContext(method, target string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, target, nil)
	return c, w
}

func decodeBody(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not JSON: %v", w.Body.String(), err)
	}
	return body
}

func TestResponseWriters(t *testing.T) {
	c, w := testContext(http.MethodGet, "/")
	OK(c, map[string]string{"id": "thing-1"})
	if w.Code != http.StatusOK {
		t.Fatalf("OK status = %d, want 200", w.Code)
	}
	if got := decodeBody(t, w)["id"]; got != "thing-1" {
		t.Fatalf("OK body id = %v", got)
	}

	c, w = testContext(http.MethodPost, "/")
	Created(c, map[string]string{"id": "thing-1"})
	if w.Code != http.StatusCreated {
		t.Fatalf("Created status = %d, want 201", w.Code)
	}

	c, w = testContext(http.MethodDelete, "/")
	NoContent(c)
	if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
		t.Fatalf("NoContent status = %d, body = %q; want 204 empty", w.Code, w.Body.String())
	}

	c, w = testContext(http.MethodGet, "/")
	Page(c, pagination.Params{Limit: 20, Offset: 0}, []string{"a"}, 1)
	if w.Code != http.StatusOK {
		t.Fatalf("Page status = %d, want 200", w.Code)
	}
	body := decodeBody(t, w)
	if body["limit"] != float64(20) || body["offset"] != float64(0) || body["total"] != float64(1) {
		t.Fatalf("Page envelope = %#v", body)
	}
	data, ok := body["data"].([]any)
	if !ok || len(data) != 1 || data[0] != "a" {
		t.Fatalf("Page data = %#v", body["data"])
	}
}
`;

const MIDDLEWARE_CONTRACT_TEST = String.raw`package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"qaapp/internal/shared/apperror"

	"github.com/gin-gonic/gin"
)

func TestErrorContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequestID())
	r.Use(Error(false))
	r.GET("/missing", func(c *gin.Context) {
		c.Error(apperror.NewNotFound("thing not found"))
	})

	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	req.Header.Set("X-Request-ID", "qa-error-request")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
	var body struct {
		Error struct {
			Code      string ` + "`json:\"code\"`" + `
			Message   string ` + "`json:\"message\"`" + `
			RequestID string ` + "`json:\"request_id\"`" + `
		} ` + "`json:\"error\"`" + `
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not JSON: %v", w.Body.String(), err)
	}
	if body.Error.Code != "NOT_FOUND" || body.Error.Message != "thing not found" || body.Error.RequestID != "qa-error-request" {
		t.Fatalf("error envelope = %#v", body)
	}
}
`;

const PAGINATION_CONTRACT_TEST = String.raw`package pagination

import "testing"

func TestPaginationEnvelope(t *testing.T) {
	params := Params{Limit: 20, Offset: 0}
	got := params.ResponseWithTotal([]string{"a"}, 1)
	if got["limit"] != 20 || got["offset"] != 0 || got["total"] != int64(1) {
		t.Fatalf("envelope = %#v", got)
	}
	if data, ok := got["data"].([]string); !ok || len(data) != 1 || data[0] != "a" {
		t.Fatalf("data = %#v", got["data"])
	}
}
`;

test("generic HTTP contract", { timeout: 240000 }, async (t) => {
  if (!existsSync(path.join(ROOT, "dist", "index.js"))) {
    assert.fail("dist/index.js is missing — run `pnpm run build` before `pnpm run test:qa`");
  }

  const scratch = mkdtempSync(path.join(tmpdir(), "go-scaffold-qa-http-"));
  const project = path.join(scratch, "qaapp");
  try {
    run(scratch, "create", "qaapp", "--defaults", "--no-docker", "--api-prefix", "v1");
    run(project, "generate", "module", "orders", "--profile", "crud", "--defaults");
    run(project, "generate", "module", "catalog", "--surface", "read", "--defaults");
    run(project, "generate", "module", "relay", "--surface", "none", "--defaults");
    run(project, "generate", "module", "presence", "--surface", "minimal", "--cqrs", "--defaults");
    run(project, "generate", "method", "orders", "approve", "--type", "patch");
    run(project, "add", "auth", "--defaults", "--yes");
    run(project, "add", "rbac", "--yes");

    const tidy = runResult("go", ["mod", "tidy"], project);
    assertOk(tidy, "go mod tidy");

    write(project, "internal/app/order/adapters/inbound/http/route_contract_qa_test.go", ROUTE_CONTRACT_TEST);
    write(project, "internal/shared/apperror/translate_qa_test.go", APPERROR_CONTRACT_TEST);
    write(project, "internal/shared/httpx/respond_qa_test.go", HTTPX_CONTRACT_TEST);
    write(project, "internal/shared/middleware/error_contract_qa_test.go", MIDDLEWARE_CONTRACT_TEST);
    write(project, "internal/shared/pagination/envelope_qa_test.go", PAGINATION_CONTRACT_TEST);

    await t.test("regression tier: current wire shapes are stable", () => {
      const regression = runResult(
        "go",
        [
          "test",
          "-count=1",
          "-run",
          "TestHTTPJSONContract|TestHTTPJSONContractOverNetwork|TestErrorContract|TestPaginationEnvelope",
          "./internal/app/order/adapters/inbound/http",
          "./internal/shared/middleware",
          "./internal/shared/pagination",
        ],
        project
      );
      assertOk(regression, "regression Go tests");
      assert.match(regression.output, /ok\s+qaapp\/internal\/app\/order\/adapters\/inbound\/http/);
      assert.match(regression.output, /ok\s+qaapp\/internal\/shared\/middleware/);
      assert.match(regression.output, /ok\s+qaapp\/internal\/shared\/pagination/);
    });

    await t.test("target tier: generic helpers exist and behave", () => {
      const target = runResult(
        "go",
        ["test", "-count=1", "-run", "TestTranslateContract|TestResponseWriters", "./internal/shared/apperror", "./internal/shared/httpx"],
        project
      );
      assertOk(target, "target helper Go tests");
      assert.match(target.output, /ok\s+qaapp\/internal\/shared\/apperror/);
      assert.match(target.output, /ok\s+qaapp\/internal\/shared\/httpx/);
    });

    await t.test("target tier: generated handlers use one response/error pattern", () => {
      const contractDoc = read(project, "docs/architect/http-contract.md");
      assert.match(contractDoc, /httpx\.OK/, "contract doc does not name httpx.OK");
      assert.match(contractDoc, /apperror\.Translate/, "contract doc does not name apperror.Translate");
      for (const file of ["README.md", "AGENTS.md", ".agents/skills/go-scaffold/SKILL.md"]) {
        assert.match(read(project, file), /http-contract\.md/, `${file} does not link to the contract`);
      }

      for (const module of ["order", "catalog", "relay", "presence"]) {
        assertGenericModule(project, path.join("internal", "app", module));
      }

      const ordersHandler = read(
        project,
        "internal/app/order/adapters/inbound/http/handler.go"
      );
      for (const helper of ["httpx.Created(", "httpx.OK(", "httpx.Page(", "httpx.NoContent("]) {
        assert.ok(ordersHandler.includes(helper), `orders handler does not use ${helper}`);
      }

      const method = read(
        project,
        "internal/app/order/adapters/inbound/http/method_approve.go"
      );
      assert.match(method, /httpx\.NoContent\s*\(/, "generated method does not use httpx.NoContent");
      assert.match(method, /appError\(err\)/, "generated method does not use appError");
      assertNoRawWriter(path.join(project, "internal/app/order/adapters/inbound/http/method_approve.go"));

      assertGenericAuth(project, path.join("internal", "app", "user"));
      assertGenericAuth(project, path.join("internal", "app", "role"));

      const templateRoots = [
        path.join(ROOT, "templates", "generate", "module", "hexagonal", "adapters", "inbound", "http"),
        path.join(ROOT, "templates", "add", "auth", "internal", "app", "user", "adapters", "inbound", "http"),
        path.join(ROOT, "templates", "add", "rbac", "internal", "app", "role", "adapters", "inbound", "http"),
      ];
      for (const root of templateRoots) {
        const files = filesUnder(root, ".hbs");
        assert.ok(files.length > 0, `no handler templates under ${root}`);
        for (const file of files) assertNoRawWriter(file);
      }
    });

    await t.test("target tier: generated fixture compiles and passes its checks", () => {
      const unit = runResult("go", ["test", "-count=1", "./..."], project);
      assertOk(unit, "generated go test ./...");

      const vet = runResult("go", ["vet", "./..."], project);
      assertOk(vet, "generated go vet ./...");

      const check = runResult(process.execPath, [CLI, "check"], project);
      assertOk(check, "go-scaffold check");
      assert.match(check.output, /architecture check passed/);
    });
  } finally {
    if (KEEP) {
      console.log(`QA fixture kept at ${scratch}`);
    } else {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
});
