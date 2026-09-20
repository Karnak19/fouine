import { installProcessGuards } from "~/server/guards";
import { boot } from "~/server/app";

installProcessGuards();

await boot();
