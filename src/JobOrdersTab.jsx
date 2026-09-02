import React, { useEffect, useMemo, useState } from "react";
import * as api from "./lib/client.js";
import { jobOrderQueue } from "../shared/job-orders.js";

const fmt = n => n==null||isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");

/* The production allocation queue immediately after the Order Book. Every
   live Order Book row enters here; issued job cards consume it. No hidden PI
   status or material guess decides whether an order is present. */
export default function JobOrdersTab({ orders=[], shortfall, onCreateCard }){
  const [jobs,setJobs]=useState(null);
  const [err,setErr]=useState("");
  const [showDone,setShowDone]=useState(false);

  useEffect(()=>{ (async()=>{
    try{ setJobs(await api.listJobWork()); setErr(""); }
    catch(e){ setJobs([]); setErr(e.message||String(e)); }
  })(); },[]);

  const queue=useMemo(()=>jobOrderQueue(orders,jobs||[]),[orders,jobs]);
  const waiting=queue.filter(row=>row.remaining>0);
  const done=queue.filter(row=>row.remaining<=0);
  const waitingPairs=waiting.reduce((a,row)=>a+row.remaining,0);

  if(jobs===null) return <div className="p-5 text-sm text-slate-500">Loading Job Orders…</div>;

  return <div className="p-4 md:p-5">
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      <div className="text-sm font-semibold text-slate-800">Order Book → Job Orders</div>
      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
        Every active row in the Order Book comes here automatically. A row stays open until its ordered pairs have
        been assigned on issued job cards; a partial card leaves the unassigned balance here.
      </p>
      <div className="text-xs text-slate-700 mt-2"><b>{fmt(waitingPairs)}</b> pairs waiting across <b>{waiting.length}</b> order{waiting.length===1?"":"s"}.</div>
    </div>

    {err&&<div role="alert" className="mb-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">{err}</div>}
    {!waiting.length&&!err&&<div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">No unassigned Order Book quantities.</div>}

    {waiting.map(row=>{
      const order=row.order;
      const piNo=String(order.pi?.pi_no||"");
      const material=piNo&&(shortfall||{})[piNo];
      return <div key={order.order_no} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-slate-800"><span className="mono">{order.order_no}</span> · {order.article_code}</div>
            <div className="text-xs text-slate-500">{order.party||"—"}{piNo?` · ${piNo}`:""}</div>
          </div>
          <div className="text-xs text-slate-600" aria-label={`${row.remaining} unassigned of ${row.ordered}`}><b className="mono text-slate-800">{fmt(row.remaining)}</b> unassigned of {fmt(row.ordered)}</div>
          {material&&(material.can_run
            ?<span className="text-xs font-semibold text-emerald-700">Material in stock</span>
            :<span className="text-xs font-semibold text-orange-800 border border-orange-300 bg-orange-50 rounded-lg px-2 py-0.5">{material.short_count} material{material.short_count===1?"":"s"} short</span>)}
          <button onClick={()=>onCreateCard?.(order.order_no)}
            aria-label={`Create job card for ${order.order_no}`}
            className="ml-auto text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-amber-700 hover:bg-amber-800">
            Create job card
          </button>
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs"><thead className="text-slate-500"><tr>
            <th className="text-left py-1">Size range</th><th className="text-right">Order Book</th>
            <th className="text-right">On issued cards</th><th className="text-right">Still to assign</th>
          </tr></thead><tbody>{row.lines.map(line=><tr key={line.combo} className="border-t border-slate-100">
            <td className="py-1.5 mono font-semibold">{line.combo}</td><td className="text-right mono">{fmt(line.ordered)}</td>
            <td className="text-right mono text-slate-500">{fmt(line.issued)}</td><td className="text-right mono font-semibold">{fmt(line.remaining)}</td>
          </tr>)}</tbody></table>
        </div>
      </div>;
    })}

    {!!done.length&&<div className="mt-4">
      <button onClick={()=>setShowDone(v=>!v)} className="text-xs font-semibold text-slate-600 underline">{showDone?"Hide":"Show"} {done.length} fully assigned order{done.length===1?"":"s"}</button>
      {showDone&&<div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">{done.map(row=><div key={row.order.order_no} className="text-xs text-slate-600 py-0.5"><span className="mono font-semibold">{row.order.order_no}</span> · {row.order.article_code}<span className="ml-2 text-emerald-700 font-semibold">fully assigned</span></div>)}</div>}
    </div>}
  </div>;
}
