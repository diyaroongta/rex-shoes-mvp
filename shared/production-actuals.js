/* Daily production actuals sit on top of the existing automatic plan.  The
   plan remains the source of every descriptive field; the only new factory
   input is the number of pairs achieved (and an optional note). */

const iso = value => {
  const text=String(value||"").slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

export const productionActualKey = row => [
  iso(row.production_on)||"", String(row.work_center||""),
  String(row.stage||""), String(row.unit_key||row.order_no||""),
].join("||");

export function plannedProductionRows(state, origin, fromDay){
  const rows=[];
  const work=(state&&state.units&&state.units.length?state.units:(state&&state.orders)||[]);
  for(const order of work){
    const size_ranges=(order.lines||[]).map(line=>line.combo).filter(Boolean).join(", ");
    for(const stage of order.stages||[]){
      if(stage.instant||!stage.alloc||!stage.work_center) continue;
      for(const [day,pairs] of Object.entries(stage.alloc)){
        rows.push({
          production_on:fromDay(Number(day),origin), work_center:stage.work_center,
          stage:stage.stage, order_no:order.order_no,
          unit_key:order.unit_key||order.order_no, job_card_no:order.card_no||"",
          article:order.article,
          party:order.party||"", size_ranges, planned_pairs:Math.round(Number(pairs)||0),
        });
      }
    }
  }
  return rows.sort((a,b)=>a.production_on.localeCompare(b.production_on)
    ||a.work_center.localeCompare(b.work_center)||a.order_no.localeCompare(b.order_no));
}

/* WHAT WAS PLANNED, WITH WHAT WAS ACHIEVED AGAINST IT — AND WHAT WAS ACHIEVED
   WHERE THERE IS NO LONGER A PLAN.
   The planned rows come from `stage.alloc`, which is the work still TO DO.
   Recording production is exactly what empties it: the engine marks the
   recorded pairs done and re-plans only the balance, from a later day. So the
   moment 765 pairs were saved against today, today's planned row disappeared —
   and this function, which only ever walked the planned rows, dropped the
   record with it. The screen then said "0 pairs · 0 of 0 rows" on the very day
   somebody had just reported 765.
   A recorded actual is a FACT that happened, not a projection, so it survives
   its plan row. Each one carries the figures it was saved with (the table
   stores planned_pairs, article, party and the rest), which is what it was
   measured against at the time. */
const jobCardOf=a=>({rejected_pairs:Number(a.rejected_pairs||0),repair_pairs:Number(a.repair_pairs||0),
  cartons:a.cartons==null?null:Number(a.cartons),operators:a.operators==null?null:Number(a.operators),
  supervisor:a.supervisor||"",shift:a.shift||""});
export function withProductionActuals(planned, actuals){
  const byKey=new Map((actuals||[]).map(row=>[productionActualKey(row),row]));
  const out=(planned||[]).map(row=>{
    const actual=byKey.get(productionActualKey(row));
    return {...row, id:actual&&actual.id, actual_pairs:actual==null?null:Number(actual.actual_pairs),
      note:actual&&actual.note||"", recorded_by:actual&&actual.created_by||"",
      ...(actual?jobCardOf(actual):{})};
  });
  const seen=new Set((planned||[]).map(productionActualKey));
  for(const actual of actuals||[]){
    const key=productionActualKey(actual);
    if(seen.has(key)) continue;
    seen.add(key);
    out.push({
      production_on:iso(actual.production_on)||"", work_center:String(actual.work_center||""),
      stage:String(actual.stage||""), order_no:actual.order_no||"",
      unit_key:actual.unit_key||actual.order_no||"", job_card_no:actual.job_card_no||"",
      article:actual.article||"", party:actual.party||"", size_ranges:actual.size_ranges||"",
      planned_pairs:Math.round(Number(actual.planned_pairs)||0),
      id:actual.id, actual_pairs:Number(actual.actual_pairs),
      note:actual.note||"", recorded_by:actual.created_by||"", ...jobCardOf(actual),
      /* This row is history, not a thing still to make — a screen that offers
         it as an editable plan row would be inviting work to be entered
         against a day the planner has already moved on from. */
      recorded_only:true,
    });
  }
  return out.sort((a,b)=>String(a.production_on).localeCompare(String(b.production_on))
    ||String(a.work_center).localeCompare(String(b.work_center))
    ||String(a.order_no).localeCompare(String(b.order_no)));
}

/* THE JOB CARD, FILLED IN WITH THE PRODUCTION FIGURE.
   The paper card carries more than "pairs made": what was rejected, what went
   for repair, the cartons packed, how many people ran the line, who supervised
   and which shift. Asking for them WITH the day's production fills the card
   automatically instead of leaving it to be written up separately.
   Rejected and repair are OF the achieved pairs, so together they cannot
   exceed them. Blank stays blank — "not recorded" is not zero. */
export const JOB_CARD_FIELDS = [
  ["rejected_pairs","Rejected","pairs"],["repair_pairs","Sent for repair","pairs"],
  ["cartons","Cartons packed","count"],["operators","People on the line","count"],
  ["supervisor","Supervisor","text"],["shift","Shift","text"],
];
export function validateJobCardFields(row){
  const fields={rejected_pairs:0,repair_pairs:0,cartons:null,operators:null,supervisor:null,shift:null};
  const whole=(v,label)=>{
    if(v==null||String(v).trim()==="") return {value:null};
    const n=Number(v);
    if(!Number.isInteger(n)||n<0) return {problem:`${label} must be a whole number of 0 or more`};
    return {value:n};
  };
  for(const [key,label,kind] of JOB_CARD_FIELDS){
    if(kind==="text"){ const t=String((row||{})[key]??"").trim().slice(0,80); fields[key]=t||null; continue; }
    const r=whole((row||{})[key],label);
    if(r.problem) return {problem:r.problem};
    fields[key]=r.value==null?(key.endsWith("_pairs")?0:null):r.value;
  }
  const actual=Number((row||{}).actual_pairs);
  if(Number.isFinite(actual)&&fields.rejected_pairs+fields.repair_pairs>actual)
    return {problem:`rejected (${fields.rejected_pairs}) and repair (${fields.repair_pairs}) are part of the ${actual} pairs achieved, so together they cannot exceed it`};
  return {fields};
}

/* `existing` lets a row that is ALREADY recorded be corrected even after the
   plan has moved on from it — refusing that left a wrong figure uncorrectable. */
export function validateProductionActuals(rows, planned, existing=[]){
  const plan=new Map((planned||[]).map(row=>[productionActualKey(row),row]));
  for(const row of existing||[]){ const k=productionActualKey(row); if(!plan.has(k)) plan.set(k,row); }
  const clean=[], problems=[];
  for(const [index,input] of (rows||[]).entries()){
    const key=productionActualKey(input), match=plan.get(key);
    const actual=Number(input.actual_pairs);
    if(!match){ problems.push(`Row ${index+1} is not in the current production plan`); continue; }
    if(!Number.isFinite(actual)||actual<0||!Number.isInteger(actual)){
      problems.push(`Row ${index+1} achievement must be a whole number of pairs`); continue;
    }
    const extra=validateJobCardFields({...input,actual_pairs:actual});
    if(extra.problem){ problems.push(`Row ${index+1}: ${extra.problem}`); continue; }
    clean.push({...match,actual_pairs:actual,...extra.fields,note:String(input.note||"").trim().slice(0,500)});
  }
  return {ok:problems.length===0, rows:clean, problems};
}

export function productionActualSummary(planned, actuals, date){
  const on=iso(date)||new Date().toISOString().slice(0,10);
  const rows=withProductionActuals(planned,actuals).filter(row=>row.production_on===on);
  const planned_pairs=rows.reduce((sum,row)=>sum+Number(row.planned_pairs||0),0);
  const actual_pairs=rows.reduce((sum,row)=>sum+Number(row.actual_pairs||0),0);
  const recorded_rows=rows.filter(row=>row.actual_pairs!=null).length;
  return {date:on,planned_pairs,actual_pairs,planned_rows:rows.length,recorded_rows,
    achievement_pct:planned_pairs?100*actual_pairs/planned_pairs:0};
}
