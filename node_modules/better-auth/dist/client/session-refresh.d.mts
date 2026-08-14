import { BetterAuthClientOptions } from "@better-auth/core";
import { WritableAtom } from "nanostores";

//#region src/client/session-refresh.d.ts
interface SessionRefreshOptions {
  fetchSession: () => Promise<void>;
  shouldPollSession?: () => boolean;
  sessionSignal: WritableAtom<boolean>;
  options?: BetterAuthClientOptions | undefined;
}
declare function createSessionRefreshManager(opts: SessionRefreshOptions): {
  init: () => void;
  cleanup: () => void;
  triggerRefetch: (event?: {
    event?: "poll" | "visibilitychange" | "storage";
  } | undefined) => void;
  broadcastSessionUpdate: (trigger: "signout" | "getSession" | "updateUser") => void;
};
//#endregion
export { SessionRefreshOptions, createSessionRefreshManager };