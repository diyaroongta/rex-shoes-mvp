/* The gate pass slip, reproduced from the factory's own book (SR. No 15945).
   It is built from the packing list that travels with the same lorry, so the
   two can never disagree at the customer's gate. */
import assert from "node:assert/strict";
import { buildGatePass, gatePassRows } from "../shared/gate-pass.js";
import { buildPackingList } from "../shared/packing-list.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

/* Gola Plus, from the photographed slip: sizes 7 and 7-9 at MRP 679 packed 24
   to a carton, the 1X3 and 4X5 ranges at 799 packed 18. */
const MRP  = { "7":679, "9":679, "1":799, "3":799, "4":799, "5":799 };
const PACK = { "7":24,  "9":24,  "1":18,  "3":18,  "4":18,  "5":18 };
const opts = { mrpFor:size => MRP[size] ?? null, packFor:size => PACK[size] ?? null };

const sheet = { customer:"Pawan Mkt", order_no:"PI/435", lines:[{
  article:"GOLA PLUS", closure:"VEL", colour:"BLK",
  groups:[
    { sizes:[{ size:"7", pairs:48 }], cartons:2 },
    { sizes:[{ size:"9", pairs:24 }], cartons:1 },
    { sizes:[{ size:"1", pairs:234 }], cartons:13 },
    { sizes:[{ size:"3", pairs:18 }, { size:"4", pairs:18 }], cartons:1 },
  ],
}]};

console.log("\nA — the rows the gate checks");
test("one row per size, numbered down the slip", () => {
  const built = buildPackingList(sheet);
  const rows = gatePassRows(built, opts);
  assert.deepEqual(rows.map(r => [r.sno, r.size, r.pairs]),
    [[1,"7",48],[2,"9",24],[3,"1",234],[4,"3",18],[5,"4",18]]);
});
test("a carton count is written ONCE against the sizes that share the box", () => {
  const rows = gatePassRows(buildPackingList(sheet), opts);
  assert.deepEqual(rows.map(r => r.cartons), [2,1,13,1,null],
    "repeating the count on the second size would treble the cartons at the gate");
  assert.deepEqual(rows.map(r => r.carton_numbers), ["1-2","3","4-16","17",null]);
  assert.deepEqual(rows.map(r => r.mixed), [false,false,false,true,true]);
});
test("MRP and standard pack come off the master, per size", () => {
  const rows = gatePassRows(buildPackingList(sheet), opts);
  assert.deepEqual(rows.map(r => [r.mrp, r.std_pack]),
    [[679,24],[679,24],[799,18],[799,18],[799,18]]);
});

console.log("\nB — what it refuses to make up");
test("the serial number is typed from the book, never generated", () => {
  const pass = buildGatePass({ packing_list:buildPackingList(sheet), ...opts });
  assert.equal(pass.serial_no, "", "a number we invent would compete with the printed pad");
  const numbered = buildGatePass({ packing_list:buildPackingList(sheet), serial_no:"15945", ...opts });
  assert.equal(numbered.serial_no, "15945");
});
test("a missing MRP prints blank and is COUNTED, never zero", () => {
  const built = buildPackingList(sheet);
  const pass = buildGatePass({ packing_list:built, mrpFor:() => null, packFor:() => null });
  assert.equal(pass.rows[0].mrp, null, "zero would tell the gate the shoes are free");
  assert.equal(pass.missing_mrp, 5);
  assert.equal(pass.missing_pack, 5);
});

console.log("\nC — it cannot disagree with the lorry");
test("totals match the packing list exactly", () => {
  const built = buildPackingList(sheet);
  const pass = buildGatePass({ packing_list:built, party:"Pawan Mkt", city:"Mumbai",
    transporter:"A.B.C. Transport", serial_no:"15945", ...opts });
  assert.equal(pass.total_pairs, 342);
  assert.equal(pass.total_cartons, 17);
  assert.equal(pass.total_pairs, built.total_pairs);
  assert.equal(pass.total_cartons, built.total_cartons);
  assert.deepEqual(pass.problems, []);
  assert.equal(pass.ok, true);
  assert.equal(pass.party, "Pawan Mkt");
  assert.equal(pass.transporter, "A.B.C. Transport");
});
test("a sheet edited underneath it is reported, not printed quietly", () => {
  const built = buildPackingList(sheet);
  const pass = buildGatePass({ packing_list:{ ...built, total_pairs:400 }, ...opts });
  assert.equal(pass.ok, false);
  assert.match(pass.problems[0], /342 pairs and the packing list says 400/);
});
test("an empty shipment is empty, not an error", () => {
  const pass = buildGatePass({});
  assert.deepEqual(pass.rows, []);
  assert.equal(pass.total_pairs, 0);
  assert.equal(pass.ok, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
