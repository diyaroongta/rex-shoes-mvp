/* Repair, between production and dispatch. Run: npm test */
import assert from "node:assert/strict";
import { validateMovement, repairLedger, heldByRepair, heldByCombo, repairTotals, repairRate, MOVEMENTS }
  from "../shared/repair.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}
const ev = (order_no, size, kind, qty, on) => ({ order_no, size, kind, qty, on });

console.log("\nA — the card's own three movements");

test("a movement is sent, returned or rejected and nothing else", () => {
  assert.deepEqual(MOVEMENTS, ["sent","returned","rejected"]);
  assert.equal(validateMovement({order_no:"JO1",size:"8",kind:"scrapped",qty:1}).ok, false);
});

test("a movement needs an order, a size and a whole positive quantity", () => {
  const bad = validateMovement({ kind:"sent" });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some(p => /order number/i.test(p)));
  assert.ok(bad.problems.some(p => /size is required/i.test(p)));
  assert.equal(validateMovement({order_no:"JO1",size:"8",kind:"sent",qty:0}).ok, false);
  assert.equal(validateMovement({order_no:"JO1",size:"8",kind:"sent",qty:2.5}).ok, false,
    "half a pair cannot go for repair");
  assert.equal(validateMovement({order_no:"JO1",size:"8",kind:"sent",qty:-3}).ok, false);
});

/* "8s" is the kids run and "8" the adult repeat — the factory prints both on
   one invoice, so a size is text and never a number. */
test("a size keeps its printed spelling", () => {
  const led = repairLedger([ev("JO1","8s","sent",5), ev("JO1","8","sent",3)]);
  assert.deepEqual(led.JO1.size_order, ["8","8s"]);
  assert.equal(led.JO1.sizes["8s"].sent, 5);
  assert.equal(led.JO1.sizes["8"].sent, 3);
});

console.log("\nB — in repair is not a shortage");

/* Borrowed from job work, and the reason it matters: reporting the balance as
   a shortage says the goods are lost while they are sitting on the bench. */
test("pairs sent and not yet back are IN REPAIR, not short", () => {
  const led = repairLedger([ev("JO1","8","sent",20), ev("JO1","8","returned",12)]);
  const row = led.JO1.sizes["8"];
  assert.equal(row.sent, 20);
  assert.equal(row.returned, 12);
  assert.equal(row.rejected, 0, "nothing has been written off");
  assert.equal(row.in_repair, 8, "still on the bench");
});

test("a shortage is only what was explicitly rejected", () => {
  const led = repairLedger([ev("JO1","8","sent",20), ev("JO1","8","returned",12), ev("JO1","8","rejected",8)]);
  assert.equal(led.JO1.rejected, 8);
  assert.equal(led.JO1.in_repair, 0, "the bench is clear once everything is accounted for");
});

console.log("\nC — what cannot be recorded");

test("you cannot get back more than you sent", () => {
  const out = validateMovement({order_no:"JO1",size:"8",kind:"returned",qty:9},
                               { already:{ sent:10, returned:5, rejected:0 } });
  assert.equal(out.ok, false);
  assert.match(out.problems[0], /Only 5 pair\(s\).*in repair/);
});

test("you cannot reject more than is in repair", () => {
  assert.equal(validateMovement({order_no:"JO1",size:"8",kind:"rejected",qty:4},
    { already:{ sent:10, returned:8, rejected:0 } }).ok, false, "only 2 are on the bench");
});

/* A pair already on the lorry cannot be pulled back for repair, and the same
   pair cannot be sent twice without coming back first. */
test("you cannot send more than the order still has", () => {
  const out = validateMovement({order_no:"JO1",size:"8",kind:"sent",qty:30},
                               { available:25, already:{ sent:0, returned:0, rejected:0 } });
  assert.equal(out.ok, false);
  assert.match(out.problems[0], /Only 25 pair\(s\)/);
});

test("what is already on the bench counts against what can be sent", () => {
  const out = validateMovement({order_no:"JO1",size:"8",kind:"sent",qty:10},
                               { available:25, already:{ sent:20, returned:0, rejected:0 } });
  assert.equal(out.ok, false, "20 are already in repair, so only 5 remain");
  assert.match(out.problems[0], /Only 5 pair\(s\)/);
});

test("a valid movement comes back cleaned, not just accepted", () => {
  const out = validateMovement({ order_no:" JO1 ", size:" 8s ", kind:"SENT", qty:"12",
                                 on:"2026-09-08", note:"  loose stitch  " },
                               { available:100, already:{} });
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, { order_no:"JO1", size:"8s", kind:"sent", qty:12,
                                on:"2026-09-08", note:"loose stitch" });
});

console.log("\nD — what the dispatch screen needs");

/* Shipping a pair that is being repaired is how a customer receives the very
   shoe that failed inspection. */
