/* Upper store: stitched uppers between the line and the sole. Run: npm test */
import assert from "node:assert/strict";
import { validateUpperMoves, upperStock, upperPositions, upperLedger, onHandBySize, effectOf,
         checkApproval, checkDelete, movingStatus, validateTag, outsideFabrication, upperShortage,
         rejectionRatios, countAdjustments, normalizeUpperRules, upperAlerts, ageBucket, daysBetween, qcQueue, sizeRank,
         DEFAULT_MOVING_DAYS } from "../shared/upper-store.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}
let id = 0;
const IN = (size, qty, extra = {}) => ({ id:++id, kind:"in", article:"SPIKE", colour:"Blue", size, qty,
  source_type:"line", source:"New Durga Line", order_no:"JO1", moved_on:"2026-10-01", status:"approved", ...extra });
const OUT = (size, qty, extra = {}) => ({ id:++id, kind:"out", article:"SPIKE", colour:"BLUE", size, qty,
  destination:"MOULDING", order_no:"JO1", moved_on:"2026-10-05", status:"approved", ...extra });

console.log("\nA — every receipt says where it came from");

test("a receipt needs its source type, its source and an order reference", () => {
  const { problems } = validateUpperMoves([{ kind:"in", article:"SPIKE", size:"8", qty:10 }]);
  assert.ok(problems.some(p => /stitching line or outside fabrication/.test(p)));
  assert.ok(problems.some(p => /name the line or the vendor/.test(p)));
  assert.ok(problems.some(p => /order number, or mark it MTS/.test(p)));
  const ok = validateUpperMoves([{ kind:"in", article:"SPIKE", size:"8", qty:10,
    source_type:"vendor", source:"Shree Fab", order_no:"JO4", job_card_no:"JC12", rack:"R-4" }]);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.rows[0].status, "approved");
  assert.equal(ok.rows[0].rack, "R-4");
});

/* The client's notes require an order reference AND name MTS uppers, which
   have no order. So MTS is said explicitly — a job card number alone, which
   was accepted before, is not an order reference. */
test("an order number OR an explicit MTS — never a job card alone, never both", () => {
  const base = { kind:"in", article:"SPIKE", size:"8", qty:10, source_type:"line", source:"New Durga Line" };
  assert.match(validateUpperMoves([{ ...base, job_card_no:"JC12" }]).problems[0], /order number, or mark it MTS/);
  const mts = validateUpperMoves([{ ...base, mts:true }]);
  assert.deepEqual(mts.problems, []);
  assert.equal(mts.rows[0].mts, true);
  assert.equal(mts.rows[0].order_no, null);
  assert.match(validateUpperMoves([{ ...base, mts:true, order_no:"JO1" }]).problems[0], /order or MTS, not both/);
  assert.equal(validateUpperMoves([{ ...base, mts:"yes" }]).problems.length, 1, "only a real true marks MTS");
});

test("half an upper is refused, not rounded", () => {
  const { problems } = validateUpperMoves([{ ...IN("8", 2.5) }]);
  assert.ok(problems.some(p => /whole number/.test(p)));
});

test("a size keeps its printed spelling — 8s and 8 are different uppers", () => {
  const s = upperStock([IN("8s", 5), IN("8", 3)]);
  const sizes = Object.fromEntries(s.groups[0].sizes.map(x => [x.size, x.on_hand]));
  assert.deepEqual(sizes, { "8":3, "8s":5 });
});

test("colour is part of the upper and is matched without regard to case", () => {
  const s = upperStock([IN("8", 10), OUT("8", 4)]);
  assert.equal(s.groups.length, 1, "Blue received and BLUE issued are one upper");
  assert.equal(s.groups[0].on_hand, 6);
  assert.equal(s.groups[0].at.MOULDING, 4);
});

console.log("\nB — no issue above available stock");

test("an issue larger than the store holds is refused, naming what is there", () => {
  const { rows, problems } = validateUpperMoves([OUT("8", 11)], [IN("8", 10)]);
  assert.equal(rows.length, 0);
  assert.match(problems[0], /only 10 upper\(s\) of SPIKE BLUE size 8/);
});

/* Ten sizes issued in one go are each checked against what the earlier
   ones left — otherwise two rows of 6 against a shelf of 10 both pass. */
