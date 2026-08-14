import { PACKAGE_VERSION } from "../version.mjs";
import { getGlobalBroadcastChannel, kBroadcastChannel } from "./broadcast-channel.mjs";
import { isJsonEqual, withEquality } from "./equality.mjs";
import { kFocusManager } from "./focus-manager.mjs";
import { kOnlineManager } from "./online-manager.mjs";
import { parseJSON } from "./parser.mjs";
import { useAuthQuery } from "./query.mjs";
import { createSessionRefreshManager } from "./session-refresh.mjs";
import { createAuthClient } from "./vanilla.mjs";
//#region src/client/index.ts
const InferPlugin = () => {
	return {
		id: "infer-server-plugin",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {}
	};
};
function InferAuth() {
	return {};
}
//#endregion
export { InferAuth, InferPlugin, createAuthClient, createSessionRefreshManager, getGlobalBroadcastChannel, isJsonEqual, kBroadcastChannel, kFocusManager, kOnlineManager, parseJSON, useAuthQuery, withEquality };
