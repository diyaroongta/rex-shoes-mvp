import assert from "node:assert/strict";
import { productionSummary, validateProductionLog } from "../shared/production-log.js";

const valid = {
  production_on:"2026-09-17", shift:"A", work_center:"MOLDING_ROTARY",
  order_no:"JO2043", article:"SPIKE", stage:"MOLDING",
  good_pairs:820, rejected_pairs:14, downtime_minutes:90,
  downtime_reason:"Mould change", supervisor:"R. Kumar", note:"Black compound arrived late",
};

assert.equal(validateProductionLog(valid,{today:"2026-09-17"}).ok,true);
assert.equal(validateProductionLog({...valid,good_pairs:0,rejected_pairs:0,downtime_minutes:0}).ok,false);
assert.equal(validateProductionLog({...valid,downtime_minutes:10,downtime_reason:""}).ok,false);
assert.equal(validateProductionLog({...valid,production_on:"2026-09-18"},{today:"2026-09-17"}).ok,false);

const summary=productionSummary([
  valid,
  {...valid,work_center:"CUTTING",stage:"CUTTING",good_pairs:100,rejected_pairs:1,downtime_minutes:0},
  {...valid,production_on:"2026-09-16",good_pairs:999},
],"2026-09-17");
assert.equal(summary.entries,2);
assert.equal(summary.good_pairs,920);
assert.equal(summary.rejected_pairs,15);
assert.equal(summary.downtime_minutes,90);
assert.equal(summary.centres.length,2);

console.log("  pass  daily production validation and dashboard summary");
