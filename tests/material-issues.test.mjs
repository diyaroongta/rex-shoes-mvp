/* Material issues: which material went to which job card.
 *
 * What this locks down: the register kept one running Issued total, so nobody
 * could say which job took a material or whether a card had been given what
 * its BOM calls for. And the total itself was sent by the BROWSER, so two job
 * orders raised from two screens overwrote each other.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { ISSUE_MODES, issueModeOf, effectiveIssueMode, releaseLines, netByMaterial,
         validateMovement, cardLedger, movementWarnings, bookMovements, undoProblem,
         materialTrail } from "../shared/material-issues.js";
import { jobCardIssueRows } from "../shared/stock.js";
import { netting } from "../shared/engine.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const REXINE = 'REXINE 54" BLACK||MTR', THREAD = "THREAD||SPOOL", VELCRO = "VELCRO 25 MM HOOK||MTR";
const MATERIALS = () => ({
  [REXINE]: { name:'REXINE 54" BLACK', uom:"MTR", stock:100 },
  [THREAD]: { name:"THREAD", uom:"SPOOL", stock:40 },
  [VELCRO]: { name:"VELCRO 25 MM HOOK", uom:"MTR", stock:0 },
});
/* 0.05 MTR of rexine and 0.02 MTR of velcro a pair on both ranges; thread on
   one stage of one range only. */
const ARTICLE = () => ({ combos: {
  "11X1": { rates: { CUTTING:{ [REXINE]:0.05 }, STITCHING:{ [THREAD]:0.01, [VELCRO]:0.02 } } },
  "2X5":  { rates: { CUTTING:{ [REXINE]:0.06 }, STITCHING:{ [VELCRO]:0.02 } } },
}});
const JOB = () => ({ id:12, article:"SPIKE", order_no:"JO1", fabricator:"Rex Internal",
  card:{ lines:[{ combo:"11X1", qty:200 }, { combo:"2X5", qty:100 }] } });
const mv = (id, key, type, qty, extra={}) => ({ id, job_id:12, material_key:key, type, qty,
  name:key.split("||")[0], uom:key.split("||")[1], moved_on:"2026-11-10", ...extra });

console.log("\nIssue mode");
test("only the two modes the store asked for exist", () => {
  assert.deepEqual(ISSUE_MODES, ["job_order","on_demand"]);
});
test("a material nobody has set reads as NOT SET, and behaves as it always has", () => {
  assert.equal(issueModeOf({}), null);
  assert.equal(issueModeOf(undefined), null);
  assert.equal(issueModeOf({ issue_mode:"whenever" }), null, "an unknown value is not a mode");
  assert.equal(effectiveIssueMode({}), "job_order");
  assert.equal(effectiveIssueMode({ issue_mode:"on_demand" }), "on_demand");
});

console.log("\nWhat raising a job card releases");
test("every by-job-order material is released at its full BOM quantity", () => {
  const { released, on_demand } = releaseLines(JOB().card.lines, ARTICLE(), {}, MATERIALS());
  /* Hand-checked: rexine 200x0.05 + 100x0.06 = 16; thread 200x0.01 = 2;
     velcro 300x0.02 = 6. */
  assert.deepEqual(Object.fromEntries(released.map(r => [r.material_key, r.qty])),
    { [REXINE]:16, [THREAD]:2, [VELCRO]:6 });
  assert.deepEqual(on_demand, []);
  assert.equal(released[0].name, 'REXINE 54" BLACK');
  assert.equal(released[0].uom, "MTR");
});
test("an on-demand material is NOT released, and is named so the keeper knows", () => {
  const { released, on_demand } = releaseLines(JOB().card.lines, ARTICLE(),
    { [THREAD]:{ issue_mode:"on_demand" } }, MATERIALS());
  assert.deepEqual(released.map(r => r.material_key), [REXINE, VELCRO]);
  assert.deepEqual(on_demand.map(r => [r.material_key, r.qty]), [[THREAD, 2]]);
});
test("released plus on-demand is exactly what the job card's own issue list prints", () => {
  const { released, on_demand } = releaseLines(JOB().card.lines, ARTICLE(),
    { [VELCRO]:{ issue_mode:"on_demand" } }, MATERIALS());
  const card = jobCardIssueRows(JOB().card.lines, ARTICLE());
  const total = rows => Object.fromEntries(rows.map(r => [r.key || r.material_key, r.qty]));
  assert.deepEqual(total([...released, ...on_demand]), { ...total(card) });
});
test("a card with no BOM behind it releases nothing rather than inventing a quantity", () => {
  assert.deepEqual(releaseLines(JOB().card.lines, { combos:{} }, {}, MATERIALS()),
    { released:[], on_demand:[] });
  assert.deepEqual(releaseLines(null, null), { released:[], on_demand:[] });
});

