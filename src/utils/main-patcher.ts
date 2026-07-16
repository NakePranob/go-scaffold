import fs from "fs-extra";
import { insertBeforeMarker, insertBeforeMarkerOnce, removeLines } from "./marker-patch";

const IMPORT_MARKER = "// go-scaffold:imports";
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
}

// the exact lines patchMainGo inserts for a module — one source of truth so
// unpatchMainGo removes precisely what patch added.
function mainGoLines(patch: RoutePatch) {
  const modelAlias = `${patch.pkg}model`; // every domain's model subpackage is named "model"
  return {
    importLine: `"${patch.goModule}/internal/app/${patch.modulePath}"`,
    modelImportLine: `${modelAlias} "${patch.goModule}/internal/app/${patch.modulePath}/model"`,
    migrateLine: `&${modelAlias}.${patch.pascalName}{},`,
    // `api` is the one route group declared by main.go.hbs, prefixed with
    // whatever apiPrefix the project chose at create time (e.g. /v1, /api,
    // or none) — every module registers on it, there is no per-module choice.
    routeLine: `${patch.pkg}.NewHandler(${patch.pkg}.NewService(${patch.pkg}.NewRepository(db))).Register(api)`,
  };
}

// patchMainGo wires a newly generated module into cmd/api/main.go: its
// import, its model in the AutoMigrate call, and its route registration —
// via marker comments rather than a Go AST rewrite (ponytail: text insertion
// at a fixed marker is enough here; reach for go/ast if main.go ever needs
// edits markers can't express).
export function patchMainGo(mainGoPath: string, patch: RoutePatch): void {
  let content = fs.readFileSync(mainGoPath, "utf8");
  const { importLine, modelImportLine, migrateLine, routeLine } = mainGoLines(patch);

  // each guarded by its own sentinel so re-running after only the module
  // folder was deleted (main.go still wired) is a no-op, not a dup that
  // panics gin at startup.
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);
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
  const { importLine, modelImportLine, migrateLine, routeLine } = mainGoLines(patch);

  content = removeLines(content, [importLine, modelImportLine, migrateLine, routeLine]);

  if (!content.includes(".Register(api)") && !content.includes(UNUSED_API_LINE)) {
    content = insertBeforeMarker(content, ROUTE_MARKER, UNUSED_API_LINE);
  }

  fs.writeFileSync(mainGoPath, content);
}
