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
  for(const o of orders){
    const art=articles[o.article_code];
    if(!art) continue;                 // article deleted; compute() reports it
    const r=orderReq(o, art);
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

/* ------------------------------ OVERRIDES ---------------------------------
   The plan is automatic, but the planner outranks it. One override object per
   order, all fields optional:

     { seq:        3,                        explicit queue position (1 = first)
       start_on:   "2026-09-14",             release this order on that date
       machine:    { MOLDING:"MOLDING_PU" }, run a stage on a named work centre
       days:       { MOLDING:3 } }           run a stage in exactly N days

   NOTHING HERE IS REFUSED. A planner who says "three days" gets three days,
   even when that needs 1,400 pairs a day out of a 1,200-pair line — the job of
   this module is to do it and then say plainly what it cost. Every forced
   decision comes back in `plan_warnings`, and a day that went over capacity
   because it was told to is reported there rather than as a schedule fault. */
export const emptyOverride = () => ({seq:null,start_on:null,machine:{},days:{}});

/* Accepts whatever the database holds and returns something the planner can
   trust: unknown keys dropped, numbers coerced, blanks normalised to null. */
export function normalizeOverride(raw){
  const o = emptyOverride();
  if(!raw || typeof raw !== "object") return o;
  const seq = Number(raw.seq);
  if(raw.seq != null && raw.seq !== "" && Number.isFinite(seq) && seq >= 1) o.seq = Math.floor(seq);
  if(typeof raw.start_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.start_on))
    o.start_on = raw.start_on;
  for(const [stage,wc] of Object.entries(raw.machine||{}))
    if(typeof wc === "string" && wc.trim()) o.machine[stage] = wc.trim();
  for(const [stage,days] of Object.entries(raw.days||{})){
    const n = Number(days);
    if(Number.isFinite(n) && n >= 1) o.days[stage] = Math.floor(n);
  }
  return o;
}

export const hasOverride = o => {
  const n = normalizeOverride(o);
  return n.seq != null || n.start_on != null
    || Object.keys(n.machine).length > 0 || Object.keys(n.days).length > 0;
};

/* The natural queue is priority, then order date, then order number. An
   explicit `seq` is a POSITION in that queue, not a score: seq 1 means "run
   this first", seq 3 means "third". Ranks are inserted lowest first, so two
   orders both sent to the top keep the order they were pinned in. */
export function queueOrder(orders, overrides={}){
  const natural=[...orders].sort((a,b)=>a.priority-b.priority
    ||(a.order_date<b.order_date?-1:a.order_date>b.order_date?1:0)
    ||(a.order_no<b.order_no?-1:1));
  const seqOf=o=>normalizeOverride(overrides[o.order_no]).seq;
  const pinned=natural.filter(o=>seqOf(o)!=null).sort((a,b)=>seqOf(a)-seqOf(b));
  if(!pinned.length) return natural;
  const out=natural.filter(o=>seqOf(o)==null);
  for(const o of pinned) out.splice(Math.min(Math.max(0,seqOf(o)-1),out.length),0,o);
  return out;
}

