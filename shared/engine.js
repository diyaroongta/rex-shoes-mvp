/* Factory OS — the planner. PURE: no imports, no I/O, no dates beyond integer day
   offsets from INPUTS.origin. Runs identically in the browser, in a serverless
   function, and in tests/engine.test.mjs. Keep it that way.
   Verified against the tested Python backend. */
/* ------------- engines (verified against Python backend) ------------- */
/* Day offsets from the order date by which each stage should finish.
   PLACEHOLDERS — they encode a 30-day promise nobody has confirmed. Editable
   in Machine load; PREPARATION and UPPER_QC are new and slot between their
   neighbours until the factory gives real figures. */
/* THE ORDER A SHOE IS ACTUALLY MADE IN. One definition, exported, because it
   had drifted into four copies and one of them was wrong — the stage-targets
   editor listed PRINTING (which is part of PREPARATION, not a stage of its
   own) and omitted PREPARATION and UPPER_QC altogether, so two real stages
   could never be given a target. Anything that lists stages sorts by this. */
export const STAGE_SEQUENCE = ["CUTTING","PREPARATION","STITCHING","UPPER_QC",
                               "MOLDING","ASSEMBLY","PACKING","DISPATCH"];
export const inStageOrder = stages => [...(stages||[])].sort((a,z)=>{
  const ia=STAGE_SEQUENCE.indexOf(a), iz=STAGE_SEQUENCE.indexOf(z);
  return (ia<0?99:ia)-(iz<0?99:iz) || String(a).localeCompare(String(z));
});

/* Work centres in the order a shoe passes through them. Every screen that
   lists lines uses this: reading them in whatever order the reference document
   happens to store them put DISPATCH third and PACKING second, which is not a
   plan anyone can follow. */
export const workCentresInOrder = workcenters => Object.keys(workcenters||{}).sort((a,z)=>{
  const sa=(workcenters[a]||{}).stage, sz=(workcenters[z]||{}).stage;
  const ia=STAGE_SEQUENCE.indexOf(sa), iz=STAGE_SEQUENCE.indexOf(sz);
  return (ia<0?99:ia)-(iz<0?99:iz) || String(a).localeCompare(String(z));
});

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
/* Work stitched OUTSIDE has to come back before it can be QC'd, and that
   journey takes days. It is NOT a work centre: it books no capacity and must
   not appear on the machine board — but it is real elapsed time and every
   dispatch date depends on it, so it belongs in the route rather than being
   bolted onto the release date. Adding it to the release pushed the whole
   order later instead, which delays cutting for no reason and puts the delay
   in the wrong place on the schedule. */
export const TRANSIT_STAGE = "TRANSIT_IN";

