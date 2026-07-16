import fs from "fs-extra";
import { insertBeforeMarkerOnce, removeLines } from "./marker-patch";
import { ModuleNaming } from "../types";

const PATHS_MARKER = "# go-scaffold:paths";
const SCHEMAS_MARKER = "# go-scaffold:schemas";

// the on-disk docs folder for a module — version-qualified as a FLAT sibling
// of docs/ (e.g. "v1-orders", not "v1/orders") when versioned, so the
// collection/item/schemas templates' `../common/...` relative refs stay one
// level up regardless of version. Non-versioned: unchanged ("orders").
export function docsFolderName(naming: ModuleNaming, version?: string): string {
  return version ? `${version}-${naming.plural}` : naming.plural;
}

// exact lines a module contributes to docs/openapi.yaml — shared by patch and
// unpatch so removal pulls out precisely what was added.
//
// versioned projects qualify the root index's schema keys with the version
// (OrderV1CreateInput vs OrderV2CreateInput) because v1/order and v2/order
// can coexist with the same PascalName — the per-module schemas.yaml files
// stay unqualified since they're already namespaced by their own file path.
function openapiLines(naming: ModuleNaming, version?: string) {
  const folder = docsFolderName(naming, version);
  const urlPrefix = version ?? "v1";
  const keySuffix = version ? version.charAt(0).toUpperCase() + version.slice(1) : "";
  return {
    paths: [
      `/${urlPrefix}/${naming.plural}:`,
      `  $ref: './${folder}/collection.yaml'`,
      `/${urlPrefix}/${naming.plural}/{id}:`,
      `  $ref: './${folder}/item.yaml'`,
    ],
    schemas: [
      `${naming.pascalName}${keySuffix}CreateInput: { $ref: './${folder}/schemas.yaml#/${naming.pascalName}CreateInput' }`,
      `${naming.pascalName}${keySuffix}UpdateInput: { $ref: './${folder}/schemas.yaml#/${naming.pascalName}UpdateInput' }`,
      `${naming.pascalName}${keySuffix}Response: { $ref: './${folder}/schemas.yaml#/${naming.pascalName}Response' }`,
    ],
  };
}

// patchOpenapiIndex wires a new module's collection/item docs into the
// docs/openapi.yaml index — same marker-comment approach as main.go.
export function patchOpenapiIndex(openapiPath: string, naming: ModuleNaming, version?: string): void {
  let content = fs.readFileSync(openapiPath, "utf8");
  const { paths, schemas } = openapiLines(naming, version);

  // sentinels keep re-runs idempotent (same reason as main-patcher)
  content = insertBeforeMarkerOnce(content, PATHS_MARKER, paths.join("\n"), paths[0]);
  content = insertBeforeMarkerOnce(content, SCHEMAS_MARKER, schemas.join("\n"), schemas[2]);

  fs.writeFileSync(openapiPath, content);
}

// unpatchOpenapiIndex removes a module's paths/schemas from the index — inverse
// of patchOpenapiIndex.
export function unpatchOpenapiIndex(openapiPath: string, naming: ModuleNaming, version?: string): void {
  const content = fs.readFileSync(openapiPath, "utf8");
  const { paths, schemas } = openapiLines(naming, version);
  fs.writeFileSync(openapiPath, removeLines(content, [...paths, ...schemas]));
}