console.log("\nA hand-entered movement");
const ctx = (prior=[]) => ({ job:JOB(), materials:MATERIALS(), prior });
const good = (over={}) => ({ type:"issue", moved_on:"2026-11-10",
  lines:[{ material_key:THREAD, qty:1.5 }], ...over });
test("a good issue comes back with the register's own name and unit", () => {
  const out = validateMovement(good({ lines:[{ material_key:THREAD, qty:"1.5", name:"made up", uom:"KG" }] }), ctx());
  assert.equal(out.ok, true);
  assert.deepEqual(out.value.lines, [{ material_key:THREAD, name:"THREAD", uom:"SPOOL", qty:1.5 }]);
  assert.equal(out.value.job_id, 12);
});
test("it must be against a job card", () => {
  const out = validateMovement(good(), { materials:MATERIALS() });
  assert.equal(out.ok, false);
  assert.match(out.problems.join(" "), /Choose the job card/);
});
test("nothing is issued against a cancelled card", () => {
  const out = validateMovement(good(), { ...ctx(), job:{ ...JOB(), cancelled:true } });
  assert.match(out.problems.join(" "), /was cancelled/);
});
test("a date Postgres would refuse is refused here, by name", () => {
  for(const moved_on of ["2026-13-40", "10/11/2026", ""])
    assert.match(validateMovement(good({ moved_on }), ctx()).problems.join(" "), /real date/);
});
test("a material the register does not know cannot be issued", () => {
  const out = validateMovement(good({ lines:[{ material_key:"GOLD LEAF||KG", qty:1 }] }), ctx());
  assert.match(out.problems.join(" "), /GOLD LEAF\|\|KG is not in the material register/);
});
test("zero, negative, blank and duplicate lines are each refused", () => {
  for(const qty of [0, -1, "", "abc", Infinity])
    assert.equal(validateMovement(good({ lines:[{ material_key:THREAD, qty }] }), ctx()).ok, false, `qty ${qty}`);
  assert.match(validateMovement(good({ lines:[] }), ctx()).problems.join(" "), /at least one material/);
  assert.match(validateMovement(good({ lines:[{ material_key:THREAD, qty:1 }, { material_key:THREAD, qty:2 }] }), ctx())
    .problems.join(" "), /more than once/);
  assert.match(validateMovement(good({ type:"lend" }), ctx()).problems.join(" "), /Unknown movement/);
});
test("MORE THAN THE BOM IS NOT REFUSED — the floor that needs another roll gets it", () => {
  /* The card's BOM calls for 2 spools; 50 is far past it and still saves. */
  assert.equal(validateMovement(good({ lines:[{ material_key:THREAD, qty:50 }] }), ctx()).ok, true);
});
test("a return cannot exceed what the card is holding", () => {
  const prior = [mv(1, THREAD, "issue", 2), mv(2, THREAD, "return", 0.5)];
  assert.equal(validateMovement(good({ type:"return", lines:[{ material_key:THREAD, qty:1.5 }] }), ctx(prior)).ok, true);
  const over = validateMovement(good({ type:"return", lines:[{ material_key:THREAD, qty:1.6 }] }), ctx(prior));
  assert.match(over.problems.join(" "), /only 1\.5 SPOOL is out against job card 12/);
});
test("material that never went to the card cannot come back from it", () => {
  const out = validateMovement(good({ type:"return" }), ctx([]));
  assert.match(out.problems.join(" "), /nothing is out against job card 12/);
});

