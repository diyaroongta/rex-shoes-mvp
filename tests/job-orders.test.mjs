import assert from "node:assert/strict";
import { jobOrderBalance, jobOrderQueue } from "../shared/job-orders.js";

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode=failed?1:0;
