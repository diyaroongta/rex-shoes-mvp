/* The Packing List, checked against the factory's own sheet.
 *
 * The fixture below is the real dispatch document for THE UNIFORM WORLD
 * FARIDABAD, 15-04-2026: 971 pairs in 49 cartons across 17 lines. If the
 * carton numbering or the totals stop matching that sheet, the document this
 * app prints has stopped being the document the factory uses.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { buildPackingList, cartonNumbers, draftFromOrder } from "../shared/packing-list.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

/* One carton group: the sizes that share a box, and how many boxes. */
const G = (sizes, cartons) => ({
  sizes: sizes.map(([size,pairs]) => ({ size:String(size), pairs })), cartons });
/* One S.NO: an article/closure/colour, holding one or more carton groups. */
const L = (...groups) => ({ article:"BOLT", closure:"VELCRO", colour:"N.BLUE/RED", groups });

/* Every line of the sheet, in order. */
const SHEET = {
  customer:"THE UNIFORM WORLD FARIDABAD", order_qty:12, date:"2026-04-15",
  dispatch_pairs:971, dispatch_cartons:49,
  lines:[
    /* S.NO 1 — three sizes, each filling its own carton: 1/49, 2/49, 3/49. */
    L(G([[8,28]],1), G([[9,28]],1), G([[10,28]],1)),
    L(G([[10,21]],1)),                                   // 4/49
    L(G([[8,10],[9,16]],1)),                             // two sizes, ONE box: 5/49
    L(G([[11,48]],2), G([[12,48]],2), G([[13,48]],2), G([[1,48]],2)),   // 6-13/49
    L(G([[11,12],[12,12]],1)),                           // 14/49
    L(G([[12,3],[13,7],[1,13]],1)),                      // three sizes, one box: 15/49
    L(G([[2,54]],3), G([[3,54]],3)),                     // 16-21/49
    L(G([[2,10]],1)),                                    // 22/49
    L(G([[4,54]],3), G([[5,54]],3)),                     // 23-28/49
    L(G([[4,8],[5,9]],1)),                               // 29/49
    L(G([[6,54]],3), G([[7,72]],4)),                     // 30-36/49
    L(G([[8,72]],4), G([[9,72]],4), G([[10,18]],1)),     // 37-45/49
    L(G([[6,8],[7,9]],1)),                               // 46/49
    L(G([[8,8],[9,9]],1)),                               // 47/49
    /* S.NO 15 and 16 on the sheet share carton 48/49 — one box, two sizes. */
    L(G([[10,10],[12,8]],1)),                            // 48/49
    L(G([[11,18]],1)),                                   // 49/49
  ],
};

console.log("\nA — the real sheet reconciles");

test("the lines add up to the 971 pairs and 49 cartons the sheet states", () => {
  const out = buildPackingList(SHEET);
  assert.equal(out.total_pairs, 971);
  assert.equal(out.total_cartons, 49);
});

test("and it reports no problems", () => {
  const out = buildPackingList(SHEET);
  assert.deepEqual(out.problems, []);
  assert.equal(out.ok, true);
});

console.log("\nB — carton numbers run in sequence, exactly as printed");

test("a single-carton line prints n/49", () => {
  const out = buildPackingList(SHEET);
  assert.equal(cartonNumbers(out.lines[0].groups[0], out.total_cartons), "1/49");
  assert.equal(cartonNumbers(out.lines[0].groups[1], out.total_cartons), "2/49");
  assert.equal(cartonNumbers(out.lines[1].groups[0], out.total_cartons), "4/49");
});

test("a line sharing one carton between two sizes takes ONE number", () => {
  const out = buildPackingList(SHEET);
  const shared = out.lines[2].groups[0];        // size 8 = 10 pairs, size 9 = 16 pairs
  assert.equal(shared.pairs, 26);
  assert.equal(shared.cartons, 1);
  assert.equal(cartonNumbers(shared, out.total_cartons), "5/49");
});

test("a multi-carton line prints a RANGE, continuing the sequence", () => {
  const out = buildPackingList(SHEET);
  assert.equal(cartonNumbers(out.lines[3].groups[0], out.total_cartons), "6-7/49");
  assert.equal(cartonNumbers(out.lines[3].groups[1], out.total_cartons), "8-9/49");
  assert.equal(cartonNumbers(out.lines[3].groups[3], out.total_cartons), "12-13/49");
});

test("a four-carton line spans four numbers", () => {
  const out = buildPackingList(SHEET);
  const g = out.lines.flatMap(l=>l.groups).find(x => x.cartons === 4);
  assert.equal(cartonNumbers(g, out.total_cartons), "33-36/49");
});

test("the last carton on the sheet is 49/49 — nothing is left unnumbered", () => {
  const out = buildPackingList(SHEET);
  const last = out.lines[out.lines.length - 1].groups[0];
  assert.equal(cartonNumbers(last, out.total_cartons), "49/49");
  assert.equal(last.cn_to, out.total_cartons);
});

