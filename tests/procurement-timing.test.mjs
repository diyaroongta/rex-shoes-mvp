/* When a shortfall bites, not just how big it is. Run: npm test */
import assert from "node:assert/strict";
import { stagesUsingMaterial, neededBy, buyingList, daysBetween, urgencyOf }
  from "../shared/procurement-timing.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

/* Shaped like the live article master: rates per stage, per size range. */
const SPIKE = { combos: { "6X8": { rates: {
  CUTTING:   { 'REXINE 54"||MTR': 0.5, "INSOLE||PAIR": 1 },
  STITCHING: { "THREAD||MTR": 20 },
  MOLDING:   { "SOLE EVA||PAIR": 1 },
  PACKING:   { "INNER||PCS": 1, 'REXINE 54"||MTR': 0.01 },
} } } };

const order = (order_no, article_code, release_date, stages) =>
  ({ order_no, article_code, release_date, stages });

const STAGES = [
  { stage:"CUTTING",   start_date:"2026-09-10" },
  { stage:"STITCHING", start_date:"2026-09-14" },
  { stage:"MOLDING",   start_date:"2026-09-20" },
  { stage:"PACKING",   start_date:"2026-09-24" },
];

const short = (material_key, name, shortfall, uom="MTR") => ({ material_key, name, shortfall, uom });

console.log("\nA — which stage eats which material");

/* Read off the BOM, never assumed. A SOLE is a MOLDING material and an INNER a
   PACKING one; dating either from the day cutting starts buys them weeks early. */
test("stages are read from the BOM rates", () => {
  const map = stagesUsingMaterial(SPIKE);
  assert.deepEqual([...map["INSOLE||PAIR"]], ["CUTTING"]);
  assert.deepEqual([...map["SOLE EVA||PAIR"]], ["MOLDING"]);
  assert.deepEqual([...map["INNER||PCS"]], ["PACKING"]);
});

test("a material used at two stages lists both", () => {
  const map = stagesUsingMaterial(SPIKE);
  assert.deepEqual([...map['REXINE 54"||MTR']].sort(), ["CUTTING","PACKING"]);
});

test("an article with no BOM produces no mapping rather than throwing", () => {
  assert.deepEqual(stagesUsingMaterial(undefined), {});
  assert.deepEqual(stagesUsingMaterial({}), {});
});

console.log("\nB — the date a shortfall actually bites");

test("a shortfall is dated by the stage that consumes it", () => {
  const orders = [order("JO1","SPIKE","2026-09-10",STAGES)];
  const byOrder = { JO1: { short: [ short("SOLE EVA||PAIR","SOLE EVA",100,"PAIR"),
                                    short("INSOLE||PAIR","INSOLE",50,"PAIR") ] } };
  const t = neededBy(byOrder, orders, { SPIKE });
  assert.equal(t["INSOLE||PAIR"].needed_on, "2026-09-10", "cutting");
  assert.equal(t["INSOLE||PAIR"].stage, "CUTTING");
  assert.equal(t["SOLE EVA||PAIR"].needed_on, "2026-09-20", "molding, ten days later");
  assert.equal(t["SOLE EVA||PAIR"].stage, "MOLDING");
});

/* Used at two stages, it is needed at the FIRST of them. */
test("the earliest consuming stage wins", () => {
  const orders = [order("JO1","SPIKE","2026-09-10",STAGES)];
  const byOrder = { JO1: { short: [ short('REXINE 54"||MTR','REXINE 54"',900) ] } };
  const t = neededBy(byOrder, orders, { SPIKE });
  assert.equal(t['REXINE 54"||MTR'].needed_on, "2026-09-10", "cutting, not packing");
  assert.equal(t['REXINE 54"||MTR'].stage, "CUTTING");
});

/* A material whose stage cannot be found is still needed by the time the order
   starts. Early is the safe direction to be wrong in when buying. */
test("an unmappable material falls back to the release date", () => {
  const orders = [order("JO1","SPIKE","2026-09-10",STAGES)];
  const byOrder = { JO1: { short: [ short("MYSTERY GLUE||LTR","MYSTERY GLUE",5,"LTR") ] } };
  const t = neededBy(byOrder, orders, { SPIKE });
  assert.equal(t["MYSTERY GLUE||LTR"].needed_on, "2026-09-10");
  assert.equal(t["MYSTERY GLUE||LTR"].stage, "", "and it does not claim a stage it never found");
});

/* Orders arrive in queue sequence, but a re-sequenced queue can put a later
   order in front — the EARLIEST date must win, not the first one seen. */
