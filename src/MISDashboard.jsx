import React, { useMemo, useState } from "react";
import { buildMisSnapshot } from "../shared/mis.js";

const STATUS = {
  on_track: { label:"On time", color:"#047857", pale:"#ECFDF5" },
  at_risk: { label:"At risk", color:"#B45309", pale:"#FFFBEB" },
  breach: { label:"Delayed", color:"#BE123C", pale:"#FFF1F2" },
};

const fmt = (value, digits=0) => Number(value || 0).toLocaleString("en-IN", {maximumFractionDigits:digits});
const pct = value => `${fmt(value,1)}%`;
const niceDate = value => value
  ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString("en-IN", {day:"numeric",month:"short",year:"numeric"})
  : "—";
const shortDate = value => value
  ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString("en-IN", {day:"numeric",month:"short"})
  : "—";
const dateRange = group => !group || !group.from ? "No orders" : group.from===group.to
  ? niceDate(group.from) : `${shortDate(group.from)} – ${niceDate(group.to)}`;

function Kpi({label,value,detail,tone="#0F2233",pale="#F6F8FA",testId}){
  return <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid={testId}>
    <div className="sign text-slate-500" style={{fontSize:10,fontWeight:600}}>{label}</div>
    <div className="mono mt-2" style={{fontSize:27,lineHeight:1,fontWeight:600,color:tone}}>{value}</div>
    <div className="mt-3 rounded-md px-2 py-1.5" style={{fontSize:11.5,color:tone,background:pale,minHeight:31}}>{detail}</div>
  </div>;
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

export default function MISDashboard({state,dispatches=[],dispatchLoading=false,dispatchError="",onRefresh,today}){
  const snapshot=useMemo(()=>buildMisSnapshot(state,dispatches,{today}),[state,dispatches,today]);
  const [filter,setFilter]=useState("all");
  const [search,setSearch]=useState("");
  const visible=snapshot.orders.filter(order=>(filter==="all"||order.status===filter)
    && (!search.trim() || [order.order_no,order.pi_no,order.party,order.article]
      .some(value=>String(value||"").toLowerCase().includes(search.trim().toLowerCase()))));
  const attention=snapshot.orders.filter(order=>order.status!=="on_track").slice(0,6);
  const barMax=Math.max(1,snapshot.ordered_last_30_days,snapshot.dispatched_last_30_days,snapshot.shortfall_last_30_days);

  return <div className="space-y-4" aria-label="Executive MIS dashboard">
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap gap-3 items-center">
      <div className="min-w-0 flex-1">
        <div className="sign text-slate-700" style={{fontSize:12,fontWeight:700}}>Management control view</div>
        <p className="text-xs text-slate-500 mt-1">Order health, delivery outlook, dispatch performance and planned machine loading in one screen.</p>
      </div>
      <div className="ml-auto flex flex-wrap gap-2 text-xs">
        <span className="rounded-full px-2.5 py-1" style={{background:"#ECFDF5",color:"#047857"}}>Dispatch: recorded actual</span>
        <span className="rounded-full px-2.5 py-1" style={{background:"#EFF6FF",color:"#1D4ED8"}}>Production: current schedule</span>
        <span className="mono rounded-full bg-slate-100 text-slate-600 px-2.5 py-1">As of {niceDate(snapshot.as_of)}</span>
        {onRefresh && <button onClick={onRefresh} disabled={dispatchLoading} className="rounded-full border border-slate-300 bg-white text-slate-700 px-2.5 py-1 font-semibold disabled:opacity-50">
          {dispatchLoading?"Refreshing…":"Refresh live data"}
        </button>}
      </div>
    </section>

    {dispatchError && <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs">
      Dispatch history could not be loaded. Order health is visible, but last-30-day dispatch KPIs are incomplete: {String(dispatchError).slice(0,160)}
    </div>}

    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
      <Kpi label="Total live orders" value={fmt(snapshot.total_orders)} detail={`${fmt(snapshot.total_pairs)} ordered pairs`} testId="kpi-total-orders" />
      <Kpi label="Orders on time" value={fmt(snapshot.status.on_track.count)} detail={dateRange(snapshot.status.on_track)} tone={STATUS.on_track.color} pale={STATUS.on_track.pale} testId="kpi-on-time" />
      <Kpi label="Orders at risk" value={fmt(snapshot.status.at_risk.count)} detail={dateRange(snapshot.status.at_risk)} tone={STATUS.at_risk.color} pale={STATUS.at_risk.pale} testId="kpi-at-risk" />
      <Kpi label="Delayed orders" value={fmt(snapshot.status.breach.count)} detail={dateRange(snapshot.status.breach)} tone={STATUS.breach.color} pale={STATUS.breach.pale} testId="kpi-delayed" />
      <Kpi label="Avg production days" value={fmt(snapshot.average_production_days,1)} detail="Average scheduled release-to-dispatch lead time" testId="kpi-production-days" />
      <Kpi label="Capacity utilisation" value={pct(snapshot.capacity_util_pct)} detail="Average planned utilisation across active centres" tone="#0B6BCB" pale="#EFF6FF" testId="kpi-utilisation" />
    </section>

    <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Kpi label="Order vs dispatch %" value={pct(snapshot.order_vs_dispatch_pct)}
        detail={`${fmt(snapshot.dispatched_last_30_days)} dispatched ÷ ${fmt(snapshot.ordered_last_30_days)} ordered pairs · last 30 days`}
        tone="#0B6BCB" pale="#EFF6FF" testId="kpi-order-dispatch-pct" />
      <Kpi label="Dispatch shortage %" value={pct(snapshot.dispatch_shortage_pct)}
        detail={`${fmt(snapshot.shortage_pairs_last_30_days)} shortage ÷ ${fmt(snapshot.closed_order_pairs_last_30_days)} pairs on orders closed in 30 days`}
        tone={snapshot.dispatch_shortage_pct?"#BE123C":"#047857"} pale={snapshot.dispatch_shortage_pct?"#FFF1F2":"#ECFDF5"}
        testId="kpi-dispatch-shortage-pct" />
      <Kpi label="Average dispatch days" value={fmt(snapshot.average_dispatch_days,1)}
        detail={`${fmt(snapshot.completed_orders_used_for_dispatch_days)} completed order${snapshot.completed_orders_used_for_dispatch_days===1?"":"s"} · order date to completed dispatch`}
        tone="#334155" pale="#F8FAFC" testId="kpi-average-dispatch-days" />
    </section>

    <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="serif text-lg font-semibold">Order versus dispatch — last 30 days</h2>
            <p className="text-xs text-slate-500 mt-1">{niceDate(snapshot.month_from)} to {niceDate(snapshot.month_to)} · orders use order date; dispatch uses recorded dispatch date.</p>
          </div>
          {dispatchLoading && <span className="text-xs text-slate-400">Refreshing dispatch history…</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          {[
            ["Ordered",snapshot.ordered_last_30_days,"#24425E"],
            ["Dispatched",snapshot.dispatched_last_30_days,"#0B6BCB"],
            ["Shortfall",snapshot.shortfall_last_30_days,snapshot.shortfall_last_30_days?"#BE123C":"#047857"],
          ].map(([label,value,color])=><div key={label} className="rounded-lg bg-slate-50 px-3 py-3">
            <div className="sign text-slate-500" style={{fontSize:10}}>{label} pairs</div>
            <div className="mono text-xl font-semibold mt-1" style={{color}}>{fmt(value)}</div>
            <div className="mt-2 rounded-full overflow-hidden" style={{height:5,background:"#E3E8EE"}}>
              <div style={{height:"100%",width:`${100*Number(value)/barMax}%`,background:color,borderRadius:99}} />
            </div>
          </div>)}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1"><Progress value={snapshot.order_vs_dispatch_pct} /></div>
          <div className="mono text-sm font-semibold text-slate-700">{pct(snapshot.order_vs_dispatch_pct)} order vs dispatch</div>
        </div>
      </div>

      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="serif text-lg font-semibold">Five-day movement</h2>
            <p className="text-xs text-slate-500 mt-1">Ordered <span style={{color:"#24425E"}}>■</span> vs dispatched <span style={{color:"#0B6BCB"}}>■</span></p>
          </div>
        </div>
        <TrendChart trend={snapshot.trend} />
      </div>
    </section>

    <details className="bg-white border border-slate-200 rounded-xl p-4">
      <summary className="text-sm font-semibold text-indigo-800 cursor-pointer">Show MIS calculation logic</summary>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mt-4 text-xs text-slate-600">
        <div><b className="text-slate-800">Order vs dispatch %</b><br/>Pairs recorded as dispatched in the last 30 days ÷ pairs on orders raised in the last 30 days × 100. Current calculation: {fmt(snapshot.dispatched_last_30_days)} ÷ {fmt(snapshot.ordered_last_30_days)} × 100 = <b>{pct(snapshot.order_vs_dispatch_pct)}</b>.</div>
        <div><b className="text-slate-800">Dispatch shortage %</b><br/>Accepted shortage pairs on orders completed or closed in the last 30 days ÷ the original ordered pairs on those same closed orders × 100. Current calculation: {fmt(snapshot.shortage_pairs_last_30_days)} ÷ {fmt(snapshot.closed_order_pairs_last_30_days)} × 100 = <b>{pct(snapshot.dispatch_shortage_pct)}</b>.</div>
        <div><b className="text-slate-800">Average dispatch days</b><br/>For fully dispatched or deliberately closed orders: calendar days from order date to completed dispatch date, added together ÷ completed orders. Open and partially dispatched orders are excluded.</div>
        <div><b className="text-slate-800">Average production days</b><br/>Sum of the planner&rsquo;s scheduled release-to-dispatch lead days ÷ live scheduled orders.</div>
        <div><b className="text-slate-800">Capacity utilisation</b><br/>Average of each active work centre&rsquo;s planned utilisation percentage. It is planned capacity until actual shop-floor output is connected.</div>
        <div><b className="text-slate-800">On time / at risk / delayed</b><br/>Uses the current production schedule&rsquo;s SLA status for each live order. The displayed date range is the earliest to latest planned dispatch date in that status.</div>
      </div>
    </details>

    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div><h2 className="serif text-lg font-semibold">Orders needing attention</h2><p className="text-xs text-slate-500 mt-1">Delayed first, then at-risk orders by planned dispatch date.</p></div>
          <span className="mono text-xs rounded-full bg-rose-50 text-rose-700 px-2 py-1">{attention.length} shown</span>
        </div>
        {attention.length ? <table className="w-full text-xs" style={{minWidth:620}}>
          <thead><tr className="sign text-slate-400" style={{fontSize:9}}>
            <th className="text-left py-2">Order / PI</th><th className="text-left">Customer</th><th className="text-left">Article</th><th className="text-left">Risk stage</th><th className="text-left">Planned dispatch</th><th className="text-right">Pending</th>
          </tr></thead>
          <tbody>{attention.map(order=><tr key={order.order_no} className="border-t border-slate-100">
            <td className="py-2"><div className="mono font-semibold">{order.order_no}</div><div className="mono text-slate-400">{order.pi_no||"No PI"}</div></td>
            <td>{order.party||"—"}</td><td>{order.article}</td>
            <td><StatusPill status={order.status}/><div className="text-slate-500 mt-1">{order.bottleneck||"Schedule"}{order.slip_days>0?` · ${order.slip_days}d slip`:""}</div></td>
            <td className="mono">{niceDate(order.dispatch_date)}</td>
            <td className="mono text-right font-semibold">{fmt(order.pending)}</td>
          </tr>)}</tbody>
        </table> : <div className="rounded-lg bg-emerald-50 text-emerald-800 text-sm p-4">No orders are currently marked at risk or delayed.</div>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto">
        <div className="mb-3"><h2 className="serif text-lg font-semibold">Average machine output</h2><p className="text-xs text-slate-500 mt-1">Scheduled pairs per busy day. This becomes actual output after the shop-floor actual feed is connected.</p></div>
        {snapshot.machines.length ? <table className="w-full text-xs" style={{minWidth:620}}>
          <thead><tr className="sign text-slate-400" style={{fontSize:9}}>
            <th className="text-left py-2">Machine / centre</th><th className="text-left">Stage</th><th className="text-right">Avg output / busy day</th><th className="text-right">Daily capacity</th><th className="text-right">Avg util.</th><th className="text-right">Peak</th>
          </tr></thead>
          <tbody>{snapshot.machines.map(machine=><tr key={machine.work_center} className="border-t border-slate-100">
            <td className="py-2"><div className="font-semibold">{machine.name}</div><div className="mono text-slate-400">{machine.work_center} · {machine.busy_days} busy days</div></td>
            <td>{machine.stage}</td><td className="mono text-right font-semibold">{fmt(machine.average_output)}</td><td className="mono text-right">{fmt(machine.capacity_per_day)}</td>
            <td className="text-right"><div className="mono font-semibold">{pct(machine.avg_util_pct)}</div><div className="mt-1 ml-auto" style={{width:72}}><Progress value={machine.avg_util_pct} color={machine.avg_util_pct>90?"#BE123C":machine.avg_util_pct>75?"#B45309":"#0B6BCB"}/></div></td>
            <td className="mono text-right">{pct(machine.peak_util_pct)}</td>
          </tr>)}</tbody>
        </table> : <div className="text-sm text-slate-500 rounded-lg bg-slate-50 p-4">Machine output appears when orders enter the production schedule.</div>}
      </div>
    </section>

    <section className="bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto">
      <div className="flex items-start gap-3 flex-wrap mb-3">
        <div><h2 className="serif text-lg font-semibold">Complete order health</h2><p className="text-xs text-slate-500 mt-1">One management row per order with delivery outlook and dispatch completion.</p></div>
        <div className="ml-auto flex gap-2 flex-wrap items-center">
          <input aria-label="Search executive orders" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Order, PI, customer, article…" className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs" style={{width:220}} />
          {[["all","All",snapshot.total_orders],["on_track","On time",snapshot.status.on_track.count],["at_risk","At risk",snapshot.status.at_risk.count],["breach","Delayed",snapshot.status.breach.count]].map(([key,label,count])=><button key={key} onClick={()=>setFilter(key)} aria-pressed={filter===key} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{background:filter===key?"#0F2233":"#fff",color:filter===key?"#fff":"#52606D",borderColor:filter===key?"#0F2233":"#D7DEE6"}}>{label} · {count}</button>)}
        </div>
      </div>
      <table className="w-full text-xs" style={{minWidth:1000}}>
        <thead><tr className="sign text-slate-400" style={{fontSize:9}}>
          <th className="text-left py-2">Order / PI</th><th className="text-left">Party</th><th className="text-left">Article</th><th className="text-right">Pairs</th><th className="text-left">Health</th><th className="text-left">Order date</th><th className="text-left">Planned dispatch</th><th className="text-right">Production days</th><th className="text-left">Dispatch completion</th><th className="text-right">Pending / shortage</th>
        </tr></thead>
        <tbody>{visible.map(order=><tr key={order.order_no} className="border-t border-slate-100">
          <td className="py-2"><div className="mono font-semibold">{order.order_no}</div><div className="mono text-slate-400">{order.pi_no||"No PI"}</div></td>
          <td>{order.party||"—"}</td><td>{order.article}</td><td className="mono text-right">{fmt(order.qty)}</td>
          <td><StatusPill status={order.status}/>{order.bottleneck&&<div className="text-slate-400 mt-1">{order.bottleneck}</div>}</td>
          <td className="mono">{niceDate(order.order_date)}</td><td className="mono">{niceDate(order.dispatch_date)}</td><td className="mono text-right">{fmt(order.lead_days,1)}</td>
          <td><div className="flex justify-between gap-2 mb-1"><span className="mono">{fmt(order.dispatched)} / {fmt(order.qty)}</span><span className="mono text-slate-400">{pct(order.completion_pct)}</span></div><Progress value={order.completion_pct} color={order.completion_pct>=100?"#047857":"#0B6BCB"}/></td>
          <td className="mono text-right"><div className={order.pending?"text-amber-700":"text-emerald-700"}>{fmt(order.pending)} pending</div>{order.shortage>0&&<div className="text-rose-700">{fmt(order.shortage)} short</div>}</td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <div className="text-sm text-slate-500 text-center py-8">No orders match this dashboard filter.</div>}
    </section>

    <div className="rounded-lg border border-blue-200 bg-blue-50 text-blue-900 px-3 py-2 text-xs">
      <b>Data boundary:</b> order dates, schedule health and machine utilisation update from the live Factory OS plan; dispatch updates from recorded packing reports. Shop-floor actual good pairs, rejection and downtime are not yet stored in Factory OS, so machine output is explicitly shown as scheduled—not actual.
    </div>
  </div>;
}
