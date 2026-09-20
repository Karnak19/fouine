import { installProcessGuards } from "~/server/guards";
import { boot } from "~/server/app";

// Before anything async can reject: these guards are the difference between
// one stray rejection logging an error and it taking down every in-flight
// review with it (see guards.ts for the incident).
installProcessGuards();

await boot();
