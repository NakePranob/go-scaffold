import fs from "fs-extra";
import { insertBeforeMarker, insertBeforeMarkerOnce, removeBlock, removeLines, removeLinesByPrefix } from "./marker-patch";

const IMPORT_MARKER = "// go-scaffold:imports";
const SCHEMA_MARKER = "// go-scaffold:schemas";
const MODEL_MARKER = "// go-scaffold:models";
const ROUTE_MARKER = "// go-scaffold:routes";
// no leading tab: insertBeforeMarker re-indents, and removeLines matches by
// trimmed text — so this stays correct regardless of gofmt's indentation.
const UNUSED_API_LINE = "_ = api // dropped once `generate module` registers the first route";

export interface RoutePatch {
  goModule: string;
  /** path under internal/app, e.g. "order" */
  modulePath: string;
  pkg: string;
  pascalName: string;
  /** Postgres schema this module's table lives in, e.g. "order_svc" */
  schemaName: string;
  /** wires middleware.RequireAuth(cfg.JWTSecret) into the module's route group */
  auth?: boolean;
  /** also wires authz.Require(permission) — requires auth too */
  permission?: string;
}

// the exact lines patchMainGo inserts for a module — one source of truth so
// unpatchMainGo removes precisely what patch added.
//
// The service gets its own named variable rather than being constructed
// inline inside NewHandler(...). docs/architect/patterns.md tells you to wire
// one domain's service into another's constructor when it needs behaviour
// from it, which means editing this block by hand — and an inline expression
// has nowhere to hold the result. With a named variable the edit is "add an
// argument to the end of line one", and unpatchMainGo can still find the line
// afterwards because it matches on the `<pkg>Svc :=` prefix, not the whole
// text.
function mainGoLines(patch: RoutePatch) {
  const modelAlias = `${patch.pkg}model`; // every domain's model subpackage is named "model"
  const svcVar = `${patch.pkg}Svc`;
  const handlerArgs = [svcVar];
  if (patch.auth) handlerArgs.push("cfg.JWTSecret");
  if (patch.permission) handlerArgs.push("authz");
  return {
    importLine: `"${patch.goModule}/internal/app/${patch.modulePath}"`,
    modelImportLine: `${modelAlias} "${patch.goModule}/internal/app/${patch.modulePath}/model"`,
    // AutoMigrate (dev) creates tables but not the schema they live in — see
    // the comment on go-scaffold:schemas in main.go.hbs. One Exec per schema,
    // guarded by its own sentinel so two modules sharing a schema name only
    // ever produce one line (not expected today, but cheap to keep safe).
    schemaLines: [
      `if err := db.Exec("CREATE SCHEMA IF NOT EXISTS ${patch.schemaName}").Error; err != nil {`,
      `\tlogger.Error("create schema", "error", err)`,
      `\tos.Exit(1)`,
      `}`,
    ].join("\n"),
    schemaSentinel: `CREATE SCHEMA IF NOT EXISTS ${patch.schemaName}`,
    migrateLine: `&${modelAlias}.${patch.pascalName}{},`,
    serviceLine: `${svcVar} := ${patch.pkg}.NewService(${patch.pkg}.NewRepository(db))`,
    // matches the service line however the user has since extended it
    servicePrefix: `${svcVar} :=`,
    // `api` is the one route group declared by main.go.hbs, prefixed with
    // whatever apiPrefix the project chose at create time (e.g. /v1, /api,
    // or none) — every module registers on it, there is no per-module choice.
    // `authz` only exists in main.go once `add rbac` has run — patch.permission
    // is only ever set once that's already been verified by the caller.
    routeLine: `${patch.pkg}.NewHandler(${handlerArgs.join(", ")}).Register(api)`,
  };
}

// patchMainGo wires a newly generated module into cmd/api/main.go: its
// import, its model in the AutoMigrate call, and its route registration —
// via marker comments rather than a Go AST rewrite (ponytail: text insertion
// at a fixed marker is enough here; reach for go/ast if main.go ever needs
// edits markers can't express).
export function patchMainGo(mainGoPath: string, patch: RoutePatch): void {
  let content = fs.readFileSync(mainGoPath, "utf8");
  const { importLine, modelImportLine, schemaLines, schemaSentinel, migrateLine, serviceLine, servicePrefix, routeLine } =
    mainGoLines(patch);

  // each guarded by its own sentinel so re-running after only the module
  // folder was deleted (main.go still wired) is a no-op, not a dup that
  // panics gin at startup.
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);
  content = insertBeforeMarkerOnce(content, SCHEMA_MARKER, schemaLines, schemaSentinel);
  content = insertBeforeMarkerOnce(content, MODEL_MARKER, migrateLine, migrateLine);
  // sentinel is the prefix, not the whole line: a re-run must not add a
  // second service line just because the first one gained a dependency.
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, serviceLine, servicePrefix);
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, routeLine, routeLine);
  content = removeLines(content, [UNUSED_API_LINE]);

  fs.writeFileSync(mainGoPath, content);
}

// unpatchMainGo removes a module's wiring — the inverse of patchMainGo. If it
// leaves no registered routes, it restores the `_ = api` placeholder so
// main.go still compiles (api would otherwise be declared-and-unused).
export function unpatchMainGo(mainGoPath: string, patch: RoutePatch): void {
  let content = fs.readFileSync(mainGoPath, "utf8");
  const { importLine, modelImportLine, schemaLines, migrateLine, servicePrefix, routeLine } = mainGoLines(patch);

  content = removeLines(content, [importLine, modelImportLine, migrateLine, routeLine]);
  // by prefix: the service line may have grown arguments since it was written
  content = removeLinesByPrefix(content, [servicePrefix]);
  // by contiguous block, not removeLines: every module's schema block is
  // identical except the schema name, so a line-by-line removal would also
  // strip another module's matching lines.
  content = removeBlock(content, schemaLines);

  if (!content.includes(".Register(api)") && !content.includes(UNUSED_API_LINE)) {
    content = insertBeforeMarker(content, ROUTE_MARKER, UNUSED_API_LINE);
  }

  fs.writeFileSync(mainGoPath, content);
}
