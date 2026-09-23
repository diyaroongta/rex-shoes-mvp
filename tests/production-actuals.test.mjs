import assert from "node:assert/strict";
import {plannedProductionRows,validateProductionActuals,withProductionActuals,productionActualSummary}
  from "../shared/production-actuals.js";

let passed=0;
const test=(name,fn)=>{fn();passed++;console.log(`  pass  ${name}`);};
const fromDay=day=>`2026-09-${String(day+1).padStart(2,"0")}`;
const unit={order_no:"JO1",unit_key:"JO1#JC7",card_no:"JC7",article:"BOLT",party:"A2Z",
  lines:[{combo:"4X9",qty:100}],stages:[{stage:"CUTTING",work_center:"CUTTING",alloc:{0:60,1:40}}]};
const state={orders:[],units:[unit]};

console.log("\nproduction actuals — the plan supplies every field except achievement");
const planned=plannedProductionRows(state,"ignored",fromDay);
test("one row is produced for each planned day",()=>assert.deepEqual(planned.map(r=>r.planned_pairs),[60,40]));
test("job card, article, party and size range come from the plan",()=>assert.deepEqual(
  {card:planned[0].job_card_no,article:planned[0].article,party:planned[0].party,size:planned[0].size_ranges},
  {card:"JC7",article:"BOLT",party:"A2Z",size:"4X9"}));
test("a matching whole-number achievement is accepted",()=>{
  const out=validateProductionActuals([{...planned[0],actual_pairs:55}],planned);
  assert.equal(out.ok,true);assert.equal(out.rows[0].actual_pairs,55);
});
test("a row outside the live plan is rejected",()=>assert.equal(
  validateProductionActuals([{...planned[0],unit_key:"JO-X",actual_pairs:55}],planned).ok,false));
test("negative and fractional pairs are rejected",()=>{
  assert.equal(validateProductionActuals([{...planned[0],actual_pairs:-1}],planned).ok,false);
  assert.equal(validateProductionActuals([{...planned[0],actual_pairs:1.5}],planned).ok,false);
});
test("actuals join the exact date, centre, stage and production unit",()=>{
  const rows=withProductionActuals(planned,[{...planned[1],id:7,actual_pairs:38}]);
  assert.equal(rows[0].actual_pairs,null);assert.equal(rows[1].actual_pairs,38);
});
test("today's dashboard summary uses plan and recorded achievement",()=>{
  const out=productionActualSummary(planned,[{...planned[0],actual_pairs:55}],"2026-09-01");
  assert.equal(out.planned_pairs,60);assert.equal(out.actual_pairs,55);assert.equal(out.recorded_rows,1);
  assert.ok(Math.abs(out.achievement_pct-(55/60*100))<1e-9);
});

console.log(`\n${passed} passed, 0 failed\n`);
