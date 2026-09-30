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
export function withProductionActuals(planned, actuals){
  const byKey=new Map((actuals||[]).map(row=>[productionActualKey(row),row]));
  const out=(planned||[]).map(row=>{
    const actual=byKey.get(productionActualKey(row));
    return {...row, id:actual&&actual.id, actual_pairs:actual==null?null:Number(actual.actual_pairs),
      note:actual&&actual.note||"", recorded_by:actual&&actual.created_by||""};
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
      note:actual.note||"", recorded_by:actual.created_by||"",
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

export function validateProductionActuals(rows, planned){
  const plan=new Map((planned||[]).map(row=>[productionActualKey(row),row]));
  const clean=[], problems=[];
  for(const [index,input] of (rows||[]).entries()){
    const key=productionActualKey(input), match=plan.get(key);
    const actual=Number(input.actual_pairs);
    if(!match){ problems.push(`Row ${index+1} is not in the current production plan`); continue; }
    if(!Number.isFinite(actual)||actual<0||!Number.isInteger(actual)){
      problems.push(`Row ${index+1} achievement must be a whole number of pairs`); continue;
    }
    clean.push({...match,actual_pairs:actual,note:String(input.note||"").trim().slice(0,500)});
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