console.log("\nThe job card's material account");
test("required, issued, returned, kept and still to issue — per material", () => {
  const moves = [mv(1, REXINE, "issue", 16), mv(2, VELCRO, "issue", 4),
                 mv(3, REXINE, "return", 1.5), mv(4, VELCRO, "issue", 1)];
  const ledger = cardLedger(JOB(), ARTICLE(), moves, { [VELCRO]:{ issue_mode:"on_demand" } }, MATERIALS());
  const row = key => ledger.rows.find(r => r.material_key === key);
  assert.deepEqual({ ...row(REXINE) }, { material_key:REXINE, name:'REXINE 54" BLACK', uom:"MTR", on_bom:true,
    mode:"job_order", mode_set:false, required:16, issued:16, returned:1.5, net:14.5, balance:1.5, excess:0 });
  assert.equal(row(VELCRO).mode, "on_demand");
  assert.equal(row(VELCRO).mode_set, true);
  assert.equal(row(VELCRO).balance, 1);
  /* Thread is on the BOM and nothing has gone out: the whole 2 is pending. */
  assert.equal(row(THREAD).balance, 2);
  assert.equal(ledger.fully_issued, false);
  assert.equal(ledger.pending, 3);
});
test("rows follow the BOM's own order, not the alphabet", () => {
  const ledger = cardLedger(JOB(), ARTICLE(), [], {}, MATERIALS());
  assert.deepEqual(ledger.rows.map(r => r.material_key), [REXINE, THREAD, VELCRO]);
  assert.equal(ledger.nothing_recorded, true);
});
test("a card given everything its BOM calls for is fully issued", () => {
  const moves = [mv(1, REXINE, "issue", 16), mv(2, THREAD, "issue", 2), mv(3, VELCRO, "issue", 6)];
  const ledger = cardLedger(JOB(), ARTICLE(), moves, {}, MATERIALS());
  assert.equal(ledger.fully_issued, true);
  assert.equal(ledger.pending, 0);
});
test("more than the BOM shows as excess, never as a negative balance", () => {
  const ledger = cardLedger(JOB(), ARTICLE(), [mv(1, THREAD, "issue", 5)], {}, MATERIALS());
  const thread = ledger.rows.find(r => r.material_key === THREAD);
  assert.equal(thread.balance, 0);
  assert.equal(thread.excess, 3);
});
test("material the BOM never asked for is SHOWN against the card, flagged", () => {
  const extra = "GLUE||KG";
  const ledger = cardLedger(JOB(), ARTICLE(), [mv(1, extra, "issue", 2)], {},
    { ...MATERIALS(), [extra]:{ name:"GLUE", uom:"KG", stock:5 } });
  const row = ledger.rows[ledger.rows.length - 1];
  assert.deepEqual([row.material_key, row.on_bom, row.required, row.net], [extra, false, 0, 2]);
  assert.equal(ledger.unplanned, 1);
});
test("a card whose article has no BOM is NOT reported as fully issued", () => {
  const ledger = cardLedger(JOB(), { combos:{} }, [], {}, MATERIALS());
  assert.equal(ledger.no_bom, true);
  assert.equal(ledger.fully_issued, false);
});
test("a job with no size-wise card has nothing to check against, and says so", () => {
  const ledger = cardLedger({ id:3 }, ARTICLE(), [], {}, MATERIALS());
  assert.equal(ledger.has_card, false);
  assert.deepEqual(ledger.rows, []);
});

