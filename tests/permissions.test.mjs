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
         KNOWN_ENDPOINTS, ROLES, ROLE_LABEL, ROLE_SUMMARY,
         RECOMMENDED_USER_COUNTS, upperStoreAccess, canEditSchedule,
         rolesOf, normalizeRoles, hasRole, rolesLabel } from "../shared/permissions.js";

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

console.log("\nC — the Production Planner, from the client's 11-Nov-2026 list");

/* "can see order taking, order planning, material procurement, machine
   planning, recording production/dispatch, updating stocks — can't see MIS
   reports, change machine capacities, change existing boms". The planner was
   once confined to the PLAN; the client has since given it the order and the
   dispatch as well. */
test("a planner takes orders, plans them and records dispatch", () => {
  for(const [method, url, body] of [
    ["POST","/api/orders",{}], ["PATCH","/api/orders/JO1",{lines:[]}],
    ["PATCH","/api/orders/JO1",{plan_override:{seq:1}}], ["PATCH","/api/orders/JO1",{priority:1}],
    ["POST","/api/pis",{}], ["POST","/api/read-order-photo",{}], ["POST","/api/read-pi",{}],
    ["POST","/api/dispatches",{}], ["POST","/api/dispatches?resource=production_actuals",{rows:[{}]}],
    ["POST","/api/dispatches?resource=stock_plan",{}],
  ]) assert.equal(allow("planner", method, url, body), true, `planner should ${method} ${url}`);
  assert.equal(allow("viewer","POST","/api/dispatches?resource=production_actuals",{rows:[{}]}),false);
  assert.equal(isReadOnly("planner"), false);
});

test("a planner updates stock and works the buying list", () => {
  assert.equal(allow("planner","PATCH","/api/reference",{stock:{"REXINE 54\" BLACK":120}}), true);
  assert.equal(allow("planner","PATCH","/api/reference",{new_material:{name:"GLUE",uom:"LTR"}}), true);
  assert.equal(allow("planner","POST","/api/reference?resource=purchase_orders",{supplier:"ABC"}), true);
  assert.equal(allow("planner","POST","/api/reference?resource=material_issues",{job_id:1}), true);
  assert.equal(allow("planner","POST","/api/dispatches?resource=upper_store",{moves:[]}), true);
  assert.equal(allow("planner","PATCH","/api/dispatches?resource=upper_store",{id:4,action:"approve"}), false,
    "approving a count adjustment stays with the store in-charge");
});

test("a planner cannot change machine capacities", () => {
  assert.equal(allow("planner","PUT","/api/settings",{capacities:{}}), false);
  assert.equal(allow("planner","PUT","/api/settings/anything"), false);
});

test("a planner may NOT change a BOM, packing or MRP", () => {
  assert.equal(allow("planner","POST","/api/reference",{parsed:{article:"SPIKE"}}), false);
  assert.equal(allow("planner","PATCH","/api/reference",{bom_removal:{articles:["SPIKE"]}}), false);
  assert.equal(allow("planner","PATCH","/api/reference",{packing:{}}), false);
  assert.equal(allow("planner","PATCH","/api/reference",{mrp:{}}), false);
  assert.equal(allow("planner","PATCH","/api/reference",{stock:{"X":1},packing:{}}), false,
    "one disallowed key still sinks the whole request");
});

test("a planner cannot change the article master or parties", () => {
  for(const [method, url] of [["PUT","/api/parties"],["DELETE","/api/parties"],
                              ["PUT","/api/catalogue"],["DELETE","/api/catalogue"]])
    assert.equal(allow("planner", method, url), false, `planner must not ${method} ${url}`);
});

test("a store keeper cannot smuggle a BOM change in beside a stock change", () => {
  assert.equal(allow("store","PATCH","/api/reference",
    {stock:{"REXINE":10}, bom_removal:{articles:["SPIKE"]}}), false,
    "one disallowed key must sink the whole request");
});

