import fs from "fs-extra";
import { hasMarker, insertBeforeMarker, insertBeforeMarkerOnce, removeBlock, removeLines, removeLinesByPrefix } from "./marker-patch";

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
// Generated features own their repository/service/handler composition. The
// API binary supplies infrastructure and security dependencies, then only
// registers the feature's handler.
function mainGoLines(patch: RoutePatch) {
  const modelAlias = `${patch.pkg}postgres`; // every domain's persistence adapter is named "postgres"
  const handlerArgs = ["db"];
  const legacyHandlerArgs = [`${patch.pkg}Svc`];
  if (patch.auth) handlerArgs.push("cfg.JWTSecret");
  // RBAC's Authz is owned by role/composition.go. wiring.go registers a
  // permission-gated feature with that public capability; it no longer keeps a
  // standalone root variable named `authz`.
  if (patch.permission) handlerArgs.push("roleComposition.Authz");
  if (patch.auth) legacyHandlerArgs.push("cfg.JWTSecret");
  if (patch.permission) legacyHandlerArgs.push("roleComposition.Authz");
  return {
    importLine: `"${patch.goModule}/internal/app/${patch.modulePath}"`,
    modelImportLine: `${modelAlias} "${patch.goModule}/internal/app/${patch.modulePath}/adapters/outbound/postgres"`,
    // Development schema bootstrap creates tables but not the schema they live in — see
    // the comment on go-scaffold:schemas in main.go.hbs. One Exec per schema,
    // guarded by its own sentinel so two modules sharing a schema name only
    // ever produce one line (not expected today, but cheap to keep safe).
    schemaLines: [
      `if err := db.Exec("CREATE SCHEMA IF NOT EXISTS ${patch.schemaName}").Error; err != nil {`,
      `\treturn fmt.Errorf("create schema ${patch.schemaName}: %w", err)`,
      `}`,
    ].join("\n"),
    schemaSentinel: `CREATE SCHEMA IF NOT EXISTS ${patch.schemaName}`,
    migrateLine: `&${modelAlias}.${patch.pascalName}Model{},`,
    // kept only so undo can clean projects generated before feature-local
    // composition was introduced.
    legacyServicePrefix: `${patch.pkg}Svc :=`,
    legacyRouteLine: `${patch.pkg}.NewHandler(${legacyHandlerArgs.join(", ")}).Register(api)`,
    // `api` is the one route group declared by main.go.hbs, prefixed with
    // whatever apiPrefix the project chose at create time (e.g. /v1, /api,
    // or none) — every module registers on it, there is no per-module choice.
    // `roleComposition.Authz` only exists in main.go once `add rbac` has run —
    // patch.permission is only ever set once that has been verified by the
    // caller.
    routeLine: `${patch.pkg}.NewHandlerFromDB(${handlerArgs.join(", ")}).Register(api)`,
  };
}

// assertMainGoPatchable is the pre-flight for it: every marker patchMainGo
// needs, checked before the caller writes anything. Without it a missing
// marker surfaced only once the module files and its migration were already
// on disk, and the retry then hit "internal/app/<pkg> already exists" — a
// dead end that pointed nowhere useful.
export function assertMainGoPatchable(mainGoPath: string): void {
  if (!fs.existsSync(mainGoPath)) {
    throw new Error(`${mainGoPath} not found — this doesn't look like a go-scaffold project`);
  }
  const content = fs.readFileSync(mainGoPath, "utf8");
  const missing = [IMPORT_MARKER, SCHEMA_MARKER, MODEL_MARKER, ROUTE_MARKER].filter((m) => !hasMarker(content, m));
  if (missing.length) {
    throw new Error(
      `cmd/api/wiring.go is missing the marker comment${missing.length > 1 ? "s" : ""} this command patches at:\n` +
        missing.map((m) => `  ${m}`).join("\n") +
        `\n\nEither the file was hand-edited, or it was scaffolded by an older go-scaffold that\n` +
        `didn't emit ${missing.length > 1 ? "them" : "it"} yet. Add the marker${missing.length > 1 ? "s" : ""} back where the generated code should go, or\n` +
        `wire this module into main.go by hand.`
    );
  }
}

// patchMainGo wires a newly generated module into cmd/api/wiring.go: its
// import, its model in the development bootstrap, and its route registration —
// via marker comments rather than a Go AST rewrite (ponytail: text insertion
// at a fixed marker is enough here; reach for go/ast if main.go ever needs
// edits markers can't express).
export function patchMainGo(mainGoPath: string, patch: RoutePatch): void {
  let content = fs.readFileSync(mainGoPath, "utf8");
  const { importLine, modelImportLine, schemaLines, schemaSentinel, migrateLine, routeLine } =
    mainGoLines(patch);

  // each guarded by its own sentinel so re-running after only the module
  // folder was deleted (main.go still wired) is a no-op, not a dup that
  // panics gin at startup.
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);
  content = insertBeforeMarkerOnce(content, SCHEMA_MARKER, schemaLines, schemaSentinel);
  content = insertBeforeMarkerOnce(content, MODEL_MARKER, migrateLine, migrateLine);
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, routeLine, routeLine);
  content = removeLines(content, [UNUSED_API_LINE]);

  fs.writeFileSync(mainGoPath, content);
}

// unpatchMainGo removes a module's wiring — the inverse of patchMainGo. If it
// leaves no registered routes, it restores the `_ = api` placeholder so
// main.go still compiles (api would otherwise be declared-and-unused).
export function unpatchMainGo(mainGoPath: string, patch: RoutePatch): void {
  let content = fs.readFileSync(mainGoPath, "utf8");
  const { importLine, modelImportLine, schemaLines, migrateLine, legacyServicePrefix, legacyRouteLine, routeLine } = mainGoLines(patch);

  content = removeLines(content, [importLine, modelImportLine, migrateLine, routeLine, legacyRouteLine]);
  // by prefix: remove the named service line from projects generated before
  // composition became feature-local.
  content = removeLinesByPrefix(content, [legacyServicePrefix]);
  // by contiguous block, not removeLines: every module's schema block is
  // identical except the schema name, so a line-by-line removal would also
  // strip another module's matching lines.
  content = removeBlock(content, schemaLines);

  if (!content.includes(".Register(api)") && !content.includes(UNUSED_API_LINE)) {
    content = insertBeforeMarker(content, ROUTE_MARKER, UNUSED_API_LINE);
  }

  fs.writeFileSync(mainGoPath, content);
}
