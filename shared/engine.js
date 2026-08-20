/* Factory OS — the planner. PURE: no imports, no I/O, no dates beyond integer day
   offsets from INPUTS.origin. Runs identically in the browser, in a serverless
   function, and in tests/engine.test.mjs. Keep it that way.
   Verified against the tested Python backend. */
/* ------------- engines (verified against Python backend) ------------- */
/* Day offsets from the order date by which each stage should finish.
   PLACEHOLDERS — they encode a 30-day promise nobody has confirmed. Editable
   in Machine load; PREPARATION and UPPER_QC are new and slot between their
   neighbours until the factory gives real figures. */
export const TARGETS = {CUTTING:8,PREPARATION:11,STITCHING:15,UPPER_QC:18,PRINTING:18,MOLDING:22,ASSEMBLY:22,PACKING:28,DISPATCH:30};
export const RANK = {on_track:0,at_risk:1,breach:2};
export const round2 = (n,d)=>{const f=10**d;return Math.round(n*f)/f;};
export const dayIndex = (iso,origin)=>Math.round((new Date(iso)-new Date(origin))/86400000);
export const fromDay = (i,origin)=>{const d=new Date(origin);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);};
// MOLDING is ONE physical machine shared by every sole type (PVC/PU/EVA) —
// it is never split by sole. ASSEMBLY (stuck-on sole sticking) stays its own line.
/* Molding is several distinct machines, not one. Which one an order uses
   depends on its sole type, and for PVC on the article's assigned machine
   (rotary or vertical) — that assignment is factory knowledge, so when it is
   missing we fall back to rotary AND report it rather than guessing silently. */
export const MOLDING_BY_SOLE = {
  EVA:"MOLDING_EVA", PU:"MOLDING_PU",
  PVC_ROTARY:"MOLDING_PVC_ROTARY", PVC_VERTICAL:"MOLDING_PVC_VERTICAL",
};

export function wcFor(stage, sole, article){
  if(stage === "ASSEMBLY") return `ASSEMBLY_${sole}`;
  if(stage !== "MOLDING")  return stage;
  if(sole === "STUCK-ON")  return "ASSEMBLY_STUCK-ON";
  if(sole === "PVC"){
    const m = article && article.molding_machine;
    if(m === "VERTICAL") return "MOLDING_PVC_VERTICAL";
    return "MOLDING_PVC_ROTARY";            // default; flagged via moldingUnassigned
  }
  return MOLDING_BY_SOLE[sole] || "MOLDING_EVA";
}

/* True when a PVC article has not been told which machine it runs on. */
export const moldingUnassigned = a =>
  a.sole_type === "PVC" && !a.molding_machine;

/* DISPATCH is now a real stage with its own capacity, not an instant marker. */
export function route(a){
  return a.routing.map(st => [st, wcFor(st, a.sole_type, a), "normal"]);
}

export function orderReq(order, article){
  const req={};
  for(const l of order.lines){
    const c = article.combos[l.combo];
    if(!c) continue;
    for(const stage of Object.keys(c.rates))
      for(const [m,rate] of Object.entries(c.rates[stage]))
        req[m]=(req[m]||0)+rate*l.qty;
  }
  return req;
}
export function rollup(orders, articles){
  const t={};
  for(const o of orders){ const r=orderReq(o, articles[o.article_code]);
    for(const [m,q] of Object.entries(r)) t[m]=(t[m]||0)+q; }
  return t;
}
export function netting(total, materials){
  return Object.entries(total).map(([m,req])=>{ const mat=materials[m];
    return {material_key:m,name:mat.name,uom:mat.uom,required:round2(req,2),stock:round2(mat.stock,2),
            shortfall:round2(Math.max(0,req-mat.stock),2)}; });
}
/* Extra days an order carries before production can flow: outside stitching
   needs transport out and back, in-house needs a preparation window, and
   printing adds its own. Comes off the order, since two orders for the same
   article can be stitched differently. */
export function extraLeadDays(order, rules){
  if(!rules) return 0;
  let d = 0;
  const st = (order && order.stitching) || "inhouse";
  if(st === "outside") d += Number(rules.stitching_outside_transport_days) || 0;
  // In-house preparation is already an explicit PREPARATION work-centre in
  // every route. Adding another day here created a duplicate one-day buffer
  // before Cutting in the UI schedule.
  if(order && order.printing) d += Number(rules.printing_days) || 0;
  return d;
}

