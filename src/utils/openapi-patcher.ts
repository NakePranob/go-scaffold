import fs from "fs-extra";
import { insertBeforeMarkerOnce, removeLines } from "./marker-patch";
import { ModuleNaming } from "../types";

const PATHS_MARKER = "# go-scaffold:paths";
const SCHEMAS_MARKER = "# go-scaffold:schemas";

// exact lines a module contributes to docs/openapi.yaml — shared by patch and
// unpatch so removal pulls out precisely what was added. apiPrefix is the
// project-wide prefix chosen at create time (e.g. "v1", "" for none).
function openapiLines(naming: ModuleNaming, apiPrefix: string) {
  const base = apiPrefix ? `/${apiPrefix}/${naming.plural}` : `/${naming.plural}`;
  return {
    paths: [
      `${base}:`,
      `  $ref: './${naming.plural}/collection.yaml'`,
      `${base}/{id}:`,
      `  $ref: './${naming.plural}/item.yaml'`,
    ],
    schemas: [
      `${naming.pascalName}CreateInput: { $ref: './${naming.plural}/schemas.yaml#/${naming.pascalName}CreateInput' }`,
      `${naming.pascalName}UpdateInput: { $ref: './${naming.plural}/schemas.yaml#/${naming.pascalName}UpdateInput' }`,
      `${naming.pascalName}Response: { $ref: './${naming.plural}/schemas.yaml#/${naming.pascalName}Response' }`,
    ],
  };
}

// patchOpenapiIndex wires a new module's collection/item docs into the
// docs/openapi.yaml index — same marker-comment approach as main.go.
export function patchOpenapiIndex(openapiPath: string, naming: ModuleNaming, apiPrefix: string): void {
  let content = fs.readFileSync(openapiPath, "utf8");
  const { paths, schemas } = openapiLines(naming, apiPrefix);

  // sentinels keep re-runs idempotent (same reason as main-patcher)
  content = insertBeforeMarkerOnce(content, PATHS_MARKER, paths.join("\n"), paths[0]);
  content = insertBeforeMarkerOnce(content, SCHEMAS_MARKER, schemas.join("\n"), schemas[2]);

  fs.writeFileSync(openapiPath, content);
}

// unpatchOpenapiIndex removes a module's paths/schemas from the index — inverse
// of patchOpenapiIndex.
export function unpatchOpenapiIndex(openapiPath: string, naming: ModuleNaming, apiPrefix: string): void {
  const content = fs.readFileSync(openapiPath, "utf8");
  const { paths, schemas } = openapiLines(naming, apiPrefix);
  fs.writeFileSync(openapiPath, removeLines(content, [...paths, ...schemas]));
}
