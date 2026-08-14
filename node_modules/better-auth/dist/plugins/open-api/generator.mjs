import { db_exports } from "../../db/index.mjs";
import { getEndpoints } from "../../api/index.mjs";
import * as z from "zod";
//#region src/plugins/open-api/generator.ts
const OPEN_API_SCHEMA_TYPES = new Set([
	"string",
	"number",
	"boolean",
	"array",
	"object"
]);
function getOpenApiTypeFromZodType(zodType) {
	if (zodType instanceof z.ZodDefault || zodType instanceof z.ZodPrefault) return getOpenApiTypeFromZodType(unwrapZodSchema(zodType));
	const type = zodType.type;
	return OPEN_API_SCHEMA_TYPES.has(type) ? type : "string";
}
function getFieldSchema(field) {
	const schema = {
		type: field.type === "date" ? "string" : field.type,
		...field.type === "date" && { format: "date-time" }
	};
	if (field.defaultValue !== void 0) {
		if (typeof field.defaultValue !== "function") schema.default = field.defaultValue;
	}
	if (field.input === false) schema.readOnly = true;
	return schema;
}
function asZodSchema(schema) {
	return schema;
}
function unwrapZodSchema(zodType) {
	return asZodSchema(zodType.unwrap());
}
function getZodDef(zodType) {
	return zodType._def;
}
function getZodDescription(zodType) {
	return zodType.description;
}
function withDescription(schema, zodType) {
	const description = getZodDescription(zodType);
	return description ? {
		...schema,
		description
	} : schema;
}
function addNullType(schema) {
	if (schema.type) {
		const type = Array.isArray(schema.type) ? schema.type : [schema.type];
		const nullableType = Array.from(new Set([...type, "null"]));
		return {
			...schema,
			type: nullableType
		};
	}
	return { anyOf: [schema, { type: "null" }] };
}
function getZodStringSchemaConstraints(zodType) {
	const minLength = zodType.minLength;
	const maxLength = zodType.maxLength;
	return {
		...typeof minLength === "number" ? { minLength } : {},
		...typeof maxLength === "number" ? { maxLength } : {}
	};
}
function getZodPipeSchema(zodType) {
	const def = getZodDef(zodType);
	return def.in instanceof z.ZodTransform && def.out instanceof z.ZodType ? def.out : def.in;
}
function getParameters(options) {
	const parameters = [];
	if (options.metadata?.openapi?.parameters) parameters.push(...options.metadata.openapi.parameters);
	if (!options.metadata?.openapi?.parameters && options.query instanceof z.ZodObject) Object.entries(options.query.shape).forEach(([key, value]) => {
		if (value instanceof z.ZodType) {
			const parameterSchema = toOpenApiSchema(value);
			parameters.push({
				name: key,
				in: "query",
				schema: parameterSchema
			});
		}
	});
	return parameters;
}
function getPathParameters(path, parameters) {
	const existingParameters = new Set(parameters.map((parameter) => `${parameter.in}:${parameter.name}`));
	return path.split("/").filter((part) => part.startsWith(":")).map((part) => part.slice(1)).filter((name) => !existingParameters.has(`path:${name}`)).map((name) => ({
		name,
		in: "path",
		required: true,
		schema: { type: "string" }
	}));
}
function getRequestBodySchemaInfo(zodType) {
	return {
		required: !schemaAcceptsUndefined(zodType),
		schema: zodType
	};
}
function schemaAcceptsUndefined(zodType) {
	if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodDefault || zodType instanceof z.ZodPrefault || zodType instanceof z.ZodCatch || zodType instanceof z.ZodUndefined || zodType instanceof z.ZodVoid) return true;
	if (zodType instanceof z.ZodNonOptional) return false;
	if (zodType instanceof z.ZodNullable || zodType instanceof z.ZodReadonly) return schemaAcceptsUndefined(unwrapZodSchema(zodType));
	if (zodType instanceof z.ZodPipe) return schemaAcceptsUndefined(getZodPipeSchema(zodType));
	if (zodType instanceof z.ZodUnion) return getZodDef(zodType).options.some((option) => schemaAcceptsUndefined(option));
	if (zodType instanceof z.ZodIntersection) {
		const def = getZodDef(zodType);
		return schemaAcceptsUndefined(def.left) && schemaAcceptsUndefined(def.right);
	}
	return false;
}
function isUndefinedOnlySchema(zodType) {
	return zodType instanceof z.ZodUndefined || zodType instanceof z.ZodVoid;
}
function isMergeableObjectSchema(schema) {
	const type = schema?.type;
	return !!schema && (type === "object" || Array.isArray(type) && type.includes("object")) && schema.$ref === void 0 && schema.allOf === void 0 && schema.anyOf === void 0;
}
function schemaAllowsNull(schema) {
	const type = schema?.type;
	return Array.isArray(type) && type.includes("null");
}
function areSchemasEqual(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}
function areSchemaMembersCompatible(left, right) {
	if (left === void 0 || right === void 0) return true;
	if (typeof left === "boolean" || typeof right === "boolean") return left === right;
	return areSchemasEqual(left, right);
}
function mergeObjectSchemas(left, right, description) {
	const properties = { ...left.properties || {} };
	for (const [key, value] of Object.entries(right.properties || {})) {
		if (properties[key] !== void 0 && !areSchemasEqual(properties[key], value)) return;
		properties[key] = value;
	}
	const required = Array.from(new Set([...left.required || [], ...right.required || []]));
	const leftAdditionalProperties = left.additionalProperties;
	const rightAdditionalProperties = right.additionalProperties;
	if (!areSchemaMembersCompatible(leftAdditionalProperties, rightAdditionalProperties)) return;
	const leftPropertyNames = left.propertyNames;
	const rightPropertyNames = right.propertyNames;
	if (!areSchemaMembersCompatible(leftPropertyNames, rightPropertyNames)) return;
	const additionalProperties = leftAdditionalProperties ?? rightAdditionalProperties;
	const propertyNames = leftPropertyNames ?? rightPropertyNames;
	return {
		type: schemaAllowsNull(left) && schemaAllowsNull(right) ? ["object", "null"] : "object",
		...Object.keys(properties).length > 0 ? { properties } : {},
		...required.length > 0 ? { required } : {},
		...additionalProperties !== void 0 ? { additionalProperties } : {},
		...propertyNames !== void 0 ? { propertyNames } : {},
		...description ?? left.description ?? right.description ? { description: description ?? left.description ?? right.description } : {}
	};
}
function getRequestBody(options) {
	if (options.metadata?.openapi?.requestBody) return options.metadata.openapi.requestBody;
	if (!options.body) return void 0;
	const requestBodySchemaInfo = getRequestBodySchemaInfo(options.body);
	const schema = toOpenApiSchema(requestBodySchemaInfo.schema);
	return {
		required: requestBodySchemaInfo.required,
		content: { "application/json": { schema } }
	};
}
function toOpenApiSchema(zodType) {
	if (zodType instanceof z.ZodOptional) return toOpenApiSchema(unwrapZodSchema(zodType));
	if (zodType instanceof z.ZodNullable) return addNullType(toOpenApiSchema(unwrapZodSchema(zodType)));
	if (zodType instanceof z.ZodDefault || zodType instanceof z.ZodPrefault || zodType instanceof z.ZodNonOptional) return toOpenApiSchema(unwrapZodSchema(zodType));
	if (zodType instanceof z.ZodAny) return withDescription({}, zodType);
	if (zodType instanceof z.ZodObject) {
		const shape = zodType.shape;
		if (shape) {
			const properties = {};
			const required = [];
			Object.entries(shape).forEach(([key, value]) => {
				if (value instanceof z.ZodType) {
					properties[key] = toOpenApiSchema(value);
					if (!schemaAcceptsUndefined(value)) required.push(key);
				}
			});
			return withDescription({
				type: "object",
				properties,
				...required.length > 0 ? { required } : {}
			}, zodType);
		}
	}
	if (zodType instanceof z.ZodRecord) {
		const def = getZodDef(zodType);
		return withDescription({
			type: "object",
			propertyNames: toOpenApiSchema(def.keyType),
			additionalProperties: toOpenApiSchema(def.valueType)
		}, zodType);
	}
	if (zodType instanceof z.ZodIntersection) {
		const def = getZodDef(zodType);
		const leftSchema = toOpenApiSchema(def.left);
		const rightSchema = toOpenApiSchema(def.right);
		if (isMergeableObjectSchema(leftSchema) && isMergeableObjectSchema(rightSchema)) {
			const mergedSchema = mergeObjectSchemas(leftSchema, rightSchema, getZodDescription(zodType));
			if (mergedSchema) return mergedSchema;
		}
		return withDescription({ allOf: [leftSchema, rightSchema] }, zodType);
	}
	if (zodType instanceof z.ZodUnion) {
		const def = getZodDef(zodType);
		const schemas = def.options.filter((option) => !isUndefinedOnlySchema(option)).map((option) => toOpenApiSchema(option));
		if (schemas.length === 0) return withDescription({}, zodType);
		if (schemas.length === 1) {
			const schema = schemas[0];
			if (!schema) return withDescription({}, zodType);
			return withDescription(schema, zodType);
		}
		return withDescription(def.inclusive === false ? { oneOf: schemas } : { anyOf: schemas }, zodType);
	}
	if (zodType instanceof z.ZodArray) return withDescription({
		type: "array",
		items: toOpenApiSchema(getZodDef(zodType).element)
	}, zodType);
	if (zodType instanceof z.ZodLiteral) return withDescription({ enum: Array.from(zodType.values) }, zodType);
	if (zodType instanceof z.ZodEnum) return withDescription({
		type: "string",
		enum: zodType.options
	}, zodType);
	if (zodType instanceof z.ZodPipe) return withDescription(toOpenApiSchema(getZodPipeSchema(zodType)), zodType);
	if (zodType instanceof z.ZodCatch || zodType instanceof z.ZodReadonly) return withDescription(toOpenApiSchema(getZodDef(zodType).innerType), zodType);
	if (zodType instanceof z.ZodNull) return withDescription({ type: "null" }, zodType);
	if (zodType instanceof z.ZodUndefined) return withDescription({}, zodType);
	if (zodType instanceof z.ZodVoid) return withDescription({}, zodType);
	return withDescription({
		type: getOpenApiTypeFromZodType(zodType),
		...zodType instanceof z.ZodString ? getZodStringSchemaConstraints(zodType) : {}
	}, zodType);
}
function getResponse(responses) {
	return {
		"400": {
			content: { "application/json": { schema: {
				type: "object",
				properties: { message: { type: "string" } },
				required: ["message"]
			} } },
			description: "Bad Request. Usually due to missing parameters, or invalid parameters."
		},
		"401": {
			content: { "application/json": { schema: {
				type: "object",
				properties: { message: { type: "string" } },
				required: ["message"]
			} } },
			description: "Unauthorized. Due to missing or invalid authentication."
		},
		"403": {
			content: { "application/json": { schema: {
				type: "object",
				properties: { message: { type: "string" } }
			} } },
			description: "Forbidden. You do not have permission to access this resource or to perform this action."
		},
		"404": {
			content: { "application/json": { schema: {
				type: "object",
				properties: { message: { type: "string" } }
			} } },
			description: "Not Found. The requested resource was not found."
		},
		"429": {
			content: { "application/json": { schema: {
				type: "object",
				properties: { message: { type: "string" } }
			} } },
			description: "Too Many Requests. You have exceeded the rate limit. Try again later."
		},
		"500": {
			content: { "application/json": { schema: {
				type: "object",
				properties: { message: { type: "string" } }
			} } },
			description: "Internal Server Error. This is a problem with the server that you cannot fix."
		},
		...responses ? structuredClone(responses) : {}
	};
}
function toOpenApiPath(path) {
	return path.split("/").map((part) => part.startsWith(":") ? `{${part.slice(1)}}` : part).join("/");
}
function getOperationId(operationId, method, usedOperationIds) {
	if (!operationId) return;
	if (!usedOperationIds.has(operationId)) {
		usedOperationIds.add(operationId);
		return operationId;
	}
	const normalizedMethod = method.toUpperCase();
	const methodSuffix = normalizedMethod.charAt(0) + normalizedMethod.slice(1).toLowerCase();
	let candidate = `${operationId}${methodSuffix}`;
	let duplicateIndex = 2;
	while (usedOperationIds.has(candidate)) {
		candidate = `${operationId}${methodSuffix}${duplicateIndex}`;
		duplicateIndex += 1;
	}
	usedOperationIds.add(candidate);
	return candidate;
}
function cloneOpenAPIValue(value) {
	if (Array.isArray(value)) return value.map((item) => cloneOpenAPIValue(item));
	if (value instanceof Date) return new Date(value);
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneOpenAPIValue(entry)]));
	return value;
}
async function generator(ctx, options) {
	const baseEndpoints = getEndpoints(ctx, {
		...options,
		plugins: []
	});
	const tables = (0, db_exports.getAuthTables)({
		...options,
		session: {
			...options.session,
			storeSessionInDatabase: true
		}
	});
	const components = { schemas: { ...Object.entries(tables).reduce((acc, [key, value]) => {
		const modelName = key.charAt(0).toUpperCase() + key.slice(1);
		const fields = value.fields;
		const required = new Set(["id"]);
		const properties = { id: {
			type: "string",
			readOnly: true
		} };
		Object.entries(fields).forEach(([fieldKey, fieldValue]) => {
			if (!fieldValue) return;
			properties[fieldKey] = getFieldSchema(fieldValue);
			if (fieldValue.required && fieldValue.returned !== false) required.add(fieldKey);
		});
		Object.entries(properties).forEach(([key, prop]) => {
			const field = value.fields[key];
			if (field && field.type === "date" && prop.type === "string") prop.format = "date-time";
		});
		acc[modelName] = {
			type: "object",
			properties,
			required: Array.from(required)
		};
		return acc;
	}, {}) } };
	const paths = {};
	const usedOperationIds = /* @__PURE__ */ new Set();
	Object.entries(baseEndpoints.api).forEach(([_, value]) => {
		if (!value.path || ctx.options.disabledPaths?.includes(value.path)) return;
		const options = value.options;
		if (options.metadata?.SERVER_ONLY) return;
		const path = toOpenApiPath(value.path);
		const operationParameters = getParameters(options);
		const parameters = [...operationParameters, ...getPathParameters(value.path, operationParameters)];
		const methods = Array.isArray(options.method) ? options.method : [options.method];
		for (const method of methods.filter((m) => m === "GET" || m === "DELETE")) paths[path] = {
			...paths[path],
			[method.toLowerCase()]: {
				tags: ["Default", ...options.metadata?.openapi?.tags || []],
				description: options.metadata?.openapi?.description,
				operationId: getOperationId(options.metadata?.openapi?.operationId, method, usedOperationIds),
				security: [{ bearerAuth: [] }],
				parameters: cloneOpenAPIValue(parameters),
				responses: cloneOpenAPIValue(getResponse(options.metadata?.openapi?.responses))
			}
		};
		for (const method of methods.filter((m) => m === "POST" || m === "PATCH" || m === "PUT")) {
			const body = getRequestBody(options);
			paths[path] = {
				...paths[path],
				[method.toLowerCase()]: {
					tags: ["Default", ...options.metadata?.openapi?.tags || []],
					description: options.metadata?.openapi?.description,
					operationId: getOperationId(options.metadata?.openapi?.operationId, method, usedOperationIds),
					security: [{ bearerAuth: [] }],
					parameters: cloneOpenAPIValue(parameters),
					...body ? { requestBody: cloneOpenAPIValue(body) } : { requestBody: { content: { "application/json": { schema: {
						type: "object",
						properties: {}
					} } } } },
					responses: cloneOpenAPIValue(getResponse(options.metadata?.openapi?.responses))
				}
			};
		}
	});
	for (const plugin of options.plugins || []) {
		if (plugin.id === "open-api") continue;
		const pluginEndpoints = getEndpoints(ctx, {
			...options,
			plugins: [plugin]
		});
		const api = Object.keys(pluginEndpoints.api).map((key) => {
			if (baseEndpoints.api[key] === void 0) return pluginEndpoints.api[key];
			return null;
		}).filter((x) => x !== null);
		Object.entries(api).forEach(([key, value]) => {
			if (!value.path || ctx.options.disabledPaths?.includes(value.path)) return;
			const options = value.options;
			if (options.metadata?.SERVER_ONLY) return;
			const path = toOpenApiPath(value.path);
			const operationParameters = getParameters(options);
			const parameters = [...operationParameters, ...getPathParameters(value.path, operationParameters)];
			const methods = Array.isArray(options.method) ? options.method : [options.method];
			for (const method of methods.filter((m) => m === "GET" || m === "DELETE")) paths[path] = {
				...paths[path],
				[method.toLowerCase()]: {
					tags: options.metadata?.openapi?.tags || [plugin.id.charAt(0).toUpperCase() + plugin.id.slice(1)],
					description: options.metadata?.openapi?.description,
					operationId: getOperationId(options.metadata?.openapi?.operationId, method, usedOperationIds),
					security: [{ bearerAuth: [] }],
					parameters: cloneOpenAPIValue(parameters),
					responses: cloneOpenAPIValue(getResponse(options.metadata?.openapi?.responses))
				}
			};
			for (const method of methods.filter((m) => m === "POST" || m === "PATCH" || m === "PUT")) paths[path] = {
				...paths[path],
				[method.toLowerCase()]: {
					tags: options.metadata?.openapi?.tags || [plugin.id.charAt(0).toUpperCase() + plugin.id.slice(1)],
					description: options.metadata?.openapi?.description,
					operationId: getOperationId(options.metadata?.openapi?.operationId, method, usedOperationIds),
					security: [{ bearerAuth: [] }],
					parameters: cloneOpenAPIValue(parameters),
					requestBody: cloneOpenAPIValue(getRequestBody(options)),
					responses: cloneOpenAPIValue(getResponse(options.metadata?.openapi?.responses))
				}
			};
		});
	}
	return {
		openapi: "3.1.1",
		info: {
			title: "Better Auth",
			description: "API Reference for your Better Auth Instance",
			version: "1.1.0"
		},
		components: {
			...components,
			securitySchemes: {
				apiKeyCookie: {
					type: "apiKey",
					in: "cookie",
					name: "apiKeyCookie",
					description: "API Key authentication via cookie"
				},
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					description: "Bearer token authentication"
				}
			}
		},
		security: [{
			apiKeyCookie: [],
			bearerAuth: []
		}],
		servers: [{ url: ctx.baseURL }],
		tags: [{
			name: "Default",
			description: "Default endpoints that are included with Better Auth by default. These endpoints are not part of any plugin."
		}],
		paths
	};
}
//#endregion
export { generator };
