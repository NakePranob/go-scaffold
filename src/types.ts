export interface ProjectFeatures {
  docker: boolean;
  openapiDocs: boolean;
}

export interface ProjectConfig {
  projectName: string;
  goModule: string;
  /** URL prefix every route is grouped under, e.g. "v1" -> /v1/orders. "" means no prefix. */
  apiPrefix: string;
  features: ProjectFeatures;
}

export interface ModuleNaming {
  /** raw name as passed on the CLI, lowercased (e.g. "order") */
  name: string;
  /** Go package name — lowercase, no separators (e.g. "order") */
  pkg: string;
  /** Go exported type name (e.g. "Order") */
  pascalName: string;
  /** plural, used for REST route + table name (e.g. "orders") */
  plural: string;
  /** SCREAMING_SNAKE prefix for error codes (e.g. "ORDER") */
  errorPrefix: string;
}

export type MethodType = "get" | "post" | "put" | "patch" | "delete";
export type GetMethodMode = "all" | "one";

export interface MethodNaming {
  /** raw name as passed on the CLI, trimmed (e.g. "approve") */
  name: string;
  /** exported Service method name (e.g. "Approve", "FindActive") */
  pascalName: string;
  /** unexported Handler method name (e.g. "approve", "findActive") */
  handlerName: string;
  /** URL path segment (e.g. "approve", "find-active") */
  pathSegment: string;
}
