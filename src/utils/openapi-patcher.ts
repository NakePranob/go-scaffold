import fs from "fs-extra";
import { insertBeforeMarkerOnce } from "./marker-patch";
import { ModuleNaming } from "../types";

const PATHS_MARKER = "# go-scaffold:paths";
const SCHEMAS_MARKER = "# go-scaffold:schemas";

// patchOpenapiIndex wires a new module's collection/item docs into the
// docs/openapi.yaml index — same marker-comment approach as main.go.
export function patchOpenapiIndex(openapiPath: string, naming: ModuleNaming): void {
  let content = fs.readFileSync(openapiPath, "utf8");

  // sentinels keep re-runs idempotent (same reason as main-patcher)
  content = insertBeforeMarkerOnce(
    content,
    PATHS_MARKER,
    [
      `/v1/${naming.plural}:`,
      `  $ref: './${naming.plural}/collection.yaml'`,
      `/v1/${naming.plural}/{id}:`,
      `  $ref: './${naming.plural}/item.yaml'`,
    ].join("\n"),
    `/v1/${naming.plural}:`
  );

  content = insertBeforeMarkerOnce(
    content,
    SCHEMAS_MARKER,
    [
      `${naming.pascalName}CreateInput: { $ref: './${naming.plural}/schemas.yaml#/${naming.pascalName}CreateInput' }`,
      `${naming.pascalName}UpdateInput: { $ref: './${naming.plural}/schemas.yaml#/${naming.pascalName}UpdateInput' }`,
      `${naming.pascalName}Response: { $ref: './${naming.plural}/schemas.yaml#/${naming.pascalName}Response' }`,
    ].join("\n"),
    `${naming.pascalName}Response: { $ref: './${naming.plural}/schemas.yaml`
  );

  fs.writeFileSync(openapiPath, content);
}
