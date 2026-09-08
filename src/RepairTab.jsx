import React, { useEffect, useMemo, useState } from "react";
import * as api from "./lib/client.js";
import { buildLedger } from "../shared/dispatch-ledger.js";
import { pairsPerCarton, comboSizesForArticle } from "../shared/bridge.js";
import { repairLedger, repairTotals, validateMovement, MOVEMENTS, MOVEMENT_LABEL }
  from "../shared/repair.js";

const fmt = n => (n==null||isNaN(n)) ? "0" : Number(n).toLocaleString("en-IN");
const today = () => new Date().toISOString().slice(0,10);

/* Repair, between production and dispatch.
 *
 * The factory's own ARMOUR 17004 card records this as dated movements per
 * size — SEND FOR REPAIR, RECIVED AFTER REPAIR, REJECTION — so that is what
 * this screen captures, one movement at a time, rather than three totals to be
 * overtyped. The totals are derived.
 *
 * The distinction that matters and is easy to get wrong: pairs sent and not
 * yet back are IN REPAIR, not short. They only become a shortage when somebody
 * writes them off as rejected.
 */
export default function RepairTab({ orders = [], dispatches = [], onChanged }){
  const [entries,setEntries]=useState(null);
  const [order,setOrder]=useState("");
  const [size,setSize]=useState("");
  const [kind,setKind]=useState("sent");
  const [qty,setQty]=useState("");
  const [on,setOn]=useState(today);
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [confirmDel,setConfirmDel]=useState(null);

  async function load(){
    try{ setEntries(await api.listRepairs()); setErr(""); }
    catch(e){ setErr(e.message||String(e)); setEntries([]); }
  }
  useEffect(()=>{ load(); },[]);

  const ledger = useMemo(()=>repairLedger(entries||[]),[entries]);
  const totals = useMemo(()=>repairTotals(ledger),[ledger]);

  /* Only orders that still have pairs to ship. A repair on something already
     gone is not a repair, it is a return — a different thing the factory
     handles another way. */
  const shipLedger = useMemo(
    ()=>buildLedger(orders, dispatches, pairsPerCarton),[orders,dispatches]);
  const open = orders.filter(o=>{
    const rec = shipLedger[o.order_no];
    return rec && rec.total_pending > 0 && !rec.closed;
  });
  const chosen = orders.find(o=>o.order_no===order) || null;

  /* The sizes this order actually carries, in the article's own printed order.
     Offering every size in the roll would invite a repair against a size the
     customer never ordered. */
  const sizes = useMemo(()=>{
    if(!chosen) return [];
    const out=[];
    for(const line of chosen.lines||[]){
      const named = comboSizesForArticle(chosen.article_code||chosen.article, line.combo) || [];
      for(const sz of (named.length?named:Object.keys(line.sizes||{})))
        if(!out.includes(String(sz))) out.push(String(sz));
    }
    return out;
  },[chosen]);

  const rec = ledger[order] || null;
  const sizeRow = rec && rec.sizes[size];
  const already = sizeRow || { sent:0, returned:0, rejected:0 };
  /* Pairs of this size still to ship — what can be pulled for repair. */
  const available = useMemo(()=>{
    if(!chosen) return null;
    let n=0;
    for(const line of chosen.lines||[]) n += Number((line.sizes||{})[size]) || 0;
    return n || null;
  },[chosen,size]);

  const check = validateMovement({ order_no:order, size, kind, qty, on, note }, { already, available });
  const ready = !!order && !!size && check.ok;

  async function record(){
    setBusy(true); setErr(""); setMsg("");
    try{
      await api.addRepair({ order_no:order, size, kind, qty:Number(qty), on, note, available });
      setQty(""); setNote("");
      await load();
      setMsg(`${MOVEMENT_LABEL[kind]} — ${qty} pair(s) of size ${size} on ${order}.`);
      if(onChanged) await onChanged();
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  async function remove(id){
    setBusy(true); setErr(""); setMsg("");
    try{ await api.deleteRepair(id); setConfirmDel(null); await load();
         setMsg("That movement was removed from the repair record."); }
    catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  if(entries===null) return <div className="p-5 text-sm text-slate-500">Loading the repair record…</div>;

  return <div className="p-4 md:p-5">
    {msg && <div role="status" className="mb-3 text-xs rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">{msg}</div>}
    {err && <div role="alert" className="mb-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">{err}</div>}

    <div className="flex gap-4 flex-wrap mb-3 text-xs">
      <span className="text-slate-500">Sent for repair <b className="mono text-slate-800">{fmt(totals.sent)}</b></span>
      <span className="text-slate-500">Repaired <b className="mono text-emerald-700">{fmt(totals.returned)}</b></span>
      {/* IN REPAIR is not a shortage — these pairs are on the bench, not lost. */}
      <span className="text-slate-500">On the bench <b className="mono text-amber-700">{fmt(totals.in_repair)}</b></span>
      <span className="text-slate-500">Rejected <b className="mono text-rose-700">{fmt(totals.rejected)}</b></span>
    </div>

    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      <div className="serif text-base font-semibold mb-1">Record a repair movement</div>
      <p className="text-xs text-slate-500 mb-3">
        One movement at a time, exactly as the job card records it — a date, a size and a quantity.
        Pairs sent and not yet back are <b>on the bench</b>; they become a shortage only when rejected.
      </p>
      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-xs text-slate-600">Order
          <select value={order} aria-label="Order" onChange={e=>{setOrder(e.target.value);setSize("");}}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm min-w-64">
            <option value="">— choose an order still to ship —</option>
            {open.map(o=><option key={o.order_no} value={o.order_no}>
              {o.order_no} · {o.article_code||o.article}{o.party?` · ${o.party}`:""}</option>)}
          </select></label>
        <label className="text-xs text-slate-600">Size
          <select value={size} aria-label="Size" onChange={e=>setSize(e.target.value)} disabled={!chosen}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
            <option value="">{chosen?"— size —":"choose an order first"}</option>
            {sizes.map(sz=><option key={sz} value={sz}>{sz}</option>)}
          </select></label>
        <label className="text-xs text-slate-600">Movement
          <select value={kind} aria-label="Movement" onChange={e=>setKind(e.target.value)}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
            {MOVEMENTS.map(k=><option key={k} value={k}>{MOVEMENT_LABEL[k]}</option>)}
          </select></label>
        <label className="text-xs text-slate-600">Pairs
          <input type="number" min="1" step="1" value={qty} aria-label="Pairs"
            onChange={e=>setQty(e.target.value)}
            className="block mt-1 w-24 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm mono text-right"/></label>
        <label className="text-xs text-slate-600">Date
          <input type="date" value={on} aria-label="Date" onChange={e=>setOn(e.target.value)}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm"/></label>
        <label className="text-xs text-slate-600 flex-1 min-w-40">Note
          <input value={note} aria-label="Note" onChange={e=>setNote(e.target.value)}
            placeholder="What was wrong with them"
            className="block mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm"/></label>
        <button onClick={record} disabled={busy||!ready}
          className="text-xs font-semibold text-white rounded-lg px-4 py-2 bg-indigo-600 disabled:opacity-50">
          {busy?"Recording…":"Record"}</button>
      </div>

      {size && <div className="text-[11px] text-slate-600 mt-2">
        Size <b>{size}</b> on {order}: {fmt(already.sent)} sent · {fmt(already.returned)} back ·
        {" "}{fmt(already.rejected)} rejected · <b>{fmt(Math.max(0,already.sent-already.returned-already.rejected))} on the bench</b>
        {available!=null && <> · {fmt(available)} ordered</>}
      </div>}
      {!!qty && !check.ok && <ul className="text-[11px] text-rose-700 mt-2 list-disc pl-4">
        {check.problems.map(p=><li key={p}>{p}</li>)}</ul>}
    </div>

    {!!Object.keys(ledger).length && <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      <div className="text-sm font-semibold text-slate-700 mb-2">Repair position by order</div>
      <table className="w-full text-xs">
        <thead><tr className="text-slate-500">
          <th className="text-left py-1">Order</th><th className="text-left">Article</th>
          <th className="text-right">Sent</th><th className="text-right">Repaired</th>
          <th className="text-right">On the bench</th><th className="text-right">Rejected</th></tr></thead>
        <tbody>{Object.values(ledger).map(r=>{
          const o = orders.find(x=>x.order_no===r.order_no);
          return <tr key={r.order_no} className="border-t border-slate-100">
            <td className="py-1.5 mono font-semibold">{r.order_no}</td>
            <td className="text-slate-600">{o?(o.article_code||o.article):"—"}</td>
            <td className="text-right mono">{fmt(r.sent)}</td>
            <td className="text-right mono text-emerald-700">{fmt(r.returned)}</td>
            <td className="text-right mono font-semibold" style={{color:r.in_repair>0?"#b45309":"#64748b"}}>{fmt(r.in_repair)}</td>
            <td className="text-right mono text-rose-700">{fmt(r.rejected)}</td>
          </tr>;})}
        </tbody>
      </table>
      {totals.in_repair>0 && <p className="text-[11px] text-amber-800 mt-2">
        <b>{fmt(totals.in_repair)} pair(s) are on the repair bench.</b> They have not shipped and are
        not a shortage — a shortage is only what has been rejected.</p>}
    </div>}

    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-slate-700 mb-2">Every movement</div>
      {!entries.length
        ? <div className="text-xs text-slate-400">Nothing recorded yet.</div>
        : <table className="w-full text-xs">
            <thead><tr className="text-slate-500">
              <th className="text-left py-1">Date</th><th className="text-left">Order</th>
              <th className="text-left">Size</th><th className="text-left">Movement</th>
              <th className="text-right">Pairs</th><th className="text-left pl-3">Note</th><th></th></tr></thead>
            <tbody>{entries.map(e=>(
              <React.Fragment key={e.id}>
                <tr className="border-t border-slate-100">
                  <td className="py-1.5 mono">{String(e.moved_on||e.created_at||"").slice(0,10)}</td>
                  <td className="mono">{e.order_no}</td>
                  <td className="mono">{e.size}</td>
                  <td style={{color:e.kind==="rejected"?"#be123c":e.kind==="returned"?"#047857":"#b45309"}}>
                    {MOVEMENT_LABEL[e.kind]||e.kind}</td>
                  <td className="text-right mono font-semibold">{fmt(e.qty)}</td>
                  <td className="pl-3 text-slate-500">{e.note||""}</td>
                  <td className="text-right">
                    <button onClick={()=>setConfirmDel(e.id)} title="Remove this movement"
                      className="text-rose-500 text-sm leading-none">×</button></td>
                </tr>
                {confirmDel===e.id && <tr><td colSpan={7} className="pb-2">
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 flex items-center gap-3 flex-wrap">
                    {/* A movement is a record of what happened, so a wrong one is
                        removed rather than edited — an edited quantity would
                        leave no trace that it had changed. */}
                    <span className="text-xs text-amber-900">
                      Remove <b>{MOVEMENT_LABEL[e.kind]}</b> of {fmt(e.qty)} pair(s), size {e.size} on {e.order_no}?
                      <span className="block mt-0.5">The totals above recalculate. Record a fresh movement to correct it.</span>
                    </span>
                    <button disabled={busy} onClick={()=>remove(e.id)}
                      className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-700 text-white disabled:opacity-50">Remove</button>
                    <button onClick={()=>setConfirmDel(null)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Cancel</button>
                  </div></td></tr>}
              </React.Fragment>))}
            </tbody>
          </table>}
    </div>
  </div>;
}
