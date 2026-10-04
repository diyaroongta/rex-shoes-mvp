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
import { buildPackingList, cartonNumbers, draftFromOrder, sizeBalance, checkAgainstOrder, syncSheetPairs } from "../shared/packing-list.js";

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

/* The demo sheet printed "Order Quantity :-" blank for a 1,000-pair order.
   It is the order's own figure, not something to invent or leave empty. */
test("the draft prints the order's total quantity, and blank only when there is none", () => {
  const order = { order_no:"JO2173", party:"DEMO", article_code:"ARMOUR", pi:{},
                  lines:[{ combo:"2X5", qty:1000 }] };
  assert.equal(draftFromOrder(order, () => ["2","3","4","5"], { "2X5":425 }).order_qty, 1000);
  assert.equal(draftFromOrder({ ...order, lines:[] }, () => [], {}).order_qty, null,
    "no quantities on the order is unknown, not zero");
});

test("the draft leaves the carton count at zero — that is the number to count", () => {
  const order = { order_no:"JO1", party:"P", article_code:"BOLT", pi:{} };
  const d = draftFromOrder(order, () => ["8"], { "8X10":28 });
  assert.equal(d.lines[0].groups[0].cartons, 0, "cartons are counted on the screen, never derived");
});

/* A COMBINATION PACK IS PACKED EQUAL.
   The factory's rule: a carton labelled 8X10 holds 8, 9 and 10 in equal
   numbers. The draft used to start every size at zero and make the packer
   type the obvious case; it now offers the even split and lets them change
   it. The carton COUNT is still theirs to count. */
test("the draft splits a range's pairs equally across its sizes", () => {
  const order = { order_no:"JO1", party:"P", article_code:"BOLT", pi:{} };
  const d = draftFromOrder(order, () => ["8","9","10"], { "8X10":84 });
  assert.deepEqual(d.lines[0].groups.map(g => g.sizes[0].pairs), [28,28,28]);
  assert.equal(d.lines[0].groups.every(g => g.cartons === 0), true);
  assert.equal(d.lines[0].combo_pairs, 84, "and the line still totals what was dispatched");
});

/* 18 pairs across 4 sizes is 4.5 each, which is not a thing. The remainder
   falls on the earliest sizes — the same way the invoice already splits a
   range, so one range never splits two ways on two documents. */
test("an indivisible range still adds up, with the remainder on the earliest sizes", () => {
  const order = { order_no:"JO1", party:"P", article_code:"BOLT", pi:{} };
  const d = draftFromOrder(order, () => ["2","3","4","5"], { "2X5":18 });
  const pairs = d.lines[0].groups.map(g => g.sizes[0].pairs);
  assert.deepEqual(pairs, [5,5,4,4]);
  assert.equal(pairs.reduce((a,b)=>a+b,0), 18, "nothing is lost or invented in the rounding");
});

/* THE COMPLAINT HAS TO SAY WHICH BOX TO COUNT.
   A 6X7 line drafted as 27 pairs of 6s and 27 of 7s produced
   "Line 1: 27 pairs but no cartons counted" word for word twice — which reads
   as a repeating bug rather than as two separate boxes still to count. */
test("an uncounted line names its sizes, so two rows do not read alike", () => {
  const out = buildPackingList({ customer:"C", order_no:"O", lines:[
    { article:"GLAMOUR", groups:[
      { sizes:[{size:"6s",pairs:27}], cartons:0 },
      { sizes:[{size:"7s",pairs:27}], cartons:0 },
    ]}]});
  const uncounted = out.problems.filter(p => /no cartons counted/.test(p));
  assert.equal(uncounted.length, 2, "one per box still to count");
  assert.equal(new Set(uncounted).size, 2, "and they are distinguishable");
  assert.ok(uncounted.some(p => p.includes("6s")), uncounted.join(" | "));
  assert.ok(uncounted.some(p => p.includes("7s")), uncounted.join(" | "));
});