test("a batch is checked row by row against what the rows before it left", () => {
  const { rows, problems } = validateUpperMoves([OUT("8", 6), OUT("8", 6)], [IN("8", 10)]);
  assert.equal(rows.length, 1);
  assert.match(problems[0], /Row 2: only 4/);
});

test("an issue needs a destination and a production order", () => {
  const { problems } = validateUpperMoves([{ kind:"out", article:"SPIKE", size:"8", qty:1 }], [IN("8", 10)]);
  assert.ok(problems.some(p => /pasting or moulding/.test(p)));
  assert.ok(problems.some(p => /production order/.test(p)));
});

console.log("\nC — returns and damage");

test("unused uppers come back from the floor that holds them, and no more", () => {
  const log = [IN("8", 10), OUT("8", 6)];
  assert.match(validateUpperMoves([{ kind:"returned", article:"SPIKE", colour:"blue", size:"8", qty:7, destination:"MOULDING" }], log).problems[0],
    /only 6 upper\(s\).*out at moulding/);
  assert.match(validateUpperMoves([{ kind:"returned", article:"SPIKE", colour:"blue", size:"8", qty:1, destination:"PASTING" }], log).problems[0],
    /only 0 .*pasting/, "nothing was issued to pasting");
  const ok = validateUpperMoves([{ kind:"returned", article:"SPIKE", colour:"blue", size:"8", qty:2, destination:"MOULDING" }], log);
  assert.deepEqual(ok.problems, []);
  const p = upperPositions([...log, ...ok.rows]).get("SPIKE||BLUE||8");
  assert.equal(p.on_hand, 6);
  assert.equal(p.at.MOULDING, 4);
});

test("damaged needs a reason", () => {
  const { problems } = validateUpperMoves([{ kind:"damaged", article:"SPIKE", colour:"blue", size:"8", qty:1 }], [IN("8", 10)]);
  assert.ok(problems.some(p => /needs a reason/.test(p)));
});

/* An upper damaged at moulding was already issued. Taking it off the shelf
   as well would count the same upper out twice. */
test("damaged in the store leaves the shelf; damaged at moulding leaves moulding", () => {
  const log = [IN("8", 10), OUT("8", 6)];
  const store = { kind:"damaged", article:"SPIKE", colour:"blue", size:"8", qty:1, damaged_at:"STORE", reason:"torn" };
  const floor = { kind:"damaged", article:"SPIKE", colour:"blue", size:"8", qty:2, damaged_at:"MOULDING", reason:"burnt" };
  const { rows, problems } = validateUpperMoves([store, floor], log);
  assert.deepEqual(problems, []);
  const p = upperPositions([...log, ...rows]).get("SPIKE||BLUE||8");
  assert.equal(p.on_hand, 3, "10 in, 6 issued, 1 damaged on the shelf");
  assert.equal(p.at.MOULDING, 4, "6 issued, 2 damaged there");
  assert.equal(effectOf(rows[1]), 0, "the moulding damage does not touch the shelf");
});

console.log("\nD — a count adjustment waits for the store in-charge");

test("a physical count turns into PENDING adjustments that move nothing yet", () => {
  const log = [IN("8", 10), IN("9", 4)];
  const { rows, adjustments } = countAdjustments(log, "SPIKE", "blue", { "8":7, "9":4, "10":"" });
  assert.deepEqual(rows.map(r => [r.size, r.system, r.counted, r.diff]), [["8",10,7,-3],["9",4,4,0]]);
  assert.equal(adjustments.length, 1, "a size that agrees needs no adjustment");
  const checked = validateUpperMoves(adjustments, log);
  assert.deepEqual(checked.problems, []);
  assert.equal(checked.rows[0].status, "pending");
  const p = upperPositions([...log, ...checked.rows]).get("SPIKE||BLUE||8");
  assert.equal(p.on_hand, 10, "unapproved, the book is unchanged");
  assert.equal(p.pending_adjust, -3);
});

test("approval is checked against the book as it is now", () => {
  const pending = { id:99, kind:"adjust", article:"SPIKE", colour:"BLUE", size:"8", qty:-8, status:"pending" };
  assert.equal(checkApproval(pending, [IN("8", 10)]).ok, true);
  assert.match(checkApproval(pending, [IN("8", 10), OUT("8", 5)]).problem, /below zero/);
  assert.equal(checkApproval({ ...pending, status:"approved" }, []).ok, false);
  assert.equal(checkApproval(IN("8", 1), []).ok, false, "only an adjustment is approved");
  const approved = upperPositions([IN("8", 10), { ...pending, status:"approved" }]).get("SPIKE||BLUE||8");
  assert.equal(approved.on_hand, 2);
});

