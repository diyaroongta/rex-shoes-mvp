import {delayReasons} from "../shared/delay-reasons.js";
import React, { useMemo, useState } from "react";
import { buildMisSnapshot } from "../shared/mis.js";
import { plannedProductionRows, productionActualSummary } from "../shared/production-actuals.js";
import { planVsActual, biggestGaps, planAdherence } from "../shared/plan-vs-actual.js";
import { fromDay } from "../shared/engine.js";
import { REF as INPUTS } from "./lib/refdata.js";

const STATUS = {
  waiting: { label:"Waiting for job card", color:"#475569", pale:"#F1F5F9" },
  on_track: { label:"On time", color:"#047857", pale:"#ECFDF5" },
  at_risk: { label:"At risk", color:"#B45309", pale:"#FFFBEB" },
  breach: { label:"Delayed", color:"#BE123C", pale:"#FFF1F2" },
};

const fmt = (value, digits=0) => Number(value || 0).toLocaleString("en-IN", {maximumFractionDigits:digits});
const pct = value => value==null ? "—" : `${fmt(value,1)}%`;
const niceDate = value => value
  ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString("en-IN", {day:"numeric",month:"short",year:"numeric"})
  : "—";
const shortDate = value => value
  ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString("en-IN", {day:"numeric",month:"short"})
  : "—";
const dateRange = group => !group || !group.from ? "No orders" : group.from===group.to
  ? niceDate(group.from) : `${shortDate(group.from)} – ${niceDate(group.to)}`;

/* THE DASHBOARD SAID EVERYTHING THREE TIMES. Thirteen large tiles, each a
   label, a number, a tinted box and a line of link text; the status counts
   again as filter chips over the table; and again as an "orders needing
   attention" list under it. One figure now has one home:

     StatusTile   how many orders are in each state — and clicking it filters
                  the table underneath, so the count and the list are one thing
     Fig          a figure in a band of four: label, number, the arithmetic   */
function StatusTile({label,count,detail,tone,pale,active,onClick,testId}){
  return <button type="button" onClick={onClick} aria-pressed={active} aria-label={`${label} · ${count}`} data-testid={testId}
    className="text-left rounded-xl border px-3.5 py-2.5 transition-colors hover:border-slate-400"
    style={{background:active?pale:"#fff",borderColor:active?tone:"#E2E8F0",boxShadow:active?`inset 0 -3px 0 ${tone}`:"none"}}>
    <div className="sign text-slate-500" style={{fontSize:10,fontWeight:600}}>{label}</div>
    <div className="flex items-baseline gap-2 mt-1.5">
      {/* A colour only when there is something to act on: a red zero says
          "look here" about nothing. */}
      <span className="mono" style={{fontSize:26,lineHeight:1,fontWeight:600,color:count==="0"?"#94A3B8":tone}}>{count}</span>
      <span className="text-slate-500 truncate" style={{fontSize:11}}>{detail}</span>
    </div>
  </button>;
}

/* A figure nobody can take apart is a figure nobody can trust. Giving `drill`
   turns the figure into a button that opens the orders behind the number, so
   "19% shortage" can be checked against the orders that produced it. */
function Fig({label,value,detail,tone="#0F2233",testId,drill,onDrill,open}){
  const body=<>
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className="mono font-semibold mt-0.5" style={{fontSize:21,lineHeight:1.15,color:tone}}>{value}</div>
    {detail && <div className="text-[10.5px] text-slate-500 mt-0.5">{detail}</div>}
    {drill && <div className="text-[10.5px] font-semibold text-indigo-700 mt-1">{open?"Hide the orders ▲":"Which orders ▼"}</div>}
  </>;
  if(!drill) return <div className="min-w-0" data-testid={testId}>{body}</div>;
  return <button type="button" onClick={()=>onDrill(open?null:drill)} data-testid={testId} aria-expanded={!!open}
    className="text-left min-w-0 rounded-lg hover:bg-slate-50" style={{margin:-6,padding:6,background:open?"#EEF2FF":undefined}}>{body}</button>;
}
function Band({title,note,children}){
  return <div className="bg-white border border-slate-200 rounded-xl p-4">
    <div className="flex items-baseline gap-2 flex-wrap mb-3">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {note && <span className="text-[11px] text-slate-400">{note}</span>}
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4">{children}</div>
  </div>;
}

/* The orders that produce one figure, with the arithmetic spelled out. Every
   row comes from the same snapshot the tile was computed from, so the two can
   never disagree. */