export function route(a, order, rules){
  const base = a.routing.map(st => [st, wcFor(st, a.sole_type, a), "normal"]);
  const days = ((order && order.stitching) === "outside")
    ? Number((rules || {}).stitching_outside_transport_days) || 0 : 0;
  if(!days) return base;
  const after = base.findIndex(([st]) => st === "STITCHING");
  if(after < 0) return base;
  const leg = [TRANSIT_STAGE, null, "transit", days];
  return [...base.slice(0, after + 1), leg, ...base.slice(after + 1)];
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
  /* Outside-stitching transport is NOT counted here any more. It happens
     AFTER stitching, not before cutting, so it is a leg of the route (see
     TRANSIT_STAGE). Counting it here delayed the release — the whole order
     started later — which is both the wrong duration and the wrong place on
     the schedule. */
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

/* WHAT THE FLOOR HAS ALREADY DONE.
   `progress` is {unit key: {STAGE: {done: pairs, on: "YYYY-MM-DD"}}} — the
   pairs actually achieved, keyed the way the plan is keyed. A stage that is
   finished takes no capacity and no future day; a stage part done is
   rescheduled for WHAT IS LEFT, from the day after the last entry. That is the
   whole feedback loop: the floor reports a number, and tomorrow's plan is
   built from what is genuinely still to make. */
export function schedule(orders, articles, wcs, origin, horizon=1500, overrides={}, progress={}){
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
    const done=(progress||{})[o.order_no]||{};
    const r=rel(o); let prevEnd=r; let firstStage=true; const stages=[];
    for(const [stage,autoWc,kind,legDays] of route(art, o, wcs && wcs._lead_time_rules)){
      if(kind==="instant"){ stages.push({stage,work_center:autoWc,start:prevEnd,end:prevEnd,instant:true}); continue; }
      /* Elapsed days, no capacity, no machine. It is shown on the schedule
         because the customer waits for it, and left off the machine board
         because nothing is being made. */
      if(kind==="transit"){
        const start=prevEnd+1, end=start+Math.max(1,Number(legDays)||1)-1;
        stages.push({stage,work_center:null,start,end,transit:true});
        prevEnd=end; continue;
      }
      /* WHAT IS ALREADY MADE IS NOT PLANNED AGAIN.
         A stage finished on the floor is recorded where it actually happened
         and books no further capacity; a stage part done is planned for the
         BALANCE only, and never before the day after the last entry — the
         work cannot be done again yesterday. */
      const record=done[stage];
      const madeSoFar=record?Math.max(0,Math.min(qty,Number(record.done)||0)):0;
      const lastOn=record&&record.on?dayIndex(record.on,origin):null;
      if(record&&madeSoFar>=qty-1e-9){
        const end=lastOn==null?prevEnd:Math.max(prevEnd,lastOn);
        stages.push({stage,work_center:autoWc,start:lastOn==null?prevEnd:lastOn,end,
          instant:false,alloc:{},complete:true,achieved:madeSoFar});
        prevEnd=end; firstStage=false; continue;
      }
      const remaining=qty-madeSoFar;

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
      const readyOn=firstStage?prevEnd:prevEnd+1;
      /* Part done yesterday: the rest picks up today, not back at the
         beginning of the stage. */
      const earliest=lastOn==null?readyOn:Math.max(readyOn,lastOn+1);
      let startDay=null, endDay=prevEnd; const alloc={};
      if(!used[wcCode]) used[wcCode]={};

      if(wc.exclusive){
        /* HOW MANY JOB CARDS A MACHINE CAN RUN AT ONCE IS ITS CAPACITY — and
           WHICH cards those can be is the mould fitted to it.
 
           The factory's own weekly plan sheet is the evidence for both: each
           moulding machine carries ONE article on a given day ("GOLA BLK D.V,
           ALL SIZES, 500" against Vertical M/C 1) at that machine's own daily
           rate. So two cards of the same article share a machine-day up to
           capacity — which is what makes batching an order into five cards
           worth doing — and a different article waits for the machine, because
           changing the mould is not something a plan can pretend away.
 
           The block stays CONTIGUOUS. A card that stops for a day and resumes
           is not how a moulding run works, so a day that is full or committed
           to another article restarts the run rather than splitting it. */
        if(!busy[wcCode]) busy[wcCode]=[];
        const blocks=busy[wcCode];
        const article=o.article_code;
        const dayHolder=d=>{
          const on=blocks.filter(b=>d>=b.start&&d<=b.end);
          return on.length?on[0].article:null;
        };
        const free=d=>cap-(used[wcCode][d]||0);
        let s=null, e=null;
        if(forcedDays){
          /* Told to take N days: it takes N days, from the first day the
             machine is not holding a different article. */
          let c=earliest;
          while(c<=earliest+horizon){
            let ok=true;
            for(let d=c; d<c+forcedDays; d++){
              const holder=dayHolder(d);
              if(holder && holder!==article){ ok=false; c=d+1; break; }
            }
            if(ok){ s=c; e=c+forcedDays-1; break; }
          }
          if(s===null){ s=earliest; e=earliest+forcedDays-1; }
        } else {
          let c=earliest;
          while(c<=earliest+horizon){
            let want=remaining, d=c, run=[];
            while(want>1e-9 && d<=earliest+horizon){
              const holder=dayHolder(d);
              if((holder && holder!==article) || free(d)<=1e-9){ break; }
              const take=Math.min(free(d),want);
              run.push([d,take]); want-=take; d++;
            }
            if(want<=1e-9){ s=c; e=run[run.length-1][0]; break; }
            /* The run was broken. Restart after whatever stopped it. */
            c=(run.length?run[run.length-1][0]:c)+1;
          }
          if(s===null){ s=earliest; e=earliest+Math.max(1,Math.ceil(remaining/cap-1e-9))-1; }
        }
        startDay=s; endDay=e;
        blocks.push({start:startDay,end:endDay,order_no:o.order_no,article});
        // A forced span spreads the whole order evenly across those days, even
        // when that is more than the line can hold in a day. That is the point.
        const span=endDay-startDay+1;
        const perDay=forcedDays?remaining/span:null;
        let left=remaining;
        for(let d=startDay; d<=endDay; d++){
          /* Unforced, a day takes what is LEFT on the machine that day, not the
             full capacity — another card of the same article may already hold
             part of it. */
          const take=forcedDays
            ? (d===endDay?left:perDay)
            : Math.min(Math.max(0,cap-(used[wcCode][d]||0)),left);
          used[wcCode][d]=(used[wcCode][d]||0)+take; alloc[d]=take; left-=take;
          if(forcedDays&&used[wcCode][d]>cap+1e-6){
            (forcedLoad[wcCode]=forcedLoad[wcCode]||{})[d]=true;
          }
        }
      } else if(forcedDays){
        /* Told to finish in N days on a shared line: take the day whether or
           not it is free. The line is now overbooked, and that is reported. */
        startDay=earliest; endDay=startDay+forcedDays-1;
        const perDay=remaining/forcedDays;
        for(let d=startDay; d<=endDay; d++){
          used[wcCode][d]=(used[wcCode][d]||0)+perDay; alloc[d]=perDay;
          if(used[wcCode][d]>cap+1e-6) (forcedLoad[wcCode]=forcedLoad[wcCode]||{})[d]=true;
        }
      } else {
        // a hall or a bank of lines: several orders can share the same day's capacity
        let left=remaining, d=earliest;
        while(left>1e-9 && d<=r+horizon){
          const free=cap-(used[wcCode][d]||0);
          if(free>1e-9){ const take=Math.min(free,left); used[wcCode][d]=(used[wcCode][d]||0)+take; alloc[d]=take; left-=take; if(startDay===null)startDay=d; }
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
    /* A BATCH is released on its own card date, but the delivery promise was
       made on the ORDER's date and does not move because a batch went out
       late — that slippage is the very thing the SLA exists to show. So the
       target is measured from `target_base_date` when a unit carries one, and
       from the release day otherwise, which is every order scheduled whole. */
    const targetBase=o.target_base_date!=null?Math.max(0,dayIndex(o.target_base_date,origin)):r;
    res[o.order_no]={order_no:o.order_no,qty,priority:o.priority,release_day:r,stages,dispatch_day:prevEnd,
      target_base:targetBase,
      unit_key:o.unit_key||o.order_no,unit_kind:o.unit_kind||"order",
      source_order_no:o.source_order_no||o.order_no,
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
    const base=o.target_base==null?o.release_day:o.target_base;
    for(const s of o.stages){ const off=targets[s.stage]; if(off==null)continue;
      const target=base+off, slip=s.end-target;
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

/* ------------- PLAN OVERRIDES WHEN AN ORDER RUNS AS BATCHES ---------------
   An override was written against an ORDER, and the planner now schedules its
   JOB CARDS. Two of the four fields survive that move unchanged and two do
   not:

     machine, days   a stage-level decision — "mould this article on the
                     vertical", "cutting takes two days". True of every batch,
                     so every batch inherits it.
     seq, start_on   a decision about ONE piece of work in the queue. Applying
                     "start on the 14th" to five batches would release all
                     5 x 2,000 pairs on one day, which is the opposite of what
                     splitting them was for.

   So seq and start_on are NOT applied to a multi-batch order, and the planner
   is told in as many words that the pin belongs on a card. Silently spreading
   it — or silently dropping it — are both worse than saying so. */
export function overridesForUnits(units, overrides={}){
  const map={}, notes=[]; const told=new Set();
  for(const u of units||[]){
    const key=u.unit_key||u.order_no, parent=u.source_order_no||key;
    if(overrides[key]){ map[key]=overrides[key]; continue; }
    if(key===parent||!overrides[parent]) continue;
    const n=normalizeOverride(overrides[parent]);
    const machine=Object.keys(n.machine).length?n.machine:null;
    const days=Object.keys(n.days).length?n.days:null;
    if(machine||days) map[key]={...(machine?{machine}:{}),...(days?{days}:{})};
    if((n.seq!=null||n.start_on!=null)&&!told.has(parent)){
      told.add(parent);
      const what=[n.seq!=null?"queue position":null,n.start_on!=null?`start date ${n.start_on}`:null]
        .filter(Boolean).join(" and ");
      notes.push({order_no:parent,stage:null,kind:"override_not_applied",
        message:`${parent} runs as separate job cards, so the pinned ${what} was not applied to it. `
          +`Pin the job card instead — each batch takes its own place in the queue.`});
    }
  }
  return {overrides:map,notes};
}

/* One row of an order's own gantt, merged from the batches that make it up.
   An order that runs as one unit keeps exactly the row it had before. */
function mergeStageRows(rows, wcs, origin){
  const first=rows[0];
  const start=Math.min(...rows.map(r=>r.start));
  const end=Math.max(...rows.map(r=>r.end));
  const ready=Math.min(...rows.map(r=>r.start-(r.queue_wait_days||0)));
  const alloc={};
  for(const r of rows) for(const [d,v] of Object.entries(r.alloc||{})) alloc[d]=(alloc[d]||0)+v;
  const centres=[...new Set(rows.map(r=>r.work_center).filter(Boolean))];
  const worst=rows.reduce((w,r)=>RANK[r.status]>RANK[w]?r.status:w,"on_track");
  return {...first, start, end, alloc,
    /* Batches of one order can legitimately run on DIFFERENT machines — that
       is what a machine override per card is for — so the merged row names
       them all rather than picking one and being wrong on the others. */
    work_center:centres.length===1?centres[0]:null, work_centers:centres,
    capacity_per_day:centres.length===1?(wcs[centres[0]]||{}).capacity_per_day:null,
    start_date:fromDay(start,origin), end_date:fromDay(end,origin),
    ready_date:fromDay(ready,origin), queue_wait_days:Math.max(0,start-ready),
    duration_days:end-start+1,
    slip_days:Math.max(...rows.map(r=>r.slip_days==null?0:r.slip_days)),
    status:worst, batch_count:rows.length};
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

  /* ---------------- WHAT IS SCHEDULED: BATCHES, NOT ORDERS ----------------
     A 10,000-pair order is a commercial fact; the floor releases it as five
     job cards of 2,000 on five different days, and it is those cards that
     occupy cutting and moulding. Scheduling the order instead put all 10,000
     pairs on the machine board on day one and dated the dispatch from a
     release that never happened.

     Units come from shared/production-units.js (which the engine cannot
     import — it is pure and import-free by design, so the caller builds them
     and passes them in). An order with no job cards is ONE unit keyed by its
     own order number, so everything below is unchanged for it, plan overrides
     included. The units of an order always add up to the order, never more,
     so material demand and the pair count do not move. */
  const ownUnit=o=>({...o,unit_key:o.order_no,unit_kind:"order",source_order_no:o.order_no});
  const live=new Set(planned.map(o=>o.order_no));
  const supplied=(Array.isArray(opts.units)?opts.units:[])
    .filter(u=>u&&articles[u.article_code]&&live.has(u.source_order_no||u.order_no));
  const units=[...supplied];
  const covered=new Set(units.map(u=>u.source_order_no||u.order_no));
  for(const o of planned) if(!covered.has(o.order_no)) units.push(ownUnit(o));

  /* PAIRS NOBODY HAS PUT ON A JOB CARD ARE NOT ON THE PLAN.
     The factory's answer, and it is the right one: an order of 10,000 with one
     card of 2,000 has 2,000 in production and 8,000 WAITING TO BE RELEASED.
     Scheduling the other 8,000 books machines for work the floor has not
     agreed to make and dates a dispatch nobody promised.

     They are not dropped either — that would hide real customer demand. They
     come back as `pending_release` for a list of orders still to be put on a
     card, and they still count in PROCUREMENT (below), because the material
     has to be bought long before a card is written. */
  const scheduled=units.filter(u=>u.unit_kind!=="balance");
  const pending=units.filter(u=>u.unit_kind==="balance");

  const expanded=overridesForUnits(scheduled, overrides);
  /* What the floor reported it actually made, fed back in: a finished stage
     books no more capacity and a part-finished one is planned for the balance
     from tomorrow. Absent, the plan is the pure forecast it always was. */
  const sched=schedule(scheduled,articles,wcs,origin,1500,expanded.overrides,opts.progress||{});
  sched.warnings.push(...expanded.notes);
  const problems=validateSchedule(sched,wcs);
  for(const o of orphaned)
    problems.push(`${o.order_no}: article ${o.article_code} no longer exists — `
      +`this order cannot be planned until its article is restored or the order is re-articled`);

  /* AN ARTICLE THAT EXISTS BUT HAS NO BOM IS WORSE THAN ONE THAT IS MISSING.
     A missing article is loud: the order is set aside and reported. An article
     with size ranges and no RATES is silent — it schedules normally, books
     machine capacity, and requires ZERO material, so procurement reports
     `can_run: true` and nothing short for work that cannot actually be made.
     REX GOLA PLUS carried the two largest orders on the book, 10,015 pairs,
     and produced not one line of material demand or a single warning.

     It is a DATA GAP, not a schedule problem, and the difference is the whole
     reason it has its own channel. `schedule_problems` is the red banner above
     EVERY screen, and it is right for something that broke today's plan — a
     capacity violation, an order whose article no longer exists. A BOM that
     has not been uploaded yet is a standing condition: it will still be true
     tomorrow and next week, so putting it there parks a red bar over the whole
     app until somebody uploads a workbook, and teaches people to scroll past
     the banner that is telling them the plan is actually broken.

     So it is reported STRUCTURED and where its audience is: procurement, whose
     buying list is the thing missing the pairs, and the order row itself. */
  const seenNoBom = new Set();
  const dataGaps = [];
  for(const o of planned){
    const art = articles[o.article_code];
    if(!art || seenNoBom.has(o.article_code)) continue;
    let rates = 0;
    for(const combo of Object.values(art.combos || {}))
      for(const stage of Object.values(combo.rates || {})) rates += Object.keys(stage).length;
    if(rates > 0) continue;
    seenNoBom.add(o.article_code);
    const on = orders.filter(x => x.article_code === o.article_code);
    dataGaps.push({
      kind: "bom_missing",
      article_code: o.article_code,
      orders: on.length,
      order_nos: on.map(x => x.order_no),
      pairs: on.reduce((a, x) => a + (x.lines || []).reduce((n, l) => n + (Number(l.qty) || 0), 0), 0),
    });
  }
  const sla=slaEval(sched, riskWindow, targets);
  const netted=netting(rollup(planned,articles),materials);
  /* Attributed in the order the plan actually runs, so re-sequencing the queue
     moves the shortfall onto whichever PI now waits for the stock. Batches are
     walked in their own plan sequence: a card released in March takes the
     stock before the card released in April, which is what happens on the
     floor and is the whole point of attributing by consumption order. */
  /* Released work takes the stock first, in the sequence the plan runs it;
     pairs still waiting for a card take what is left. That ordering is the
     honest one — a card that exists is ahead of one that has not been written
     — and it keeps the buying list covering the whole order book. */
  const consumption=[...queueOrder(scheduled,expanded.overrides),...pending];
  const byUnit=netByOrder(consumption,articles,materials,consumption.map(u=>u.order_no));
  const unitOf=new Map(units.map(u=>[u.unit_key||u.order_no,u]));
  const byOrder={};
  for(const [key,row] of Object.entries(byUnit)){
    const u=unitOf.get(key)||{}; const parent=u.source_order_no||key;
    const g=byOrder[parent]||(byOrder[parent]={order_no:parent,pi_no:row.pi_no,materials:[],short:[],can_run:true});
    const acc=new Map(g.materials.map(m=>[m.material_key,m]));
    for(const m of row.materials){
      const cur=acc.get(m.material_key);
      if(!cur){ acc.set(m.material_key,{...m}); continue; }
      cur.required=round2(cur.required+m.required,2);
      cur.covered=round2(cur.covered+m.covered,2);
      cur.shortfall=round2(cur.shortfall+m.shortfall,2);
    }
    g.materials=[...acc.values()].sort((a,b)=>b.shortfall-a.shortfall||a.name.localeCompare(b.name));
    g.short=g.materials.filter(m=>m.shortfall>1e-6);
    g.can_run=g.short.length===0;
  }
  const procurement=netted.filter(n=>n.shortfall>1e-6).sort((a,b)=>b.shortfall-a.shortfall);

  /* One scheduled row — for a batch, or for an order that runs whole. */
  const viewOf=(o,sr,sl)=>{
    const bomMissing = seenNoBom.has(o.article_code);
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
    const unknown=(o.lines||[]).filter(l=>!art.combos[l.combo]).map(l=>l.combo);
    return {order_no:o.source_order_no||o.order_no,party:o.party,article:o.article_code,article_code:o.article_code,
      ...(bomMissing ? { bom_missing:true } : {}),
      unit_key:sr.unit_key, unit_kind:sr.unit_kind,
      card_no:o.card_no||null, fabricator:o.fabricator||null, job_id:o.job_id||null,
      /* The day the card was WRITTEN, beside the day its work starts. */
      created_on:o.created_on||null,
      override:normalizeOverride(expanded.overrides[sr.unit_key]), overridden:!!sr.overridden,
      plan_warnings:sched.warnings.filter(w=>w.order_no===sr.unit_key),
      sole_type:art.sole_type, pi:o.pi||{}, stitching:o.stitching||((o.pi||{}).stitching)||"inhouse",
      printing:!!(o.printing||((o.pi||{}).printing)),
      qty:sr.qty,priority:o.priority,order_date:o.order_date,lines:o.lines||[],unknown_combos:unknown,
      release_date:fromDay(sr.release_day,origin), release_delay_days:sr.release_day-Math.max(0,dayIndex(o.order_date,origin)),
      dispatch_date:fromDay(sr.dispatch_day,origin),dispatch_day:sr.dispatch_day,
      lead_days:sr.dispatch_day-sr.release_day,sla:sl.overall,stages};
  };

  const unitViews=scheduled.map(u=>{
    const key=u.unit_key||u.order_no;
    return viewOf(u, sched.orders[key], sla[key]);
  });
  /* One row per order still owing a job card, with the sizes that are owed.
     No dates: it has not been planned, and inventing one would be the very
     thing this change removed. */
  const pendingRelease=pending.map(u=>({
    order_no:u.source_order_no||u.order_no, party:u.party,
    article:u.article_code, article_code:u.article_code,
    pairs:(u.lines||[]).reduce((a,l)=>a+(Number(l.qty)||0),0),
    lines:u.lines||[], order_date:u.order_date, priority:u.priority,
    pi:u.pi||{},
  })).filter(row=>row.pairs>0)
    .sort((a,z)=>a.order_date<z.order_date?-1:a.order_date>z.order_date?1:
                 a.order_no<z.order_no?-1:1);
  const pendingByOrder=new Map(pendingRelease.map(r=>[r.order_no,r]));
  const viewsByOrder=new Map();
  for(const v of unitViews){
    const list=viewsByOrder.get(v.order_no)||[]; list.push(v); viewsByOrder.set(v.order_no,list);
  }

  /* An order's own row: the batches it is made of, rolled back up. It dispatches
     when its LAST batch dispatches and is released when its FIRST one is, and
     its SLA is the worst of them — a customer with 2,000 of 10,000 pairs on
     time has a late order, not a 20%-on-time one. */
  const orderViews=planned.map(o=>{
    const views=(viewsByOrder.get(o.order_no)||[]).sort((a,b)=>a.dispatch_day-b.dispatch_day);
    const batches=views.map(v=>({unit_key:v.unit_key,unit_kind:v.unit_kind,card_no:v.card_no,
      fabricator:v.fabricator,job_id:v.job_id,qty:v.qty,order_date:v.order_date,
      release_date:v.release_date,dispatch_date:v.dispatch_date,dispatch_day:v.dispatch_day,
      sla:v.sla,overridden:v.overridden,override:v.override}));
    const waiting=pendingByOrder.get(o.order_no)||null;
    const waitingFields={
      pending_pairs: waiting?waiting.pairs:0,
      pending_lines: waiting?waiting.lines:[],
    };
    if(views.length===1 && views[0].unit_key===o.order_no)
      return {...views[0], lines:o.lines, batches, batch_count:1, ...waitingFields};
    const stageRows=new Map();
    for(const v of views) for(const st of v.stages){
      const list=stageRows.get(st.stage)||[]; list.push(st); stageRows.set(st.stage,list);
    }
    const stages=inStageOrder([...stageRows.keys()]).map(st=>mergeStageRows(stageRows.get(st),wcs,origin));
    const worst=views.reduce((w,v)=>RANK[v.sla]>RANK[w]?v.sla:w,"on_track");
    const releaseDay=Math.min(...views.map(v=>dayIndex(v.release_date,origin)));
    const dispatchDay=Math.max(...views.map(v=>v.dispatch_day));
    return {...views[0],
      unit_key:o.order_no, unit_kind:"order", card_no:null, fabricator:null, job_id:null,
      override:normalizeOverride(overrides[o.order_no]),
      overridden:views.some(v=>v.overridden),
      plan_warnings:[...views.flatMap(v=>v.plan_warnings),
                     ...sched.warnings.filter(w=>w.order_no===o.order_no)],
      qty:views.reduce((a,v)=>a+v.qty,0), lines:o.lines, order_date:o.order_date,
      release_date:fromDay(releaseDay,origin),
      release_delay_days:releaseDay-Math.max(0,dayIndex(o.order_date,origin)),
      dispatch_date:fromDay(dispatchDay,origin), dispatch_day:dispatchDay,
      lead_days:dispatchDay-releaseDay, sla:worst, stages,
      batches, batch_count:views.length, ...waitingFields};
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
    batches:[], batch_count:0,
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
  return {orders:[...orphanViews,...orderViews],orphan_orders:orphanViews,procurement,netted,machine_load:loadSummary,schedule_problems:problems,data_gaps:dataGaps,daily_load:sched.load,
    plan_warnings:sched.warnings, forced_load:sched.forced_load,
    /* Every batch as its own row, for the screens that plan work rather than
       report on an order: the machine board, the status view, and the
       schedule's own expandable rows. */
    units:unitViews, batched:unitViews.length>planned.length,
    /* Orders still to be put on a job card — listed, never scheduled. */
    pending_release:pendingRelease,
    procurement_by_order:byOrder, procurement_by_unit:byUnit, procurement_by_pi:shortfallByPi(byOrder),
    totals:{orders:orders.length,total_pairs:orders.reduce((s,o)=>s+o.lines.reduce((a,l)=>a+l.qty,0),0),
      last_dispatch:orderViews.length?fromDay(Math.max(...orderViews.map(o=>o.dispatch_day)),origin):null,
      batches:unitViews.length,
      pending_pairs:pendingRelease.reduce((a,r)=>a+r.pairs,0),
      pending_orders:pendingRelease.length,
      unplanned:orphanViews.length,
      sla:{on_track:orderViews.filter(o=>o.sla==="on_track").length,at_risk:orderViews.filter(o=>o.sla==="at_risk").length,breach:orderViews.filter(o=>o.sla==="breach").length}}};
}
