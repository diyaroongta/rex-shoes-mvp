/* Who may do what. Run: npm test
 *
 * Access control is the one area where a passing test is not reassurance
 * unless it also tests the NEGATIVE — that the role which should be refused
 * actually is. Every allow below has a matching deny.
 */
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { can, canSeeTab, defaultTab, isReadOnly, endpointOf,
         KNOWN_ENDPOINTS, ROLES } from "../shared/permissions.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}
const allow = (role, method, url, body) => can(role, method, url, body).allowed;

console.log("\nA — reading is open to everyone signed in");

test("every role can read every screen's data", () => {
  for(const role of ROLES)
    for(const url of ["/api/orders","/api/pis","/api/reference","/api/settings","/api/catalogue"])
      assert.equal(allow(role, "GET", url), true, `${role} should read ${url}`);
});

console.log("\nB — the viewer changes nothing, anywhere");

test("a viewer is refused every kind of write", () => {
  const writes = [
    ["POST","/api/orders"], ["PATCH","/api/orders/JO1"], ["DELETE","/api/orders/JO1"],
    ["POST","/api/pis"], ["POST","/api/dispatches"], ["PUT","/api/settings"],
    ["PATCH","/api/reference"], ["PUT","/api/parties"], ["DELETE","/api/catalogue"],
    ["POST","/api/copilot"], ["POST","/api/read-pi"],
  ];
  for(const [method, url] of writes)
    assert.equal(allow("viewer", method, url), false, `viewer must not ${method} ${url}`);
});

test("the refusal explains itself rather than just saying no", () => {
  const { reason } = can("viewer", "POST", "/api/orders");
  assert.match(reason, /read-only/i);
  assert.match(reason, /administrator/i);
});

test("a viewer can still update stock? No — read-only means read-only", () => {
  assert.equal(allow("viewer","PATCH","/api/reference",{stock:{"REXINE":10}}), false);
});

console.log("\nC — the planner does the daily job, not the master data");

test("a planner runs orders, PIs, dispatch and the AI readers", () => {
  for(const [method, url] of [["POST","/api/orders"],["PATCH","/api/orders/JO1"],
                              ["DELETE","/api/orders/JO1"],["POST","/api/pis"],
                              ["POST","/api/dispatches"],["DELETE","/api/dispatches"],
                              ["POST","/api/read-order-photo"],["POST","/api/copilot"]])
    assert.equal(allow("planner", method, url), true, `planner should ${method} ${url}`);
});

test("a planner cannot change the article master, parties or capacities", () => {
  for(const [method, url] of [["PUT","/api/settings"],["PUT","/api/parties"],
                              ["DELETE","/api/parties"],["PUT","/api/catalogue"],
                              ["DELETE","/api/catalogue"]])
    assert.equal(allow("planner", method, url), false, `planner must not ${method} ${url}`);
});

/* The BOM and the stock figures live behind one endpoint but are completely
   different jobs: stock is daily clerical work, the BOM is master data whose
   every error is repeated across all future orders. */
test("a planner may update stock figures", () => {
  assert.equal(allow("planner","PATCH","/api/reference",{stock:{"REXINE 54\" BLACK":120}}), true);
  assert.equal(allow("planner","PATCH","/api/reference",{stock_meta:{"REXINE":{rate:5}}}), true);
});

test("a planner may NOT upload a BOM or bulk-remove one through the same endpoint", () => {
  assert.equal(allow("planner","POST","/api/reference",{parsed:{article:"SPIKE"}}), false);
  assert.equal(allow("planner","PATCH","/api/reference",{bom_removal:{articles:["SPIKE"]}}), false);
  assert.equal(allow("planner","PATCH","/api/reference",{packing:{}}), false);
  assert.equal(allow("planner","PATCH","/api/reference",{mrp:{}}), false);
});

test("a planner cannot smuggle a BOM change in beside a stock change", () => {
  assert.equal(allow("planner","PATCH","/api/reference",
    {stock:{"REXINE":10}, bom_removal:{articles:["SPIKE"]}}), false,
    "one disallowed key must sink the whole request");
});

