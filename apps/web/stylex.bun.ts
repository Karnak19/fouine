import { createStylexBunPlugin } from "@stylexjs/unplugin/bun";
import { stylexOptions } from "./stylex.options";

// Referenced from apps/server/bunfig.toml [serve.static]. A bunfig plugin entry
// is a bare module path with no way to pass options, so the configured plugin
// has to be constructed here and exported as the default.
export default createStylexBunPlugin(stylexOptions);
