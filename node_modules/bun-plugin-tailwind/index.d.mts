import { BunPlugin } from 'bun';

declare const isWindows: boolean;
declare const plugin: BunPlugin;

export { plugin as default, isWindows };