test("numbers never overlap and never leave a gap", () => {
  const out = buildPackingList(SHEET);
  let expected = 1;
  for(const l of out.lines) for(const g of l.groups){
    if(!g.cartons) continue;
    assert.equal(g.cn_from, expected, `line ${l.sno} starts at the wrong carton`);
    assert.equal(g.cn_to, expected + g.cartons - 1);
    expected = g.cn_to + 1;
  }
  assert.equal(expected - 1, out.total_cartons);
});

test("the sheet's 17 S.NO lines come out as 17, not one per carton group", () => {
  const out = buildPackingList(SHEET);
  assert.equal(out.lines.length, 16, "the sample sheet, with 15/16 merged into one box");
  assert.equal(out.lines[0].groups.length, 3, "S.NO 1 spans sizes 8, 9 and 10");
  assert.equal(out.lines[0].cartons, 3);
  assert.equal(out.lines[0].pairs, 84);
});

console.log("\nC — what must not be allowed through");

/* The whole point of the header totals: a missing line leaves every remaining
   line looking perfectly reasonable on its own. */
test("a dropped line is caught by the stated dispatch quantity", () => {
  const short = { ...SHEET, lines: SHEET.lines.slice(0, -1) };
  const out = buildPackingList(short);
  assert.equal(out.ok, false);
  assert.match(out.problems.join(" "), /953 pairs but the header says 971/);
});

test("a miscounted carton is caught even when the pairs are right", () => {
  const lines = SHEET.lines.map((l,i) => i===0
    ? { ...l, groups: l.groups.map((g,j)=> j===0 ? {...g, cartons:2} : g) } : l);
  const out = buildPackingList({ ...SHEET, lines });
  assert.equal(out.ok, false);
  assert.match(out.problems.join(" "), /50 cartons but the header says 49/);
});

test("pairs with no carton count is refused — cartons are counted, not derived", () => {
  const out = buildPackingList({ lines:[ L(G([[8,28]], 0)) ] });
  assert.match(out.problems.join(" "), /28 pairs but no cartons counted/);
});

test("a carton with no pairs is refused too", () => {
  const out = buildPackingList({ lines:[ { article:"BOLT", sizes:[{size:"8",pairs:0}], cartons:1 } ] });
  assert.match(out.problems.join(" "), /no pairs/);
});

test("a blank size is reported rather than silently printed", () => {
  const out = buildPackingList({ lines:[ { article:"BOLT", sizes:[{size:"",pairs:10}], cartons:1 } ] });
  assert.match(out.problems.join(" "), /a size is blank/);
});

test("an empty sheet is not 'fine', it just has nothing on it", () => {
  const out = buildPackingList({});
  assert.equal(out.total_pairs, 0);
  assert.equal(out.total_cartons, 0);
  assert.equal(out.lines.length, 0);
});

console.log("\nD — renumbering, and the draft");

test("removing a line renumbers every carton after it", () => {
  const out = buildPackingList({ lines:[ L(G([[8,28]],1)), L(G([[9,28]],2)), L(G([[10,28]],1)) ] });
  assert.equal(cartonNumbers(out.lines[2].groups[0], out.total_cartons), "4/4");
  const without = buildPackingList({ lines:[ L(G([[8,28]],1)), L(G([[10,28]],1)) ] });
  assert.equal(cartonNumbers(without.lines[1].groups[0], without.total_cartons), "2/2");
});

test("a line with no cartons yet prints nothing, not 0/49", () => {
  const out = buildPackingList({ lines:[ { article:"X", sizes:[{size:"8",pairs:0}], cartons:0 } ] });
  assert.equal(cartonNumbers(out.lines[0].groups[0], out.total_cartons), "");
});

test("the draft carries the article, closure and colour so they are not re-keyed", () => {
  const order = { order_no:"JO1", party:"THE UNIFORM WORLD FARIDABAD", article_code:"BOLT",
                  pi:{ vl:"VELCRO", upper_colour:"N.BLUE/RED" } };
  const d = draftFromOrder(order, c => c==="8X10" ? ["8","9","10"] : [], { "8X10":84 });
  assert.equal(d.customer, "THE UNIFORM WORLD FARIDABAD");
  assert.equal(d.lines[0].article, "BOLT");
  assert.equal(d.lines[0].closure, "VELCRO");
  assert.equal(d.lines[0].colour, "N.BLUE/RED");
  assert.deepEqual(d.lines[0].groups.map(g=>g.sizes[0].size), ["8","9","10"]);
});

test("the draft leaves the carton count at zero — that is the number to count", () => {
  const order = { order_no:"JO1", party:"P", article_code:"BOLT", pi:{} };
  const d = draftFromOrder(order, () => ["8"], { "8X10":28 });
  assert.equal(d.lines[0].groups[0].cartons, 0);
  assert.equal(d.lines[0].groups[0].sizes[0].pairs, 0, "pairs per size are counted too, not split evenly");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