function Drill({metric,snapshot,fmt,pct,niceDate}){
  if(!metric) return null;
  const all=snapshot.orders||[];
  const VIEWS={
    shortage:{
      title:"Accepted shortage — orders closed with pairs never delivered",
      rows:all.filter(o=>o.shortage>0),
      sum:`${fmt(snapshot.shortage_pairs_last_30_days)} shortage pairs ÷ ${fmt(snapshot.closed_order_pairs_last_30_days)} pairs on orders closed in the last 30 days = ${pct(snapshot.dispatch_shortage_pct)}`,
      empty:"No order has been closed short. A part-shipped order that is still open counts as pending, not shortage — see Pending below.",
      cols:["Ordered","Dispatched","Shortage"], cell:o=>[o.qty,o.dispatched,o.shortage],
    },
    pending:{
      title:"Still to ship — ordered pairs not yet dispatched",
      rows:all.filter(o=>o.pending>0),
      sum:`${fmt(all.reduce((n,o)=>n+o.pending,0))} pairs outstanding across ${all.filter(o=>o.pending>0).length} order(s)`,
      empty:"Nothing outstanding.",
      cols:["Ordered","Dispatched","Pending"], cell:o=>[o.qty,o.dispatched,o.pending],
    },
    coverage:{
      title:"Order versus dispatch — last 30 days",
      rows:all.filter(o=>o.dispatched>0||o.pending>0),
      sum:`${fmt(snapshot.dispatched_last_30_days)} dispatched ÷ ${fmt(snapshot.ordered_last_30_days)} ordered in the last 30 days = ${pct(snapshot.order_vs_dispatch_pct)}`,
      empty:"No orders or dispatches in the last 30 days.",
      cols:["Ordered","Dispatched","Pending"], cell:o=>[o.qty,o.dispatched,o.pending],
    },
  };
  const v=VIEWS[metric];
  if(!v) return null;
  return <section className="bg-white border border-indigo-300 rounded-xl p-4">
    <div className="text-sm font-semibold text-slate-800">{v.title}</div>
    <div className="mono text-xs text-slate-600 mt-1">{v.sum}</div>
    {!v.rows.length
      ? <div className="text-xs text-slate-500 mt-3">{v.empty}</div>
      : <div className="overflow-x-auto mt-3"><table className="w-full text-xs" style={{minWidth:560}}>
          <thead><tr className="sign text-slate-400" style={{fontSize:9}}>
            <th className="text-left py-1">Order / PI</th><th className="text-left">Party</th><th className="text-left">Article</th>
            {v.cols.map(c=><th key={c} className="text-right">{c}</th>)}
          </tr></thead>
          <tbody>{v.rows.map(o=><tr key={o.order_no} className="border-t border-slate-100">
            <td className="py-1.5"><div className="mono font-semibold">{o.order_no}</div>
              <div className="mono text-slate-400">{o.pi_no||"No PI"}</div></td>
            <td>{o.party||"—"}</td><td>{o.article}</td>
            {v.cell(o).map((x,i)=><td key={i} className="mono text-right">{typeof x==="number"?fmt(x):x}</td>)}
          </tr>)}</tbody>
        </table></div>}
  </section>;
}

function StatusPill({status}){
  const style=STATUS[status]||STATUS.on_track;
  return <span className="inline-flex rounded-full px-2 py-0.5 font-semibold" style={{fontSize:11,color:style.color,background:style.pale}}>{style.label}</span>;
}

function TrendChart({trend}){
  const max=Math.max(1,...trend.flatMap(row=>[row.ordered,row.dispatched]));
  return <div role="img" aria-label="Ordered and dispatched pairs in six five-day periods" className="flex items-end gap-3" style={{height:190}}>
    {trend.map((row,index)=><div key={row.from} className="flex-1 h-full flex flex-col justify-end min-w-0">
      <div className="flex items-end justify-center gap-1" style={{height:142}}>
        <div title={`${fmt(row.ordered)} ordered`} style={{height:`${Math.max(row.ordered?3:0,100*row.ordered/max)}%`,width:"34%",maxWidth:28,background:"#24425E",borderRadius:"4px 4px 0 0"}} />
        <div title={`${fmt(row.dispatched)} dispatched`} style={{height:`${Math.max(row.dispatched?3:0,100*row.dispatched/max)}%`,width:"34%",maxWidth:28,background:"#0B6BCB",borderRadius:"4px 4px 0 0"}} />
      </div>
      <div className="mono text-center text-slate-400 mt-2" style={{fontSize:9,lineHeight:1.25}}>
        {shortDate(row.from)}<br/>{index===trend.length-1?shortDate(row.to):""}
      </div>
    </div>)}
  </div>;
}