test("the earliest need wins even from a later order in the queue", () => {
  const orders = [
    order("JO1","SPIKE","2026-10-01",[{stage:"CUTTING",start_date:"2026-10-01"}]),
    order("JO2","SPIKE","2026-09-05",[{stage:"CUTTING",start_date:"2026-09-05"}]),
  ];
  const byOrder = { JO1:{ short:[short("INSOLE||PAIR","INSOLE",10,"PAIR")] },
                    JO2:{ short:[short("INSOLE||PAIR","INSOLE",10,"PAIR")] } };
  const t = neededBy(byOrder, orders, { SPIKE });
  assert.equal(t["INSOLE||PAIR"].needed_on, "2026-09-05");
  assert.equal(t["INSOLE||PAIR"].order_no, "JO2");
});

test("an order with nothing short contributes nothing", () => {
  const orders = [order("JO1","SPIKE","2026-09-10",STAGES)];
  assert.deepEqual(neededBy({ JO1:{ short:[] } }, orders, { SPIKE }), {});
  assert.deepEqual(neededBy({}, orders, { SPIKE }), {});
});

console.log("\nC — the buying list, most urgent first");

const PROC = [
  { material_key:"INSOLE||PAIR",   name:"INSOLE",   uom:"PAIR", shortfall:50 },
  { material_key:"SOLE EVA||PAIR", name:"SOLE EVA", uom:"PAIR", shortfall:9000 },
  { material_key:"NODATE||PCS",    name:"NODATE",   uom:"PCS",  shortfall:400 },
  { material_key:"COVERED||MTR",   name:"COVERED",  uom:"MTR",  shortfall:0 },
];
const TIMING = {
  "INSOLE||PAIR":   { needed_on:"2026-09-10", order_no:"JO1", stage:"CUTTING" },
  "SOLE EVA||PAIR": { needed_on:"2026-09-20", order_no:"JO1", stage:"MOLDING" },
};

/* The whole point: a small shortfall needed tomorrow outranks a huge one due in
   three weeks. Sorted by quantity, these come out backwards. */
test("urgency beats size", () => {
  const rows = buyingList(PROC, TIMING, "2026-09-08");
  assert.deepEqual(rows.map(r => r.name), ["INSOLE","SOLE EVA","NODATE"]);
  assert.equal(rows[0].shortfall, 50, "50 pairs needed in 2 days beats 9,000 needed in 12");
});

test("what is already covered is not on a buying list", () => {
  assert.equal(buyingList(PROC, TIMING, "2026-09-08").some(r => r.name === "COVERED"), false);
});

/* "No date" and "due in 999 days" are different claims and must not sort
   together — an undated shortfall is real but cannot be scheduled. */
test("an undated shortfall sits below the dated ones, and says so", () => {
  const rows = buyingList(PROC, TIMING, "2026-09-08");
  const last = rows[rows.length - 1];
  assert.equal(last.name, "NODATE");
  assert.equal(last.needed_on, "");
  assert.equal(last.days_until, null, "not 0, and not a large number");
  assert.equal(urgencyOf(last), "undated");
});

test("days until, and what is already late", () => {
  const rows = buyingList(PROC, TIMING, "2026-09-08");
  assert.equal(rows[0].days_until, 2);
  assert.equal(rows[0].overdue, false);
  const late = buyingList(PROC, TIMING, "2026-09-15");
  assert.equal(late[0].days_until, -5);
  assert.equal(late[0].overdue, true);
  assert.equal(urgencyOf(late[0]), "overdue");
});

test("urgency is coarse on purpose", () => {
  assert.equal(urgencyOf({ needed_on:"2026-09-10", days_until:2 }), "urgent");
  assert.equal(urgencyOf({ needed_on:"2026-09-30", days_until:22 }), "planned");
  assert.equal(urgencyOf({ needed_on:"2026-09-10", days_until:9 }, 14), "urgent",
    "a longer lead time makes more of it urgent");
});

console.log("\nD — dates");

test("whole days, in UTC on both sides", () => {
  assert.equal(daysBetween("2026-09-08","2026-09-10"), 2);
  assert.equal(daysBetween("2026-09-10","2026-09-08"), -2);
  assert.equal(daysBetween("2026-09-08","2026-09-08"), 0);
  /* Across a daylight-saving boundary, a local-time subtraction gives 6.96 days
     and rounds to the wrong side. */
  assert.equal(daysBetween("2026-03-27","2026-04-03"), 7);
  assert.equal(daysBetween("rubbish","2026-09-10"), null);
  assert.equal(daysBetween("", ""), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
/* exitCode, not exit(): process.exit() truncates V8's coverage write. */
process.exitCode = failed ? 1 : 0;