test("an adjustment needs a reason and a non-zero figure", () => {
  const { problems } = validateUpperMoves([{ kind:"adjust", article:"SPIKE", size:"8", qty:0 }]);
  assert.ok(problems.some(p => /other than 0/.test(p)));
  assert.ok(problems.some(p => /needs a reason/.test(p)));
});

console.log("\nE — deleting a mistake cannot leave the book negative");

test("a receipt that has since been issued cannot be deleted first", () => {
  const rec = IN("8", 10), iss = OUT("8", 6);
  assert.match(checkDelete(rec.id, [rec, iss]).problem, /below zero/);
  assert.equal(checkDelete(iss.id, [rec, iss]).ok, true);
  assert.equal(checkDelete(12345, [rec]).missing, true);
});

console.log("\nF — moving vs non-moving");

test("issued within the window is moving; past it, non-moving with its own reason", () => {
  const log = [IN("8", 10), OUT("8", 2, { moved_on:"2026-10-05" })];
  const fresh = movingStatus(log, [], "2026-10-10", 7);
  assert.equal(fresh.rows[0].status, "moving");
  const stale = movingStatus(log, [], "2026-10-20", 7);
  assert.equal(stale.rows[0].status, "non_moving");
  assert.equal(stale.rows[0].reason, "No issue for 15 days");
  assert.equal(stale.rows[0].bucket, "8-15");
  assert.equal(stale.non_moving_pairs, 8);
});

test("the window is the client's setting, 7 by default", () => {
  const log = [IN("8", 10), OUT("8", 2, { moved_on:"2026-10-05" })];
  assert.equal(DEFAULT_MOVING_DAYS, 7);
  assert.equal(movingStatus(log, [], "2026-10-20", 15).rows[0].status, "moving");
  assert.equal(movingStatus(log, [], "2026-10-20").moving_days, 7);
});

test("never issued is aged from its first receipt", () => {
  const r = movingStatus([IN("8", 10, { moved_on:"2026-09-01" })], [], "2026-10-15").rows[0];
  assert.equal(r.status, "non_moving");
  assert.equal(r.bucket, "30+");
  assert.match(r.reason, /Never issued/);
});

test("a manual tag overrides the automatic one and carries its reason", () => {
  const log = [IN("8", 10), OUT("8", 2, { moved_on:"2026-10-05" })];
  const tagged = movingStatus(log, [{ article:"SPIKE", colour:"blue", tag:"non_moving", reason_code:"hold", reason:"party asked to wait" }], "2026-10-06");
  assert.equal(tagged.rows[0].status, "non_moving");
  assert.equal(tagged.rows[0].reason, "Order hold — party asked to wait");
  assert.equal(tagged.rows[0].manual, true);
});

test("non-moving needs a reason; a tag can be handed back to the automatic rule", () => {
  assert.ok(validateTag({ article:"SPIKE", tag:"non_moving" }).problems.length);
  assert.deepEqual(validateTag({ article:"SPIKE", tag:"non_moving", reason_code:"mts" }).problems, []);
  assert.deepEqual(validateTag({ article:"SPIKE", tag:"auto" }).problems, []);
  assert.ok(validateTag({ article:"SPIKE", tag:"non_moving", reason_code:"lost" }).problems.length);
});

test("ageing buckets are the client's 0-7, 8-15, 16-30, 30+", () => {
  assert.deepEqual([0, 7, 8, 15, 16, 30, 31].map(ageBucket), ["0-7","0-7","8-15","8-15","16-30","16-30","30+"]);
  assert.equal(daysBetween("2026-10-30", "2026-11-02"), 3);
});

console.log("\nG — outside fabrication, from the job work already issued");

const jobs = [
  { id:1, fabricator:"Shree Fab", fabricator_type:"external", stage:"STITCHING", article:"SPIKE", qty:500, received:400, status:"partial", issued_on:"2026-10-01", card:{ card_no:"JC1" } },
  { id:2, fabricator:"Shree Fab", fabricator_type:"external", stage:"STITCHING", article:"SPIKE", qty:300, received:250, shortage:50, status:"closed", issued_on:"2026-09-01" },
  { id:3, fabricator:"Rex Internal", fabricator_type:"internal_line", stage:"STITCHING", article:"SPIKE", qty:900, received:0, status:"issued", issued_on:"2026-10-01" },
  { id:4, fabricator:"Sample Co", fabricator_type:"external", sample:true, qty:2, received:0, status:"issued", issued_on:"2026-10-01" },
];

