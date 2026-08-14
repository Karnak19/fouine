import { Kysely } from "kysely";
import { DBAdapter, DBAdapterDebugLogOption } from "@better-auth/core/db/adapter";
import { BetterAuthOptions } from "@better-auth/core";

//#region src/types.d.ts
type KyselyDatabaseType = "postgres" | "mysql" | "sqlite" | "mssql";
//#endregion
//#region src/dialect.d.ts
declare function getKyselyDatabaseType(db: BetterAuthOptions["database"]): KyselyDatabaseType | null;
declare const createKyselyAdapter: (config: BetterAuthOptions) => Promise<{
  kysely: Kysely<any>;
  databaseType: "postgres" | "mysql" | "sqlite" | "mssql";
  transaction: boolean | undefined;
} | {
  kysely: Kysely<any> | null;
  databaseType: KyselyDatabaseType | null;
  transaction: undefined;
}>;
//#endregion
//#region src/kysely-adapter.d.ts
interface KyselyAdapterConfig {
  /**
   * Database type.
   *
   * For `"mysql"`, this adapter depends on the driver returning
   * "rows matched" counts from `UPDATE`/`DELETE` operations (in
   * mysql2: `affectedRows`, exposed by Kysely as `numUpdatedRows`).
   * By default, `mysql2` enables this via the `FOUND_ROWS` client
   * flag.
   *
   * Do not disable this flag. If you remove it (e.g. with
   * `flags: '-FOUND_ROWS'` in your pool config), MySQL will report
   * "rows changed" semantics: an idempotent `UPDATE` (where the new
   * value equals the old value) will show zero affected rows, causing
   * adapter methods like `update`, `incrementOne`, or `updateMany` to
   * return `null` or `0` even if a row matched the predicate.
   */
  type?: KyselyDatabaseType | undefined;
  /**
   * Enable debug logs for the adapter
   *
   * @default false
   */
  debugLogs?: DBAdapterDebugLogOption | undefined;
  /**
   * Use plural for table names.
   *
   * @default false
   */
  usePlural?: boolean | undefined;
  /**
   * Whether to execute multiple operations in a transaction.
   *
   * If the database doesn't support transactions,
   * set this to `false` and operations will be executed sequentially.
   * @default false
   */
  transaction?: boolean | undefined;
}
declare const kyselyAdapter: (db: Kysely<any>, config?: KyselyAdapterConfig | undefined) => (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions>;
//#endregion
export { KyselyDatabaseType, createKyselyAdapter, getKyselyDatabaseType, kyselyAdapter };