/* Splitting a PI order into production runs. Pure arithmetic, so it is checked
   here rather than through the screen: a split that loses or invents a pair
   would put a quantity nobody agreed to onto the machines. */
import assert from "node:assert/strict";
import { takeFromSizes, releasedBySource, remainingForOrder, remainingForPi,
         nextRunNo, buildRunLines, sourceOrderOf } from "../shared/pi-split.js";

let passed=0, failed=0;
const test=(name,fn)=>{ try{ fn(); passed++; console.log("  pass  "+name); }
  catch(e){ failed++; console.log("  FAIL  "+name+"\n        "+e.message); } };

console.log("\nPI splitting — a PI order is a ceiling, not a production order");

test("a split never loses or invents a pair", () => {
  const sizes={"11s":100,"12s":37,"13s":9};
  const total=146;
  for(let want=0; want<=total+20; want++){
    const {taken,left}=takeFromSizes(sizes,want);
    const t=Object.values(taken).reduce((a,b)=>a+b,0);
    const l=Object.values(left).reduce((a,b)=>a+b,0);
    assert.equal(t, Math.min(want,total), `want ${want}: took ${t}`);
    assert.equal(t+l, total, `want ${want}: ${t}+${l} != ${total}`);
    for(const k of Object.keys(sizes))
      assert.ok((taken[k]||0) <= sizes[k], `want ${want}: ${k} over-taken`);
  }
});

test("every part is a whole number of pairs", () => {
  const {taken}=takeFromSizes({"1":7,"2":3,"3":5},8);
  for(const v of Object.values(taken)) assert.ok(Number.isInteger(v), "pairs are indivisible");
});

test("an order with no source_order answers for itself", () => {
  assert.equal(sourceOrderOf({order_no:"JO1",pi:{}}), "JO1");
  assert.equal(sourceOrderOf({order_no:"JO1-2",pi:{source_order:"JO1"}}), "JO1");
});

const snapshot={order_no:"JO1",article_code:"SPIKE",
  lines:[{combo:"7X10S",qty:2400,sizes:{"7s":600,"8s":600,"9s":600,"10s":600}}]};

test("what is owed is derived from the runs that exist", () => {
  const none=remainingForOrder(snapshot,{});
  assert.equal(none.remaining,2400);
  assert.equal(none.released,0);
  assert.equal(none.fully_released,false);

  const half=remainingForOrder(snapshot,{"7X10S":600});
  assert.equal(half.released,600);
  assert.equal(half.remaining,1800);
  // The sizes still owed are what is left after the first run took its share.
  assert.equal(Object.values(half.lines[0].sizes).reduce((a,b)=>a+b,0),1800);

  const done=remainingForOrder(snapshot,{"7X10S":2400});
  assert.equal(done.remaining,0);
  assert.equal(done.fully_released,true);
});

test("several runs against one PI order all count against it", () => {
  const live=[
    {order_no:"JO1",   lines:[{combo:"7X10S",qty:600}], pi:{pi_no:"PI1",source_order:"JO1"}},
    {order_no:"JO1-2", lines:[{combo:"7X10S",qty:400}], pi:{pi_no:"PI1",source_order:"JO1"}},
    {order_no:"JO9",   lines:[{combo:"7X10S",qty:999}], pi:{pi_no:"PI-OTHER"}},   // another PI
  ];
  assert.deepEqual(releasedBySource(live,"PI1"), {JO1:{"7X10S":1000}},
    "runs on another PI must not be counted against this one");
  const left=remainingForPi([snapshot],live,"PI1");
  assert.equal(left[0].remaining,1400);
});

test("run numbers read as what they are on the floor", () => {
  assert.equal(nextRunNo("JO1",0),"JO1","the first run keeps the PI order's own number");
  assert.equal(nextRunNo("JO1",1),"JO1-2");
  assert.equal(nextRunNo("JO1",2),"JO1-3");
});

test("asking for more than is owed is refused, never trimmed", () => {
  const remaining=remainingForOrder(snapshot,{"7X10S":2000});   // 400 left
  const over=buildRunLines(remaining,{"7X10S":600});
  assert.equal(over.lines.length,0);
  assert.ok(over.errors[0].includes("only 400 remain"),over.errors.join(" | "));

  const ok=buildRunLines(remaining,{"7X10S":400});
  assert.deepEqual(ok.errors,[]);
  assert.equal(ok.lines[0].qty,400);
  assert.equal(Object.values(ok.lines[0].sizes).reduce((a,b)=>a+b,0),400,
    "the run's sizes must add up to the run's quantity");
});

test("selecting nothing is an error, not an empty order", () => {
  const {lines,errors}=buildRunLines(remainingForOrder(snapshot,{}),{});
  assert.equal(lines.length,0);
  assert.ok(errors[0].includes("nothing was selected"));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed?1:0);