test("pairs on the bench are held back from dispatch", () => {
  const led = repairLedger([ev("JO1","8","sent",20), ev("JO1","8","returned",5),
                            ev("JO2","9","sent",4), ev("JO2","9","returned",4)]);
  assert.equal(heldByRepair(led, "JO1"), 15);
  assert.equal(heldByRepair(led, "JO2"), 0, "all back, nothing held");
  assert.equal(heldByRepair(led, "NOSUCH"), 0);
});

test("the factory's whole repair position adds up", () => {
  const led = repairLedger([ev("JO1","8","sent",20), ev("JO1","8","returned",12), ev("JO1","8","rejected",3),
                            ev("JO2","9","sent",10)]);
  assert.deepEqual(repairTotals(led),
    { orders:2, sent:30, returned:12, rejected:3, in_repair:15 });
});

/* "No repairs yet" and "a 0% repair rate" are not the same claim. */
test("the repair rate is null until something has been sent", () => {
  assert.equal(repairRate(repairLedger([]), 1000), null);
  assert.equal(repairRate(repairLedger([ev("JO1","8","sent",50)]), 1000), 5);
  assert.equal(repairRate(repairLedger([ev("JO1","8","sent",50)]), 0), null, "no production, no rate");
});

console.log("\nE — the log is the record");

/* Keeping events rather than totals is what lets the card be reproduced and a
   wrong entry be reversed. */
test("movements accumulate rather than overwrite", () => {
  const led = repairLedger([ev("JO1","8","sent",5,"2026-09-01"),
                            ev("JO1","8","sent",7,"2026-09-03"),
                            ev("JO1","8","returned",4,"2026-09-05")]);
  assert.equal(led.JO1.sizes["8"].sent, 12, "two sends, not the later one winning");
  assert.equal(led.JO1.events, 3);
  assert.equal(led.JO1.in_repair, 8);
});

test("rubbish in the log is skipped, never counted as zero-or-worse", () => {
  const led = repairLedger([ev("JO1","8","sent",10), {}, ev("","8","sent",5),
                            ev("JO1","","sent",5), ev("JO1","8","nonsense",5), ev("JO1","8","sent",-2)]);
  assert.equal(led.JO1.sent, 10, "only the one real movement counted");
  assert.equal(Object.keys(led).length, 1);
});


console.log("\nF — joining repair (per size) to dispatch (per size range)");

const ORDER = { order_no:"JO1", lines:[
  { combo:"6X10", sizes:{ "6s":50, "7s":50 } },
  { combo:"2X5",  sizes:{ "5":40 } },
]};

/* The dispatch screen works in RANGES; repair is recorded per SIZE. They are
   joined through the order's own lines. */
test("held pairs are attributed to the range that contains the size", () => {
  const led = repairLedger([ev("JO1","6s","sent",12), ev("JO1","5","sent",4)]);
  const held = heldByCombo(led, ORDER);
  assert.equal(held.by_combo["6X10"], 12);
  assert.equal(held.by_combo["2X5"], 4);
  assert.equal(held.unattributed, 0);
  assert.equal(held.total, 16);
});

test("what has come back is no longer held", () => {
  const led = repairLedger([ev("JO1","6s","sent",12), ev("JO1","6s","returned",5)]);
  assert.equal(heldByCombo(led, ORDER).by_combo["6X10"], 7, "12 out, 5 back");
});

test("rejected pairs stop being held — they are a shortage, not a hold", () => {
  const led = repairLedger([ev("JO1","6s","sent",12), ev("JO1","6s","rejected",12)]);
  const held = heldByCombo(led, ORDER);
  assert.equal(held.total, 0);
  assert.equal(held.by_combo["6X10"], undefined);
});

/* The record says "8" and two ranges on the order both contain an 8. Charging
   it to whichever was read first would block the wrong range silently. */
test("a size in two ranges is unattributed, not guessed at", () => {
  const twoWays = { order_no:"JO1", lines:[
    { combo:"6X8",  sizes:{ "8":30 } },
    { combo:"8X12", sizes:{ "8":30 } },
  ]};
  const held = heldByCombo(repairLedger([ev("JO1","8","sent",9)]), twoWays);
  assert.deepEqual(held.by_combo, {});
  assert.equal(held.unattributed, 9, "still held, just not against one range");
  assert.equal(held.total, 9, "and never lost from the total");
});

test("a size on no line at all is held at order level", () => {
  const held = heldByCombo(repairLedger([ev("JO1","99","sent",3)]), ORDER);
  assert.equal(held.unattributed, 3);
  assert.equal(held.total, 3);
});

test("an order with nothing in repair holds nothing", () => {
  assert.deepEqual(heldByCombo(repairLedger([]), ORDER), { by_combo:{}, unattributed:0, total:0 });
  assert.deepEqual(heldByCombo({}, undefined), { by_combo:{}, unattributed:0, total:0 });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
/* exitCode, not exit(): process.exit() truncates V8's coverage write. */
process.exitCode = failed ? 1 : 0;