test("sent, received and pending come off external stitching job work", () => {
  const f = outsideFabrication(jobs, "2026-10-29");
  assert.deepEqual(f.rows.map(r => r.id), [1, 2], "internal lines and samples are not outside fabrication");
  assert.equal(f.rows[0].pending, 100);
  assert.equal(f.rows[1].pending, 0, "a closed job's balance is a shortage, not pending");
  assert.deepEqual(f.fabricators[0], { fabricator:"Shree Fab", jobs:2, sent:800, received:650, pending:100, shortage:50, overdue:0 });
});

test("nothing is overdue until the factory sets a turnaround", () => {
  assert.equal(outsideFabrication(jobs, "2026-10-29").rows[0].overdue, false);
  const set = outsideFabrication(jobs, "2026-10-29", 21);
  assert.equal(set.rows[0].overdue, true, "28 days out against 21");
  assert.equal(set.fabricators[0].overdue, 1);
});

console.log("\nH — shortage: order need against available uppers");

test("need is ordered less what was issued against that order, net of returns", () => {
  const orders = [{ order_no:"JO1", article_code:"SPIKE", lines:[{ combo:"7X10", qty:60, sizes:{ "8":40, "9":20 } }] },
                  { order_no:"JO2", article_code:"SPIKE", lines:[{ combo:"7X10", qty:30, sizes:{ "8":30 } }] }];
  const log = [IN("8", 50), OUT("8", 30), { ...OUT("8", 5), kind:"returned" }];
  const s = upperShortage(orders, log);
  const r8 = s.rows.find(r => r.size === "8");
  assert.equal(r8.need, 15 + 30, "JO1 still needs 40-25, JO2 needs all 30");
  assert.equal(r8.available, 25);
  assert.equal(r8.short, 20);
  assert.deepEqual(r8.orders, ["JO1","JO2"]);
  assert.equal(s.rows.find(r => r.size === "9").short, 20);
  assert.deepEqual(s.articles_short, ["SPIKE"]);
});

test("a range ordered without sizes is counted apart, never split evenly", () => {
  const s = upperShortage([{ order_no:"JO3", article_code:"GOLA", lines:[{ combo:"6X9", qty:72 }] }], []);
  assert.deepEqual(s.rows, []);
  assert.deepEqual(s.sizes_unknown, [{ article:"GOLA", pairs:72, orders:["JO3"] }]);
});

test("finished orders need no uppers", () => {
  const orders = [{ order_no:"JO1", article_code:"SPIKE", lines:[{ qty:10, sizes:{ "8":10 } }] }];
  assert.equal(upperShortage(orders, [], new Set(["JO1"])).rows.length, 0);
});

console.log("\nQ — QC at receipt, and rework back to the maker");

const FAIL = (size, qty, extra = {}) => ({ id:++id, kind:"qc_failed", article:"SPIKE", colour:"BLUE", size, qty,
  source_type:"vendor", source:"Shree Fab", order_no:"JO1", reason:"open stitch", moved_on:"2026-10-02", status:"approved", ...extra });
const VIN = (size, qty) => IN(size, qty, { source_type:"vendor", source:"Shree Fab" });

test("a failed upper is held in QC — in the building, never available", () => {
  const log = [VIN("8", 90), FAIL("8", 10)];
  const p = upperPositions(log).get("SPIKE||BLUE||8");
  assert.equal(p.on_hand, 90, "only the passed uppers are stock");
  assert.equal(p.qc_hold, 10);
  assert.match(validateUpperMoves([OUT("8", 91)], log).problems[0], /only 90/, "a held upper cannot be issued");
});

test("a QC failure records its defect and its maker, and needs an order or MTS", () => {
  const { problems } = validateUpperMoves([{ kind:"qc_failed", article:"SPIKE", size:"8", qty:3 }]);
  assert.ok(problems.some(p => /defect/.test(p)));
  assert.ok(problems.some(p => /name the line or the vendor/.test(p)));
  assert.ok(problems.some(p => /order number, or mark it MTS/.test(p)));
  assert.deepEqual(qcQueue([VIN("8", 90), FAIL("8", 10)])[0].defects, ["open stitch"]);
});

