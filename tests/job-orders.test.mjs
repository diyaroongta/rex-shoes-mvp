import assert from "node:assert/strict";
import { jobOrderBalance, jobOrderQueue } from "../shared/job-orders.js";
import { buildLedger } from "../shared/dispatch-ledger.js";

let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log("  pass  "+name);}catch(e){failed++;console.log("  FAIL  "+name+"\n        "+e.message);}}

const ORDER={order_no:"JO10",article_code:"ARMOUR",party:"Buyer",lines:[
  {combo:"2X5S",qty:100,sizes:{"2S":40,"3S":60}},
  {combo:"6X10",qty:200,sizes:{"6":80,"7":120}},
]};

console.log("\nJob Orders — derived only from the Order Book and issued cards");

test("every Order Book row starts with its full quantity waiting",()=>{
  const [row]=jobOrderQueue([ORDER],[]);
  assert.equal(row.remaining,300);
  assert.deepEqual(row.lines.map(l=>l.remaining),[100,200]);
});

test("an issued size-wise card consumes its exact range and sizes",()=>{
  const row=jobOrderBalance(ORDER,[{order_no:"JO10",qty:50,card:{lines:[
    {combo:"2X5S",qty:50,sizes:{"2S":20,"3S":30}},
  ]}}]);
  assert.equal(row.remaining,250);
  assert.equal(row.lines[0].issued,50);
  assert.deepEqual(row.lines[0].remaining_sizes,{"2S":20,"3S":30});
});

test("partial cards leave the order visible until all pairs are assigned",()=>{
  const partial=jobOrderBalance(ORDER,[{order_no:"JO10",qty:100,card:{lines:[{combo:"2X5S",qty:100}]}}]);
  assert.equal(partial.fully_issued,false);
  const done=jobOrderBalance(ORDER,[{order_no:"JO10",qty:300}]);
  assert.equal(done.fully_issued,true);
  assert.equal(done.remaining,0);
});

test("work for another order never consumes this one",()=>{
  assert.equal(jobOrderBalance(ORDER,[{order_no:"JO99",qty:300}]).remaining,300);
});


console.log("\nZ — a shortage does not reopen the balance, and that is the gap");

/* The Order Book balance counts what was ISSUED, not what came BACK. Issue 500
   to a line, get 400 back, write 100 off short — and the order still reads as
   fully issued, so the 100 lost pairs cannot be re-issued to anyone. The
   customer is still owed them. */
{
  const order = { order_no:"JO1", lines:[{ combo:"6X8", qty:500, sizes:{ "6":250, "7":250 } }] };
  const short = { order_no:"JO1", qty:500, received:400, shortage:100, status:"closed",
                  card:{ lines:[{ combo:"6X8", qty:500 }] } };
  const b = jobOrderBalance(order, [short]);
  assert.equal(b.lines[0].issued, 500);
  /* `remaining` is deliberately UNCHANGED — losing a hundred pairs must not be
     healed by arithmetic. They surface as their own number instead. */
  assert.equal(b.remaining, 0, "the shortage does not quietly free the balance");
  assert.equal(b.to_remake, 100, "but it is not lost either — it is a decision waiting");
  assert.equal(b.remake_allowance, 100, "what a card MAY carry once somebody asks");
  assert.equal(b.fully_issued, false, "an order owing a remake is not finished");
  console.log("  pass  a shortage surfaces as pairs to remake, without moving the balance");
}

/* Nothing to remake means nothing offered — the control must not appear on
   every order. */
{
  const order = { order_no:"JO2", lines:[{ combo:"6X8", qty:100 }] };
  const clean = { order_no:"JO2", qty:100, received:100, shortage:0, status:"closed",
                  card:{ lines:[{ combo:"6X8", qty:100 }] } };
  const b = jobOrderBalance(order, [clean]);
  assert.equal(b.to_remake, 0);
  assert.equal(b.remake_allowance, 0);
  assert.equal(b.fully_issued, true, "everything went out and everything came back");
  console.log("  pass  a job that came back whole leaves nothing to remake");
}

/* Two short jobs on one order add up. */
{
  const order = { order_no:"JO3", lines:[{ combo:"6X8", qty:400 }] };
  const jobs = [
    { order_no:"JO3", qty:200, shortage:30, status:"closed", card:{ lines:[{ combo:"6X8", qty:200 }] } },
    { order_no:"JO3", qty:200, shortage:20, status:"closed", card:{ lines:[{ combo:"6X8", qty:200 }] } },
    { order_no:"OTHER", qty:100, shortage:99, status:"closed", card:{ lines:[{ combo:"6X8", qty:100 }] } },
  ];
  const b = jobOrderBalance(order, jobs);
  assert.equal(b.to_remake, 50, "30 + 20, and never another order's 99");
  console.log("  pass  shortages accumulate per order, and stay on their own order");
}

/* And the two ledgers are genuinely separate: dispatch status is ordered-versus-
   dispatched and knows nothing about job work, which is why an order can read
   "complete" on dispatch while a job order against it was closed short. */
{
  const order = { order_no:"JO1", article_code:"SPIKE", lines:[{ combo:"6X8", qty:100 }] };
  const led = buildLedger([order], [{ id:1, order_no:"JO1", dispatched:{ "6X8":100 },
    dispatched_on:"2026-09-01" }], () => 20).JO1;
  assert.equal(led.status, "complete", "every ordered pair shipped");
  assert.equal(led.total_pending, 0);
  console.log("  pass  dispatch completeness is ordered-vs-dispatched, not job work");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode=failed?1:0;
