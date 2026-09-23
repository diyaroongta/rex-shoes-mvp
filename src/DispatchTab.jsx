import React, { useState, useMemo, useRef, useEffect } from "react";
import { REF as INPUTS } from "./lib/refdata.js";
import { pairsPerCarton } from "../shared/bridge.js";
import { buildLedger, ledgerTotals } from "../shared/dispatch-ledger.js";
import * as api from "./lib/client.js";
import PackingList from "./PackingList.jsx";
import { buildPackingList, draftFromOrder } from "../shared/packing-list.js";
import { repairLedger, heldByCombo } from "../shared/repair.js";
import { comboSizes, mrpForSize } from "../shared/pi.js";
import GatePass from "./GatePass.jsx";
import { buildGatePass, pairsFromCartons } from "../shared/gate-pass.js";
import { singlePackQty } from "../shared/bridge.js";
import { suggestMixedCarton, withMixedCarton, describeCartons, packingSummary,
         withSharedCarton, sharedCartons } from "../shared/mixed-carton.js";

const fmt = n => (n==null||isNaN(n)) ? "0" : Number(n).toLocaleString("en-IN");

/* Dispatch / packing reports. Recording a dispatch reduces an order's pending
   quantity; it never edits the order, so what was ordered stays auditable
   against what actually shipped. Cartons are derived from the packing chart
   where one exists — otherwise the field is left blank rather than guessed. */
/* Dispatch events arrive as a prop rather than being fetched here. Holding a
   second copy meant this screen and the dashboard could show different totals
   for the same day — whichever had refreshed last won. One source, one set of
   numbers. */
/* `dispatches` now arrives WITH hidden rows. Hiding a report takes it off the
   history list; it does not un-ship the pairs, and the server has always
   counted hidden rows when checking what is still outstanding. The browser
   was counting only the visible ones, so a hidden report made the screen show
   MORE pending than really existed and the clerk was refused on save with
   "only N pairs remain outstanding". The ledger below sees everything; only
   the history list filters. */
