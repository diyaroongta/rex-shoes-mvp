/* A TEST FILE THAT NEVER RUNS READS EXACTLY LIKE ONE THAT PASSES.
   shared/line-load.js shipped with nine tests and 0% coverage, because the
   file was never added to the `test:core` chain — the same class of fault as
   the `process.exit()` that once silently truncated this suite. This asserts
   that every test file in tests/ is actually run by it. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

console.log("\nEvery test file is in the suite");
test("no test file is written and then never run", () => {
  const chain = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    .scripts["test:core"];
  const onDisk = readdirSync(new URL("../tests", import.meta.url))
    .filter(f => f.endsWith(".test.mjs"));
  const missing = onDisk.filter(f => !chain.includes(`tests/${f}`));
  assert.deepEqual(missing, [],
    `these test files exist but npm run test:core never runs them: ${missing.join(", ")}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
