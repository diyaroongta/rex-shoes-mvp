/* Finished goods: the ledger, the stock cards, and "is it already made?". */
import assert from "node:assert/strict";
import { validateMoves, finishedStock, stockForOrder, mtoStock } from "../shared/finished-stock.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

console.log("\nFinished stock — the ledger");
test("the sign follows the kind: 'issued 40' can never add 40", () => {
  const { rows, problems } = validateMoves([{ article:"SPIKE", size:"8s", kind:"issued", qty:40, order_no:"JO1" }]);
  assert.deepEqual(problems, []);
  assert.equal(rows[0].qty, -40);
});
test("an adjustment keeps the sign it was entered with", () => {
  assert.equal(validateMoves([{ article:"A", size:"8s", kind:"adjust", qty:-12 }]).rows[0].qty, -12);
});
test("a movement with no size, no article, a zero or an unknown kind is refused", () => {
  const { problems } = validateMoves([{ article:"A", kind:"opening", qty:5 }, { size:"8s", kind:"opening", qty:5 },
    { article:"A", size:"8s", kind:"opening", qty:0 }, { article:"A", size:"8s", kind:"stolen", qty:2 }]);
  assert.equal(problems.length, 4);
});
test("on hand sums the ledger AND the stock job cards, per size", () => {
  const moves = [{ article:"SPIKE", size:"8s", qty:100 }, { article:"SPIKE", size:"8s", qty:-30 }, { article:"SPIKE", size:"9s", qty:20 }];
  const jobs = [{ order_no:null, article:"SPIKE", qty:50, received:50, status:"closed", card:{ lines:[{ sizes:{ "9s":50 } }] } },
                { order_no:"JO1", article:"SPIKE", qty:500, received:500 }];   // a customer's card is not stock
  const s = finishedStock(moves, jobs);
  const spike = s.articles.find(a => a.article === "SPIKE");
  assert.deepEqual(Object.fromEntries(spike.size_list.map(x => [x.size, x.pairs])), { "8s":70, "9s":70 });
  assert.equal(spike.total, 140);
});
test("more issued than ever came in is reported, not floored", () => {
  const s = finishedStock([{ article:"A", size:"8s", qty:-5 }], []);
  assert.deepEqual(s.articles[0].negative, ["8s"]);
});

console.log("\nFinished stock — asked before a duplicate job card");
const stock = finishedStock([{ article:"SPIKE", size:"8s", qty:30 }, { article:"SPIKE", size:"10s", qty:100 }], []);
test("sizes on the shelf are matched to the sizes ordered", () => {
  const r = stockForOrder(stock, "SPIKE", [{ combo:"7X10S", qty:80, sizes:{ "8s":40, "9s":0, "10s":40 } }]);
  assert.equal(r.any, true);
  assert.deepEqual(r.sizes.map(x => [x.size, x.wanted, x.on_hand, x.cover]), [["8s",40,30,30],["10s",40,100,40]]);
  assert.equal(r.covered, 70);
});
test("a range ordered as a range is matched against the range's sizes", () => {
  const r = stockForOrder(stock, "SPIKE", [{ combo:"7X10S", qty:240 }], () => ["7s","8s","9s","10s"]);
  assert.equal(r.any, true);
  assert.equal(r.sizes[0].wanted, null, "the size breakdown is unknown, so nothing is claimed");
});
test("nothing on the shelf says so", () => {
  assert.equal(stockForOrder(stock, "JILL", [{ combo:"2X5", qty:10, sizes:{ "2":10 } }]).any, false);
});

console.log("\nMTO stock — packed and not yet shipped");
test("ready = packed (less rejections) minus shipped, MTO orders only", () => {
  const orders = [{ order_no:"JO1", party:"P", article_code:"A", pi:{ order_nature:"MTO" }, lines:[{ combo:"X", qty:500 }] },
                  { order_no:"JO2", party:"Q", article_code:"A", pi:{ order_nature:"MTS" }, lines:[{ combo:"X", qty:500 }] }];
  const actuals = [{ order_no:"JO1", stage:"PACKING", actual_pairs:300, rejected_pairs:20 },
                   { order_no:"JO1", stage:"CUTTING", actual_pairs:500 }];
  const r = mtoStock(orders, actuals, [{ order_no:"JO1", dispatched:{ X:100 } }]);
  assert.equal(r.rows.length, 1);
  assert.deepEqual([r.rows[0].packed, r.rows[0].dispatched, r.rows[0].ready, r.rows[0].to_make], [280, 100, 180, 220]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
