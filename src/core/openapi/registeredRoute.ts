/** JSON Schema keywords remain extensible; metadata cannot contain executable values. */
type OpenApiJson =
  | null
  | boolean
  | number
  | string
  | OpenApiJson[]
  | { [key: string]: OpenApiJson | undefined };
type OpenApiSchema = boolean | { [keyword: string]: OpenApiJson | undefined };
interface OpenApiParameter {
  name: string;
  in: "header" | "query" | "path" | "cookie";
  required?: boolean;
  description?: string;
  schema: OpenApiSchema;
}
interface OpenApiMediaType {
  schema?: OpenApiSchema;
  example?: OpenApiJson;
}
interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
}
interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    description?: string;
    content: Record<string, OpenApiMediaType>;
  };
  responses?: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
}
type OpenApiRouteMap = Record<
  string,
  Partial<
    Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS", OpenApiOperation>
  >
>;
interface RegisteredRoute {
  method: string;
  path: string;
  middleware: string[];
  openApi?: OpenApiOperation;
}

export type {
  OpenApiJson,
  OpenApiMediaType,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
  OpenApiRouteMap,
  OpenApiSchema,
  RegisteredRoute,
};
