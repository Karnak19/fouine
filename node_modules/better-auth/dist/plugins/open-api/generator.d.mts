import { AuthContext, BetterAuthOptions } from "@better-auth/core";
import { DBFieldAttributeConfig, DBFieldType } from "@better-auth/core/db";
import { OpenAPIParameter, OpenAPISchemaType } from "better-call";

//#region src/plugins/open-api/generator.d.ts
interface Path {
  get?: OpenAPIOperation | undefined;
  post?: OpenAPIOperation | undefined;
  put?: OpenAPIOperation | undefined;
  patch?: OpenAPIOperation | undefined;
  delete?: OpenAPIOperation | undefined;
}
type OpenAPISchemaPrimitiveType = OpenAPISchemaType | "null";
type OpenAPISchema = {
  type?: OpenAPISchemaPrimitiveType | OpenAPISchemaPrimitiveType[];
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  $ref?: string;
  description?: string;
  default?: unknown;
  readOnly?: boolean;
  format?: string;
  deprecated?: boolean;
  enum?: unknown[];
  items?: OpenAPISchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | OpenAPISchema;
  propertyNames?: OpenAPISchema;
  allOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  oneOf?: OpenAPISchema[];
  const?: unknown;
  example?: unknown;
};
type OpenAPIParameter$1 = Omit<OpenAPIParameter, "schema"> & {
  schema?: OpenAPISchema;
};
type OpenAPIMediaTypeObject = {
  schema?: OpenAPISchema;
};
type OpenAPIResponseContent = {
  "application/json"?: OpenAPIMediaTypeObject;
  "text/plain"?: OpenAPIMediaTypeObject;
  "text/html"?: OpenAPIMediaTypeObject;
  [contentType: string]: OpenAPIMediaTypeObject | undefined;
};
type OpenAPIResponse = {
  description?: string;
  content?: OpenAPIResponseContent;
};
type OpenAPIRequestBody = {
  required?: boolean;
  content: {
    "application/json": {
      schema: OpenAPISchema;
    };
  };
};
type OpenAPIOperation = {
  tags?: string[];
  operationId?: string;
  description?: string;
  security?: [{
    bearerAuth: string[];
  }];
  parameters?: OpenAPIParameter$1[];
  requestBody?: OpenAPIRequestBody;
  responses?: Record<string, OpenAPIResponse>;
};
type FieldSchema = {
  type: DBFieldType;
  default?: DBFieldAttributeConfig["defaultValue"] | undefined;
  readOnly?: boolean | undefined;
  format?: string;
};
type OpenAPIModelSchema = {
  type: "object";
  properties: Record<string, FieldSchema>;
  required?: string[] | undefined;
};
declare function generator(ctx: AuthContext, options: BetterAuthOptions): Promise<{
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
  };
  components: {
    securitySchemes: {
      apiKeyCookie: {
        type: string;
        in: string;
        name: string;
        description: string;
      };
      bearerAuth: {
        type: string;
        scheme: string;
        description: string;
      };
    };
    schemas: {
      [x: string]: OpenAPIModelSchema;
    };
  };
  security: {
    apiKeyCookie: never[];
    bearerAuth: never[];
  }[];
  servers: {
    url: string;
  }[];
  tags: {
    name: string;
    description: string;
  }[];
  paths: Record<string, Path>;
}>;
//#endregion
export { FieldSchema, OpenAPIModelSchema, OpenAPIParameter$1 as OpenAPIParameter, OpenAPISchema, Path, generator };