test("Procurement manages POs while Store can only receive them", () => {
  const url="/api/reference?resource=purchase_orders";
  assert.equal(allow("procurement","POST",url,{resource:"purchase_orders",supplier:"ABC"}),true);
  assert.equal(allow("procurement","PATCH",url,{resource:"purchase_orders",action:"cancel"}),true);
  assert.equal(allow("store","PATCH",url,{resource:"purchase_orders",action:"receive"}),true);
  assert.equal(allow("store","POST",url,{resource:"purchase_orders",supplier:"ABC"}),false);
  assert.equal(allow("store","PATCH",url,{resource:"purchase_orders",action:"cancel"}),false);
  assert.equal(allow("viewer","PATCH",url,{resource:"purchase_orders",action:"receive"}),false);
});

test("the Store issues material against a job card; nobody without stock rights does", () => {
  const url="/api/reference?resource=material_issues";
  const body={job_id:12,type:"issue",moved_on:"2026-11-10",lines:[{material_key:"THREAD||SPOOL",qty:2}]};
  for(const role of ["store","store_incharge","procurement","data","admin"]){
    assert.equal(allow(role,"POST",url,body),true,`${role} should issue material`);
    assert.equal(allow(role,"DELETE",url+"&id=4"),true,`${role} should undo an entry`);
  }
  for(const role of ["sales","dispatch","owner","auditor","viewer"]){
    assert.equal(allow(role,"POST",url,body),false,`${role} must not issue material`);
    assert.equal(allow(role,"DELETE",url+"&id=4"),false,`${role} must not undo an entry`);
  }
  assert.match(can("sales","POST",url,body).reason,/cannot issue or take back material/);
});

test("a resource named in the BODY is judged the same way as one in the URL", () => {
  /* The handler routes on either, so the policy has to as well — otherwise a
     dispatch clerk's request could be steered at the issue log, or a store
     keeper's at something the URL did not name. */
  const body={resource:"material_issues",job_id:12,lines:[]};
  assert.equal(allow("store","POST","/api/reference",body),true);
  assert.equal(allow("dispatch","POST","/api/reference",body),false);
  assert.equal(allow("sales","POST","/api/reference",body),false);
});

test("the issue grant does not reach the BOM", () => {
  assert.equal(allow("store","PATCH","/api/reference",{packing:{}}),false);
  assert.equal(allow("store","PATCH","/api/reference",{stock_meta:{"THREAD||SPOOL":{issue_mode:"on_demand"}}}),true,
    "how a material is issued is a stock setting");
});

test("Issue Material is a Store screen", () => {
  for(const role of ["store","store_incharge","admin","planner"]) assert.equal(canSeeTab(role,"stock_issue"),true,role);
  for(const role of ["sales","dispatch","procurement","data","auditor"])
    assert.equal(canSeeTab(role,"stock_issue"),false,role);
});

test("PO permission does not grant a BOM or MRP change", () => {
  assert.equal(allow("procurement","PATCH","/api/reference",{packing:{}}),false);
  assert.equal(allow("store","PATCH","/api/reference",{mrp:{}}),false);
});

test("an empty body does not sail through on a technicality", () => {
  assert.equal(allow("store","PATCH","/api/reference",{}), false);
  assert.equal(allow("store","PATCH","/api/reference"), false);
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
    assert.equal(canSeeTab("viewer", tab), true, "a viewer SEES everything — it just cannot change it");
  for(const tab of ["mis","orders","schedule","procurement","stock","jobwork"])
    assert.equal(canSeeTab("viewer", tab), true, `viewer should see ${tab}`);
});

test("a planner sees order taking, production, procurement and dispatch — but not the MIS", () => {
  for(const tab of ["intake","pis","orders","jobs","jobwork","schedule","production_input","plan","machines",
                    "dispatch","finished","stock_add","stock_issue","stock","procurement"])
    assert.equal(canSeeTab("planner", tab), true, `planner should see ${tab}`);
  for(const tab of ["mis","data","catalogue","parties","profiles","copilot"])
    assert.equal(canSeeTab("planner", tab), false, `planner should not see ${tab}`);
});

/* "can see only MIS reports, order taking and orders pending — no viewership
   or access to production related tabs". */
test("a Sales Head sees the MIS and the orders, and no production screen", () => {
  for(const tab of ["mis","intake","pis","orders"])
    assert.equal(canSeeTab("sales", tab), true, `sales should see ${tab}`);
  for(const tab of ["jobs","jobwork","schedule","production_input","status","upper_store","plan","machines",
                    "dispatch","finished","repair","stock","procurement","data"])
    assert.equal(canSeeTab("sales", tab), false, `sales should NOT see ${tab}`);
});

