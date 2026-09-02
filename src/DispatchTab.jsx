import React, { useState, useMemo, useRef } from "react";
import { REF as INPUTS } from "./lib/refdata.js";
import { pairsPerCarton } from "../shared/bridge.js";
import { buildLedger, ledgerTotals } from "../shared/dispatch-ledger.js";
import * as api from "./lib/client.js";
import PackingList from "./PackingList.jsx";
import { buildPackingList, draftFromOrder } from "../shared/packing-list.js";
import { comboSizes } from "../shared/pi.js";

const fmt = n => (n==null||isNaN(n)) ? "0" : Number(n).toLocaleString("en-IN");

/* Dispatch / packing reports. Recording a dispatch reduces an order's pending
   quantity; it never edits the order, so what was ordered stays auditable
   against what actually shipped. Cartons are derived from the packing chart
   where one exists — otherwise the field is left blank rather than guessed. */
/* Dispatch events arrive as a prop rather than being fetched here. Holding a
   second copy meant this screen and the dashboard could show different totals
   for the same day — whichever had refreshed last won. One source, one set of
   numbers. */
export default function DispatchTab({ orders, dispatches = [], onChanged }){
  const [open,setOpen]=useState(null);
  /* The packing list for the dispatch being recorded. Null until the packer
     opens it — a dispatch can still be recorded without one, because a
     shortage close has nothing to pack. */
  const [sheet,setSheet]=useState(null);
  /* A stored packing list opened for viewing/printing. The document is the
     thing that travels with the lorry, so it has to be reprintable long after
     the dispatch was recorded — not only at the moment it was keyed in. */
  const [viewing,setViewing]=useState(null);
  const [draft,setDraft]=useState({});
  const [kind,setKind]=useState("partial");
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [confirmDel,setConfirmDel]=useState(null);
  const historyMsgRef=useRef(null);

  /* A packing report can be mis-keyed. Removing one returns its pairs to the
     order's pending balance, so this is a correction — not a way to make a
     shipment disappear, which is why it is confirmed and says what it does. */
  /* UNDO: the report was mis-keyed, so the pairs go back to pending. */
  async function undoDispatch(d){
    setBusy(true); setErr(""); setMsg("");
    try{
      await api.undoDispatch(d.id);
      const pairs=Object.values(d.dispatched||{}).reduce((a,b)=>a+(Number(b)||0),0);
      setMsg(`Dispatch undone. ${fmt(pairs)} pair(s) are pending again on ${d.order_no}.`);
      setConfirmDel(null);
      if(onChanged) await onChanged();
    }catch(e){
      setErr(String(e.message||e));
      /* A stale row is the usual cause, and the list is wrong either way. */
      if(onChanged) await onChanged();
    }
    finally{ setBusy(false); }
  }

  /* HIDE: the goods shipped. This only takes the row off the list — the pairs
     keep counting, and the order's pending balance does not move. */
  async function hideDispatch(d){
    setBusy(true); setErr(""); setMsg("");
    try{
      await api.hideDispatch(d.id);
      setMsg(`Removed from the history. ${d.order_no} still counts those pairs as dispatched.`);
      setConfirmDel(null);
      if(onChanged) await onChanged();
    }catch(e){
      setErr(String(e.message||e));
      if(onChanged) await onChanged();
    }
    finally{ setBusy(false); }
  }


  /* ordered − dispatched, per combo, per order. The arithmetic — including what
     closing an order short does to the pending balance — lives in shared/. */
  const pending = useMemo(
    ()=>buildLedger(orders||[], dispatches, pairsPerCarton),
    [orders,dispatches]);

  const list=Object.values(pending);
  const totals=ledgerTotals(pending);

  function startReport(rec){
    setOpen(rec.order.order_no); setErr(""); setMsg(""); setKind("partial"); setNote("");
    const d={}; for(const r of rec.rows) d[r.combo]=r.pending>0?r.pending:0;
    setDraft(d);
  }

  async function submit(rec, closes=false){
    const closing=closes||kind==="shortage";
    const dispatched={};
    for(const [c,v] of Object.entries(draft)){ const n=Number(v)||0; if(n>0) dispatched[c]=n; }
    if(!Object.keys(dispatched).length && !closing){ setErr("Enter at least one quantity."); return; }
    const short=rec.total_ordered-rec.total_dispatched-Object.values(dispatched).reduce((a,b)=>a+b,0);
    if(closing && short<=0 &&
       !confirm(`${rec.order.order_no} has nothing short — the quantities entered cover the whole order.\n\n`+
                `This will simply complete it. To close it short, reduce the quantities to what actually shipped.`))
      return;
    if(closing && short>0 &&
       !confirm(`Close ${rec.order.order_no} with ${fmt(short)} pairs never delivered?\n\n`+
                `The balance stops counting as pending and is recorded as a shortage. This cannot be undone from here.`))
      return;
    setBusy(true); setErr("");
    try{
      /* Cartons come from the packing list, where they were COUNTED. The old
         code divided pairs by the packing rate and stored a fraction — 2.67
         cartons — which is not something that can be put on a lorry, and is
         wrong whenever sizes inside a range pack at different rates. */
      const cartons={};
      if(sheet) for(const line of buildPackingList(sheet).lines)
        if(line.combo) cartons[line.combo]=(cartons[line.combo]||0)+line.cartons;

      await api.addDispatch({ order_no:rec.order.order_no, dispatched, cartons,
        kind: closing ? "shortage" : kind, note, closes_order: closing,
        ...(sheet ? { packing_list: sheet } : {}) });
      setOpen(null);
      setMsg(closing
        ? `${rec.order.order_no} closed. Any undelivered balance is recorded as a shortage.`
        : `Packing report recorded for ${rec.order.order_no}.`);
      if(onChanged) await onChanged();   // reloads the shared dispatch list
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  /* Printed into its own window rather than by hiding the app with CSS, the
     same way the invoice is. A print stylesheet has to anticipate every piece
     of chrome on the page; a clean document cannot get one wrong, and what is
     saved as a PDF is then exactly the sheet and nothing else. */
  function printPackingList(){
    const node=document.querySelector(".packing-list");
    if(!node) return;
    const w=window.open("","_blank","width=900,height=1000");
    if(!w){ setErr("Popup blocked — allow popups to print the packing list."); return; }
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">`
      + `<title>Packing list ${viewing?viewing.order_no:""}</title>`
      + `<style>*{box-sizing:border-box}`
      + `body{margin:0;padding:12mm;font-family:Arial,Helvetica,sans-serif;color:#000}`
      + `table{width:100%;border-collapse:collapse}`
      + `[data-noprint]{display:none!important}@page{size:A4 portrait;margin:10mm}</style></head>`
      + `<body>${node.outerHTML}`
      + `<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>`
      + `</body></html>`);
    w.document.close();
  }

  if(!orders || !orders.length) return <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center text-slate-500 text-sm">
    No orders yet — dispatch reports are made against an order.</div>;

  return <div>
    {err && <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-3">{err}</div>}
    {msg && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-3">{msg}</div>}

    <div className="flex gap-4 flex-wrap mb-3 text-xs">
      <span className="text-slate-500">Ordered <b className="mono text-slate-800">{fmt(totals.ordered)}</b></span>
      <span className="text-slate-500">Dispatched <b className="mono text-emerald-700">{fmt(totals.dispatched)}</b></span>
      <span className="text-slate-500">Pending <b className="mono text-amber-700">{fmt(totals.pending)}</b></span>
      {totals.shortfall>0 && <span className="text-slate-500">Closed short <b className="mono text-rose-700">{fmt(totals.shortfall)}</b></span>}
    </div>

    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <table className="w-full text-sm">
        <thead><tr className="text-xs uppercase tracking-wide text-slate-500">
          <th className="text-left py-2">Order</th><th className="text-left">Party</th>
          <th className="text-left">Article</th><th className="text-right">Ordered</th>
          <th className="text-right">Dispatched</th><th className="text-right">Pending</th>
          <th className="text-left pl-3">Status</th><th></th></tr></thead>
        <tbody>
          {list.map(rec=>(
            <React.Fragment key={rec.order.order_no}>
              <tr className="border-t border-slate-100">
                <td className="py-2 mono font-semibold">{rec.order.order_no}</td>
                <td className="text-slate-600">{rec.order.party}</td>
                <td className="text-slate-600">{rec.order.article}</td>
                <td className="text-right mono">{fmt(rec.total_ordered)}</td>
                <td className="text-right mono text-emerald-700">{fmt(rec.total_dispatched)}</td>
                <td className="text-right mono font-semibold" style={{color:rec.total_pending>0?"#b45309":"#16a34a"}}>
                  {fmt(rec.total_pending)}</td>
                <td className="pl-3">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{
                    background: rec.status==="complete"?"#dcfce7":rec.status==="closed short"?"#ffe4e6"
                               :rec.status==="partial"?"#fef3c7":"#f1f5f9",
                    color: rec.status==="complete"?"#166534":rec.status==="closed short"?"#9f1239"
                          :rec.status==="partial"?"#92400e":"#64748b"}}>
                    {rec.status}</span>
                  {rec.shortfall>0 && <div className="text-xs text-rose-700 mono">−{fmt(rec.shortfall)} short</div>}</td>
                <td className="text-right">
                  {rec.total_pending>0 && !rec.closed && <button onClick={()=>open===rec.order.order_no?setOpen(null):startReport(rec)}
                    className="text-xs font-semibold text-indigo-700 hover:underline">
                    {open===rec.order.order_no?"Cancel":"Packing report"}</button>}</td>
              </tr>

              {open===rec.order.order_no && (
                <tr><td colSpan={8} className="px-2 pb-3">
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
                    <div className="text-xs font-semibold text-indigo-900 mb-2">
                      Packing report — {rec.order.order_no}
                    </div>
                    <table className="w-full text-xs mb-2">
                      <thead><tr className="text-slate-500">
                        <th className="text-left">Size range</th><th className="text-right">Ordered</th>
                        <th className="text-right">Already sent</th><th className="text-right">Outstanding</th>
                        <th className="text-right">Dispatch now</th></tr></thead>
                      <tbody>
                        {rec.rows.map(r=>{
                          return <tr key={r.combo}>
                            <td className="mono py-1">{r.combo}</td>
                            <td className="text-right mono">{fmt(r.ordered)}</td>
                            <td className="text-right mono">{fmt(r.dispatched)}</td>
                            <td className="text-right mono">{fmt(r.pending)}</td>
                            <td className="text-right">
                              <input type="number" min={0} max={r.pending} value={draft[r.combo]??0}
                                onChange={e=>setDraft(d=>({...d,[r.combo]:e.target.value}))}
                                className="w-20 text-sm border border-slate-300 rounded px-1 py-0.5 mono text-right" /></td>
                          </tr>;})}
                      </tbody>
                    </table>

                    {/* The dispatch document itself. Quantities above set what
                        leaves the order book; this is what the customer's gate
                        checks against, so it is entered per SIZE with cartons
                        COUNTED — never divided out of a packing rate. */}
                    <div className="mt-3">
                      {!sheet
                        ? <button type="button"
                            onClick={()=>setSheet(draftFromOrder(rec.order, comboSizes,
                              Object.fromEntries(Object.entries(draft).map(([c,v])=>[c,Number(v)||0]))))}
                            className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white">
                            Fill in the packing list
                          </button>
                        : <PackingListEditor sheet={sheet} setSheet={setSheet}
                            expectedPairs={Object.values(draft).reduce((a,v)=>a+(Number(v)||0),0)} />}
                    </div>
                    <div className="flex gap-2 items-end flex-wrap">
                      <label className="text-xs text-slate-600">Type
                        <select value={kind} onChange={e=>{
                            const next=e.target.value; setKind(next);
                            /* The boxes start pre-filled with everything still
                               outstanding, which is right for a real dispatch
                               and exactly wrong for closing short: pressing it
                               unchanged shipped the whole balance and left
                               nothing short. Closing starts from zero, so the
                               shortage is the balance unless pairs are typed. */
                            if(next==="shortage") setDraft(d=>Object.fromEntries(Object.keys(d).map(k=>[k,0])));
                            else setDraft(Object.fromEntries(rec.rows.map(r=>[r.combo,r.pending>0?r.pending:0])));
                          }}
                          className="block mt-0.5 text-sm border border-slate-300 rounded-lg px-2 py-1 bg-white">
                          <option value="partial">Partial dispatch</option>
                          <option value="full">Full / final</option>
                          <option value="shortage">Shortage — closing short</option>
                        </select></label>
                      <label className="text-xs text-slate-600 flex-1">Note
                        <input value={note} onChange={e=>setNote(e.target.value)}
                          placeholder={kind==="shortage"?"Reason for the shortage":"Vehicle, LR number, etc."}
                          className="block mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2 py-1" /></label>
                      <button disabled={busy} onClick={()=>submit(rec,false)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">
                        {busy?"Recording…":"Record dispatch"}</button>
                      <button disabled={busy} onClick={()=>submit(rec,true)}
                        title="Dispatch what is entered above and close the order, accepting the rest as never coming"
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 bg-white disabled:opacity-50">
                        Complete order despite shortage</button>
                    </div>
                    {(() => {
                      const entered=Object.values(draft).reduce((a,b)=>a+(Number(b)||0),0);
                      const short=rec.total_pending-entered;
                      return short>0 ? (
                        <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5 mt-2">
                          <b>Complete order despite shortage</b> ships the {fmt(entered)} pairs entered above and closes
                          {" "}{rec.order.order_no} with <b>{fmt(short)} pairs</b> never delivered. The balance stops
                          counting as pending; the shortfall stays on record against the order.
                        </div>
                      ) : (
                        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5 mt-2">
                          The quantities above cover the whole order, so <b>nothing would be short</b>. Closing now
                          simply completes {rec.order.order_no}. To record a shortage, reduce the quantities to what
                          actually shipped — the rest becomes the shortfall.
                        </div>
                      );
                    })()}
                  </div>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>

    {viewing && (
      <div className="mb-4 rounded-2xl border border-slate-300 bg-white p-3 shadow-sm">
        <div data-noprint className="flex items-center gap-2 flex-wrap mb-2">
          <div className="text-sm font-semibold text-slate-800">
            Packing list · <span className="mono">{viewing.order_no}</span>
          </div>
          <button onClick={printPackingList}
            className="ml-auto text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-slate-800">
            Print / Save PDF</button>
          <button onClick={()=>setViewing(null)}
            className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white">Close</button>
        </div>
        <PackingList data={viewing.sheet} />
      </div>)}

    {!!dispatches.length && (
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mt-4">
        <div className="text-sm font-semibold text-slate-700 mb-2">Dispatch history</div>
        {(err||msg) && <div ref={historyMsgRef}
          className={`text-xs rounded-lg border px-3 py-2 mb-2 ${err
            ?"border-rose-200 bg-rose-50 text-rose-800":"border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          {err||msg}</div>}
        <table className="w-full text-xs">
          <thead><tr className="text-slate-500">
            <th className="text-left py-1">Date</th><th className="text-left">Order</th>
            <th className="text-left">Type</th><th className="text-left">Sent</th>
            <th className="text-left">Note</th><th></th></tr></thead>
          <tbody>
            {dispatches.map(d=>(
              <tr key={d.id} className="border-t border-slate-100">
                <td className="py-1 mono">{d.dispatched_on}</td>
                <td className="mono">{d.order_no}</td>
                <td>{d.closes_order ? <span className="text-rose-700 font-semibold">closed short</span> : d.kind}</td>
                <td className="mono">{Object.entries(d.dispatched).map(([c,v])=>`${c}:${fmt(v)}`).join("  ")}</td>
                <td className="text-slate-500">{d.note||""}</td>
                <td className="text-right whitespace-nowrap">
                  {/* Only offered where a sheet was actually entered — an
                      empty document would be worse than none. */}
                  {d.packing_list && <button
                    onClick={()=>setViewing({order_no:d.order_no, sheet:{...d.packing_list, date:d.dispatched_on}})}
                    aria-label={`Packing list for ${d.order_no}`}
                    className="font-semibold text-indigo-700 hover:underline mr-2">Packing list</button>}
                  {confirmDel===d.id
                    ? <span className="inline-flex gap-1.5 items-center flex-wrap justify-end">
                        <span className="text-slate-700">Which one?</span>
                        <button disabled={busy} onClick={()=>undoDispatch(d)}
                          aria-label={`Undo the ${d.order_no} dispatch and put the pairs back`}
                          title="The report was wrong. The pairs go back to pending."
                          className="font-semibold text-white bg-rose-700 rounded px-2 py-0.5 disabled:opacity-50">
                          Undo dispatch — pairs go back</button>
                        <button disabled={busy} onClick={()=>hideDispatch(d)}
                          aria-label={`Remove the ${d.order_no} report from the history only`}
                          title="The goods shipped. This only takes the row off this list."
                          className="font-semibold border border-slate-300 bg-white rounded px-2 py-0.5 disabled:opacity-50">
                          Just remove from history</button>
                        <button onClick={()=>setConfirmDel(null)}
                          className="font-semibold border border-slate-300 bg-white rounded px-2 py-0.5">Cancel</button>
                      </span>
                    : <button onClick={()=>setConfirmDel(d.id)}
                        aria-label={`Remove the ${d.order_no} packing report`}
                        title="Undo the dispatch, or just take this row off the history"
                        className="text-slate-600 font-semibold hover:underline">Remove…</button>}
                </td>
              </tr>))}
          </tbody>
        </table>
      </div>
    )}
  </div>;
}

/* Entering the packing list: per SIZE pairs, and a COUNTED carton figure for
   each group of sizes that shares a box. Sizes that fill their own cartons stay
   as separate groups; the "share a carton" action merges a size into the group
   above it, which is how a part carton is actually made up on the floor. */
function PackingListEditor({ sheet, setSheet, expectedPairs }){
  const built = buildPackingList({ ...sheet, dispatch_pairs: expectedPairs });
  const edit = fn => { const next = JSON.parse(JSON.stringify(sheet)); fn(next); setSheet(next); };

  return <div className="rounded-xl border border-slate-300 bg-white p-3">
    <div className="flex items-baseline gap-3 flex-wrap mb-2">
      <div className="text-sm font-semibold text-slate-800">Packing list</div>
      <div className="text-xs text-slate-600">
        <b className="mono">{built.total_pairs}</b> pairs · <b className="mono">{built.total_cartons}</b> cartons
        {expectedPairs != null && <> · dispatching <b className="mono">{expectedPairs}</b></>}
      </div>
    </div>

    {sheet.lines.map((line, li) => (
      <div key={li} className="mb-2 rounded-lg border border-slate-200 p-2">
        <div className="text-xs font-semibold text-slate-700 mb-1">
          <span className="mono">{line.article}</span> · {line.closure || "—"} · {line.colour || "—"}
          <span className="text-slate-400 font-normal ml-2 mono">{line.combo}</span>
        </div>
        <table className="text-xs w-full" style={{borderCollapse:"collapse"}}>
          <thead><tr className="text-slate-500">
            <th className="text-left py-1">Size</th>
            <th className="text-right">Pairs</th>
            <th className="text-right">Cartons (counted)</th>
            <th></th>
          </tr></thead>
          <tbody>
            {line.groups.map((g, gi) => g.sizes.map((sz, si) => (
              <tr key={`${gi}-${si}`} style={{borderTop:"1px solid #f1f5f9"}}>
                <td className="py-1 mono">{sz.size}</td>
                <td className="text-right">
                  <input type="number" min={0} value={sz.pairs ?? 0}
                    aria-label={`Pairs of size ${sz.size}`}
                    onChange={e=>edit(n=>{ n.lines[li].groups[gi].sizes[si].pairs = e.target.value; })}
                    className="w-20 border border-slate-300 rounded px-1 py-0.5 mono text-right" /></td>
                {si === 0 && <td className="text-right" rowSpan={g.sizes.length}>
                  <input type="number" min={0} value={g.cartons ?? 0}
                    aria-label={`Cartons for size ${g.sizes.map(x=>x.size).join(" and ")}`}
                    onChange={e=>edit(n=>{ n.lines[li].groups[gi].cartons = e.target.value; })}
                    className="w-20 border border-slate-300 rounded px-1 py-0.5 mono text-right" /></td>}
                {si === 0 && <td className="text-right" rowSpan={g.sizes.length}>
                  {gi > 0 && <button type="button" title="Pack this size in the carton above"
                    onClick={()=>edit(n=>{ const gs=n.lines[li].groups;
                      gs[gi-1].sizes.push(...gs[gi].sizes); gs.splice(gi,1); })}
                    className="text-[11px] text-indigo-700 underline">share carton above</button>}
                  {g.sizes.length > 1 && <button type="button" title="Give each size its own carton"
                    onClick={()=>edit(n=>{ const gs=n.lines[li].groups;
                      const split=gs[gi].sizes.map(x=>({sizes:[x],cartons:0}));
                      gs.splice(gi,1,...split); })}
                    className="ml-2 text-[11px] text-slate-600 underline">split</button>}
                </td>}
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    ))}

    {!built.ok && <div className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1.5">
      {built.problems.slice(0,4).map((p,i)=><div key={i}>{p}</div>)}
    </div>}
  </div>;
}