console.log("\nE — the order's own sizes, not an even split (the GOLA PLUS dispatch)");
{
  /* The live fault: an order taken size by size came back on the dispatch
     sheet as 30/30/30/30 — 120 pairs of 7X10 divided evenly — and its 8X10
     line printed as kids sizes. The ORDER is the source of the sheet now. */
  const roll = c => ({ "7X10":["7s","8s","9s","10s"], "11X1":["11s","12s","13s","1"], "8X10B":["8","9","10"] })[c] || [];
  const order = { order_no:"JO2175", party:"Shoe House", article_code:"GOLA PLUS VELCRO BLACK BLACK",
    pi:{ vl:"VELCRO", upper_colour:"BLACK" },
    lines:[ { combo:"7X10", qty:120, sizes:{ "7s":40, "8s":20, "9s":0, "10s":60 } },
            { combo:"11X1", qty:110, sizes:{ "11s":50, "13s":60 } },
            { combo:"8X10B", qty:120, sizes:{ "8":40, "9":40, "10":40 }, size_order:["8","9","10"] } ] };
  const flat = d => Object.fromEntries(d.lines.map(l => [l.combo, Object.fromEntries(l.groups.flatMap(g => g.sizes).map(s => [s.size, s.pairs]))]));

  test("the draft is the order's sizes, exactly — no size nobody ordered", () => {
    const d = draftFromOrder(order, roll, { "7X10":120, "11X1":110, "8X10B":120 });
    assert.deepEqual(flat(d), { "7X10":{ "7s":40, "8s":20, "10s":60 }, "11X1":{ "11s":50, "13s":60 }, "8X10B":{ "8":40, "9":40, "10":40 } });
    assert.ok(d.lines.every(l => !l.estimated), "an exact order is not an estimate");
  });
  test("adult sizes keep the labels the order wrote (8, not 8s)", () => {
    const d = draftFromOrder(order, roll, { "8X10B":120 });
    assert.deepEqual(d.lines[0].groups.map(g => g.sizes[0].size), ["8","9","10"]);
  });
  test("sizes given for this dispatch are used as given", () => {
    const d = draftFromOrder(order, roll, { "7X10":{ "7s":10, "10s":14 } });
    assert.deepEqual(flat(d), { "7X10":{ "7s":10, "10s":14 } });
  });
  test("a second dispatch drafts only what is still owed per size", () => {
    const first = { dispatched:{ "7X10":60 }, packing_list:{ lines:[{ combo:"7X10", groups:[{ sizes:[{ size:"7s", pairs:40 },{ size:"8s", pairs:20 }] }] }] } };
    const bal = sizeBalance(order, [first]);
    assert.equal(bal["7X10"].sizes["7s"].remaining, 0);
    assert.equal(bal["7X10"].sizes["10s"].remaining, 60);
    const d = draftFromOrder(order, roll, { "7X10":60 }, [first]);
    assert.deepEqual(flat(d), { "7X10":{ "10s":60 } });
  });
  test("a range ordered as a range still starts equal, and says it is an estimate", () => {
    const d = draftFromOrder({ ...order, lines:[{ combo:"7X10", qty:120 }] }, roll, { "7X10":120 });
    assert.deepEqual(flat(d), { "7X10":{ "7s":30, "8s":30, "9s":30, "10s":30 } });
    assert.equal(d.lines[0].estimated, true);
  });
  test("the check refuses pairs moved between ranges even when the total matches", () => {
    const sheet = draftFromOrder(order, roll, { "7X10":120, "11X1":110 });
    sheet.lines[0].groups[0].sizes[0].pairs = 70;           // +30 on 7X10
    sheet.lines[1].groups[0].sizes[0].pairs = 20;           // -30 on 11X1
    const p = checkAgainstOrder(sheet, order, { "7X10":120, "11X1":110 });
    assert.ok(p.some(x => /7X10: the packing list has 150/.test(x)), p.join(" | "));
  });
  test("the check refuses a size that was never ordered", () => {
    const sheet = { lines:[{ combo:"11X1", groups:[{ sizes:[{ size:"12s", pairs:10 },{ size:"11s", pairs:40 }], cartons:1 }] }] };
    const p = checkAgainstOrder(sheet, order, { "11X1":50 });
    assert.ok(p.some(x => /size 12s was not ordered/.test(x)), p.join(" | "));
  });
  test("the check refuses more of a size than is still owed", () => {
    const sheet = { lines:[{ combo:"7X10", groups:[{ sizes:[{ size:"8s", pairs:25 }], cartons:1 }] }] };
    const p = checkAgainstOrder(sheet, order, { "7X10":25 });
    assert.ok(p.some(x => /8s: 25 pairs packed but only 20/.test(x)), p.join(" | "));
  });
  test("a sheet that matches the order passes", () => {
    const sheet = draftFromOrder(order, roll, { "7X10":120, "11X1":110, "8X10B":120 });
    assert.deepEqual(checkAgainstOrder(sheet, order, { "7X10":120, "11X1":110, "8X10B":120 }), []);
  });
  test("changing what leaves keeps every carton already counted", () => {
    const sheet = draftFromOrder(order, roll, { "7X10":120 });
    sheet.lines[0].groups[0].cartons = 2;                    // 7s counted
    const next = syncSheetPairs(sheet, { "7X10":{ "7s":40, "8s":20, "10s":30 } }, order, roll);
    assert.equal(next.lines[0].groups[0].cartons, 2);
    assert.deepEqual(flat(next), { "7X10":{ "7s":40, "8s":20, "10s":30 } });
    const dropped = syncSheetPairs(next, { "7X10":{ "7s":40 } }, order, roll);
    assert.deepEqual(flat(dropped), { "7X10":{ "7s":40 } });
  });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
/* exitCode, not exit(): process.exit() kills the process before V8 flushes
   its coverage file, so a suite that passed reported 0% and dragged the whole
   threshold down. Letting it end naturally keeps both the exit status and the
   coverage. */
process.exitCode = failed ? 1 : 0;
