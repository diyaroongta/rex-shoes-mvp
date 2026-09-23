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

export function withProductionActuals(planned, actuals){
  const byKey=new Map((actuals||[]).map(row=>[productionActualKey(row),row]));
  return (planned||[]).map(row=>{
    const actual=byKey.get(productionActualKey(row));
    return {...row, id:actual&&actual.id, actual_pairs:actual==null?null:Number(actual.actual_pairs),
      note:actual&&actual.note||"", recorded_by:actual&&actual.created_by||""};
  });
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