test("an admin sees everything", () => {
  for(const tab of ["mis","intake","jobs","orders","dispatch","schedule","plan","machines",
                    "procurement","stock","jobwork","parties","fabricators","catalogue","rules","data","copilot"])
    assert.equal(canSeeTab("admin", tab), true);
});

test("every role lands on a screen it is allowed to open", () => {
  for(const role of ROLES) assert.equal(canSeeTab(role, defaultTab(role)), true);
});

test("the roles that change nothing are marked read-only", () => {
  for(const role of ["viewer","owner","auditor"])
    assert.equal(isReadOnly(role), true, `${role} changes nothing`);
  /* Each of these writes SOMETHING, even where `writes` is empty: the planner
     edits the plan, the store keeper the stock figures. */
  for(const role of ["admin","planner","store","procurement","sales","dispatch","data"])
    assert.equal(isReadOnly(role), false, `${role} can change something`);
});

console.log("\nH — the narrower roles from the factory's own access list");

/* The case the three-role model could not express: someone who records a
   shipment but must not raise an invoice or touch an order. */
test("a Dispatch Executive can record a dispatch and nothing else", () => {
  assert.equal(allow("dispatch","POST","/api/dispatches"), true);
  assert.equal(allow("dispatch","POST","/api/dispatches?resource=finished_stock",{resource:"finished_stock",moves:[]}), true,
    "finished-goods stock is the dispatch clerk's to update");
  for(const [m,u] of [["POST","/api/orders"],["PATCH","/api/orders/JO1"],["POST","/api/pis"],
                      ["PUT","/api/catalogue"],["PUT","/api/parties"],["PUT","/api/settings"],
                      ["PATCH","/api/reference"],["POST","/api/read-pi"]])
    assert.equal(allow("dispatch", m, u, {}), false, `dispatch must not ${m} ${u}`);
});

/* "can update dispatch stock (fg stocks), can record dispatches, see pending
   orders, see order sheets". */
test("and sees only what packing a shipment needs — no MIS", () => {
  for(const tab of ["orders","dispatch","finished","rules","pis"])
    assert.equal(canSeeTab("dispatch", tab), true, `dispatch should see ${tab}`);
  for(const tab of ["mis","intake","data","catalogue","parties","stock","plan","machines","jobwork"])
    assert.equal(canSeeTab("dispatch", tab), false, `dispatch should NOT see ${tab}`);
});

/* Director: the whole factory, read-only. */
test("a Director sees everything and can change nothing", () => {
  assert.match(ROLE_LABEL.owner, /Director/);
  for(const tab of ["mis","orders","dispatch","data","catalogue","parties","plan"])
    assert.equal(canSeeTab("owner", tab), true);
  for(const [m,u] of [["POST","/api/orders"],["POST","/api/dispatches"],["PATCH","/api/reference"],
                      ["PUT","/api/settings"],["PUT","/api/catalogue"]])
    assert.equal(allow("owner", m, u, {}), false, `owner must not ${m} ${u}`);
  assert.equal(allow("owner","GET","/api/orders"), true, "but reads everything");
  assert.equal(isReadOnly("owner"), true);
});

test("a store keeper updates stock but cannot touch the BOM", () => {
  assert.equal(allow("store","PATCH","/api/reference",{stock:{"X":1}}), true);
  assert.equal(allow("store","PATCH","/api/reference",{bom_removal:{articles:["X"]}}), false);
  assert.equal(allow("store","POST","/api/orders"), false);
});

/* Product codes are master data: they go on job cards and PIs, so assigning
   them belongs with the BOM, not with the daily stock count. Nothing was added
   to the policy for this — the allowlist refuses an unrecognised key on its
   own — and that is exactly what is being asserted. */
test("assigning product codes is master data, not a stock update", () => {
  assert.equal(allow("admin","PATCH","/api/reference",{assign_product_codes:true}), true);
  assert.equal(allow("data","PATCH","/api/reference",{assign_product_codes:true}), true);
  for(const role of ["planner","store","procurement","dispatch","viewer","owner"])
    assert.equal(allow(role,"PATCH","/api/reference",{assign_product_codes:true}), false,
      `${role} must not renumber the article master`);
});

