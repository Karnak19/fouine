import type { ElysiaAdapter } from '../types';
export declare const isHTMLBundle: (handle: any) => boolean;
type Routes = Record<string, Function | Response | Record<string, unknown>>;
export declare const removeTrailingPath: (routes: Routes) => Routes;
export declare const BunAdapter: ElysiaAdapter;
export {};
