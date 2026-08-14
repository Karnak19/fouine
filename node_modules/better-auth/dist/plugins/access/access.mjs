import { BetterAuthError } from "@better-auth/core/error";
//#region src/plugins/access/access.ts
function unknownResourceResponse(requestedResource) {
	return {
		success: false,
		error: `You are not allowed to access resource: ${requestedResource}`
	};
}
function unauthorizedResourceResponse(requestedResource) {
	return {
		success: false,
		error: `unauthorized to access resource "${requestedResource}"`
	};
}
function normalizeConnector(connector) {
	return connector === "OR" ? "OR" : "AND";
}
function isActionList(actions) {
	return Array.isArray(actions);
}
function normalizeActionRequest(requestedActions) {
	if (isActionList(requestedActions)) return {
		actions: requestedActions,
		connector: "AND"
	};
	if (!requestedActions || typeof requestedActions !== "object") throw new BetterAuthError("Invalid access control request");
	const { actions, connector } = requestedActions;
	if (!isActionList(actions)) return {
		actions: [],
		connector: normalizeConnector(connector)
	};
	return {
		actions,
		connector: normalizeConnector(connector)
	};
}
function hasAllowedAction(allowedActions, requestedAction) {
	return typeof requestedAction === "string" && allowedActions.includes(requestedAction);
}
function isResourceAuthorized(allowedActions, { actions, connector }) {
	if (actions.length === 0) return false;
	if (connector === "OR") return actions.some((requestedAction) => hasAllowedAction(allowedActions, requestedAction));
	return actions.every((requestedAction) => hasAllowedAction(allowedActions, requestedAction));
}
function role(statements) {
	return {
		authorize(request, connector = "AND") {
			let hasAuthorizedResource = false;
			for (const [requestedResource, requestedActions] of Object.entries(request)) {
				const allowedActions = statements[requestedResource];
				if (!allowedActions) {
					if (connector === "AND") return unknownResourceResponse(requestedResource);
					continue;
				}
				const isAuthorized = isResourceAuthorized(allowedActions, normalizeActionRequest(requestedActions));
				if (isAuthorized) hasAuthorizedResource = true;
				if (isAuthorized && connector === "OR") return { success: true };
				if (!isAuthorized && connector === "AND") return unauthorizedResourceResponse(requestedResource);
			}
			if (hasAuthorizedResource) return { success: true };
			return {
				success: false,
				error: "Not authorized"
			};
		},
		statements
	};
}
function createAccessControl(s) {
	return {
		newRole(statements) {
			return role(statements);
		},
		statements: s
	};
}
//#endregion
export { createAccessControl, role };
