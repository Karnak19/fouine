import { DBAdapter, DBTransactionAdapter } from "../db/adapter/index.mjs";
import { BetterAuthOptions } from "../types/init-options.mjs";
import { AsyncLocalStorage } from "node:async_hooks";

//#region src/context/transaction.d.ts
type StoredAdapter = DBTransactionAdapter<BetterAuthOptions>;
type HookContext = {
  adapter: StoredAdapter;
  pendingHooks: Array<() => Promise<void>>;
  isTransactionActive: boolean;
};
/**
 * This is for internal use only. Most users should use `getCurrentAdapter` instead.
 *
 * It is exposed for advanced use cases where you need direct access to the AsyncLocalStorage instance.
 */
declare const getCurrentDBAdapterAsyncLocalStorage: () => Promise<AsyncLocalStorage<HookContext>>;
declare const getCurrentAdapter: <Options extends BetterAuthOptions = BetterAuthOptions>(fallback: DBTransactionAdapter<Options>) => Promise<DBTransactionAdapter<Options>>;
declare const runWithAdapter: <R, Options extends BetterAuthOptions = BetterAuthOptions>(adapter: DBAdapter<Options>, fn: () => R) => Promise<R>;
declare const runWithTransaction: <R, Options extends BetterAuthOptions = BetterAuthOptions>(adapter: DBAdapter<Options>, fn: () => R) => Promise<R>;
/**
 * Queue a hook to be executed after the current transaction commits.
 * If not in a transaction, the hook will execute immediately.
 */
declare const queueAfterTransactionHook: (hook: () => Promise<void>) => Promise<void>;
//#endregion
export { getCurrentAdapter, getCurrentDBAdapterAsyncLocalStorage, queueAfterTransactionHook, runWithAdapter, runWithTransaction };