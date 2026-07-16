import fs from "fs-extra";
import { insertBeforeMarker, insertBeforeMarkerOnce, removeLines } from "./marker-patch";

const IMPORT_MARKER = "// go-scaffold:imports";
const MODEL_MARKER = "// go-scaffold:models";
const ROUTE_GROUPS_MARKER = "// go-scaffold:route-groups";
const ROUTE_MARKER = "// go-scaffold:routes";
// no leading tab: insertBeforeMarker re-indents, and removeLines matches by
// trimmed text — so this stays correct regardless of gofmt's indentation.
const UNUSED_V1_LINE = "_ = v1 // dropped once `generate module` registers the first route";

export interface RoutePatch {
  goModule: string;
  /** path under internal/app, e.g. "order" or "v1/order" */
  modulePath: string;
  pkg: string;
  pascalName: string;
  /** version folder ("v1", "v2", ...) when the project has versioning enabled; undefined otherwise */
  version?: string;
}

// the exact lines patchMainGo inserts for a module — one source of truth so
// unpatchMainGo removes precisely what patch added.
//
// non-versioned projects: bare import (`order`), bare model alias
// (`ordermodel`), routes register on the single hardcoded `v1` group —
// unchanged from before route-level versioning existed.
//
// versioned projects: import + model alias are qualified with the version
// (`orderv1`, `orderv1model`) so the SAME domain name can live in v1 and v2
// at once (the actual point of API versioning) without a redeclared-import
// error; routes register on a group named after their own version, declared
// on demand.
function mainGoLines(patch: RoutePatch) {
  const alias = patch.version ? `${patch.pkg}${patch.version}` : patch.pkg;
  const modelAlias = `${alias}model`;
  const groupVar = patch.version ?? "v1";
  return {
    importLine: patch.version
      ? `${alias} "${patch.goModule}/internal/app/${patch.modulePath}"`
      : `"${patch.goModule}/internal/app/${patch.modulePath}"`,
    modelImportLine: `${modelAlias} "${patch.goModule}/internal/app/${patch.modulePath}/model"`,
    migrateLine: `&${modelAlias}.${patch.pascalName}{},`,
    routeLine: `${alias}.NewHandler(${alias}.NewService(${alias}.NewRepository(db))).Register(${groupVar})`,
    groupLine: patch.version ? `${patch.version} := r.Group("/${patch.version}")` : undefined,
  };
}

// patchMainGo wires a newly generated module into cmd/api/main.go: its
// import, its model in the AutoMigrate call, and its route registration —
// via marker comments rather than a Go AST rewrite (ponytail: text insertion
// at a fixed marker is enough here; reach for go/ast if main.go ever needs
// edits markers can't express).
export function patchMainGo(mainGoPath: string, patch: RoutePatch): void {
  let content = fs.readFileSync(mainGoPath, "utf8");
  const { importLine, modelImportLine, migrateLine, routeLine, groupLine } = mainGoLines(patch);

  // each guarded by its own sentinel so re-running after only the module
  // folder was deleted (main.go still wired) is a no-op, not a dup that
  // panics gin at startup.
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);
  content = insertBeforeMarkerOnce(content, MODEL_MARKER, migrateLine, migrateLine);
  if (groupLine) {
    // declared once per version, shared by every module in that version
    content = insertBeforeMarkerOnce(content, ROUTE_GROUPS_MARKER, groupLine, groupLine);
  }
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, routeLine, routeLine);
  content = removeLines(content, [UNUSED_V1_LINE]);

  fs.writeFileSync(mainGoPath, content);
}

// unpatchMainGo removes a module's wiring — the inverse of patchMainGo.
// Non-versioned: if it leaves no registered routes, restores the `_ = v1`
// placeholder so main.go still compiles (v1 would otherwise be
// declared-and-unused).
// Versioned: if no other module still registers on this module's version
// group, also drops that group's declaration line (same reason — an unused
// `v2 := r.Group(...)` fails to compile).
export function unpatchMainGo(mainGoPath: string, patch: RoutePatch): void {
  let content = fs.readFileSync(mainGoPath, "utf8");
  const { importLine, modelImportLine, migrateLine, routeLine, groupLine } = mainGoLines(patch);

  content = removeLines(content, [importLine, modelImportLine, migrateLine, routeLine]);

  if (patch.version) {
    if (groupLine && !content.includes(`.Register(${patch.version})`)) {
      content = removeLines(content, [groupLine]);
    }
  } else if (!content.includes(".Register(v1)") && !content.includes(UNUSED_V1_LINE)) {
    content = insertBeforeMarker(content, ROUTE_MARKER, UNUSED_V1_LINE);
  }

  fs.writeFileSync(mainGoPath, content);
}
