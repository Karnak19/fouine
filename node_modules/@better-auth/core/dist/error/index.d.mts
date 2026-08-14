import { APIErrorCode, BASE_ERROR_CODES } from "./codes.mjs";
import { APIError as APIError$1 } from "better-call/error";

//#region src/error/index.d.ts
declare class BetterAuthError extends Error {
  constructor(message: string, options?: {
    cause?: unknown | undefined;
  });
}
type BaseAPIErrorInstance = InstanceType<typeof APIError$1>;
declare class APIError extends APIError$1 {
  status: BaseAPIErrorInstance["status"];
  body: BaseAPIErrorInstance["body"];
  headers: BaseAPIErrorInstance["headers"];
  statusCode: BaseAPIErrorInstance["statusCode"];
  message: string;
  errorStack: BaseAPIErrorInstance["errorStack"];
  constructor(...args: ConstructorParameters<typeof APIError$1>);
  static fromStatus(status: ConstructorParameters<typeof APIError$1>[0], body?: ConstructorParameters<typeof APIError$1>[1]): APIError;
  static from(status: ConstructorParameters<typeof APIError$1>[0], error: {
    code: string;
    message: string;
  }): APIError;
}
//#endregion
export { APIError, type APIErrorCode, BASE_ERROR_CODES, BetterAuthError };