test("an empty body does not sail through on a technicality", () => {
  assert.equal(allow("planner","PATCH","/api/reference",{}), false);
  assert.equal(allow("planner","PATCH","/api/reference"), false);
});

console.log("\nD — the admin, and anything unrecognised");

test("an admin may do everything", () => {
  for(const [method, url] of [["PUT","/api/settings"],["POST","/api/reference"],
                              ["DELETE","/api/catalogue"],["PUT","/api/parties"]])
    assert.equal(allow("admin", method, url), true);
});

/* Fail closed: a new endpoint is admin-only until somebody classifies it. */
test("an unknown endpoint is denied to planner and viewer, never defaulted open", () => {
  assert.equal(allow("planner","POST","/api/brand-new-thing"), false);
  assert.equal(allow("viewer","POST","/api/brand-new-thing"), false);
});

test("an unknown or missing role is refused outright", () => {
  assert.equal(allow("superuser","GET","/api/orders"), false);
  assert.equal(allow(undefined,"GET","/api/orders"), false);
  assert.equal(allow(null,"POST","/api/orders"), false);
});

test("sign-in is reachable whatever the role says", () => {
  for(const role of [...ROLES, "nonsense", undefined])
    assert.equal(allow(role,"POST","/api/auth"), true, "or nobody could ever sign out");
});

console.log("\nE — the endpoint is read out of the URL correctly");

test("a nested or query-laden URL still resolves to its endpoint", () => {
  assert.equal(endpointOf("/api/orders/JO1?all=1"), "orders");
  assert.equal(endpointOf("/api/reference?history=1"), "reference");
  assert.equal(endpointOf("/api/orders"), "orders");
  assert.equal(endpointOf(""), "");
});

test("a sub-path cannot be used to dodge the policy", () => {
  // /api/orders/... is still the orders endpoint, whatever follows.
  assert.equal(allow("viewer","DELETE","/api/orders/JO1?all=1"), false);
  assert.equal(allow("planner","PUT","/api/settings/anything"), false);
});

console.log("\nF — every endpoint has been classified");

test("no file under api/ is missing from the policy", () => {
  const walk = (dir="api") => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if(statSync(path).isDirectory()) return name === "_lib" ? [] : [dir.replace(/^api\/?/,"") || name];
    return path.endsWith(".js") ? [name.replace(/\.js$/,"")] : [];
  });
  const missing = [...new Set(walk())].filter(e => !KNOWN_ENDPOINTS.has(e));
  assert.deepEqual(missing, [], `classify these in shared/permissions.js: ${missing.join(", ")}`);
});

console.log("\nG — screens follow the same rules");

test("a viewer is not offered screens whose every button would be refused", () => {
  for(const tab of ["data","rules","catalogue","parties","intake","jobs","copilot"])
    assert.equal(canSeeTab("viewer", tab), false, `viewer should not see ${tab}`);
  for(const tab of ["mis","orders","schedule","procurement","stock"])
    assert.equal(canSeeTab("viewer", tab), true, `viewer should see ${tab}`);
});

test("a planner gets the production screens but not the setup ones", () => {
  for(const tab of ["intake","jobs","orders","schedule","plan","machines","stock","copilot"])
    assert.equal(canSeeTab("planner", tab), true, `planner should see ${tab}`);
  for(const tab of ["data","rules","catalogue","parties","fabricators"])
    assert.equal(canSeeTab("planner", tab), false, `planner should not see ${tab}`);
});

test("an admin sees everything", () => {
  for(const tab of ["mis","intake","jobs","orders","dispatch","schedule","plan","machines",
                    "procurement","stock","parties","fabricators","catalogue","rules","data","copilot"])
    assert.equal(canSeeTab("admin", tab), true);
});

test("every role lands on a screen it is allowed to open", () => {
  for(const role of ROLES) assert.equal(canSeeTab(role, defaultTab(role)), true);
});

test("only the viewer is read-only", () => {
  assert.equal(isReadOnly("viewer"), true);
  assert.equal(isReadOnly("planner"), false);
  assert.equal(isReadOnly("admin"), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
