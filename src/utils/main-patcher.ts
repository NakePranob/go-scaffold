import fs from "fs-extra";
import { insertBeforeMarkerOnce } from "./marker-patch";

const IMPORT_MARKER = "// go-scaffold:imports";
const MODEL_MARKER = "// go-scaffold:models";
const ROUTE_MARKER = "// go-scaffold:routes";
const UNUSED_V1_LINE = "\t_ = v1 // dropped once `generate module` registers the first route\n";

export interface RoutePatch {
  goModule: string;
  /** path under internal/app, e.g. "order" or "v1/order" */
  modulePath: string;
  pkg: string;
  pascalName: string;
}

// patchMainGo wires a newly generated module into cmd/api/main.go: its
// import, its model in the AutoMigrate call, and its route registration —
// via marker comments rather than a Go AST rewrite (ponytail: text insertion
// at a fixed marker is enough here; reach for go/ast if main.go ever needs
// edits markers can't express).
export function patchMainGo(mainGoPath: string, patch: RoutePatch): void {
  let content = fs.readFileSync(mainGoPath, "utf8");

  // aliased because every domain's model subpackage is named "model"
  const modelAlias = `${patch.pkg}model`;
  const importLine = `"${patch.goModule}/internal/app/${patch.modulePath}"`;
  const modelImportLine = `${modelAlias} "${patch.goModule}/internal/app/${patch.modulePath}/model"`;
  const migrateLine = `&${modelAlias}.${patch.pascalName}{},`;
  const routeLine = `${patch.pkg}.NewHandler(${patch.pkg}.NewService(${patch.pkg}.NewRepository(db))).Register(v1)`;

  // each guarded by its own sentinel so re-running after only the module
  // folder was deleted (main.go still wired) is a no-op, not a dup that
  // panics gin at startup.
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, importLine, importLine);
  content = insertBeforeMarkerOnce(content, IMPORT_MARKER, modelImportLine, modelImportLine);
  content = insertBeforeMarkerOnce(content, MODEL_MARKER, migrateLine, migrateLine);
  content = insertBeforeMarkerOnce(content, ROUTE_MARKER, routeLine, routeLine);
  content = content.replace(UNUSED_V1_LINE, "");

  fs.writeFileSync(mainGoPath, content);
}
