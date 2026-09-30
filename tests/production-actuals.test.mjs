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

/* RECORDED PRODUCTION DOES NOT VANISH WHEN THE PLAN MOVES ON.
 *
 * Planned rows come from `stage.alloc` — the work still TO DO. Recording
 * production is exactly what empties it: the engine marks the recorded pairs
 * done and re-plans only the balance, from a later day. So the moment 765
 * pairs were saved against today, today's planned row disappeared, the record
 * was dropped with it, and the screen read "0 pairs · 0 of 0 rows" on the very
 * day somebody had just reported 765. A record is a fact that happened, not a
 * projection, so it outlives its plan row. */
{
  const recorded={id:12,production_on:"2026-09-29",work_center:"UPPER_QC",stage:"UPPER_QC",
    order_no:"JO2161",unit_key:"JO2161#JC7",job_card_no:"JC7",article:"GOLA PLUS VELCRO BLACK",
    party:"Jyoti The School Mall",size_ranges:"11X1, 2X5",planned_pairs:900,actual_pairs:765,note:""};
  /* The plan AFTER saving: the 29th is gone, the 135-pair balance sits later. */
  const planAfter=[{production_on:"2026-10-01",work_center:"UPPER_QC",stage:"UPPER_QC",
    order_no:"JO2161",unit_key:"JO2161#JC7",job_card_no:"JC7",article:"GOLA PLUS VELCRO BLACK",
    party:"Jyoti The School Mall",size_ranges:"11X1, 2X5",planned_pairs:135}];

  test("a record outlives the plan row it was entered against",()=>{
    const joined=withProductionActuals(planAfter,[recorded]);
    assert.equal(joined.length,2);
    const kept=joined.find(r=>r.production_on==="2026-09-29");
    assert.equal(kept.actual_pairs,765);
    assert.equal(kept.planned_pairs,900,"against what it was measured at the time");
    assert.equal(kept.recorded_only,true,"marked history, not work still to do");
  });

  test("the day's tiles show what was reported, not 0 of 0",()=>{
    const out=productionActualSummary(planAfter,[recorded],"2026-09-29");
    assert.equal(out.actual_pairs,765);
    assert.equal(out.planned_pairs,900);
    assert.equal(out.recorded_rows,1);
    assert.equal(out.planned_rows,1);
  });

  test("and the balance still reads as work to do on the day it moved to",()=>{
    const out=productionActualSummary(planAfter,[recorded],"2026-10-01");
    assert.equal(out.planned_pairs,135);
    assert.equal(out.actual_pairs,0);
  });

  test("a record that still matches its plan row is not duplicated",()=>{
    const both=withProductionActuals([{...recorded}],[recorded]);
    assert.equal(both.length,1);
    assert.equal(both[0].actual_pairs,765);
  });
}

console.log(`\n${passed} passed, 0 failed\n`);