test("failed uppers go back to THEIR maker for rework, and no more than are held", () => {
  const log = [VIN("8", 90), FAIL("8", 10)];
  const send = { kind:"rework_out", article:"SPIKE", colour:"blue", size:"8", source:"Shree Fab" };
  assert.match(validateUpperMoves([{ ...send, qty:11 }], log).problems[0], /only 10 .*Shree Fab are in QC hold/);
  assert.match(validateUpperMoves([{ ...send, qty:1, source:"New Durga Line" }], log).problems[0], /only 0/,
    "another maker's hold is not this one's");
  const ok = validateUpperMoves([{ ...send, qty:10 }], log);
  assert.deepEqual(ok.problems, []);
  const q = qcQueue([...log, ...ok.rows])[0];
  assert.deepEqual([q.hold, q.rework], [0, 10]);
});

test("rework comes back passed into stock, or fails again into QC hold", () => {
  const log = [VIN("8", 90), FAIL("8", 10),
               { id:++id, kind:"rework_out", article:"SPIKE", colour:"BLUE", size:"8", qty:10, source:"Shree Fab", status:"approved" }];
  const back = { kind:"rework_in", article:"SPIKE", colour:"BLUE", size:"8", source:"Shree Fab" };
  assert.match(validateUpperMoves([{ ...back, qty:11 }], log).problems[0], /only 10 .*with Shree Fab for rework/);
  const { rows, problems } = validateUpperMoves([{ ...back, qty:8 },
    { kind:"qc_failed", rework:true, article:"SPIKE", colour:"BLUE", size:"8", qty:2, source:"Shree Fab", reason:"still open" }], log);
  assert.deepEqual(problems, [], "rework returning needs no new order reference");
  const p = upperPositions([...log, ...rows]).get("SPIKE||BLUE||8");
  assert.deepEqual([p.on_hand, p.qc_hold, p.rework], [98, 2, 0]);
});

test("a held upper can be scrapped, with a reason, from its maker's hold", () => {
  const log = [VIN("8", 90), FAIL("8", 10)];
  const scrap = { kind:"damaged", damaged_at:"QC", article:"SPIKE", colour:"BLUE", size:"8", qty:4, reason:"beyond repair" };
  assert.ok(validateUpperMoves([scrap], log).problems.some(p => /whose QC hold/.test(p)));
  const ok = validateUpperMoves([{ ...scrap, source:"Shree Fab" }], log);
  assert.deepEqual(ok.problems, []);
  const p = upperPositions([...log, ...ok.rows]).get("SPIKE||BLUE||8");
  assert.deepEqual([p.on_hand, p.qc_hold], [90, 6], "scrapping from QC never touches the shelf");
});

test("rework cannot be un-recorded out from under its return", () => {
  const out = { id:++id, kind:"rework_out", article:"SPIKE", colour:"BLUE", size:"8", qty:10, source:"Shree Fab", status:"approved" };
  const back = { id:++id, kind:"rework_in", article:"SPIKE", colour:"BLUE", size:"8", qty:10, source:"Shree Fab", status:"approved" };
  assert.match(checkDelete(out.id, [VIN("8", 90), FAIL("8", 10), out, back]).problem, /below zero/);
});

console.log("\nI — rejection ratio, alerts and rules");

/* First-inspection failures over everything inspected. A reworked upper that
   fails again is reported, not added in, or it would count twice. */
test("QC rejection ratio per maker is first-inspection failures over inspected", () => {
  const log = [VIN("8", 90), FAIL("8", 10),
    { kind:"rework_out", article:"SPIKE", colour:"BLUE", size:"8", qty:10, source:"Shree Fab" },
    { kind:"qc_failed", rework:true, article:"SPIKE", colour:"BLUE", size:"8", qty:2, source:"Shree Fab", reason:"x" }];
  const r = rejectionRatios(log).find(x => x.source === "Shree Fab");
  assert.equal(r.inspected, 100);
  assert.equal(r.failed, 10);
  assert.equal(r.ratio, 10);
  assert.equal(r.failed_again, 2);
  assert.equal(r.sent_for_rework, 10);
});

