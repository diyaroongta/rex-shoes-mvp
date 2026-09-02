import React, { useEffect, useMemo, useState } from "react";
import * as api from "./lib/client.js";
import { remainingForPi } from "../shared/pi-split.js";

/* Production job orders.
 *
 * Creating the job order used to be a button inside the PI database, which put
 * a production decision inside a commercial record and meant the person doing
 * the day's releasing had to hunt through issued invoices to find the work
 * still owed. This screen asks the only question that matters on the floor —
 * what is still owed, and how much of it do we start now — and the PI database
 * goes back to being the record of what was invoiced.
 *
 * A PI is deliberately NOT released all at once. A large order is normally made
 * in several runs, so each release becomes its own production order that
 * schedules and dispatches on its own. Whatever is left stays on the PI and can
 * be released later; the invoice is unchanged either way.
 */

const fmt = n => n==null||isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");
const key = (orderNo, combo) => `${orderNo}|${combo}`;

export default function JobOrdersTab({ orders=[], shortfall, onScheduled }){
  const [pis, setPis] = useState(null);
  const [openPi, setOpenPi] = useState(null);
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [showDone, setShowDone] = useState(false);

  async function reload(){
    try{ setPis(await api.listPis()); setErr(""); }
    catch(e){ setErr(e.message||String(e)); setPis([]); }
  }
  useEffect(()=>{ reload(); },[]);

  /* WHAT IS STILL OWED, not what is absent. A PI released in two runs already
     has production orders against it, so "is it on the schedule" answers yes
     while half the pairs have never been made. */
  const outstandingFor = pi =>
    remainingForPi((pi.snapshot&&pi.snapshot.orders)||[], orders||[], pi.pi_no);

  const rows = useMemo(()=>(pis||[]).map(p => {
    const owed = outstandingFor(p);
    return { pi:p, owed, owedPairs: owed.reduce((a,r)=>a+r.remaining,0) };
  }), [pis, orders]);

  const waiting = rows.filter(r => r.owedPairs > 0);
  const done    = rows.filter(r => r.owedPairs <= 0);
  const totalWaiting = waiting.reduce((a,r)=>a+r.owedPairs,0);

  const asked = (orderNo, combo) => {
    const raw = picked[key(orderNo,combo)];
    const n = Number(raw);
    return raw===""||raw==null||!isFinite(n) ? 0 : Math.floor(n);
  };

  function openFor(row){
    const open = openPi === row.pi.pi_no;
    setOpenPi(open ? null : row.pi.pi_no);
    setMsg(""); setErr("");
    setPicked(open ? {} : Object.fromEntries(row.owed.flatMap(r =>
      r.lines.filter(l=>l.remaining>0).map(l=>[key(r.order_no,l.combo), String(l.remaining)]))));
  }

  async function create(piNo, parts){
    setBusy(piNo); setErr(""); setMsg("");
    try{
      const result = await api.releasePiParts(piNo, parts);
      if(onScheduled) await onScheduled();
      await reload();
      setOpenPi(null); setPicked({});
      const made = result.created||[];
      const pairs = made.reduce((a,c)=>a+(Number(c.pairs)||0),0);
      const left = (result.outstanding||[]).reduce((a,o)=>a+(Number(o.remaining)||0),0);
      setMsg(`${piNo}: ${made.length} job order${made.length===1?"":"s"} created for ${fmt(pairs)} pairs`
        + (left>0 ? `. ${fmt(left)} pairs still owed on this PI.` : ". This PI is now fully released."));
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(""); }
  }

  if(pis===null) return <div className="p-5 text-sm text-slate-500">Loading PIs…</div>;

  return <div className="p-4 md:p-5">
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <div className="text-sm font-semibold text-slate-800">Work waiting to be started</div>
        <div className="text-xs text-slate-600">
          {waiting.length
            ? <><b>{fmt(totalWaiting)}</b> pairs across <b>{waiting.length}</b> PI{waiting.length===1?"":"s"}</>
            : "Every issued PI has been fully released into production."}
        </div>
      </div>
      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
        A job order is one production run. Release as much or as little of a PI as the floor
        can start now — the rest stays owed and can be released later, and the invoice does
        not change either way.
      </p>
    </div>

    {msg && <div role="status" className="mb-3 text-xs rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">{msg}</div>}
    {err && <div role="alert" className="mb-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">{err}</div>}

    {!waiting.length && !err && (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Nothing is waiting. New work appears here as soon as a PI is issued.
      </div>
    )}

    {waiting.map(row => {
      const p = row.pi;
      const isOpen = openPi === p.pi_no;
      const g = (shortfall||{})[p.pi_no];
      const parts = row.owed.map(r => ({
        order_no: r.order_no,
        qty: Object.fromEntries(r.lines
          .filter(l => asked(r.order_no,l.combo) > 0)
          .map(l => [l.combo, asked(r.order_no,l.combo)])),
      })).filter(pt => Object.keys(pt.qty).length);
      const totalAsked = parts.reduce((a,pt)=>a+Object.values(pt.qty).reduce((x,y)=>x+y,0),0);
      const over = row.owed.flatMap(r => r.lines
        .filter(l => asked(r.order_no,l.combo) > l.remaining)
        .map(l => `${r.order_no} ${l.combo}`));

      return <div key={p.pi_no} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-slate-800">
              <span className="mono">{p.pi_no}</span> · {p.party||"—"}
            </div>
            <div className="text-xs text-slate-500 mono">{p.pi_date||""}</div>
          </div>
          <div className="text-xs">
            <span className="text-slate-500">Still owed </span>
            <b className="mono text-slate-800">{fmt(row.owedPairs)}</b>
            <span className="text-slate-500"> pairs</span>
          </div>
          {/* Whether the material is actually there, after every PI ahead of
              this one in the queue has taken its stock. Starting a run that
              cannot be finished is worse than not starting it. */}
          {g && (g.can_run
            ? <span className="text-xs font-semibold text-emerald-700">Material in stock</span>
            : <span className="text-xs font-semibold text-orange-800 border border-orange-300 bg-orange-50 rounded-lg px-2 py-0.5">
                {g.short_count} material{g.short_count===1?"":"s"} short</span>)}
          <button onClick={()=>openFor(row)} disabled={busy===p.pi_no}
            aria-label={`Create job orders for ${p.pi_no}`}
            className="ml-auto text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-amber-700 hover:bg-amber-800 disabled:opacity-40">
            {busy===p.pi_no ? "Creating…" : isOpen ? "Close" : `Create job order…`}
          </button>
        </div>

        {isOpen && <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50/70 px-3 py-3">
          <div className="text-sm font-semibold text-amber-900 mb-2">
            How many pairs to start now
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs" style={{borderCollapse:"collapse",minWidth:520}}>
              <thead><tr className="text-slate-600">
                <th className="text-left py-1 pr-3">Article</th>
                <th className="text-left py-1 pr-3">Size range</th>
                <th className="text-right py-1 pr-3">On the PI</th>
                <th className="text-right py-1 pr-3">Already made</th>
                <th className="text-right py-1 pr-3">Still owed</th>
                <th className="text-left py-1">Start now</th>
              </tr></thead>
              <tbody>
                {row.owed.flatMap(r => r.lines.filter(l=>l.remaining>0).map((l,li)=>(
                  <tr key={key(r.order_no,l.combo)} style={{borderTop:"1px solid #f3d8bd"}}>
                    <td className="py-1 pr-3">{li===0
                      ? <><span className="mono font-semibold">{r.order_no}</span> {r.article_code}</> : ""}</td>
                    <td className="py-1 pr-3 mono">{l.combo}</td>
                    <td className="py-1 pr-3 text-right mono text-slate-500">{fmt(l.ordered)}</td>
                    <td className="py-1 pr-3 text-right mono text-slate-500">{fmt(l.released)}</td>
                    <td className="py-1 pr-3 text-right mono font-semibold">{fmt(l.remaining)}</td>
                    <td className="py-1">
                      <input type="number" min="0" max={l.remaining} step="1"
                        aria-label={`Pairs of ${l.combo} to release from ${r.order_no}`}
                        value={picked[key(r.order_no,l.combo)]??""}
                        onChange={e=>setPicked(x=>({...x,[key(r.order_no,l.combo)]:e.target.value}))}
                        className="w-24 border rounded px-1.5 py-0.5 bg-white mono"
                        style={{fontSize:11,borderColor:asked(r.order_no,l.combo)>l.remaining?"#dc2626":"#cbd5e1"}} />
                    </td>
                  </tr>)))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 flex-wrap items-center mt-2">
            <button disabled={!parts.length||!!over.length||busy===p.pi_no}
              onClick={()=>create(p.pi_no, parts)}
              className="text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-amber-700 hover:bg-amber-800 disabled:opacity-40">
              {busy===p.pi_no ? "Creating…" : `Create job order for ${fmt(totalAsked)} pairs`}</button>
            <button onClick={()=>setPicked(Object.fromEntries(row.owed.flatMap(r =>
                r.lines.filter(l=>l.remaining>0).map(l=>[key(r.order_no,l.combo), String(l.remaining)]))))}
              className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white">All remaining</button>
            <button onClick={()=>setPicked({})}
              className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white">None</button>
            {!!over.length && <span className="text-xs font-semibold text-rose-700">
              More than is owed on {over.join(", ")}.</span>}
          </div>
        </div>}
      </div>;
    })}

    {done.length > 0 && <div className="mt-4">
      <button onClick={()=>setShowDone(v=>!v)} className="text-xs font-semibold text-slate-600 underline">
        {showDone ? "Hide" : "Show"} {done.length} fully released PI{done.length===1?"":"s"}
      </button>
      {showDone && <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
        {done.map(r => <div key={r.pi.pi_no} className="text-xs text-slate-600 py-0.5">
          <span className="mono font-semibold">{r.pi.pi_no}</span> · {r.pi.party||"—"}
          <span className="ml-2 text-emerald-700 font-semibold">fully released</span>
        </div>)}
      </div>}
    </div>}
  </div>;
}