function Progress({value,color="#0B6BCB"}){
  const safe=Math.max(0,Math.min(100,Number(value)||0));
  return <div className="rounded-full overflow-hidden" style={{height:6,background:"#E8EDF2"}}>
    <div style={{width:`${safe}%`,height:"100%",background:color,borderRadius:99}} />
  </div>;
}

/* WHY THIS ORDER IS WHERE IT IS.
   The board could say "at risk" and stop, which tells a director what they can
   already see. Every input to that verdict was computed and thrown away — the
   dates, the machine the work queued behind, the capacity it was divided by,
   and whether a planner moved it by hand. shared/delay-reasons.js reassembles
   them; this prints them worst first. It recalculates nothing, so it can never
   disagree with the board. */
function OrderWhy({detail,order,fmt,niceDate}){
  if(!detail) return <div className="text-xs text-slate-500 py-3">
    This order is not in the current plan, so there is nothing to explain — it may have been
    archived or completed.</div>;
  const TONE={data:{bg:"#FEF2F2",fg:"#991B1B"},planned_by_hand:{bg:"#EEF2FF",fg:"#3730A3"},
    queue:{bg:"#FFF7ED",fg:"#9A3412"},capacity:{bg:"#F8FAFC",fg:"#475569"},
    release:{bg:"#F8FAFC",fg:"#475569"},transit:{bg:"#F1F5F9",fg:"#475569"}};
  return <div className="py-3">
    <div className="flex gap-4 flex-wrap text-xs mb-3">
      {[["Customer",detail.party||"—"],["Article",detail.article],["Pairs",fmt(detail.qty)],
        ["Ordered",niceDate(detail.order_date)],["Released",niceDate(detail.release_date)],
        ["Planned dispatch",niceDate(detail.dispatch_date)],
        ["Days start to finish",`${fmt(detail.lead_days)}`]].map(([k,v])=>
        <div key={k}><div className="sign text-slate-400" style={{fontSize:9}}>{k}</div>
          <div className="mono text-slate-800">{v}</div></div>)}
    </div>
    {detail.reasons.length
      ? <>
          <div className="sign text-slate-500 mb-1" style={{fontSize:9.5}}>Why it sits where it does</div>
          <ul className="space-y-1">
            {detail.reasons.map((r,i)=>{
              const t=TONE[r.kind]||TONE.capacity;
              return <li key={i} className="text-xs rounded-lg px-2.5 py-1.5 flex gap-2 items-baseline"
                style={{background:t.bg,color:t.fg}}>
                {/* The days it cost, where the figure exists. A cause with no
                    countable cost shows no number rather than a zero. */}
                <span className="mono font-semibold whitespace-nowrap" style={{minWidth:52}}>
                  {r.days!=null?`${r.days} day${r.days===1?"":"s"}`:"—"}</span>
                <span>{r.text}</span>
              </li>;
            })}
          </ul>
        </>
      : <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
          Nothing is holding this order up — it runs straight through at the planned rate.
        </div>}
    {order.pending>0 && <div className="text-[11px] text-slate-500 mt-2">
      {fmt(order.pending)} pairs still to dispatch of {fmt(order.qty)}.</div>}
  </div>;
}