export default function DispatchTab({ orders, dispatches = [], onChanged }){
  /* Pairs on the repair bench are NOT shippable — sending one is how a customer
     receives the very shoe that failed inspection. The screen subtracts them so
     the clerk sees a true "can ship" figure rather than being refused by the
     server after filling the whole report in. */
  const [repairs,setRepairs]=useState([]);
  const [open,setOpen]=useState(null);
  /* The packing list for the dispatch being recorded. Null until the packer
     opens it — a dispatch can still be recorded without one, because a
     shortage close has nothing to pack. */
  const [sheet,setSheet]=useState(null);
  /* A stored packing list opened for viewing/printing. The document is the
     thing that travels with the lorry, so it has to be reprintable long after
     the dispatch was recorded — not only at the moment it was keyed in. */
  const [viewing,setViewing]=useState(null);
  /* The gate pass is the SAME shipment as the packing list, so it is raised
     from the same row rather than re-keyed. Three things are not in the
     system and are typed here: the serial number off the pre-printed pad, the
     transporter, and the destination city. */
  const [showGate,setShowGate]=useState(false);
  const [gate,setGate]=useState({serial_no:"",transporter:"",city:""});
  const [draft,setDraft]=useState({});
  const [kind,setKind]=useState("partial");
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [confirmDel,setConfirmDel]=useState(null);
  /* The PI's three steps — choose, check, confirm — and its most important
     property: editing after Generate marks the preview STALE and blocks
     recording, so what is confirmed is always what was checked. */
  const [preview,setPreview]=useState(null);
  const [stale,setStale]=useState(false);
  const historyMsgRef=useRef(null);
  useEffect(()=>{ let live=true;
    api.listRepairs().then(r=>{ if(live) setRepairs(r||[]); })
      .catch(()=>{ /* a repair read failing must not take the dispatch screen
                      down; nothing is held and the server still enforces it. */ });
    return ()=>{ live=false; };
  },[dispatches]);

  const repairHold=useMemo(()=>{
    const led=repairLedger(repairs);
    const out={};
    for(const o of orders||[]) out[o.order_no]=heldByCombo(led,o);
    return out;
  },[repairs,orders]);



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
  const reportsByOrder=useMemo(()=>{
    const groups=new Map();
    for(const d of dispatches.filter(row=>!row.hidden)){
      const key=String(d.order_no||"");
      if(!groups.has(key)){
        const order=(orders||[]).find(o=>String(o.order_no)===key)||{};
        groups.set(key,{order_no:key,party:order.party||"",article:order.article_code||order.article||"",reports:[]});
      }
      groups.get(key).reports.push(d);
    }
    return [...groups.values()].map(group=>{
      group.reports.sort((a,b)=>String(b.dispatched_on||"").localeCompare(String(a.dispatched_on||""))||Number(b.id||0)-Number(a.id||0));
      group.pairs=group.reports.reduce((sum,d)=>sum+Object.values(d.dispatched||{}).reduce((a,b)=>a+(Number(b)||0),0),0);
      group.cartons=group.reports.reduce((sum,d)=>sum+Object.values(d.cartons||{}).reduce((a,b)=>a+(Number(b)||0),0),0);
      group.latest=group.reports[0]?.dispatched_on||"";
      return group;
    }).sort((a,b)=>String(b.latest).localeCompare(String(a.latest))||a.order_no.localeCompare(b.order_no));
  },[dispatches,orders]);

  function startReport(rec){
    setOpen(rec.order.order_no); setErr(""); setMsg(""); setKind("partial"); setNote("");
    /* Pre-filled with what can actually SHIP. Pre-filling the whole outstanding
       balance would put pairs that are on the repair bench into the report by
       default, and the server would then refuse the whole thing. */
    const hold=(repairHold[rec.order.order_no]||{by_combo:{}}).by_combo;
    const d={}; for(const r of rec.rows)
      d[r.combo]=Math.max(0, (r.pending>0?r.pending:0) - (hold[r.combo]||0));
    setDraft(d); setSheet(null); setPreview(null); setStale(false);
  }

  /* Any change to what is leaving, or to how it is boxed, invalidates a
     preview already generated. */
  function touched(){ if(preview) setStale(true); }
  const editDraft=(combo,value)=>{ setDraft(d=>({...d,[combo]:value})); touched(); };
  const editSheet=next=>{ setSheet(next); touched(); };

  function generate(rec){
    const built=sheet?buildPackingList({...sheet,dispatch_pairs:enteredPairs()}):null;
    setPreview({order_no:rec.order.order_no, sheet, built});
    setStale(false);
  }
  const enteredPairs=()=>Object.values(draft).reduce((a,v)=>a+(Number(v)||0),0);
  /* The server REFUSES a sheet whose pairs disagree with the dispatch, so
     letting Record be pressed here only turns a visible mismatch into a
     server error after the fact. */
  const sheetProblems=()=>sheet
    ? buildPackingList({...sheet,dispatch_pairs:enteredPairs()}).problems : [];

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
      setOpen(null); setPreview(null); setStale(false); setSheet(null);
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
  function printPackingList(){ printDocument(".packing-list","Packing list"); }
  function printGatePass(){ printDocument(".gate-pass","Gate pass"); }
  function printDocument(selector,label){
    const node=document.querySelector(selector);
    if(!node) return;
    const w=window.open("","_blank","width=900,height=1000");
    if(!w){ setErr(`Popup blocked — allow popups to print the ${label.toLowerCase()}.`); return; }
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">`
      + `<title>${label} ${viewing?viewing.order_no:""}</title>`
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
      {(()=>{const c=Object.values(pending).reduce((a,r)=>a+(r.total_cartons||0),0);
        return c>0?<span className="text-slate-500">Packed <b className="mono text-slate-800">{fmt(c)}</b> cartons</span>:null;})()}
      {totals.shortfall>0 && <span className="text-slate-500">Closed short <b className="mono text-rose-700">{fmt(totals.shortfall)}</b></span>}
    </div>

    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <table className="w-full text-sm">
        <thead><tr className="text-xs uppercase tracking-wide text-slate-500">
          <th className="text-left py-2">Order</th><th className="text-left">Party</th>
          <th className="text-left">Article</th><th className="text-right">Ordered</th>
          <th className="text-right">Dispatched</th><th className="text-right">Packed</th>
          <th className="text-right">Pending</th>
          <th className="text-left pl-3">Status</th><th></th></tr></thead>
        <tbody>
          {list.map(rec=>(
            <React.Fragment key={rec.order.order_no}>
              <tr className="border-t border-slate-100">
                <td className="py-2 mono font-semibold">{rec.order.order_no}</td>
                <td className="text-slate-600">{rec.order.party}</td>
                <td className="text-slate-600">{rec.order.article}</td>
                <td className="text-right mono">{fmt(rec.total_ordered)}</td>
                <td className="text-right mono text-emerald-700">{fmt(rec.total_dispatched)}
                  {rec.dispatch_count>1 && <span className="text-slate-400"> ·{rec.dispatch_count}</span>}</td>
                {/* Cartons COUNTED on the packing list. A dash means nobody
                    counted — a dispatch recorded without a packing list did
                    not ship in zero boxes. */}
                <td className="text-right mono text-slate-600">
                  {rec.total_cartons==null
                    ? <span className="text-slate-300" title="No packing list on this order's dispatches">—</span>
                    : <>{fmt(rec.total_cartons)}<span className="text-slate-400 text-xs"> ctn</span></>}</td>
                <td className="text-right mono font-semibold" style={{color:rec.total_pending>0?"#b45309":"#16a34a"}}>
                  {fmt(rec.total_pending)}
                  {(repairHold[rec.order.order_no]||{}).total>0 && <div className="text-[10px] font-normal text-amber-700">
                    {fmt(repairHold[rec.order.order_no].total)} in repair</div>}</td>
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
                <tr><td colSpan={9} className="px-2 pb-3">
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
                    <div className="text-xs font-semibold text-indigo-900 mb-2">
                      Packing report — {rec.order.order_no}
                    </div>
                    <div className="serif text-sm font-semibold text-slate-800 mb-1">
                      1 · What is leaving</div>
                    <table className="w-full text-xs mb-2">
                      <thead><tr className="text-slate-500">
                        <th className="text-left">Size range</th><th className="text-right">Ordered</th>
                        <th className="text-right">Already sent</th><th className="text-right">Outstanding</th>
                        <th className="text-right">Dispatch now</th></tr></thead>
                      <tbody>
                        {rec.rows.map(r=>{
                          const onBench=(repairHold[rec.order.order_no]||{by_combo:{}}).by_combo[r.combo]||0;
                          const canShip=Math.max(0,r.pending-onBench);
                          return <tr key={r.combo}>
                            <td className="mono py-1">{r.combo}</td>
                            <td className="text-right mono">{fmt(r.ordered)}</td>
                            <td className="text-right mono">{fmt(r.dispatched)}</td>
                            <td className="text-right mono">{fmt(r.pending)}
                              {/* Outstanding and SHIPPABLE are different numbers
                                  once something is on the bench, so both are
                                  shown rather than one quietly replacing the
                                  other. */}
                              {onBench>0 && <div className="text-[10px] text-amber-700">
                                −{fmt(onBench)} in repair</div>}</td>
                            <td className="text-right">
                              <input type="number" min={0} max={canShip} value={draft[r.combo]??0}
                                onChange={e=>editDraft(r.combo,e.target.value)}
                                style={onBench>0?{borderColor:"#f59e0b"}:undefined}
                                title={onBench>0?`${onBench} pair(s) are on the repair bench and cannot ship`:undefined}
                                className="w-20 text-sm border border-slate-300 rounded px-1 py-0.5 mono text-right" /></td>
                          </tr>;})}
                      </tbody>
                    </table>

                    {/* The dispatch document itself. Quantities above set what
                        leaves the order book; this is what the customer's gate
                        checks against, so it is entered per SIZE with cartons
                        COUNTED — never divided out of a packing rate. */}
                    <div className="serif text-sm font-semibold text-slate-800 mt-4 mb-1">
                      2 · Check the packing list</div>
                    <div className="mt-1">
                      {!sheet
                        ? <button type="button"
                            onClick={()=>editSheet(draftFromOrder(rec.order, comboSizes,
                              Object.fromEntries(Object.entries(draft).map(([c,v])=>[c,Number(v)||0]))))}
                            className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white">
                            Fill in the packing list
                          </button>
                        : <PackingListEditor sheet={sheet} setSheet={editSheet}
                            expectedPairs={enteredPairs()} />}
                    </div>

                    {/* The gate pass and the order book must agree, and the
                        server REFUSES a sheet whose pairs disagree with the
                        dispatch. Saying so here — where the numbers are — beats
                        a rejection after the clerk has pressed Record. */}
                    {sheet && (()=>{
                      const built=buildPackingList({...sheet,dispatch_pairs:enteredPairs()});
                      return built.problems.length
                        ? <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5 mt-2">
                            <b>The packing list and the dispatch do not agree yet:</b>
                            <ul className="list-disc pl-4 mt-0.5">{built.problems.map(p=><li key={p}>{p}</li>)}</ul>
                          </div>
                        : <div className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5 mt-2">
                            Reconciled — <b className="mono">{fmt(built.total_pairs)}</b> pairs in
                            {" "}<b className="mono">{fmt(built.total_cartons)}</b> carton{built.total_cartons===1?"":"s"},
                            matching the quantities above.
                          </div>;
                    })()}
                    <div className="serif text-sm font-semibold text-slate-800 mt-4 mb-1">
                      3 · Confirm and record</div>
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
                      <button type="button" onClick={()=>generate(rec)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-300 text-indigo-700 bg-white">
                        {preview?(stale?"Update the preview":"Preview again"):"Generate packing list"}</button>
                      <button disabled={busy||!preview||stale||sheetProblems(rec).length>0} onClick={()=>submit(rec,false)}
                        title={!preview?"Generate the packing list first"
                          :stale?"Something changed — update the preview"
                          :sheetProblems(rec).length?"The packing list and the dispatch do not agree":""}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">
                        {busy?"Recording…":"Record dispatch"}</button>
                      <button disabled={busy||stale} onClick={()=>submit(rec,true)}
                        title="Dispatch what is entered above and close the order, accepting the rest as never coming"
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 bg-white disabled:opacity-50">
                        Complete order despite shortage</button>
                    </div>
                    {stale && <div className="text-[11px] font-semibold text-amber-800 mt-1">
                      Something changed — update the preview before recording.</div>}
                    {preview && !stale && <div className="mt-3 rounded-xl border border-slate-300 bg-white p-3">
                      <div className="text-xs font-semibold text-slate-800 mb-2">
                        Preview — this is the sheet that will be filed and printed</div>
                      {preview.sheet
                        ? <PackingList data={preview.sheet}/>
                        : <div className="text-xs text-slate-500">
                            No packing list filled in — the dispatch will be recorded without one.</div>}
                    </div>}
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
            <span className="mono">{viewing.order_no}</span>
          </div>
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
            {[["list","Packing list"],["gate","Gate pass"]].map(([key,label])=>(
              <button key={key} onClick={()=>setShowGate(key==="gate")}
                className={`px-2.5 py-1 font-semibold ${(key==="gate")===showGate?"bg-slate-800 text-white":"bg-white text-slate-600"}`}>
                {label}</button>))}
          </div>
          <button onClick={showGate?printGatePass:printPackingList}
            className="ml-auto text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-slate-800">
            Print / Save PDF</button>
          <button onClick={()=>{setViewing(null);setShowGate(false);}}
            className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white">Close</button>
        </div>
        {showGate && <div data-noprint className="flex gap-2 flex-wrap mb-2">
          <label className="text-xs text-slate-600">SR. No. from the book
            <input value={gate.serial_no} aria-label="Gate pass serial number"
              onChange={e=>setGate(g=>({...g,serial_no:e.target.value}))}
              className="block mt-0.5 w-32 text-sm border border-slate-300 rounded px-2 py-1 mono" /></label>
          <label className="text-xs text-slate-600">Transporter
            <input value={gate.transporter} aria-label="Transporter"
              onChange={e=>setGate(g=>({...g,transporter:e.target.value}))}
              className="block mt-0.5 w-44 text-sm border border-slate-300 rounded px-2 py-1" /></label>
          <label className="text-xs text-slate-600">City
            <input value={gate.city} aria-label="Destination city"
              onChange={e=>setGate(g=>({...g,city:e.target.value}))}
              className="block mt-0.5 w-36 text-sm border border-slate-300 rounded px-2 py-1" /></label>
        </div>}
        {showGate
          ? (()=>{
              const built=buildPackingList(viewing.sheet||{});
              const order=(orders||[]).find(o=>o.order_no===viewing.order_no)||{};
              const article=order.article_code||order.article||"";
              return <GatePass data={buildGatePass({
                packing_list:built, ...gate,
                order_no:viewing.order_no, date:viewing.dispatched_on||built.date,
                party:built.customer||order.party,
                order_qty:(order.lines||[]).reduce((a,l)=>a+(Number(l.qty)||0),0)||null,
                /* Per SIZE, off the article master — blank where there is no
                   figure on record rather than a zero. */
                mrpFor:size=>mrpForSize((INPUTS.mrp&&INPUTS.mrp[article])||{},"",size),
                packFor:size=>singlePackQty(article,size,"",""),
              })} />;
            })()
          : <PackingList data={viewing.sheet} />}
      </div>)}

    {!!reportsByOrder.length && (
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mt-4">
        <div className="text-sm font-semibold text-slate-700">Order packing reports</div>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">
          Reports are kept inside their order so separate partial dispatches never get mixed with another order.
        </p>
        {(err||msg) && <div ref={historyMsgRef}
          className={`text-xs rounded-lg border px-3 py-2 mb-2 ${err
            ?"border-rose-200 bg-rose-50 text-rose-800":"border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          {err||msg}</div>}
        <div className="space-y-3">
          {reportsByOrder.map(group=><section key={group.order_no}
            aria-label={`Packing reports for order ${group.order_no}`}
            className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 flex gap-3 items-center flex-wrap">
              <div className="mono text-sm font-semibold text-slate-800">{group.order_no}</div>
              <div className="text-xs text-slate-600">{group.article||"—"}{group.party?` · ${group.party}`:""}</div>
              <div className="ml-auto text-xs text-slate-500">
                <b>{group.reports.length}</b> report{group.reports.length===1?"":"s"} · <b className="mono">{fmt(group.pairs)}</b> pairs
                {group.cartons>0&&<> · <b className="mono">{fmt(group.cartons)}</b> cartons</>}
              </div>
            </div>
            <div className="overflow-x-auto"><table className="w-full text-xs" style={{minWidth:760}}>
              <thead><tr className="text-slate-500">
                <th className="text-left px-3 py-1.5">Report</th><th className="text-left">Date</th>
                <th className="text-left">Type</th><th className="text-left">Sent</th>
                <th className="text-left">Note</th><th></th></tr></thead>
              <tbody>{group.reports.map((d,index)=><tr key={d.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-semibold text-slate-600">Packing report {group.reports.length-index}</td>
                <td className="mono">{d.dispatched_on}</td>
                <td>{d.closes_order ? <span className="text-rose-700 font-semibold">closed short</span> : d.kind}</td>
                <td className="mono">{Object.entries(d.dispatched).map(([c,v])=>`${c}:${fmt(v)}`).join("  ")}</td>
                <td className="text-slate-500">{d.note||""}</td>
                <td className="text-right whitespace-nowrap pr-3">
                  {d.packing_list && <button
                    onClick={()=>setViewing({order_no:d.order_no, sheet:{...d.packing_list, date:d.dispatched_on}})}
                    aria-label={`Packing list for ${d.order_no}`}
                    className="font-semibold text-indigo-700 hover:underline mr-2">View report</button>}
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
              </tr>)}</tbody>
            </table></div>
          </section>)}
        </div>
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
  /* Per SIZE, never per range: SPIKE's 11X1 packs its 12s and 13s at 24 and
     its size 1 at 18, so a rate taken from the range is wrong as often as it
     is right. */
  const rateForLine = line => size => singlePackQty(line.article, size, "", line.combo);
  const summary = packingSummary(built, () => null);

  return <div className="rounded-xl border border-slate-300 bg-white p-3">
    <div className="flex items-baseline gap-3 flex-wrap mb-2">
      <div className="text-sm font-semibold text-slate-800">Packing list</div>
      <div className="text-xs text-slate-600">
        <b className="mono">{built.total_pairs}</b> pairs · <b className="mono">{built.total_cartons}</b> cartons
        {summary.mixed_cartons > 0 && <> · <b className="mono">{summary.mixed_cartons}</b> mixed
          {" "}(<b className="mono">{summary.mixed_pairs}</b> pairs)</>}
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
            <th className="text-right">C/N</th>
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
                    className="w-20 border border-slate-300 rounded px-1 py-0.5 mono text-right" />
                  {/* PAIRS = CARTONS x STD. PAC. — the factory's own rule, off
                      their gate pass. Offered rather than applied: the packer
                      counted the box, and a figure that overwrites a count
                      without being asked is how a gate pass stops matching the
                      lorry. A size with no pack on record offers nothing. */}
                  {(() => {
                    if(g.sizes.length !== 1) return null;
                    const pack = singlePackQty(line.article, g.sizes[0].size, "", line.combo);
                    const derived = pairsFromCartons(g.cartons, pack);
                    if(derived == null || derived === 0) return null;
                    if(Number(g.sizes[0].pairs) === derived)
                      return <div className="text-[10px] text-slate-400 mt-0.5">{g.cartons} × {pack}</div>;
                    return <button type="button"
                      onClick={()=>edit(n=>{ n.lines[li].groups[gi].sizes[0].pairs = derived; })}
                      className="block mt-0.5 text-[10px] text-indigo-700 underline">
                      = {derived} pairs ({g.cartons} × {pack})</button>;
                  })()}
                </td>}
                {si === 0 && <td className="text-right mono text-slate-500" rowSpan={g.sizes.length}>
                  {(() => { const b = (built.lines[li]||{}).groups||[];
                    const bg = b[gi];
                    const cn = bg && bg.cn_from ? (bg.cn_from===bg.cn_to?`${bg.cn_from}`:`${bg.cn_from}-${bg.cn_to}`) : "—";
                    return <>{cn}{g.sizes.length>1 && <div className="text-[10px] font-semibold text-indigo-700">mixed</div>}</>; })()}
                </td>}
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
                  {g.mixed && <button type="button" title="Remove this mixed carton"
                    onClick={()=>edit(n=>{ n.lines[li].groups.splice(gi,1); })}
                    className="ml-2 text-[11px] text-rose-700 underline">remove</button>}
                </td>}
              </tr>
            )))}
          </tbody>
        </table>

        {/* THE LAST BOX. 45 cartons of whole sizes and six pairs of 8 with six
            of 9 left over: those twelve pairs travel together in carton 46,
            and the gate has to be told which sizes are inside it. The leftover
            pairs are SUGGESTED from the packing rates and then typed over —
            what is in the box is counted, never derived. */}
        {(() => {
          const suggestion = suggestMixedCarton(line, rateForLine(line));
          const sizes = (comboSizes(line.combo)||[]).length
            ? comboSizes(line.combo) : line.groups.flatMap(g=>g.sizes.map(s=>s.size));
          return <div className="flex items-center gap-2 flex-wrap mt-1">
            <button type="button"
              onClick={()=>setSheet(withMixedCarton(sheet, li,
                suggestion || { sizes: sizes.slice(0,1).map(size=>({ size, pairs:0 })) }))}
              className="text-[11px] font-semibold rounded-lg px-2 py-1 border border-indigo-300 text-indigo-800 bg-indigo-50">
              + Add a mixed carton</button>
            <span className="text-[11px] text-slate-500">
              {suggestion
                ? <>{suggestion.pairs} pair{suggestion.pairs===1?"":"s"} will not fill a carton of their own
                    {" "}({suggestion.sizes.map(x=>`${x.size} x ${x.pairs}`).join(", ")}).</>
                : <>One box holding several sizes. Its pairs are counted, and it takes the next carton number.</>}
            </span>
          </div>;
        })()}
      </div>
    ))}

    {/* A BOX THAT HOLDS TWO DIFFERENT SHOES — same article type, different
        shoe, which is what their own slip does when one carton count spans the
        change from STRIKE (V) to STRIKE (L). The box is counted once and each
        shoe keeps its own pairs, so the order book's balance stays right. */}
    {sheet.lines.length > 1 && <SharedCartonBuilder sheet={sheet} setSheet={setSheet} built={built} />}

    {!built.ok && <div className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1.5">
      {built.problems.slice(0,4).map((p,i)=><div key={i}>{p}</div>)}
    </div>}
  </div>;
}

/* One box, several shoes. The packer names what went into it, shoe by shoe;
   the carton is counted once and numbered once. */
function SharedCartonBuilder({ sheet, setSheet, built }){
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({});     // "li:size" -> pairs
  const boxes = sharedCartons(built);

  const sizesOf = line => {
    const seen = [];
    for(const g of line.groups || []) for(const s of g.sizes || [])
      if(s.size && !seen.includes(s.size)) seen.push(s.size);
    return seen;
  };
  const parts = Object.entries(draft)
    .map(([key, pairs]) => { const [li, size] = key.split("|"); return { line:Number(li), size, pairs:Number(pairs)||0 }; })
    .filter(p => p.pairs > 0);
  const total = parts.reduce((a, p) => a + p.pairs, 0);

  function add(){
    if(!parts.length) return;
    setSheet(withSharedCarton(sheet, parts));
    setDraft({}); setOpen(false);
  }
  function removeBox(label){
    const next = JSON.parse(JSON.stringify(sheet));
    for(const line of next.lines) line.groups = (line.groups||[]).filter(g => g.carton_group !== label);
    setSheet(next);
  }

  return <div className="mt-1">
    {boxes.map(box => (
      <div key={box.label} className="text-[11px] rounded-lg border border-indigo-200 bg-indigo-50/60 px-2 py-1.5 mb-1.5">
        <b className="mono">Box {box.label}</b> — carton {box.cn_from || "?"} ·{" "}
        <b className="mono">{box.pairs}</b> pairs ·{" "}
        {box.contents.map(c => `${c.closure||c.article} ${c.size}×${c.pairs}`).join(", ")}
        <button type="button" onClick={()=>removeBox(box.label)}
          className="ml-2 text-rose-700 underline">remove</button>
      </div>))}

    {!open
      ? <button type="button" onClick={()=>setOpen(true)}
          className="text-[11px] font-semibold rounded-lg px-2 py-1 border border-indigo-300 text-indigo-800 bg-white">
          + Mixed carton across shoes</button>
      : <div className="rounded-lg border border-indigo-300 bg-white p-2">
          <div className="text-xs font-semibold text-slate-700 mb-1">
            One box, several shoes — enter the pairs of each that went into it</div>
          {sheet.lines.map((line, li) => (
            <div key={li} className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[11px] text-slate-600" style={{minWidth:150}}>
                <span className="mono">{line.article}</span> · {line.closure || "—"} · {line.colour || "—"}</span>
              {sizesOf(line).map(size => (
                <label key={size} className="text-[11px] text-slate-500">{size}
                  <input type="number" min={0} style={{width:52}}
                    aria-label={`Pairs of ${line.article} ${line.closure||""} size ${size} in this box`}
                    value={draft[`${li}|${size}`] ?? ""}
                    onChange={e=>setDraft(d=>({ ...d, [`${li}|${size}`]: e.target.value }))}
                    className="block border border-slate-300 rounded px-1 py-0.5 mono text-right" />
                </label>))}
            </div>))}
          <div className="flex items-center gap-2 mt-1.5">
            <button type="button" onClick={add} disabled={!parts.length}
              className="text-[11px] font-semibold rounded-lg px-2.5 py-1 bg-indigo-600 text-white disabled:opacity-40">
              Add this box{total ? ` — ${total} pairs` : ""}</button>
            <button type="button" onClick={()=>{setDraft({});setOpen(false);}}
              className="text-[11px] font-semibold rounded-lg px-2 py-1 border border-slate-300 bg-white">Cancel</button>
            <span className="text-[11px] text-slate-400">Counted as one carton, numbered once.</span>
          </div>
        </div>}
  </div>;
}
