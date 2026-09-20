import { installProcessGuards } from "~/server/guards";

// Run by guards.test.ts in a child process — the guard's whole contract is
// process-level, and the test runner itself installs rejection handlers that
// would mask it in-process. This mirrors the incident's shape exactly: a
// rejection nobody catches, carrying a non-Error reason (the abort reason
// string from the opencode teardown).
installProcessGuards();
Promise.reject("cleanup");
setTimeout(() => {
  console.log("SURVIVED");
  process.exit(0);
}, 250);