console.log("\nWarnings, never refusals");
test("over the BOM, off the BOM and above the book stock are each said", () => {
  const ledger = cardLedger(JOB(), ARTICLE(), [mv(1, THREAD, "issue", 1.5)], {}, MATERIALS());
  const value = { type:"issue", lines:[
    { material_key:THREAD, name:"THREAD", uom:"SPOOL", qty:1 },
    { material_key:VELCRO, name:"VELCRO 25 MM HOOK", uom:"MTR", qty:6 },
    { material_key:"GLUE||KG", name:"GLUE", uom:"KG", qty:1 } ] };
  const w = movementWarnings(value, ledger, { ...MATERIALS(), "GLUE||KG":{ name:"GLUE", uom:"KG", stock:9 } });
  assert.match(w.join("\n"), /THREAD: this takes the card to 2\.5 SPOOL against a BOM requirement of 2/);
  assert.match(w.join("\n"), /VELCRO 25 MM HOOK: the register shows 0 MTR in stock, and 6 is being issued/);
  assert.match(w.join("\n"), /GLUE is not on this card's BOM/);
  assert.equal(w.length, 3);
});
test("the stock it warns against is the register's balance, not the opening figure alone", () => {
  /* 40 opening, 3 already issued: 37 on the shelf, whatever material.stock says. */
  const ledger = cardLedger(JOB(), ARTICLE(), [], {}, MATERIALS());
  const value = { type:"issue", lines:[{ material_key:THREAD, name:"THREAD", uom:"SPOOL", qty:38 }] };
  const meta = { [THREAD]:{ opening:40, rec:0, issue:3 } };
  assert.match(movementWarnings(value, ledger, MATERIALS(), meta).join(" "),
    /the register shows 37 SPOOL in stock, and 38 is being issued/);
  /* With no movement record the material's own figure IS the balance. */
  assert.doesNotMatch(movementWarnings(value, ledger, MATERIALS(), {}).join(" "), /register shows/);
});
test("an issue inside the BOM and inside the stock raises nothing, and nor does a return", () => {
  const ledger = cardLedger(JOB(), ARTICLE(), [], {}, MATERIALS());
  assert.deepEqual(movementWarnings({ type:"issue", lines:[{ material_key:THREAD, name:"THREAD", uom:"SPOOL", qty:2 }] },
    ledger, MATERIALS()), []);
  assert.deepEqual(movementWarnings({ type:"return", lines:[{ material_key:THREAD, name:"THREAD", uom:"SPOOL", qty:99 }] },
    ledger, MATERIALS()), []);
});

console.log("\nBooking the register");
test("an issue adds to Issued and a return takes it off — Stock = Opening + Rec - Issued", () => {
  const ref = { materials:MATERIALS(), stock_meta:{ [THREAD]:{ opening:40, rec:10, issue:5 } } };
  bookMovements(ref, "issue", [{ material_key:THREAD, qty:2 }]);
  assert.deepEqual(ref.stock_meta[THREAD], { opening:40, rec:10, issue:7 });
  assert.equal(ref.materials[THREAD].stock, 43);
  bookMovements(ref, "return", [{ material_key:THREAD, qty:0.5 }]);
  assert.equal(ref.stock_meta[THREAD].issue, 6.5);
  assert.equal(ref.materials[THREAD].stock, 43.5);
});
test("THE FIX: the issue is ADDED to the locked figure, not totalled by a browser", () => {
  /* Two cards raised from two screens. Each used to send "what I saw + mine",
     so the second save erased the first. Booked one after the other against
     the same locked document, both land. */
  const ref = { materials:MATERIALS(), stock_meta:{} };
  bookMovements(ref, "issue", [{ material_key:REXINE, qty:16 }]);
  bookMovements(ref, "issue", [{ material_key:REXINE, qty:9 }]);
  assert.equal(ref.stock_meta[REXINE].issue, 25);
  assert.equal(ref.materials[REXINE].stock, 75);
});
test("a figure that came only from the BOM upload becomes the opening balance", () => {
  const ref = { materials:MATERIALS() };
  bookMovements(ref, "issue", [{ material_key:REXINE, qty:16 }]);
  assert.deepEqual(ref.stock_meta[REXINE], { opening:100, issue:16 });
  assert.equal(ref.materials[REXINE].stock, 84);
});
test("what is booked is what procurement nets against", () => {
  const ref = { materials:MATERIALS(), stock_meta:{} };
  assert.equal(netting({ [THREAD]:45 }, ref.materials)[0].shortfall, 5);
  bookMovements(ref, "issue", [{ material_key:THREAD, qty:10 }]);
  assert.equal(netting({ [THREAD]:45 }, ref.materials)[0].shortfall, 15);
});
test("a material that has left the register is reported, not thrown on", () => {
  const ref = { materials:MATERIALS(), stock_meta:{} };
  const out = bookMovements(ref, "return", [{ material_key:"GONE||KG", qty:1 }, { material_key:THREAD, qty:1 }]);
  assert.deepEqual(out.missing, ["GONE||KG"]);
  assert.equal(ref.materials[THREAD].stock, 41);
});

console.log("\nUndoing a mis-keyed entry");
test("an issue nothing was returned against can be undone", () => {
  const all = [mv(1, THREAD, "issue", 2), mv(2, THREAD, "issue", 1)];
  assert.equal(undoProblem(all[0], all), null);
});
test("an issue that returns were made against cannot simply vanish", () => {
  const all = [mv(1, THREAD, "issue", 2), mv(2, THREAD, "return", 1.5)];
  assert.match(undoProblem(all[0], all), /THREAD: 1\.5 SPOOL has been returned against this issue\. Undo the return first\./);
});
test("a return can always be undone", () => {
  const all = [mv(1, THREAD, "issue", 2), mv(2, THREAD, "return", 1.5)];
  assert.equal(undoProblem(all[1], all), null);
  assert.equal(undoProblem(null, all), null);
});

console.log("\nWhere a material went");
test("job card by job card, most recent first, other materials left out", () => {
  const moves = [
    mv(1, REXINE, "issue", 16, { job_id:12, fabricator:"Rex Internal", article:"SPIKE", order_no:"JO1", moved_on:"2026-11-01" }),
    mv(2, REXINE, "return", 2,  { job_id:12, fabricator:"Rex Internal", article:"SPIKE", order_no:"JO1", moved_on:"2026-11-04" }),
    mv(3, REXINE, "issue", 9,  { job_id:15, fabricator:"New Durga Line", article:"JACK", order_no:"JO7", moved_on:"2026-11-09" }),
    mv(4, THREAD, "issue", 2,  { job_id:15, moved_on:"2026-11-09" }),
  ];
  assert.deepEqual(materialTrail(moves, REXINE), [
    { job_id:15, fabricator:"New Durga Line", article:"JACK", order_no:"JO7", issued:9, returned:0, net:9, last_on:"2026-11-09" },
    { job_id:12, fabricator:"Rex Internal", article:"SPIKE", order_no:"JO1", issued:16, returned:2, net:14, last_on:"2026-11-04" },
  ]);
  assert.deepEqual(materialTrail(moves, VELCRO), []);
  assert.deepEqual(netByMaterial(moves)[REXINE], { issued:25, returned:2, net:23 });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