export function schedule(orders, articles, wcs, origin, horizon=1500, overrides={}){
  const used={};
  const busy={};   // exclusive machines: [{start,end,order_no}] blocks already taken
  // Release day = order date + whatever the order's own routing costs before
  // production can start (outside stitching transport, printing, prep).
  const rel=o=>{
    const natural=Math.max(0,dayIndex(o.order_date,origin))
      + extraLeadDays(o, (wcs && wcs._lead_time_rules) || null);
    const forced=normalizeOverride(overrides[o.order_no]).start_on;
    // A pinned date REPLACES the computed release, in BOTH directions — it is
    // "release on", not "not before". Pulling an order in front of its own
    // order date is a real thing a planner does for stock already cut; it is
    // honoured and reported, never quietly ignored.
    return forced==null ? natural : dayIndex(forced,origin);
  };
  const ordered=queueOrder(orders, overrides);
  const forcedLoad={};   // wc -> day -> true, where capacity was overridden
  const warnings=[];
  const res={};
  for(const o of ordered){
    const ov=normalizeOverride(overrides[o.order_no]);
    const art=articles[o.article_code]; const qty=o.lines.reduce((s,l)=>s+l.qty,0);
    const r=rel(o); let prevEnd=r; let firstStage=true; const stages=[];
    for(const [stage,autoWc,kind] of route(art)){
      if(kind==="instant"){ stages.push({stage,work_center:autoWc,start:prevEnd,end:prevEnd,instant:true}); continue; }
      /* A forced work centre that does not exist would crash the planner, so
         it falls back to the automatic one and says so. Everything else about
         the override is obeyed. */
      const wanted=ov.machine[stage];
      const wcCode=wanted && wcs[wanted] ? wanted : autoWc;
      if(wanted && !wcs[wanted])
        warnings.push({order_no:o.order_no,stage,kind:"unknown_machine",
          message:`${stage} was pinned to "${wanted}", which is not a work centre. Planned on ${autoWc} instead.`});
      else if(wanted && wanted!==autoWc)
        warnings.push({order_no:o.order_no,stage,kind:"machine_forced",
          message:`${stage} moved to ${wcs[wanted].name||wanted}; the routing would have used ${wcs[autoWc]?.name||autoWc}.`});
      const wc=wcs[wcCode], cap=wc.capacity_per_day;
      const forcedDays=ov.days[stage]||null;
      const earliest=firstStage?prevEnd:prevEnd+1;
      let startDay=null, endDay=prevEnd; const alloc={};
      if(!used[wcCode]) used[wcCode]={};

      if(wc.exclusive){
        // ONE machine, ONE order at a time. The order occupies a contiguous block
        // of whole days; no other order may touch the machine during that block.
        if(!busy[wcCode]) busy[wcCode]=[];
        const blocks=busy[wcCode];
        const span=forcedDays||Math.max(1,Math.ceil(qty/cap - 1e-9));
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
        // A forced span spreads the whole order evenly across those days, even
        // when that is more than the line can hold in a day. That is the point.
        const perDay=forcedDays?qty/span:cap;
        let remaining=qty;
        for(let d=startDay; d<=endDay; d++){
          const take=forcedDays?(d===endDay?remaining:perDay):Math.min(cap,remaining);
          used[wcCode][d]=(used[wcCode][d]||0)+take; alloc[d]=take; remaining-=take;
          if(forcedDays&&used[wcCode][d]>cap+1e-6){
            (forcedLoad[wcCode]=forcedLoad[wcCode]||{})[d]=true;
          }
        }
      } else if(forcedDays){
        /* Told to finish in N days on a shared line: take the day whether or
           not it is free. The line is now overbooked, and that is reported. */
        startDay=earliest; endDay=startDay+forcedDays-1;
        const perDay=qty/forcedDays;
        for(let d=startDay; d<=endDay; d++){
          used[wcCode][d]=(used[wcCode][d]||0)+perDay; alloc[d]=perDay;
          if(used[wcCode][d]>cap+1e-6) (forcedLoad[wcCode]=forcedLoad[wcCode]||{})[d]=true;
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
      if(forcedDays){
        const natural=Math.max(1,Math.ceil(qty/cap-1e-9));
        const perDay=qty/forcedDays;
        const detail=perDay>cap+1e-6
          ? ` That needs ${round2(perDay,0)} pairs a day from a line that holds ${cap}.`
          : "";
        warnings.push({order_no:o.order_no,stage,
          kind:perDay>cap+1e-6?"over_capacity":"duration_forced",
          message:`${stage} pinned to ${forcedDays} day${forcedDays===1?"":"s"}; `
            +`capacity alone would take ${natural}.${detail}`});
      }
      stages.push({stage,work_center:wcCode,start:startDay!==null?startDay:prevEnd,end:endDay,instant:false,
        alloc,forced_days:forcedDays||undefined,forced_machine:wanted&&wcs[wanted]&&wanted!==autoWc?wanted:undefined});
      prevEnd=endDay; firstStage=false;
    }
    if(ov.start_on!=null){
      const own=Math.max(0,dayIndex(o.order_date,origin));
      warnings.push({order_no:o.order_no,stage:null,
        kind:r<own?"starts_before_order_date":"date_forced",
        message:r<own
          ? `Start pinned to ${ov.start_on}, which is before the order's own date of ${o.order_date}.`
          : `Start pinned to ${ov.start_on}.`});
    }
    if(ov.seq!=null)
      warnings.push({order_no:o.order_no,stage:null,kind:"sequence_forced",
        message:`Pinned to queue position ${ov.seq}, ahead of the priority-and-date order.`});
    res[o.order_no]={order_no:o.order_no,qty,priority:o.priority,release_day:r,stages,dispatch_day:prevEnd,
      overridden:hasOverride(overrides[o.order_no])};
  }
  return {orders:res,load:used,forced_load:forcedLoad,warnings};
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
  /* Over capacity is a fault ONLY when nobody asked for it. A day that went
     over because a planner pinned a stage to a shorter run is a decision, and
     it is reported in plan_warnings instead — leaving it here as well made the
     red "schedule problem" banner fire on every deliberate override. */
  const forced=result.forced_load||{};
  for(const [wc,days] of Object.entries(result.load)){
    const cap=wcs[wc].capacity_per_day;
    for(const [d,u] of Object.entries(days))
      if(u>cap+1e-6 && !(forced[wc]&&forced[wc][d])) probs.push(`${wc} day ${d} over capacity`);
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
/* ------------------- SHORTFALL, ATTRIBUTED TO AN ORDER ---------------------
   `netting` answers "what must the factory buy". This answers the different
   question a planner asks about ONE PI: "can this order actually run?"

   Stock is shared, so a shortfall cannot be attributed by dividing it up. It is
   attributed by CONSUMPTION ORDER: orders are walked in the sequence the plan
   runs them, each takes what it needs from what is left, and the order that
   finds the cupboard empty is the one carrying the shortfall. That is what
   actually happens on the floor, and it means the answer changes — correctly —
   when a planner re-sequences the queue. */
export function netByOrder(orders, articles, materials, sequence){
  const left={};
  for(const [key,mat] of Object.entries(materials||{})) left[key]=Number(mat.stock)||0;
  const order=sequence&&sequence.length?sequence:orders.map(o=>o.order_no);
  const byOrder={};
  for(const no of order){
    const o=orders.find(x=>x.order_no===no);
    if(!o||byOrder[no]) continue;
    const art=articles[o.article_code];
    const req=art?orderReq(o,art):{};
    const rows=[];
    for(const [key,need] of Object.entries(req)){
      if(!(need>1e-9)) continue;
      const have=Math.max(0,left[key]==null?0:left[key]);
      const covered=Math.min(have,need);
      left[key]=have-covered;
      rows.push({material_key:key,name:(materials[key]||{}).name||key,uom:(materials[key]||{}).uom||"",
        required:round2(need,2),covered:round2(covered,2),shortfall:round2(Math.max(0,need-covered),2)});
    }
    rows.sort((a,b)=>b.shortfall-a.shortfall||a.name.localeCompare(b.name));
    const short=rows.filter(r=>r.shortfall>1e-6);
    byOrder[no]={order_no:no,pi_no:String((o.pi||{}).pi_no||"").trim(),
      materials:rows,short:short,can_run:short.length===0};
  }
  return byOrder;
}

/* The same figures rolled onto the commercial document the customer sees. An
   order with no PI number is grouped under "" rather than dropped — unfiled
   work still eats the same stock. */
export function shortfallByPi(byOrder){
  const out={};
  for(const row of Object.values(byOrder)){
    const key=row.pi_no||"";
    const g=out[key]||(out[key]={pi_no:key,orders:[],materials:{},short_count:0,can_run:true});
    g.orders.push(row.order_no);
    for(const m of row.materials){
      const acc=g.materials[m.material_key]||(g.materials[m.material_key]=
        {material_key:m.material_key,name:m.name,uom:m.uom,required:0,covered:0,shortfall:0});
      acc.required=round2(acc.required+m.required,2);
      acc.covered=round2(acc.covered+m.covered,2);
      acc.shortfall=round2(acc.shortfall+m.shortfall,2);
    }
  }
  for(const g of Object.values(out)){
    g.materials=Object.values(g.materials).sort((a,b)=>b.shortfall-a.shortfall||a.name.localeCompare(b.name));
    g.short=g.materials.filter(m=>m.shortfall>1e-6);
    g.short_count=g.short.length;
    g.can_run=g.short_count===0;
  }
  return out;
}

export function compute(orders, articles, materials, wcs, origin, opts={}){
  const targets={...TARGETS, ...(opts.targets||{})};
  const riskWindow=opts.riskWindow==null?3:opts.riskWindow;
  const overrides=opts.overrides||{};

  /* An order can outlive its article: the article master is editable, and a
     bulk BOM removal can be confirmed over the top of a live order. Reading
     articles[code].routing on one of those threw, and because compute() builds
     EVERY screen from one call, a single orphaned order blanked the entire
     app — dashboard, schedule, procurement and PI list together. It is set
     aside here instead, and reported loudly: still listed, still counted, but
     not planned, because there is nothing left to plan it from. */
  const planned=[], orphaned=[];
  for(const o of orders) (articles[o.article_code] ? planned : orphaned).push(o);

  const sched=schedule(planned,articles,wcs,origin,1500,overrides);
  const problems=validateSchedule(sched,wcs);
  for(const o of orphaned)
    problems.push(`${o.order_no}: article ${o.article_code} no longer exists — `
      +`this order cannot be planned until its article is restored or the order is re-articled`);
  const sla=slaEval(sched, riskWindow, targets);
  const netted=netting(rollup(planned,articles),materials);
  /* Attributed in the order the plan actually runs, so re-sequencing the queue
     moves the shortfall onto whichever PI now waits for the stock. */
  const byOrder=netByOrder(planned,articles,materials,queueOrder(planned,overrides).map(o=>o.order_no));
  const procurement=netted.filter(n=>n.shortfall>1e-6).sort((a,b)=>b.shortfall-a.shortfall);
  const orderViews=planned.map(o=>{
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
      override:normalizeOverride(overrides[o.order_no]), overridden:!!sr.overridden,
      plan_warnings:sched.warnings.filter(w=>w.order_no===o.order_no),
      sole_type:art.sole_type, pi:o.pi||{}, stitching:o.stitching||((o.pi||{}).stitching)||"inhouse",
      printing:!!(o.printing||((o.pi||{}).printing)),
      qty:sr.qty,priority:o.priority,order_date:o.order_date,lines:o.lines,unknown_combos:unknown,
      release_date:fromDay(sr.release_day,origin), release_delay_days:sr.release_day-Math.max(0,dayIndex(o.order_date,origin)),
      dispatch_date:fromDay(sr.dispatch_day,origin),dispatch_day:sr.dispatch_day,
      lead_days:sr.dispatch_day-sr.release_day,sla:sl.overall,stages};
  }).sort((a,b)=>a.dispatch_day-b.dispatch_day);

  /* Orphans are put back at the TOP of the board, not dropped. An order that
     quietly disappears from the sheet is worse than one that cannot be
     planned: the pairs are still owed to the customer either way, and only one
     of those two states is visible to the person who has to fix it. */
  const orphanViews=orphaned.map(o=>({
    order_no:o.order_no,party:o.party,article:o.article_code,article_code:o.article_code,
    article_missing:true,
    override:normalizeOverride(overrides[o.order_no]), overridden:false,
    plan_warnings:[], sole_type:null, pi:o.pi||{},
    stitching:o.stitching||((o.pi||{}).stitching)||"inhouse",
    printing:!!(o.printing||((o.pi||{}).printing)),
    qty:o.lines.reduce((s,l)=>s+l.qty,0),
    priority:o.priority,order_date:o.order_date,lines:o.lines,
    unknown_combos:o.lines.map(l=>l.combo),
    release_date:null,release_delay_days:null,
    dispatch_date:null,dispatch_day:null,lead_days:null,
    sla:null,stages:[]}));
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
  return {orders:[...orphanViews,...orderViews],orphan_orders:orphanViews,procurement,netted,machine_load:loadSummary,schedule_problems:problems,daily_load:sched.load,
    plan_warnings:sched.warnings, forced_load:sched.forced_load,
    procurement_by_order:byOrder, procurement_by_pi:shortfallByPi(byOrder),
    totals:{orders:orders.length,total_pairs:orders.reduce((s,o)=>s+o.lines.reduce((a,l)=>a+l.qty,0),0),
      last_dispatch:orderViews.length?fromDay(Math.max(...orderViews.map(o=>o.dispatch_day)),origin):null,
      unplanned:orphanViews.length,
      sla:{on_track:orderViews.filter(o=>o.sla==="on_track").length,at_risk:orderViews.filter(o=>o.sla==="at_risk").length,breach:orderViews.filter(o=>o.sla==="breach").length}}};
}
