/* The Belgaum slip: four headed rows — Gala (V) BLK, (V) WHT, (L) BLK, (L) WHT —
   came back as ONE card on GOLA VELCRO BLACK holding every row's sizes. */
import assert from "node:assert/strict";
import { setReference, matchArticle, matchAmbiguous, readPrompt } from "../shared/bridge.js";
import { buildPhotoCards, remapLine, rekeySizes } from "../shared/intake.js";

let passed = 0, failed = 0;
function test(name, fn){ try { fn(); passed++; console.log("  pass  " + name); } catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); } }

const combos = { "6X10":{rates:{}}, "11X13":{rates:{}}, "1X3":{rates:{}}, "4X5":{rates:{}}, "6X7B":{rates:{}}, "8X10B":{rates:{}}, "11X12B":{rates:{}} };
const art = () => ({ sole_type:"PVC", combo_order:Object.keys(combos), combos:JSON.parse(JSON.stringify(combos)) });
const VB="GOLA VELCRO BLACK BLACK (BLACK SKINFIT)", VW="GOLA VELCRO WHITE WHITE (WHITE SKINFIT)",
      LB="GOLA LACE BLACK BLACK (BLACK SKINFIT)", LW="GOLA LACE WHITE WHITE (WHITE SKINFIT)";
const ref = { articles:{ [VB]:art(), [VW]:art(), [LB]:art(), [LW]:art(), "GOLA PLUS VELCRO BLACK BLACK (BLACK SKINFIT)":art() }, packing:{}, mrp:{} };
setReference(ref);

console.log("\nThe Belgaum Gola slip");
test("each headed row matches its own article: closure from (V)/(L), colour from BLK/WHT", () => {
  assert.equal(matchArticle("Gala (V) BLK", ""), VB);
  assert.equal(matchArticle("Gala (V) WHT", ""), VW);
  assert.equal(matchArticle("Gola (L)", "Black"), LB);
  assert.equal(matchArticle("Gola (L)", "White"), LW);
});
test("'Gola Black' with no closure is FLAGGED, not silently made Velcro", () => {
  assert.equal(matchAmbiguous("Gola", "Black"), true);
  assert.equal(matchAmbiguous("Gola (V)", "Black"), false);
});
test("the correct read gives four cards on four different articles", () => {
  const parsed = { orders:[
    { party:"Belgaum", category:"Gola (V)", color:"Black", stated_cartons:3, lines:[{ sizes:["11"], cartons:3, group:"SMALL", type:"VELCRO" }] },
    { party:"Belgaum", category:"Gola (V)", color:"White", stated_cartons:2, lines:[{ sizes:["11","13"], cartons:1, type:"VELCRO" }, { sizes:["1","3"], cartons:1, type:"VELCRO" }] },
    { party:"Belgaum", category:"Gola (L)", color:"Black", stated_cartons:4, lines:[{ sizes:["5"], cartons:1, type:"LACE" }, { sizes:["4","5"], cartons:1, type:"LACE" }, { sizes:["8","10"], cartons:2, type:"LACE" }] },
    { party:"Belgaum", category:"Gola (L)", color:"White", stated_cartons:5, lines:[{ sizes:["5"], cartons:1, type:"LACE" }, { sizes:["6","7"], cartons:2, type:"LACE" }, { sizes:["8"], cartons:1, type:"LACE" }, { sizes:["11","12"], cartons:1, type:"LACE" }] },
  ] };
  const { cards } = buildPhotoCards(parsed, ref);
  assert.deepEqual(cards.map(c => c.article), [VB, VW, LB, LW]);
  assert.ok(cards.every(c => !c.ambiguous), "nothing left to guess");
});
test("a row that names its own colour and closure splits off even inside one order", () => {
  const parsed = { orders:[{ party:"Belgaum", category:"Gola", color:"Black", lines:[
    { sizes:["11"], cartons:3, type:"VELCRO" }, { sizes:["1","3"], cartons:1, type:"VELCRO", color:"White" }, { sizes:["4","5"], cartons:1, type:"LACE" } ] }] };
  const { cards } = buildPhotoCards(parsed, ref);
  assert.deepEqual(cards.map(c => c.article).sort(), [LB, VB, VW].sort());
});
test("a merged read with nothing to separate the rows is flagged on screen", () => {
  const { cards } = buildPhotoCards({ orders:[{ party:"Belgaum", category:"Gola", color:"Black", lines:[{ sizes:["11","13"], cartons:1 }] }] }, ref);
  assert.equal(cards[0].ambiguous, true);
});
test("the reader is told a headed row is a separate product and (L) after a name is Lace", () => {
  const p = readPrompt([]);
  assert.match(p, /A ROW THAT STARTS WITH ITS OWN PRODUCT HEADING IS A DIFFERENT PRODUCT/);
  assert.match(p, /\(L\) = Lace/);
  assert.match(p, /WORKED EXAMPLE 4/);
});
console.log("\nMoving a line keeps what the slip wrote");
test("changing the product never puts a line on a range by POSITION", () => {
  /* "8X10" read as Small found no range; the card was changed to another Gola
     and the line landed on that article's 7th range, 11X12. */
  const line = { combo:null, exact:false, raw:"8X10", size_order:["8s","10s"], cartons:2, qty:0 };
  const moved = remapLine(line, VB);
  assert.notEqual(moved.combo, "11X12B");
  assert.equal(moved.combo, null, "no Small 8-10 range on this article: left for the clerk");
});
test("a written range moves to the new article's range with the same endpoints", () => {
  const moved = remapLine({ combo:null, raw:"8X10", size_order:["8","9","10"], cartons:2 }, LB);
  assert.equal(moved.combo, "8X10B");
  assert.equal(moved.exact, true);
});
test("a single size keeps its pairs on that size — no even split across the range", () => {
  const moved = remapLine({ combo:"11X13", exact:true, raw:"11", sizes:{ "11s":54 }, size_order:["11s","12s","13s"], cartons:3, qty:54 }, LB);
  assert.equal(moved.combo, "11X13");
  assert.deepEqual(moved.sizes, { "11s":54 });
});
test("re-picking the rate basis re-spells the sizes and never drops them", () => {
  assert.deepEqual(rekeySizes({ "11":54 }, ["11s","12s","13s"]), { sizes:{ "11s":54 }, stranded:[] });
  assert.deepEqual(rekeySizes({ "8":20 }, ["11s","12s"]).stranded, ["8"]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