test("a data manager owns the BOM but raises no orders", () => {
  assert.equal(allow("data","POST","/api/reference",{parsed:{}}), true);
  assert.equal(allow("data","PUT","/api/catalogue"), true);
  assert.equal(allow("data","POST","/api/orders"), false);
});

test("every role lands on a screen it may actually open", () => {
  for(const role of ROLES) assert.equal(canSeeTab(role, defaultTab(role)), true, role);
});

test("every role is described for whoever hands out the account", () => {
  for(const role of ROLES){
    assert.ok(ROLE_LABEL[role], `${role} needs a label`);
    assert.ok(ROLE_SUMMARY[role] && ROLE_SUMMARY[role].length > 20, `${role} needs a summary`);
  }
});

test("the recommended profile allocation is exactly eleven recognised roles", () => {
  assert.equal(Object.values(RECOMMENDED_USER_COUNTS).reduce((sum,count)=>sum+count,0),11);
  assert.equal(RECOMMENDED_USER_COUNTS.owner,3);
  for(const role of Object.keys(RECOMMENDED_USER_COUNTS)) assert.ok(ROLES.includes(role),role);
});


console.log("\nZ — creating a material is stock-adjacent, on purpose");

/* A material entering the system is master data — it reaches BOMs, netting and
   the buying list. But the person who FINDS one missing is the store keeper
   unpacking a delivery, not the data manager, and refusing them makes the
   feature useless to the only people who need it. */
test("a store keeper and a procurement officer can add a material", () => {
  assert.equal(allow("store","PATCH","/api/reference",{new_material:{name:"GLUE",uom:"LTR"}}), true);
  assert.equal(allow("procurement","PATCH","/api/reference",{new_material:{name:"GLUE",uom:"LTR"}}), true);
  assert.equal(allow("data","PATCH","/api/reference",{new_material:{name:"GLUE",uom:"LTR"}}), true);
  assert.equal(allow("admin","PATCH","/api/reference",{new_material:{name:"GLUE",uom:"LTR"}}), true);
});

/* It is a widening of the stock allowlist, not of everything. */
test("adding a material does not open the BOM to the same roles", () => {
  assert.equal(allow("store","PATCH","/api/reference",{bom_removal:{articles:["SPIKE"]}}), false);
  assert.equal(allow("store","POST","/api/reference",{parsed:{}}), false);
  assert.equal(allow("store","PATCH","/api/reference",
    {new_material:{name:"GLUE",uom:"LTR"}, bom_removal:{articles:["SPIKE"]}}), false,
    "one disallowed key still sinks the whole request");
});

test("roles with no stock rights still cannot add a material", () => {
  for(const role of ["dispatch","sales","viewer","owner","auditor"])
    assert.equal(allow(role,"PATCH","/api/reference",{new_material:{name:"GLUE",uom:"LTR"}}), false, role);
});

console.log("\nU — the upper store: the keeper records, the in-charge approves");

const UPPER = "/api/dispatches?resource=upper_store";
test("a store keeper records uppers in and out but cannot approve an adjustment", () => {
  assert.equal(allow("store","POST",UPPER,{moves:[{kind:"in"}]}), true);
  assert.equal(allow("store","PUT",UPPER,{tag:{}}), true);
  assert.equal(allow("store","DELETE",UPPER+"&id=4"), true);
  assert.equal(allow("store","PATCH",UPPER,{id:4,action:"approve"}), false);
  assert.match(can("store","PATCH",UPPER,{id:4,action:"approve"}).reason, /in-charge/);
});

test("the store in-charge approves; an admin can too", () => {
  assert.equal(allow("store_incharge","PATCH",UPPER,{id:4,action:"approve"}), true);
  assert.equal(allow("admin","PATCH",UPPER,{id:4,action:"approve"}), true);
  assert.equal(upperStoreAccess("store_incharge"), "approve");
  assert.equal(upperStoreAccess("admin"), "approve");
  assert.equal(upperStoreAccess("store"), "record");
  assert.equal(upperStoreAccess("planner"), "record");
  assert.equal(upperStoreAccess("auditor"), null);
});

/* The dispatch clerk holds a `dispatches` write. The upper store rides on the
   same endpoint, and that grant must not reach it — by URL or by body. */