export function schedule(orders, articles, wcs, origin, horizon=1500){
  const used={};
  const busy={};   // exclusive machines: [{start,end,order_no}] blocks already taken
  // Release day = order date + whatever the order's own routing costs before
  // production can start (outside stitching transport, printing, prep).
  const rel=o=>Math.max(0,dayIndex(o.order_date,origin)) + extraLeadDays(o, (wcs && wcs._lead_time_rules) || null);
  const ordered=[...orders].sort((a,b)=>a.priority-b.priority||(a.order_date<b.order_date?-1:a.order_date>b.order_date?1:0)||(a.order_no<b.order_no?-1:1));
  const res={};
  for(const o of ordered){
    const art=articles[o.article_code]; const qty=o.lines.reduce((s,l)=>s+l.qty,0);
    const r=rel(o); let prevEnd=r; let firstStage=true; const stages=[];
    for(const [stage,wcCode,kind] of route(art)){
      if(kind==="instant"){ stages.push({stage,work_center:wcCode,start:prevEnd,end:prevEnd,instant:true}); continue; }
      const wc=wcs[wcCode], cap=wc.capacity_per_day;
      const earliest=firstStage?prevEnd:prevEnd+1;
      let startDay=null, endDay=prevEnd; const alloc={};
      if(!used[wcCode]) used[wcCode]={};

      if(wc.exclusive){
        // ONE machine, ONE order at a time. The order occupies a contiguous block
        // of whole days; no other order may touch the machine during that block.
        if(!busy[wcCode]) busy[wcCode]=[];
        const blocks=busy[wcCode];
        const span=Math.max(1,Math.ceil(qty/cap - 1e-9));
        // it can only start when free: either as soon as it's ready, or the day
        // after some other order vacates the machine
        const cands=[earliest,...blocks.map(b=>b.end+1)].filter(x=>x>=earliest).sort((a,b)=>a-b);
        let s=null;
        for(const c of cands){
          const e=c+span-1;
          if(!blocks.some(b=>c<=b.end && e>=b.start)){ s=c; break; }
        }
        if(s===null) s=blocks.length?Math.max(...blocks.map(b=>b.end))+1:earliest;
        startDay=s; endDay=s+span-1;
        blocks.push({start:startDay,end:endDay,order_no:o.order_no});
        let remaining=qty;
        for(let d=startDay; d<=endDay; d++){
          const take=Math.min(cap,remaining);
          used[wcCode][d]=(used[wcCode][d]||0)+take; alloc[d]=take; remaining-=take;
        }
      } else {
        // a hall or a bank of lines: several orders can share the same day's capacity
        let remaining=qty, d=earliest;
        while(remaining>1e-9 && d<=r+horizon){
          const free=cap-(used[wcCode][d]||0);
          if(free>1e-9){ const take=Math.min(free,remaining); used[wcCode][d]=(used[wcCode][d]||0)+take; alloc[d]=take; remaining-=take; if(startDay===null)startDay=d; }
          d++;
        }
        endDay=startDay!==null?d-1:prevEnd;
      }
      stages.push({stage,work_center:wcCode,start:startDay!==null?startDay:prevEnd,end:endDay,instant:false,alloc});
      prevEnd=endDay; firstStage=false;
    }
    res[o.order_no]={order_no:o.order_no,qty,priority:o.priority,release_day:r,stages,dispatch_day:prevEnd};
  }
  return {orders:res,load:used};
}
export function validateSchedule(result, wcs){
  const probs=[];
  for(const o of Object.values(result.orders)){
    let prev=null;
    for(const s of o.stages){
      if(!s.instant){ if(s.start===null) probs.push(`${o.order_no} ${s.stage}: unscheduled`);
        else if(s.end<s.start) probs.push(`${o.order_no} ${s.stage}: end<start`); }
      if(prev!==null && s.start!==null && s.start<prev) probs.push(`${o.order_no} ${s.stage}: starts before prev ends`);
      prev=s.end;
    }
    if(o.stages.length && o.dispatch_day!==o.stages[o.stages.length-1].end) probs.push(`${o.order_no}: dispatch!=last end`);
  }
  for(const [wc,days] of Object.entries(result.load)){
    const cap=wcs[wc].capacity_per_day;
    for(const [d,u] of Object.entries(days)) if(u>cap+1e-6) probs.push(`${wc} day ${d} over capacity`);
  }
  return probs;
}
export function slaEval(sched, riskWindow=3, targets=TARGETS){
  const out={};
  for(const [no,o] of Object.entries(sched.orders)){
    let worst="on_track"; const rows=[];
    for(const s of o.stages){ const off=targets[s.stage]; if(off==null)continue;
      const target=o.release_day+off, slip=s.end-target;
      const status=slip<=0?"on_track":slip<=riskWindow?"at_risk":"breach";
      if(RANK[status]>RANK[worst])worst=status;
      rows.push({stage:s.stage,target_day:target,slip_days:slip,status}); }
    out[no]={overall:worst,stages:rows};
  }
  return out;
}
export function compute(orders, articles, materials, wcs, origin, opts={}){
  const targets={...TARGETS, ...(opts.targets||{})};
  const riskWindow=opts.riskWindow==null?3:opts.riskWindow;
  const sched=schedule(orders,articles,wcs,origin);
  const problems=validateSchedule(sched,wcs);
  const sla=slaEval(sched, riskWindow, targets);
  const netted=netting(rollup(orders,articles),materials);
  const procurement=netted.filter(n=>n.shortfall>1e-6).sort((a,b)=>b.shortfall-a.shortfall);
  const orderViews=orders.map(o=>{
    const sr=sched.orders[o.order_no], sl=sla[o.order_no];
    const slBy={}; sl.stages.forEach(x=>slBy[x.stage]=x);
    const art=articles[o.article_code];
    let prevEnd=null;
    const stages=sr.stages.map(st=>{
      const s=slBy[st.stage]||{};
      const ready=prevEnd===null?sr.release_day:prevEnd+1;
      const wait=st.start!==null?Math.max(0,st.start-ready):0;
      prevEnd=st.end;
      return {...st,start_date:fromDay(st.start,origin),end_date:fromDay(st.end,origin),
              ready_date:fromDay(ready,origin), queue_wait_days:wait,
              capacity_per_day:(wcs[st.work_center]||{}).capacity_per_day,
              duration_days:st.end-st.start+1,
              slip_days:s.slip_days,status:s.status||"on_track"};
    });
    const unknown=o.lines.filter(l=>!art.combos[l.combo]).map(l=>l.combo);
    return {order_no:o.order_no,party:o.party,article:o.article_code,article_code:o.article_code,
      sole_type:art.sole_type, pi:o.pi||{}, stitching:o.stitching||((o.pi||{}).stitching)||"inhouse",
      printing:!!(o.printing||((o.pi||{}).printing)),
      qty:sr.qty,priority:o.priority,order_date:o.order_date,lines:o.lines,unknown_combos:unknown,
      release_date:fromDay(sr.release_day,origin), release_delay_days:sr.release_day-Math.max(0,dayIndex(o.order_date,origin)),
      dispatch_date:fromDay(sr.dispatch_day,origin),dispatch_day:sr.dispatch_day,
      lead_days:sr.dispatch_day-sr.release_day,sla:sl.overall,stages};
  }).sort((a,b)=>a.dispatch_day-b.dispatch_day);
  const loadSummary=[];
  for(const [code,wc] of Object.entries(wcs)){
    const days=sched.load[code]||{}; const act=Object.entries(days).filter(([d,v])=>v>1e-9);
    if(!act.length)continue;
    const vals=act.map(([d,v])=>v), idx=act.map(([d])=>+d);
    const span=Math.max(...idx)-Math.min(...idx)+1, booked=vals.reduce((a,b)=>a+b,0);
    loadSummary.push({work_center:code,name:wc.name,stage:wc.stage,sole_type:wc.sole_type,
      capacity_per_day:wc.capacity_per_day,peak_util_pct:round2(100*Math.max(...vals)/wc.capacity_per_day,1),
      busy_days:act.length,avg_util_pct:round2(100*booked/(wc.capacity_per_day*span),1)});
  }
  loadSummary.sort((a,b)=>b.avg_util_pct-a.avg_util_pct);
  return {orders:orderViews,procurement,netted,machine_load:loadSummary,schedule_problems:problems,daily_load:sched.load,
    totals:{orders:orders.length,total_pairs:orders.reduce((s,o)=>s+o.lines.reduce((a,l)=>a+l.qty,0),0),
      last_dispatch:orderViews.length?fromDay(Math.max(...orderViews.map(o=>o.dispatch_day)),origin):null,
      sla:{on_track:orderViews.filter(o=>o.sla==="on_track").length,at_risk:orderViews.filter(o=>o.sla==="at_risk").length,breach:orderViews.filter(o=>o.sla==="breach").length}}};
}