test("rules default to the client's 7 days and invent no other threshold", () => {
  assert.deepEqual(normalizeUpperRules({}).rules,
    { moving_days:7, fabrication_due_days:null, rejection_alert_pct:null, repair_rejection_alert_pct:null });
  assert.deepEqual(normalizeUpperRules({ moving_days:15, fabrication_due_days:"20", rejection_alert_pct:5, repair_rejection_alert_pct:"8" }).rules,
    { moving_days:15, fabrication_due_days:20, rejection_alert_pct:5, repair_rejection_alert_pct:8 });
  assert.ok(normalizeUpperRules({ moving_days:0 }).problems.length);
  assert.ok(normalizeUpperRules({ rejection_alert_pct:150 }).problems.length);
  assert.ok(normalizeUpperRules({ repair_rejection_alert_pct:-1 }).problems.length);
});

test("every alert fires only on what was recorded", () => {
  const log = [VIN("8", 100), { ...FAIL("8", 10) }];
  log[0].moved_on = "2026-09-01";
  const orders = [{ order_no:"JO9", article_code:"SPIKE", lines:[{ qty:200, sizes:{ "8":200 } }] }];
  const repair = { articles:[{ article:"SPIKE", sent:50, rejected:5, ratio:10 }] };
  const base = { moving: movingStatus(log, [], "2026-10-29"), shortage: upperShortage(orders, log),
                 fabrication: outsideFabrication(jobs, "2026-10-29"), ratios: rejectionRatios(log), repair };
  const quiet = upperAlerts(base).map(a => a.kind).sort();
  assert.deepEqual(quiet, ["low_stock","non_moving"], "no turnaround or rejection limits set, so none of those fire");
  const loud = upperAlerts({ ...base, fabrication: outsideFabrication(jobs, "2026-10-29", 21),
                             rules:{ rejection_alert_pct:5, repair_rejection_alert_pct:10 } }).map(a => a.kind).sort();
  assert.deepEqual(loud, ["fabrication_overdue","low_stock","non_moving","rejection","repair_rejection"]);
  assert.ok(!upperAlerts({ ...base, rules:{ repair_rejection_alert_pct:11 } }).some(a => a.kind === "repair_rejection"),
    "10% is below an 11% limit");
});

console.log("\nJ — the ledger and the live stock");

test("the ledger carries the running balance of each upper, newest first", () => {
  const log = [IN("8", 10, { moved_on:"2026-10-01" }), OUT("8", 4, { moved_on:"2026-10-03" }),
               { id:++id, kind:"adjust", article:"SPIKE", colour:"blue", size:"8", qty:-1, status:"pending", moved_on:"2026-10-04", reason:"count" }];
  const l = upperLedger(log);
  assert.deepEqual(l.map(r => [r.kind, r.effect, r.balance]), [["adjust",0,6],["out",-4,6],["in",10,10]]);
  assert.deepEqual(onHandBySize(log, "SPIKE", "Blue"), { "8":6 });
});

test("a negative balance is reported, never floored", () => {
  const s = upperStock([{ kind:"adjust", article:"X", size:"8", qty:-3, status:"approved", reason:"r" }]);
  assert.deepEqual(s.groups[0].negative, ["8"]);
});

console.log("\nS — live stock in the company's series");

/* Sorted by number, adult 1 and 2 came out ahead of kids 6s and 7s. The roll
   is 6s..13s, then 1..5.5, then the bare 6..13 of a B range. */
test("sizes follow the factory roll, not number order", () => {
  const s = upperStock(["1","8","7s","13s","5.5","10s","2","6s"].map(z => IN(z, 1)));
  assert.deepEqual(s.groups[0].sizes.map(x => x.size), ["6s","7s","10s","13s","1","2","5.5","8"]);
  assert.equal(sizeRank("UK9"), null, "a size the roll does not know has no rank and sorts last");
});

test("articles follow the series the screen gives, A-Z for the rest", () => {
  const log = ["JACK LACE", "ARMOUR", "JACK VELCRO", "ZED"].map(a => IN("8", 1, { article:a }));
  const s = upperStock(log, { articleRank:{ "JACK VELCRO":0, "JACK LACE":1, "ARMOUR":2 } });
  assert.deepEqual(s.groups.map(g => g.article), ["JACK VELCRO","JACK LACE","ARMOUR","ZED"]);
  assert.deepEqual(upperStock(log).groups.map(g => g.article), ["ARMOUR","JACK LACE","JACK VELCRO","ZED"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
