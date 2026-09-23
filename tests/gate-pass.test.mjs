/* The gate pass slip, from the factory's own book (SR. No 15941, STRIKE (V)).
   One arithmetic rule governs the whole sheet: PAIRS = CARTON x STD. PAC. —
   including on a mixed box, where the std. pac. column holds what that one box
   actually carries. */
import assert from "node:assert/strict";
import { buildGatePass, gatePassRows, describeGroup, pairsFromCartons } from "../shared/gate-pass.js";
import { buildPackingList } from "../shared/packing-list.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

console.log("\nA — pairs come from the cartons and the pack");
test("one carton at ten to a pack is ten pairs", () => {
  assert.equal(pairsFromCartons(1, 10), 10);
  assert.equal(pairsFromCartons(2, 18), 36);     // their row 3
  assert.equal(pairsFromCartons(1, 21), 21);     // their row 2
});
test("an unknown pack gives no pairs at all, rather than none", () => {
  assert.equal(pairsFromCartons(3, null), null);
  assert.equal(pairsFromCartons(null, 18), null);
});
test("a full carton of one size packs at the article's own rate", () => {
  const g = describeGroup({ sizes:[{ size:"1", pairs:10 }], cartons:1 },
                          { packFor:() => 10 });
  assert.equal(g.mixed, false);
  assert.equal(g.std_pack, 10);
  assert.equal(g.pairs, 10);
  assert.equal(g.mismatch, false);
});

console.log("\nB — the mixed carton, their row 4");
test("one box of sizes 2, 3 and 5 reads 17 pairs at a std. pac. of 17", () => {
  /* 2 pairs of size 2, 5 of size 3, 10 of size 5, all in ONE carton. */
  const g = describeGroup({ cartons:1, sizes:[
    { size:"2", pairs:2 }, { size:"3", pairs:5 }, { size:"5", pairs:10 }] });
  assert.equal(g.mixed, true);
  assert.equal(g.pairs, 17);
  assert.equal(g.std_pack, 17, "a mixed box packs at whatever was put in it");
  assert.equal(pairsFromCartons(g.cartons, g.std_pack), 17, "the sheet's own arithmetic still holds");
  assert.equal(g.contents, "2 x 2, 3 x 5, 5 x 10");
  assert.equal(g.size_label, "2, 3, 5");
});
test("the carton count is written ONCE for the box, not on every size in it", () => {
  const built = buildPackingList({ lines:[{ article:"STRIKE", closure:"VEL", colour:"WHT", groups:[
    { sizes:[{ size:"6", pairs:18 }], cartons:1 },
    { cartons:1, sizes:[{ size:"6", pairs:12 }, { size:"4", pairs:10 }, { size:"10", pairs:3 }] },
  ]}]});
  const rows = gatePassRows(built, {});
  assert.deepEqual(rows.map(r => r.cartons), [1, 1],
    "three sizes sharing a box are ONE row carrying ONE carton");
  assert.equal(rows[1].mixed, true);
  assert.deepEqual(rows[1].breakdown.map(s => [s.size, s.pairs]), [["6",12],["4",10],["10",3]]);
  assert.equal(rows[1].pairs, 25);
  assert.equal(rows[1].std_pack, 25);
});

console.log("\nC — the client's own dispatch example");
/* "3 cartons of size 2, 3 of size 3, 3 of size 4 and 3 of size 5" ordered;
   dispatch 10 full cartons of the 2X5 range plus ONE mixed carton holding
   2 pairs of size 2, 4 of size 3, 6 of size 4 and 1 of size 5. */
const sheet = { customer:"Deiom India", order_no:"PI/511", lines:[{
  article:"STRIKE", closure:"VEL", colour:"WHT", combo:"2X5", groups:[
    { sizes:[{ size:"2", pairs:54 }], cartons:3 },
    { sizes:[{ size:"3", pairs:54 }], cartons:3 },
    { sizes:[{ size:"4", pairs:36 }], cartons:2 },
    { sizes:[{ size:"5", pairs:36 }], cartons:2 },
    { cartons:1, sizes:[{ size:"2", pairs:2 }, { size:"3", pairs:4 },
                        { size:"4", pairs:6 }, { size:"5", pairs:1 }] },
  ]}]};

test("ten full cartons and one mixed carton add up on the slip", () => {
  const built = buildPackingList(sheet);
  const pass = buildGatePass({ packing_list:built, party:"Deiom India", serial_no:"15941",
                               packFor:() => 18, mrpFor:() => 1499 });
  assert.equal(pass.total_cartons, 11, "ten full boxes and the mixed one");
  assert.equal(pass.mixed_cartons, 1);
  assert.equal(pass.total_pairs, 180 + 13);
  assert.deepEqual(pass.problems, []);
  const mixed = pass.rows.find(r => r.mixed);
  assert.equal(mixed.pairs, 13);
  assert.equal(mixed.std_pack, 13);
  assert.equal(mixed.contents, "2 x 2, 3 x 4, 4 x 6, 5 x 1");
});
test("the full rows carry the article's pack and its MRP", () => {
  const pass = buildGatePass({ packing_list:buildPackingList(sheet),
                               packFor:() => 18, mrpFor:() => 1499 });
  const full = pass.rows.filter(r => !r.mixed);
  assert.deepEqual(full.map(r => [r.cartons, r.std_pack, r.pairs]),
    [[3,18,54],[3,18,54],[2,18,36],[2,18,36]]);
  assert.deepEqual(full.map(r => r.mrp), [1499,1499,1499,1499]);
});

console.log("\nD — what it refuses to make up");
test("a counted figure that disagrees with the pack is REPORTED, not resolved", () => {
  /* 3 cartons at 18 is 54, and the packer counted 50. Somebody has to look. */
  const built = buildPackingList({ lines:[{ article:"STRIKE",
    groups:[{ sizes:[{ size:"2", pairs:50 }], cartons:3 }] }]});
  const pass = buildGatePass({ packing_list:built, packFor:() => 18 });
  assert.equal(pass.ok, false);
  assert.match(pass.problems[0], /3 carton\(s\) at 18 a pack is 54 pairs, but 50 were counted/);
  assert.equal(pass.rows[0].pairs, 50, "the counted figure is what prints — it is what was packed");
});
test("no pack quantity on record prints blank and is counted, never zero", () => {
  const built = buildPackingList({ lines:[{ article:"NEW",
    groups:[{ sizes:[{ size:"5.5", pairs:0 }], cartons:1 }] }]});
  const pass = buildGatePass({ packing_list:built, packFor:() => null, mrpFor:() => null });
  assert.equal(pass.rows[0].std_pack, null);
  assert.equal(pass.rows[0].pack_unknown, true);
  assert.equal(pass.missing_pack, 1);
  assert.equal(pass.missing_mrp, 1);
});
test("the serial number is typed from the book, never generated", () => {
  const pass = buildGatePass({ packing_list:buildPackingList(sheet) });
  assert.equal(pass.serial_no, "");
  assert.equal(buildGatePass({ packing_list:buildPackingList(sheet), serial_no:"15941" }).serial_no, "15941");
});
test("an empty shipment is empty, not an error", () => {
  const pass = buildGatePass({});
  assert.deepEqual(pass.rows, []);
  assert.equal(pass.total_pairs, 0);
  assert.equal(pass.ok, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