export default function MISDashboard({state,dispatches=[],productionActuals=[],dispatchLoading=false,dispatchError="",onRefresh,today}){
  const snapshot=useMemo(()=>buildMisSnapshot(state,dispatches,{today}),[state,dispatches,today]);
  const productionPlan=useMemo(()=>plannedProductionRows(state,INPUTS.origin,fromDay),[state]);
  const production=useMemo(()=>productionActualSummary(productionPlan,productionActuals,today||snapshot.as_of),
    [productionPlan,productionActuals,today,snapshot.as_of]);
  /* Planned against achieved over time, week by week. Measured on the rows
     somebody REPORTED: an unreported row is missing, not a zero. */
  const vs=useMemo(()=>planVsActual(productionPlan,productionActuals),[productionPlan,productionActuals]);
  /* Plan adherence: each plan row counts only up to what it planned, past days only. */
  const adherence=useMemo(()=>planAdherence(productionPlan,productionActuals,today||snapshot.as_of),
    [productionPlan,productionActuals,today,snapshot.as_of]);
  const [filter,setFilter]=useState("all");
  const [drill,setDrill]=useState(null);   // which figure is being taken apart
  const [search,setSearch]=useState("");
  /* BY CUSTOMER, because that is who rings up. Search already matched a party
     name, but only if you knew how it was spelled — the list is built from the
     orders themselves so every customer on the board is one click away, with
     the pairs they are waiting for. */
  const [customer,setCustomer]=useState("");
  const [openOrder,setOpenOrder]=useState(null);
  const customers=useMemo(()=>{
    const by=new Map();
    for(const order of snapshot.orders){
      const name=String(order.party||"").trim(); if(!name) continue;
      const row=by.get(name)||{name,orders:0,pairs:0,late:0};
      row.orders+=1; row.pairs+=Number(order.qty)||0;
      if(order.status==="breach"||order.status==="at_risk") row.late+=1;
      by.set(name,row);
    }
    return [...by.values()].sort((a,b)=>b.pairs-a.pairs||a.name.localeCompare(b.name));
  },[snapshot.orders]);

  const visible=snapshot.orders.filter(order=>(filter==="all"||order.status===filter)
    && (!customer || String(order.party||"")===customer)
    && (!search.trim() || [order.order_no,order.pi_no,order.party,order.article]
      .some(value=>String(value||"").toLowerCase().includes(search.trim().toLowerCase()))));
  /* The full order as the planner computed it, for the row that is open. The
     dashboard's own rows are a summary; the reasons need the stages. */
  const openDetail=useMemo(()=>{
    if(!openOrder) return null;
    const full=(state&&state.orders||[]).find(o=>o.order_no===openOrder);
    /* The work centres come from the reference document, not from `state` —
       compute() returns the plan, not the machine master, so reading them off
       state printed raw codes like MOLDING_PVC_ROTARY where the floor says
       "PVC rotary". */
    return full?delayReasons(full,{workcenters:INPUTS.workcenters||{}}):null;
  },[openOrder,state]);

  return <div className="space-y-4" aria-label="Executive MIS dashboard">
    {/* One quiet line: when this is as of, and which figures are measured
        and which are still the plan. The screen's own heading already says
        what it is. */}
    <div className="flex flex-wrap gap-2 items-center text-xs">
      <span className="mono text-slate-600">As of {niceDate(snapshot.as_of)}</span>
      <span className="rounded-full px-2.5 py-1" style={{background:"#ECFDF5",color:"#047857"}}>Dispatch: recorded actual</span>
      <span className="rounded-full px-2.5 py-1" style={{background:production.recorded_rows?"#ECFDF5":"#EFF6FF",color:production.recorded_rows?"#047857":"#1D4ED8"}}>
        Production: {production.recorded_rows?"recorded actual":"current schedule"}</span>
      {onRefresh && <button onClick={onRefresh} disabled={dispatchLoading} className="ml-auto rounded-lg border border-slate-300 bg-white text-slate-700 px-3 py-1 font-semibold disabled:opacity-50">
        {dispatchLoading?"Refreshing…":"Refresh live data"}
      </button>}
    </div>

    {dispatchError && <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs">
      Dispatch history could not be loaded. Order health is visible, but last-30-day dispatch KPIs are incomplete: {String(dispatchError).slice(0,160)}
    </div>}
    {/* WHERE EVERY ORDER STANDS, and the same five figures are the filter for
        the table under them — the count and the list cannot disagree, and
        there is no second copy of either. */}
    <section className="grid grid-cols-2 md:grid-cols-5 gap-3" aria-label="Orders by status">
      {[["all","All orders",snapshot.total_orders,`${fmt(snapshot.total_pairs)} pairs`,"#0F2233","#F1F5F9","kpi-total-orders"],
        ["waiting","Waiting",snapshot.status.waiting.count,"for a job card",STATUS.waiting.color,STATUS.waiting.pale,"kpi-waiting"],
        ["on_track","On time",snapshot.status.on_track.count,snapshot.status.on_track.count?`ships ${dateRange(snapshot.status.on_track)}`:"",STATUS.on_track.color,STATUS.on_track.pale,"kpi-on-time"],
        ["at_risk","At risk",snapshot.status.at_risk.count,snapshot.status.at_risk.count?`ships ${dateRange(snapshot.status.at_risk)}`:"",STATUS.at_risk.color,STATUS.at_risk.pale,"kpi-at-risk"],
        ["breach","Delayed",snapshot.status.breach.count,snapshot.status.breach.count?`ships ${dateRange(snapshot.status.breach)}`:"",STATUS.breach.color,STATUS.breach.pale,"kpi-delayed"],
      ].map(([key,label,count,detail,tone,pale,testId])=><StatusTile key={key} label={label} count={fmt(count)} detail={detail}
        tone={tone} pale={pale} testId={testId} active={filter===key} onClick={()=>setFilter(key)} />)}
    </section>

    {/* Order health leads the dashboard: the one table management reads first. */}
    <section className="bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <h2 className="serif text-lg font-semibold">Complete order health</h2>
        <div className="ml-auto flex gap-2 flex-wrap items-center">
          <input aria-label="Search executive orders" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Order, PI, customer, article…" className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs" style={{width:220}} />
          <select aria-label="Customer" value={customer} onChange={e=>{setCustomer(e.target.value);setOpenOrder(null);}}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white" style={{maxWidth:260}}>
            <option value="">All customers ({customers.length})</option>
            {customers.map(c=><option key={c.name} value={c.name}>
              {c.name} · {fmt(c.pairs)} pr{c.late?` · ${c.late} late`:""}</option>)}
          </select>
          {customer && <button onClick={()=>{setCustomer("");setOpenOrder(null);}}
            className="text-xs font-semibold text-indigo-700">Clear</button>}
        </div>
      </div>
      <table className="w-full text-xs" style={{minWidth:1000}}>
        <thead><tr className="sign text-slate-400" style={{fontSize:9}}>
          <th className="text-left py-2">Order / PI</th><th className="text-left">Party</th><th className="text-left">Article</th><th className="text-right pr-5">Pairs</th><th className="text-left">Health</th><th className="text-left">Order date</th><th className="text-left">Planned dispatch</th><th className="text-right pr-5">Production days</th><th className="text-left">Dispatch completion</th><th className="text-right">Pending / shortage</th>
        </tr></thead>
        <tbody>{visible.map(order=><React.Fragment key={order.order_no}>
          <tr onClick={()=>setOpenOrder(openOrder===order.order_no?null:order.order_no)}
            className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
            style={{background:openOrder===order.order_no?"#F6F8FA":undefined}}>
          <td className="py-2"><div className="mono font-semibold">{order.order_no}</div><div className="mono text-slate-400">{order.pi_no||"No PI"}</div></td>
          <td>{order.party||"—"}</td><td>{order.article}</td><td className="mono text-right pr-5">{fmt(order.qty)}</td>
          <td><StatusPill status={order.status}/>{order.bottleneck&&<div className="text-slate-400 mt-1">{order.bottleneck}{order.slip_days>0?` · ${order.slip_days}d slip`:""}</div>}</td>
          <td className="mono">{niceDate(order.order_date)}</td><td className="mono">{niceDate(order.dispatch_date)}</td><td className="mono text-right pr-5">{order.status==="waiting"?"—":fmt(order.lead_days,1)}</td>
          <td><div className="flex justify-between gap-2 mb-1"><span className="mono">{fmt(order.dispatched)} / {fmt(order.qty)}</span><span className="mono text-slate-400">{pct(order.completion_pct)}</span></div><Progress value={order.completion_pct} color={order.completion_pct>=100?"#047857":"#0B6BCB"}/></td>
          <td className="mono text-right"><div className={order.pending?"text-amber-700":"text-emerald-700"}>{fmt(order.pending)} pending</div>{order.shortage>0&&<div className="text-rose-700">{fmt(order.shortage)} short</div>}</td>
        </tr>
        {openOrder===order.order_no && <tr><td colSpan={10} className="px-3 pb-3" style={{background:"#F6F8FA"}}>
          <OrderWhy detail={openDetail} order={order} fmt={fmt} niceDate={niceDate}/>
        </td></tr>}
        </React.Fragment>)}</tbody>
      </table>
      {!visible.length && <div className="text-sm text-slate-500 text-center py-8">No orders match this dashboard filter.</div>}
    </section>
    <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Band title="Dispatch" note="last 30 days">
        <Fig label="Still to ship" value={fmt((snapshot.orders||[]).reduce((n,o)=>n+o.pending,0))}
          detail={`pairs on ${(snapshot.orders||[]).filter(o=>o.pending>0).length} order(s)`}
          tone="#B45309" testId="kpi-pending" drill="pending" onDrill={setDrill} open={drill==="pending"} />
        <Fig label="Order vs dispatch" value={pct(snapshot.order_vs_dispatch_pct)}
          detail={`${fmt(snapshot.dispatched_last_30_days)} dispatched of ${fmt(snapshot.ordered_last_30_days)} ordered${snapshot.shortfall_last_30_days>0?` · ${fmt(snapshot.shortfall_last_30_days)} short`:""}`}
          tone="#0B6BCB" testId="kpi-order-dispatch-pct" drill="coverage" onDrill={setDrill} open={drill==="coverage"} />
        <Fig label="Dispatch shortage" value={pct(snapshot.dispatch_shortage_pct)}
          detail={`${fmt(snapshot.shortage_pairs_last_30_days)} short of ${fmt(snapshot.closed_order_pairs_last_30_days)} on closed orders`}
          tone={snapshot.dispatch_shortage_pct?"#BE123C":"#047857"}
          testId="kpi-dispatch-shortage-pct" drill="shortage" onDrill={setDrill} open={drill==="shortage"} />
        <Fig label="Average dispatch days" value={fmt(snapshot.average_dispatch_days,1)}
          detail={`order to dispatch · ${fmt(snapshot.completed_orders_used_for_dispatch_days)} completed order${snapshot.completed_orders_used_for_dispatch_days===1?"":"s"}`}
          testId="kpi-average-dispatch-days" />
      </Band>
      <Band title="Production" note={production.recorded_rows?"today, as reported":"today, as scheduled"}>
        <Fig label="Today's plan" value={fmt(production.planned_pairs)}
          detail={`pairs on ${production.planned_rows} line${production.planned_rows===1?"":"s"}`}
          tone="#0B6BCB" testId="kpi-production-plan" />
        <Fig label="Today's achievement" value={fmt(production.actual_pairs)}
          detail={`${pct(production.achievement_pct)} · ${production.recorded_rows} of ${production.planned_rows} reported`}
          tone={production.recorded_rows?"#047857":"#64748B"} testId="kpi-production-actual" />
        <Fig label="Average production days" value={fmt(snapshot.average_production_days,1)}
          detail="release to dispatch, as planned" testId="kpi-production-days" />
        <Fig label="Capacity utilisation" value={pct(snapshot.capacity_util_pct)}
          detail="planned, across active machines" tone="#0B6BCB" testId="kpi-utilisation" />
      </Band>
    </section>

    <Drill metric={drill} snapshot={snapshot} fmt={fmt} pct={pct} niceDate={niceDate} />

    {/* The movement over time beside the machines that made it. The card that
        used to sit here repeated the Dispatch band figure for figure. */}
    <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="serif text-lg font-semibold">Five-day movement</h2>
            <p className="text-xs text-slate-500 mt-1">Ordered <span style={{color:"#24425E"}}>■</span> vs dispatched <span style={{color:"#0B6BCB"}}>■</span> · {shortDate(snapshot.month_from)} to {shortDate(snapshot.month_to)}</p>
          </div>
        </div>
        <TrendChart trend={snapshot.trend} />
      </div>

      <div className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto">
        <div className="mb-3"><h2 className="serif text-lg font-semibold">Average machine output</h2><p className="text-xs text-slate-500 mt-1">Scheduled pairs per busy day — planned, not measured.</p></div>
        {snapshot.machines.length ? <table className="w-full text-xs" style={{minWidth:560}}>
          <thead><tr className="sign text-slate-400" style={{fontSize:9}}>
            <th className="text-left py-2">Machine / centre</th><th className="text-left">Stage</th><th className="text-right">Avg output / busy day</th><th className="text-right">Daily capacity</th><th className="text-right">Avg util.</th><th className="text-right">Peak</th>
          </tr></thead>
          <tbody>{snapshot.machines.map(machine=><tr key={machine.work_center} className="border-t border-slate-100">
            <td className="py-2"><div className="font-semibold">{machine.name}</div><div className="mono text-slate-400">{machine.busy_days} busy day{machine.busy_days===1?"":"s"}</div></td>
            <td>{machine.stage}</td><td className="mono text-right font-semibold">{fmt(machine.average_output)}</td><td className="mono text-right">{fmt(machine.capacity_per_day)}</td>
            <td className="text-right"><div className="mono font-semibold">{pct(machine.avg_util_pct)}</div><div className="mt-1 ml-auto" style={{width:72}}><Progress value={machine.avg_util_pct} color={machine.avg_util_pct>90?"#BE123C":machine.avg_util_pct>75?"#B45309":"#0B6BCB"}/></div></td>
            <td className="mono text-right">{pct(machine.peak_util_pct)}</td>
          </tr>)}</tbody>
        </table> : <div className="text-sm text-slate-500 rounded-lg bg-slate-50 p-4">Machine output appears when orders enter the production schedule.</div>}
      </div>
    </section>


    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline gap-2 flex-wrap mb-1">
        <h3 className="text-sm font-semibold text-slate-800">Planned against achieved</h3>
        <span className="text-[11px] text-slate-400">by financial week · reported rows only</span>
      </div>
      {!vs.reported
        ? <div className="text-sm text-slate-500 py-6 text-center">
            No achievement has been reported yet, so there is nothing to compare the plan against.
          </div>
        : <>
          <div className="flex gap-4 flex-wrap text-xs mb-3">
            <Figure label="Planned (reported rows)" value={fmt(vs.totals.planned_reported)} />
            <Figure label="Achieved" value={fmt(vs.totals.actual)} />
            <Figure label="Variance" value={`${vs.totals.variance>0?"+":""}${fmt(vs.totals.variance)}`}
              tone={vs.totals.variance<0?"#B91C1C":"#047857"} />
            <Figure label="Achievement" value={pct(vs.totals.pct)} />
            <Figure label="Reported" value={`${pct(vs.totals.coverage)} of rows`}
              detail={vs.totals.unreported_planned>0?`${fmt(vs.totals.unreported_planned)} planned pairs not reported`:""} />
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500 text-left">
              <th className="py-1">Week</th><th className="py-1">Dates</th>
              <th className="py-1 text-right">Planned</th><th className="py-1 text-right">Achieved</th>
              <th className="py-1 text-right">Variance</th><th className="py-1 text-right">%</th>
              <th className="py-1 text-right">Reported</th></tr></thead>
            <tbody>{vs.weeks.map(w=><tr key={w.key} className="border-t border-slate-100">
              <td className="py-1 font-semibold text-slate-800">{w.short_label||w.label}</td>
              <td className="py-1 text-slate-500">{w.from} — {w.to}</td>
              <td className="py-1 mono text-right">{fmt(w.planned_reported)}</td>
              <td className="py-1 mono text-right">{fmt(w.actual)}</td>
              <td className={`py-1 mono text-right ${w.variance<0?"text-rose-700":"text-emerald-700"}`}>
                {w.reported_rows?`${w.variance>0?"+":""}${fmt(w.variance)}`:"—"}</td>
              <td className="py-1 mono text-right">{w.pct==null?"not reported":pct(w.pct)}</td>
              <td className="py-1 mono text-right text-slate-500">{w.reported_rows}/{w.rows}</td>
            </tr>)}</tbody>
          </table>
          {!!biggestGaps(vs,3).filter(d=>d.variance<0).length&&<div className="text-[11px] text-slate-600 mt-2">
            <b>Furthest behind:</b> {biggestGaps(vs,3).filter(d=>d.variance<0)
              .map(d=>`${d.date} (${fmt(d.variance)})`).join(" · ")}
          </div>}
        </>}
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Plan adherence">
      <div className="flex items-baseline gap-2 flex-wrap mb-1">
        <h3 className="text-sm font-semibold text-slate-800">Plan adherence</h3>
        <span className="text-[11px] text-slate-400">production plan against what was made · up to {adherence.as_of}</span>
      </div>
      {!adherence.reported
        ? <div className="text-sm text-slate-500 py-6 text-center">No production has been reported against a past plan day yet.</div>
        : <>
          <div className="flex gap-6 flex-wrap text-xs mb-3">
            <Figure label="Plan adherence" value={pct(adherence.totals.adherence)}
              tone={adherence.totals.adherence>=90?"#047857":adherence.totals.adherence>=75?"#B45309":"#B91C1C"} />
            <Figure label="Strict (unreported = missed)" value={pct(adherence.totals.adherence_all)} />
            <Figure label="Planned (past, reported)" value={fmt(adherence.totals.planned_reported)} />
            <Figure label="Made to plan" value={fmt(adherence.totals.met_reported)}
              detail={adherence.totals.shortfall>0?`${fmt(adherence.totals.shortfall)} pairs short of plan`:""} />
            <Figure label="Reported" value={`${pct(adherence.totals.coverage)} of past rows`} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <table className="w-full text-xs"><thead><tr className="text-slate-500 text-left">
              <th className="py-1">Week</th><th className="py-1 text-right">Planned</th><th className="py-1 text-right">Made to plan</th>
              <th className="py-1 text-right">Adherence</th><th className="py-1 text-right">Strict</th></tr></thead>
              <tbody>{adherence.weeks.map(w=><tr key={w.key} className="border-t border-slate-100">
                <td className="py-1 font-semibold text-slate-800">{w.short_label||w.label}<div className="text-[10px] font-normal text-slate-400">{w.from} — {w.to}</div></td>
                <td className="py-1 mono text-right">{fmt(w.planned)}</td><td className="py-1 mono text-right">{fmt(w.met)}</td>
                <td className="py-1 mono text-right font-semibold">{w.adherence==null?"not reported":pct(w.adherence)}</td>
                <td className="py-1 mono text-right text-slate-500">{pct(w.adherence_all)}</td></tr>)}</tbody></table>
            <table className="w-full text-xs"><thead><tr className="text-slate-500 text-left">
              <th className="py-1">Stage</th><th className="py-1 text-right">Planned</th><th className="py-1 text-right">Adherence</th><th className="py-1 text-right">Reported</th></tr></thead>
              <tbody>{adherence.stages.map(st=><tr key={st.key} className="border-t border-slate-100">
                <td className="py-1">{st.stage}</td><td className="py-1 mono text-right">{fmt(st.planned)}</td>
                <td className="py-1 mono text-right font-semibold">{st.adherence==null?"—":pct(st.adherence)}</td>
                <td className="py-1 mono text-right text-slate-500">{st.reported_rows}/{st.rows}</td></tr>)}</tbody></table>
          </div>
        </>}
    </section>

    <details className="bg-white border border-slate-200 rounded-xl p-4">
      <summary className="text-sm font-semibold text-indigo-800 cursor-pointer">Show MIS calculation logic</summary>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mt-4 text-xs text-slate-600">
        <div><b className="text-slate-800">Order vs dispatch %</b><br/>Pairs recorded as dispatched in the last 30 days ÷ pairs on orders raised in the last 30 days × 100. Current calculation: {fmt(snapshot.dispatched_last_30_days)} ÷ {fmt(snapshot.ordered_last_30_days)} × 100 = <b>{pct(snapshot.order_vs_dispatch_pct)}</b>.</div>
        <div><b className="text-slate-800">Dispatch shortage %</b><br/>Accepted shortage pairs on orders completed or closed in the last 30 days ÷ the original ordered pairs on those same closed orders × 100. Current calculation: {fmt(snapshot.shortage_pairs_last_30_days)} ÷ {fmt(snapshot.closed_order_pairs_last_30_days)} × 100 = <b>{pct(snapshot.dispatch_shortage_pct)}</b>.</div>
        <div><b className="text-slate-800">Average dispatch days</b><br/>For fully dispatched or deliberately closed orders: calendar days from order date to completed dispatch date, added together ÷ completed orders. Open and partially dispatched orders are excluded.</div>
        <div><b className="text-slate-800">Average production days</b><br/>Sum of the planner&rsquo;s scheduled release-to-dispatch lead days ÷ live scheduled orders.</div>
        <div><b className="text-slate-800">Capacity utilisation</b><br/>Average of each active work centre&rsquo;s planned utilisation percentage. It is planned capacity until actual shop-floor output is connected.</div>
        <div><b className="text-slate-800">Achievement % (planned against achieved)</b><br/>By the factory&rsquo;s own financial week. Percentages compare the rows that were reported, like for like; a row nobody reported is counted as missing, never as zero achieved.</div>
        <div><b className="text-slate-800">Adherence % and strict %</b><br/>Each plan row counts only up to what it planned, so making extra of one job never hides a shortfall on another. <b>Adherence</b> is over the rows reported; <b>strict</b> also counts unreported past rows as missed.</div>
        <div><b className="text-slate-800">Waiting / on time / at risk / delayed</b><br/>An order stays Waiting until a job card releases it. Once scheduled, its delivery health is calculated from the current production plan. The displayed date range is the earliest to latest planned dispatch date in that status.</div>
      </div>
    </details>

    {/* A footnote, not a banner: it is true every day. */}
    <div className="text-[11px] text-slate-500 px-1">
      <b>Where the figures come from:</b> order dates, schedule health and machine utilisation come from the Factory OS plan; production achievement, rejection, repair and cartons come from Daily plan vs achievement; dispatch comes from recorded packing reports. The plan skips Sundays and the holidays set on Production plan → Capacity.
      {production.recorded_rows===0&&<> Until achievement is uploaded, production output is <b>scheduled—not actual</b>.</>}
    </div>
  </div>;
}

/* A small labelled figure, for the planned-against-achieved band. */
function Figure({label,value,detail="",tone="#0F2233"}){
  return <div>
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className="text-base font-semibold mono" style={{color:tone}}>{value}</div>
    {detail&&<div className="text-[10px] text-slate-500">{detail}</div>}
  </div>;
}
