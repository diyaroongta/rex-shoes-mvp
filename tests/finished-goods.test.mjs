import assert from "node:assert/strict";
import { finishedGoods, onHandFor } from "../shared/finished-goods.js";

let checks = 0;
const ok = (label, fn) => { fn(); checks++; console.log("  ok  " + label); };
console.log("\nshared/finished-goods.js — shoes made for stock");

const card = (sizes) => ({ lines:[{ combo:"2X5", sizes }] });

/* THE DISTINCTION IS ALREADY IN THE DATA: a customer card carries an
   order_no, a stock card does not. What comes back on a customer card is owed
   to that customer and belongs to the order, not to the factory. */
ok("counts stock cards and ignores a customer's pairs", () => {
  const out = finishedGoods([
    { article:"SPIKE", order_no:"JO1", qty:500, received:500, status:"closed", card:card({"2":500}) },
    { article:"SPIKE", order_no:null,  qty:300, received:300, status:"closed", card:card({"2":150,"3":150}) },
  ]);
  assert.equal(out.total_pairs, 300, "only the stock card counts");
  assert.equal(out.articles.length, 1);
  assert.equal(out.articles[0].pairs, 300);
});

ok("a card that came back in full reports its sizes", () => {
  const out = finishedGoods([
    { article:"SPIKE", order_no:null, qty:300, received:300, status:"closed", card:card({"2":150,"3":150}) },
  ]);
  assert.deepEqual(out.articles[0].size_list, [{size:"2",pairs:150},{size:"3",pairs:150}]);
  assert.equal(out.sizes_unknown_pairs, 0);
});

/* `received` is a total, not a breakdown. A card for 300 with 200 back does
   not say WHICH 200 — splitting them across the sizes would invent a figure
   nobody recorded. */
ok("a part-received card counts its pairs but not its sizes", () => {
  const out = finishedGoods([
    { article:"SPIKE", order_no:null, qty:300, received:200, status:"partial", card:card({"2":150,"3":150}) },
  ]);
  assert.equal(out.articles[0].pairs, 200, "the pairs are real and are counted");
  assert.deepEqual(out.articles[0].size_list, [], "but the sizes are not guessed at");
  assert.equal(out.articles[0].sizes_unknown, 200);
  assert.equal(out.sizes_unknown_pairs, 200, "and it is said out loud");
  assert.equal(out.articles[0].open_cards, 1);
});

ok("adds up several cards of the same article, worst-known first", () => {
  const out = finishedGoods([
    { article:"SPIKE", order_no:null, qty:100, received:100, status:"closed", card:card({"2":100}) },
    { article:"SPIKE", order_no:null, qty:100, received:100, status:"closed", card:card({"2":40,"3":60}) },
    { article:"JILL",  order_no:null, qty:50,  received:50,  status:"closed", card:card({"4":50}) },
  ]);
  assert.deepEqual(out.articles.map(a=>[a.article,a.pairs]), [["SPIKE",200],["JILL",50]]);
  assert.equal(out.articles[0].sizes["2"], 140, "100 + 40");
  assert.equal(out.articles[0].cards, 2);
});

ok("nothing received yet is not stock", () => {
  const out = finishedGoods([
    { article:"SPIKE", order_no:null, qty:300, received:0, status:"issued", card:card({"2":300}) },
  ]);
  assert.equal(out.total_pairs, 0, "issued is not made");
  assert.equal(out.articles.length, 0);
});

/* "None recorded" and "none left" are different answers. */
ok("an article never made for stock answers null, not zero", () => {
  assert.equal(onHandFor([], "SPIKE"), null);
  assert.equal(onHandFor(undefined, ""), null);
  const made = onHandFor([{ article:"SPIKE", order_no:null, qty:10, received:10,
    status:"closed", card:card({"2":10}) }], "SPIKE");
  assert.equal(made.pairs, 10);
});

ok("no jobs at all answers rather than throwing", () => {
  const out = finishedGoods();
  assert.equal(out.total_pairs, 0);
  assert.deepEqual(out.articles, []);
});

console.log(`\n${checks} checks passed`);