test("a dispatch clerk's dispatch rights do not reach the upper store", () => {
  assert.equal(allow("dispatch","POST",UPPER,{moves:[]}), false);
  assert.equal(allow("dispatch","POST","/api/dispatches",{resource:"upper_store",moves:[]}), false);
  assert.equal(allow("dispatch","POST","/api/dispatches",{order_no:"JO1"}), true, "dispatch itself is untouched");
});

test("the auditor and director read the upper store; neither changes it", () => {
  for(const role of ["auditor","owner","viewer"]){
    assert.equal(canSeeTab(role,"upper_store"), true, role);
    assert.equal(allow(role,"POST",UPPER,{moves:[]}), false, role);
  }
  assert.equal(canSeeTab("sales","upper_store"), false);
});

test("the in-charge is not read-only and lands on the upper store", () => {
  assert.equal(isReadOnly("store_incharge"), false);
  assert.equal(defaultTab("store_incharge"), "upper_store");
  assert.equal(allow("store_incharge","PATCH","/api/reference",{bom_removal:{articles:["X"]}}), false);
});

console.log("\nM — one account, several roles");

/* Ticked on the Profiles screen and stored comma-joined in users.role. The
   account may do whatever ANY of its roles may do — and nothing more. */
test("a Sales Head who is also a Director sees the whole factory but writes only as Sales", () => {
  const both = "sales,owner";
  assert.equal(canSeeTab(both,"schedule"), true, "the Director half sees production");
  assert.equal(allow(both,"POST","/api/pis",{}), true, "the Sales half raises a PI");
  assert.equal(allow(both,"POST","/api/dispatches",{}), false, "neither half records a dispatch");
  assert.equal(isReadOnly(both), false);
});

test("sales + planner: the planner half may move the board, the sales half alone may not", () => {
  assert.equal(allow("sales","PATCH","/api/orders/JO1",{plan_override:{}}), false);
  assert.equal(allow("sales,planner","PATCH","/api/orders/JO1",{plan_override:{}}), true);
  assert.equal(canEditSchedule("sales,planner"), true);
  assert.equal(canEditSchedule("sales,owner"), false);
});

test("an array and a comma list mean the same thing, in any order and spacing", () => {
  assert.deepEqual(rolesOf(" Planner , sales,planner"), ["planner","sales"]);
  assert.equal(normalizeRoles(["sales","planner"]), "sales,planner");
  assert.equal(normalizeRoles("sales,planner"), normalizeRoles("planner, sales"), "stored in one canonical order");
  assert.equal(hasRole("sales,admin","admin"), true);
  assert.equal(hasRole("sales","admin"), false);
});

test("an unrecognised entry is dropped, and a list of nothing recognised is still refused", () => {
  assert.equal(normalizeRoles("sales,superuser"), "sales");
  assert.equal(normalizeRoles("superuser"), null);
  assert.equal(normalizeRoles([]), null);
  assert.equal(allow("superuser,root","POST","/api/orders",{}), false);
  assert.match(can("superuser,root","GET","/api/orders").reason, /no recognised role/);
  assert.equal(canSeeTab("superuser,root","mis"), false);
  assert.equal(isReadOnly("superuser"), true);
  assert.equal(allow("superuser,admin","POST","/api/orders",{}), true, "the recognised one still counts");
});

test("upper-store access is the highest any role grants, and the first role picks the landing screen", () => {
  assert.equal(upperStoreAccess("store,store_incharge"), "approve");
  assert.equal(upperStoreAccess("auditor,store"), "record");
  assert.equal(defaultTab("dispatch,sales"), defaultTab("dispatch"));
  for(const combo of ["sales,owner","dispatch,sales","planner,dispatch"])
    assert.equal(canSeeTab(combo, defaultTab(combo)), true, combo);
});

test("only a Master account manages profiles, alone or alongside another role", () => {
  assert.equal(canSeeTab("admin","profiles"), true);
  assert.equal(canSeeTab("sales,admin","profiles"), true);
  assert.equal(canSeeTab("owner,planner","profiles"), false);
  assert.equal(rolesLabel("sales,owner"), "Sales Head + Director (view only)");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
/* exitCode, not exit(): process.exit() kills the process before V8 flushes
   its coverage file, so a suite that passed reported 0% and dragged the whole
   threshold down. Letting it end naturally keeps both the exit status and the
   coverage. */
process.exitCode = failed ? 1 : 0;
