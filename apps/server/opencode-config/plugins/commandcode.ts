import { readFileSync } from "node:fs";
import type { Plugin } from "@opencode/plugin";
import {
  registerIntegrationMethods,
  registerProvider,
  setupCommandcode,
  type CommandcodeCatalog,
} from "./_commandcode";

// Command Code (https://commandcode.ai) is an OpenAI-compatible gateway that
// models.dev does not list, so opencode has no native knowledge of it. This
// plugin is how it becomes real inside opencode: the community
// `@brainervirus/opencode-commandcode` package is V1-only (its sole entry is
// the old `config` hook), and opencode v2 refuses to load it — so fouine
// registers the provider, its model catalog and the integration key method
// itself. Shipped in the config dir, it is auto-discovered from
// `${OPENCODE_CONFIG_DIR}/plugins/` (see _ctx.ts for the plugin conventions).
//
// Three things here are load-bearing and easy to get subtly wrong:
//  - `activation: "enabled"` (never "auto"): an "auto" provider that is also a
//    registered integration with no stored credential is filtered out of the
//    resolved model list, so a review speccing a commandcode model dies with
//    ModelUnavailableError instead of ever asking for the key. "enabled" keeps
//    it visible so the credential push (see below) can land.
//  - the model map key is the org-stripped config key (`toConfigKey`, e.g.
//    `deepseek-v4-flash`) while `modelID` carries the FULL upstream id
//    (`deepseek/deepseek-v4-flash`) the gateway expects in the request body.
//    opencode force-clobbers `id` to the map key, so `modelID` is the only
//    override that reaches the upstream `model` field.
//  - the sibling `commandcode-models.json` is materialised by fouine ONLY when
//    a Command Code key is configured (skills/materialize writeCommandcodeCatalog).
//    Its absence is this plugin's gate: no key, nothing registered, so a fresh
//    deployment never advertises a gateway it cannot authenticate. Like
//    opencode.json it is read once at activation and NOT hot-reloaded — a key
//    change lands through the server respawn / location.reload fouine already
//    triggers, exactly the semantics the old inline opencode.json block had.
//
// The key never appears in the catalog or in opencode.json: fouine pushes it to
// the running server as a stored credential (effect/opencode.ts
// ensureProviderKey → integration.connect.key), which is why the "key" method
// below must exist — opencode resolves the credential through it. A transform
// callback that throws disables the WHOLE plugin silently, so the catalog read
// is guarded and the registration helpers only do plain assignments. Those
// helpers live in _commandcode.ts: this file must export nothing but its factory
// (opencode loads every export), and the pure split keeps them unit-testable.
export default {
  id: "fouine.commandcode",
  async setup(ctx) {
    // The catalog read is the plugin's gate and is injected into
    // setupCommandcode (see _commandcode.ts) so the tests can drive both paths
    // without touching the filesystem.
    return setupCommandcode(ctx, () => {
      try {
        return JSON.parse(
          readFileSync(new URL("./commandcode-models.json", import.meta.url), "utf8"),
        ) as CommandcodeCatalog;
      } catch {
        // No catalog file = no Command Code key configured (fouine only writes
        // it then). Register nothing — see the gate note above.
        return undefined;
      }
    });
  },
} satisfies Plugin;
