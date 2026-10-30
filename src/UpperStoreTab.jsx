import React, { useEffect, useMemo, useState } from "react";
import { REF as INPUTS } from "./lib/refdata.js";
import * as api from "./lib/client.js";
import { todayIso } from "./lib/today.js";
import { articleSizes } from "./FinishedGoodsTab.jsx";
import { families, labelFor } from "../shared/product-codes.js";
import { buildLedger } from "../shared/dispatch-ledger.js";
import { pairsPerCarton } from "../shared/bridge.js";
import { upperStoreAccess } from "../shared/permissions.js";
import { repairRejection } from "../shared/repair.js";
import { validateUpperMoves, upperStock, upperLedger, onHandBySize, movingStatus, outsideFabrication,
         upperShortage, rejectionRatios, countAdjustments, normalizeUpperRules, upperAlerts, qcQueue,
         UPPER_KINDS, SOURCE_TYPES, DESTINATIONS, DAMAGE_AT, HOLD_REASONS, AGE_BUCKETS } from "../shared/upper-store.js";

const fmt = n => (n==null||isNaN(n)) ? "—" : Number(n).toLocaleString("en-IN");
const input = "block mt-0.5 text-sm border border-slate-300 rounded-lg px-2 py-1 bg-white";
const ALERT_LABEL = { non_moving:"Non-moving", low_stock:"Low stock", fabrication_overdue:"Fabrication overdue",
                      rejection:"QC rejection", repair_rejection:"Repair rejection" };
/* The order picker's value for an MTS receipt. Never a real order number —
   it becomes `mts:true` with no order, never an order called "MTS". */
const MTS = "__MTS__";

/* UPPER STORE — stitched uppers between the stitching line / outside
   fabrication and pasting / moulding. Every figure on this screen is derived
   from the movement log in shared/upper-store.js; the screen only records
   movements and shows what they add up to. */
export default function UpperStoreTab({ orders = [], jobs = [], dispatches = [], role, active = true, canEditRules = false }){
  const access = upperStoreAccess(role);
  const [data,setData]=useState(null);
  const [rules,setRules]=useState(()=>normalizeUpperRules({}).rules);
  const [fabricators,setFabricators]=useState([]);
  const [repairs,setRepairs]=useState([]);
  const [view,setView]=useState("stock");
  const [err,setErr]=useState("");

  async function load(){
    try{ setData(await api.listUpperStore()); setErr(""); }
    catch(e){ setErr(String(e.message||e)); setData(d=>d||{moves:[],tags:[]}); }   // keep the last good data
  }
  /* Loaded when the screen is looked at, and again each time it is opened —
     never on a timer, and nothing is written by looking. */
  useEffect(()=>{
    if(!active) return;
    load();
    api.getSettings().then(s=>{ if(s&&s.upper_store_rules) setRules(normalizeUpperRules(s.upper_store_rules).rules); }).catch(()=>{});
    api.listFabricators().then(f=>setFabricators(Array.isArray(f)?f:[])).catch(()=>{});
    /* The Repair screen is the record of shoes sent for repair; its figures
       drive the repair rejection alert. */
    api.listRepairs().then(r=>setRepairs(Array.isArray(r)?r:[])).catch(()=>{});
  },[active]);

  const moves = (data&&data.moves)||[];
  const tags = (data&&data.tags)||[];
  const today = todayIso();
  /* An order that has shipped or been closed needs no more uppers. */
  const done = useMemo(()=>{
    const ledger = buildLedger(orders, dispatches, pairsPerCarton);
    return new Set(orders.filter(o=>{ const r=ledger[o.order_no]; return o.production_complete || (r && (r.closed || r.total_pending<=0)); })
      .map(o=>o.order_no));
  },[orders,dispatches]);
  const stock = useMemo(()=>upperStock(moves),[moves]);
  const moving = useMemo(()=>movingStatus(moves,tags,today,rules.moving_days),[moves,tags,today,rules.moving_days]);
  const shortage = useMemo(()=>upperShortage(orders,moves,done),[orders,moves,done]);
  const fabrication = useMemo(()=>outsideFabrication(jobs,today,rules.fabrication_due_days),[jobs,today,rules.fabrication_due_days]);
  const ratios = useMemo(()=>rejectionRatios(moves),[moves]);
  const repair = useMemo(()=>repairRejection(repairs,orders),[repairs,orders]);
  const alerts = useMemo(()=>upperAlerts({moving,shortage,fabrication,ratios,repair,rules}),[moving,shortage,fabrication,ratios,repair,rules]);
  const pending = moves.filter(m=>m.kind==="adjust"&&m.status==="pending");
  const qcWaiting = useMemo(()=>qcQueue(moves).length,[moves]);

  const tabs = [["stock","Live stock"],
    ...(access?[["in","Stock in & QC"],["out","Issue"],["back","Return / damage"]]:[]),
    ["qc",`QC & rework${qcWaiting?` (${qcWaiting})`:""}`],
    ["count",`Physical count${pending.length?` (${pending.length})`:""}`],
    ["ledger","Ledger"],["reports","Reports"]];

  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <div role="tablist" aria-label="Upper store" className="inline-flex rounded-xl bg-slate-100 p-1 mb-4 flex-wrap">
      {tabs.map(([k,label])=>
        <button key={k} role="tab" aria-selected={view===k} onClick={()=>setView(k)}
          className="text-sm font-semibold rounded-lg px-4 py-1.5"
          style={view===k?{background:"#fff",color:"#1e293b",boxShadow:"0 1px 2px rgba(15,23,42,.12)"}:{background:"transparent",color:"#64748b"}}>
          {label}</button>)}
    </div>
    {err && <div role="alert" className="mb-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{err}</div>}
    {!data ? <div className="text-sm text-slate-500 text-center py-8">Loading the upper store…</div> : <>
      {view==="stock" && <><Alerts alerts={alerts} rules={rules} /><LiveStock stock={stock} moving={moving} /></>}
      {view==="in" && <MoveForm kind="in" moves={moves} orders={orders} fabricators={fabricators} onSaved={load} />}
      {view==="out" && <MoveForm kind="out" moves={moves} orders={orders} fabricators={fabricators} onSaved={load} />}
      {view==="back" && <MoveForm kind="back" moves={moves} orders={orders} fabricators={fabricators} onSaved={load} />}
      {view==="qc" && <QcRework moves={moves} access={access} onSaved={load} />}
      {view==="count" && <PhysicalCount moves={moves} access={access} pending={pending} onSaved={load} />}
      {view==="ledger" && <Ledger moves={moves} access={access} onChanged={load} />}
      {view==="reports" && <Reports moving={moving} shortage={shortage} fabrication={fabrication} ratios={ratios} repair={repair}
        rules={rules} setRules={setRules} canEditRules={canEditRules} access={access} onTagged={load} />}
    </>}
  </div>;
}

function Alerts({ alerts, rules }){
  return <div className="mb-4">
    {alerts.length
      ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="text-xs font-semibold text-amber-900 mb-1">{alerts.length} alert{alerts.length===1?"":"s"}</div>
          <ul className="text-xs text-amber-900 space-y-0.5">
            {alerts.map((a,i)=><li key={i}><b>{ALERT_LABEL[a.kind]}</b> · {a.text}</li>)}</ul></div>
      : <div className="text-xs text-slate-500">No alerts.</div>}
    {(rules.fabrication_due_days==null || rules.rejection_alert_pct==null || rules.repair_rejection_alert_pct==null) &&
      <div className="text-[11px] text-slate-500 mt-1">
        {rules.fabrication_due_days==null && "Fabrication overdue is off until a turnaround is set. "}
        {rules.rejection_alert_pct==null && "The QC rejection alert is off until a limit is set. "}
        {rules.repair_rejection_alert_pct==null && "The repair rejection alert is off until a limit is set. "}
        Set them under Reports.</div>}
  </div>;
}

function LiveStock({ stock, moving }){
  const statusOf = new Map(moving.rows.map(r=>[`${r.article}||${r.colour}`,r]));
  if(!stock.groups.length) return <div className="text-sm text-slate-500 text-center py-8">
    No uppers are recorded yet. Start with <b>Stock in</b> — or a <b>Physical count</b> to enter what is already on the racks.</div>;
  return <div>
    <div className="flex gap-4 flex-wrap mb-3 text-xs">
      <span className="text-slate-500">In the store <b className="mono text-slate-800">{fmt(stock.total)}</b></span>
      <span className="text-slate-500">Moving <b className="mono text-emerald-700">{fmt(moving.moving_pairs)}</b></span>
      <span className="text-slate-500">Non-moving <b className="mono text-amber-700">{fmt(moving.non_moving_pairs)}</b></span>
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm" style={{minWidth:720}}><thead>
        <tr className="text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
          {["Article","Colour","In store","By size","Rack","Out at pasting / moulding","QC hold / at maker","Status"].map(h=>
            <th key={h} className={`px-3 py-2 ${h==="In store"?"text-right":"text-left"}`}>{h}</th>)}</tr></thead>
        <tbody>{stock.groups.map(g=>{
          const st = statusOf.get(`${g.article}||${g.colour}`);
          return <tr key={`${g.article}|${g.colour}`} className="border-t border-slate-100 align-top">
            <td className="px-3 py-2 font-medium text-slate-800">{g.article}</td>
            <td className="px-3 py-2 text-xs">{g.colour||"—"}</td>
            <td className="px-3 py-2 text-right mono font-semibold">{fmt(g.on_hand)}</td>
            <td className="px-3 py-2 text-[11px] text-slate-600">
              {g.sizes.filter(s=>s.on_hand!==0).map(s=><span key={s.size} className="mr-3 whitespace-nowrap" style={{color:s.on_hand<0?"#b91c1c":undefined}}>
                <b className="mono">{s.size}</b>: {fmt(s.on_hand)}</span>)}
              {g.negative.length>0 && <div className="text-rose-700 font-semibold">Below zero for {g.negative.join(", ")} — a movement is missing or wrong.</div>}
              {g.pending_adjust!==0 && <div className="text-indigo-700">{g.pending_adjust>0?"+":""}{fmt(g.pending_adjust)} awaiting approval</div>}
            </td>
            <td className="px-3 py-2 text-xs">{g.racks.join(", ")||"—"}</td>
            <td className="px-3 py-2 text-xs mono">{fmt(g.at.PASTING)} / {fmt(g.at.MOULDING)}</td>
            <td className="px-3 py-2 text-xs mono" title="Failed QC: not available stock">{fmt(g.qc_hold)} / {fmt(g.rework)}</td>
            <td className="px-3 py-2 text-xs">{st
              ? <span title={st.reason} className="font-semibold" style={{color:st.status==="moving"?"#047857":"#b45309"}}>
                  {st.status==="moving"?"Moving":"Non-moving"}{st.manual?" (set)":""}<div className="font-normal text-slate-500">{st.reason}</div></span>
              : "—"}</td>
          </tr>;})}</tbody>
      </table>
    </div>
  </div>;
}

/* Articles grouped by family, families A-Z — never the reference document's
   storage order, where eleven Jacks sat scattered across the list. */
function ArticleSelect({ value, onChange }){
  const codes = Object.fromEntries(Object.entries(INPUTS.articles||{}).filter(([,a])=>a&&a.product_code).map(([n,a])=>[n,a.product_code]));
  const groups = families(Object.keys(INPUTS.articles||{}), codes);
  return <select value={value} onChange={e=>onChange(e.target.value)} aria-label="Article" className={`${input} max-w-xs`}>
    <option value="">Choose…</option>
    {Object.keys(groups).sort().map(f=><optgroup key={f} label={f}>
      {groups[f].map(({article})=><option key={article} value={article}>{labelFor(article,codes)}</option>)}</optgroup>)}
  </select>;
}

/* Stock in, issue, and return / damage — one form, because all three are the
   same thing: an article, a colour and a quantity per size, plus what that
   movement has to say about where it came from or went. */
function MoveForm({ kind, moves, orders, fabricators, onSaved }){
  const [article,setArticle]=useState("");
  const [colour,setColour]=useState("");
  const [date,setDate]=useState(todayIso());
  const [qty,setQty]=useState({});
  const [failed,setFailed]=useState({});
  const [defect,setDefect]=useState("");
  const [sourceType,setSourceType]=useState("line");
  const [source,setSource]=useState("");
  const [orderNo,setOrderNo]=useState("");
  const [jobCard,setJobCard]=useState("");
  const [rack,setRack]=useState("");
  const [destination,setDestination]=useState("MOULDING");
  const [backKind,setBackKind]=useState("returned");
  const [damagedAt,setDamagedAt]=useState("STORE");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false),[err,setErr]=useState(""),[msg,setMsg]=useState("");

  const sizes = article ? articleSizes(article) : [];
  const sum = o => Object.values(o).reduce((a,v)=>a+(Number(v)||0),0);
  const passedTotal = sum(qty), failedTotal = kind==="in" ? sum(failed) : 0;
  const total = passedTotal + failedTotal;
  const held = useMemo(()=>onHandBySize(moves,article,colour),[moves,article,colour]);
  const orderList = orders.filter(o=>!article || (o.article_code||o.article)===article);
  const sourceList = fabricators.filter(f=>sourceType==="line"?f.type==="internal_line":f.type==="external");
  const movementKind = kind==="back" ? backKind : kind;
  const showHeld = movementKind==="out" || (movementKind==="damaged" && damagedAt==="STORE");
  const mts = kind==="in" && orderNo===MTS;

  function pickArticle(a){
    setArticle(a); setQty({}); setFailed({});
    /* The article master's upper colour is a starting point, never a default
       invented here; an article with none starts blank. */
    setColour(String(((INPUTS.articles||{})[a]||{}).upper_colour||""));
  }
  async function submit(){
    setErr(""); setMsg("");
    if(!article){ setErr("Choose the article."); return; }
    const base = { article, colour, moved_on:date, order_no:mts?null:(orderNo||null), mts,
      job_card_no:jobCard||null, source_type:kind==="in"?sourceType:null, source:kind==="in"?source||null:null };
    /* A receipt is inspected as it arrives: the PASSED uppers go into stock,
       the FAILED ones into QC hold with their defect — two movements from one
       count, so the maker's rejection ratio has both halves. */
    const rows = Object.entries(qty).filter(([,v])=>Number(v)).map(([size,v])=>({
      ...base, kind:movementKind, size, qty:Number(v),
      rack:kind==="in"?rack:null, destination:movementKind==="out"||movementKind==="returned"?destination:null,
      damaged_at:movementKind==="damaged"?damagedAt:null, reason }));
    if(kind==="in") for(const [size,v] of Object.entries(failed)) if(Number(v))
      rows.push({ ...base, kind:"qc_failed", size, qty:Number(v), reason:defect });
    /* The same check the server makes, so "short" is said here, beside the
       quantities, rather than as a refusal after Save. */
    const { problems } = validateUpperMoves(rows, moves);
    if(problems.length){ setErr(problems.slice(0,6).join("; ")); return; }
    setBusy(true);
    try{
      await api.addUpperMoves(rows);
      setMsg(kind==="in"
        ? `${fmt(passedTotal)} passed into stock${failedTotal?`, ${fmt(failedTotal)} held in QC for rework`:""}.`
        : `${fmt(total)} uppers recorded.`);
      setQty({}); setFailed({});
      await onSaved();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  const heading = { in:"Uppers received from a stitching line or an outside fabricator, checked at QC",
    out:"Uppers issued to pasting or moulding, against a production order",
    back:"Unused uppers back from the floor, or damaged / rejected uppers" }[kind];
  return <div>
    <div className="text-sm font-semibold text-slate-700 mb-3">{heading}</div>
    {kind==="back" && <div className="flex gap-3 mb-3 text-sm">
      {[["returned","Returned unused"],["damaged","Damaged / rejected"]].map(([k,l])=>
        <label key={k} className="inline-flex items-center gap-1"><input type="radio" name="back" checked={backKind===k} onChange={()=>setBackKind(k)}/>{l}</label>)}</div>}
    <div className="flex gap-2 flex-wrap items-end mb-3">
      <label className="text-xs text-slate-600">Article<ArticleSelect value={article} onChange={pickArticle} /></label>
      <label className="text-xs text-slate-600">Colour
        <input value={colour} onChange={e=>setColour(e.target.value)} aria-label="Colour" className={`${input} w-32`}/></label>
      <label className="text-xs text-slate-600">Date
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} className={`${input} mono`}/></label>
      {kind==="in" && <>
        <label className="text-xs text-slate-600">From
          <select value={sourceType} onChange={e=>{setSourceType(e.target.value);setSource("");}} aria-label="Source type" className={input}>
            {Object.entries(SOURCE_TYPES).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-xs text-slate-600">{sourceType==="line"?"Line":"Vendor"}
          <input list="upper-sources" value={source} onChange={e=>setSource(e.target.value)} aria-label="Source" className={`${input} w-40`}/>
          <datalist id="upper-sources">{sourceList.map(f=><option key={f.name} value={f.name}/>)}</datalist></label>
        <label className="text-xs text-slate-600">Rack
          <input value={rack} onChange={e=>setRack(e.target.value)} aria-label="Rack" className={`${input} w-20`}/></label>
      </>}
      {(movementKind==="out"||movementKind==="returned") &&
        <label className="text-xs text-slate-600">{movementKind==="out"?"Issue to":"Back from"}
          <select value={destination} onChange={e=>setDestination(e.target.value)} aria-label="Destination" className={input}>
            {Object.entries(DESTINATIONS).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>}
      {movementKind==="damaged" &&
        <label className="text-xs text-slate-600">Where
          <select value={damagedAt} onChange={e=>setDamagedAt(e.target.value)} aria-label="Damaged where" className={input}>
            {Object.entries(DAMAGE_AT).filter(([k])=>k!=="QC").map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>}
      <label className="text-xs text-slate-600">Order {movementKind==="out"||kind==="in"?"(required)":"(optional)"}
        <select value={orderNo} onChange={e=>setOrderNo(e.target.value)} aria-label="Order" className={`${input} max-w-[14rem]`}>
          <option value="">—</option>
          {kind==="in" && <option value={MTS}>MTS — made for stock, no order</option>}
          {orderList.map(o=><option key={o.order_no} value={o.order_no}>{o.order_no} · {o.party}</option>)}</select></label>
      {kind==="in" && <label className="text-xs text-slate-600">Job card (optional)
        <input value={jobCard} onChange={e=>setJobCard(e.target.value)} aria-label="Job card" className={`${input} mono w-24`}/></label>}
      <label className="text-xs text-slate-600 flex-1 min-w-40">{movementKind==="damaged"?"Reason (required)":"Note"}
        <input value={reason} onChange={e=>setReason(e.target.value)} aria-label="Reason" className={`${input} w-full`}/></label>
    </div>
    {article && (sizes.length
      ? <div className="flex gap-2 flex-wrap mb-3">{sizes.map(sz=><div key={sz} className="text-[11px] text-slate-500 text-center">{sz}
          <input type="number" min="0" value={qty[sz]??""} aria-label={kind==="in"?`Passed size ${sz}`:`Uppers of size ${sz}`}
            placeholder={kind==="in"?"pass":""}
            onChange={e=>setQty(q=>({...q,[sz]:e.target.value}))}
            className="block w-16 border rounded px-1 py-0.5 mono text-right text-sm"
            style={{borderColor:showHeld && Number(qty[sz])>(held[sz]||0)?"#e11d48":"#cbd5e1"}}/>
          {kind==="in" && <input type="number" min="0" value={failed[sz]??""} aria-label={`Failed size ${sz}`} placeholder="fail"
            onChange={e=>setFailed(q=>({...q,[sz]:e.target.value}))}
            className="block w-16 mt-1 border border-rose-200 rounded px-1 py-0.5 mono text-right text-sm"/>}
          {showHeld && <span className="mono">{fmt(held[sz]||0)} held</span>}</div>)}</div>
      : <div className="text-xs text-amber-700 mb-3">This article has no size ranges on file.</div>)}
    {kind==="in" && failedTotal>0 &&
      <label className="block text-xs text-slate-600 mb-3">Defect found at QC (required)
        <input value={defect} onChange={e=>setDefect(e.target.value)} aria-label="Defect"
          className={`${input} w-full max-w-md`}/></label>}
    <button disabled={busy||!total} onClick={submit}
      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
      {busy?"Saving…":kind==="in"&&failedTotal?`Record ${fmt(passedTotal)} passed, ${fmt(failedTotal)} failed`:`Record ${fmt(total)} uppers`}</button>
    {err && <div role="alert" className="mt-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{err}</div>}
    {msg && <div className="mt-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">{msg}</div>}
  </div>;
}

/* QC & REWORK — every failed upper still unresolved, by maker. Each one is
   either still here in QC hold, or out with its maker for rework. From hold it
   is sent back or scrapped; from the maker it comes back passed, or fails
   again and returns to hold. */
function QcRework({ moves, access, onSaved }){
  const rows = useMemo(()=>qcQueue(moves),[moves]);
  const [qty,setQty]=useState({}), [note,setNote]=useState({});
  const [err,setErr]=useState(""), [msg,setMsg]=useState(""), [busy,setBusy]=useState(false);
  const keyOf = r => `${r.source}|${r.article}|${r.colour}|${r.size}`;
  async function act(r, kind, extra = {}){
    setErr(""); setMsg("");
    const k = keyOf(r), n = Number(qty[k]);
    const row = { kind, article:r.article, colour:r.colour, size:r.size, qty:n, source:r.source,
                  source_type:r.source_type, moved_on:todayIso(), reason:note[k]||"", ...extra };
    const { problems } = validateUpperMoves([row], moves);
    if(problems.length){ setErr(problems.join("; ")); return; }
    setBusy(true);
    try{ await api.addUpperMoves([row]); setQty(q=>({...q,[k]:""})); setNote(q=>({...q,[k]:""}));
         setMsg("Recorded."); await onSaved(); }
    catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }
  if(!rows.length) return <div className="text-sm text-slate-500 text-center py-8">No upper is waiting on QC or rework.</div>;
  const btn = "underline font-semibold mr-2 disabled:opacity-40";
  return <div className="overflow-x-auto">
    <p className="text-xs text-slate-500 mb-3">Failed uppers are never available stock. Send them back to the maker for rework,
      receive them back when they pass, or scrap them with a reason. A reworked upper that fails again comes back into QC hold.</p>
    {err && <div role="alert" className="mb-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{err}</div>}
    {msg && <div className="mb-2 text-xs text-emerald-800">{msg}</div>}
    <table className="w-full text-xs" style={{minWidth:900}}><thead><tr className="sign text-slate-500">
      {["Maker","Article","Colour","Size","In QC hold","With maker","Defects",...(access?["Qty","Note / defect",""]:[])].map(h=>
        <th key={h} className={`py-2 px-2 ${["In QC hold","With maker"].includes(h)?"text-right":"text-left"}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map(r=>{ const k=keyOf(r); return <tr key={k} className="border-t border-slate-100 align-top">
        <td className="px-2 py-1 font-medium">{r.source}</td><td className="px-2">{r.article}</td><td className="px-2">{r.colour||"—"}</td>
        <td className="px-2 mono">{r.size}</td>
        <td className="px-2 mono text-right font-semibold text-amber-700">{fmt(r.hold)}</td>
        <td className="px-2 mono text-right font-semibold text-indigo-700">{fmt(r.rework)}</td>
        <td className="px-2 text-slate-600">{r.defects.join("; ")}</td>
        {access && <>
          <td className="px-2"><input type="number" min="0" value={qty[k]??""} aria-label={`Quantity for ${r.source} ${r.article} size ${r.size}`}
            onChange={e=>setQty(q=>({...q,[k]:e.target.value}))} className="w-16 border border-slate-300 rounded px-1 py-0.5 mono text-right"/></td>
          <td className="px-2"><input value={note[k]??""} aria-label={`Note for ${r.source} ${r.article} size ${r.size}`}
            onChange={e=>setNote(q=>({...q,[k]:e.target.value}))} className="w-32 border border-slate-300 rounded px-1 py-0.5"/></td>
          <td className="px-2 whitespace-nowrap">
            {r.hold>0 && <><button disabled={busy} onClick={()=>act(r,"rework_out")} className={`${btn} text-indigo-700`}>Send for rework</button>
              <button disabled={busy} onClick={()=>act(r,"damaged",{damaged_at:"QC"})} className={`${btn} text-rose-700`}>Scrap</button></>}
            {r.rework>0 && <><button disabled={busy} onClick={()=>act(r,"rework_in")} className={`${btn} text-emerald-700`}>Back — passed</button>
              <button disabled={busy} onClick={()=>act(r,"qc_failed",{rework:true})} className={`${btn} text-amber-700`}>Back — failed again</button></>}
          </td></>}
      </tr>;})}</tbody></table>
  </div>;
}

/* Count the rack, compare with the book, and send the difference for the
   store in-charge to approve. Nothing moves until it is approved. */
function PhysicalCount({ moves, access, pending, onSaved }){
  const [article,setArticle]=useState("");
  const [colour,setColour]=useState("");
  const [counted,setCounted]=useState({});
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false),[err,setErr]=useState(""),[msg,setMsg]=useState("");
  const sizes = article ? articleSizes(article) : [];
  const { rows, adjustments } = useMemo(()=>countAdjustments(moves,article,colour,counted,note),[moves,article,colour,counted,note]);
  const diffOf = Object.fromEntries(rows.map(r=>[r.size,r]));
  const book = useMemo(()=>onHandBySize(moves,article,colour),[moves,article,colour]);

  async function submit(){
    setErr(""); setMsg(""); setBusy(true);
    try{
      const r = await api.addUpperMoves(adjustments);
      setMsg(`${r.saved} adjustment${r.saved===1?"":"s"} sent for the store in-charge's approval.`); setCounted({});
      await onSaved();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }
  async function decide(m, action){
    setErr(""); setMsg("");
    try{ await api.decideUpperAdjust(m.id, action); await onSaved(); }
    catch(e){ setErr(String(e.message||e)); }
  }

  return <div>
    {access && <>
      <div className="text-sm font-semibold text-slate-700 mb-1">Physical count</div>
      <p className="text-xs text-slate-500 mb-3">Enter what is on the rack, size by size. Any difference from the book goes to the
        store in-charge as a pending adjustment and changes nothing until it is approved.</p>
      <div className="flex gap-2 flex-wrap items-end mb-3">
        <label className="text-xs text-slate-600">Article<ArticleSelect value={article} onChange={a=>{setArticle(a);setCounted({});setColour(String(((INPUTS.articles||{})[a]||{}).upper_colour||""));}} /></label>
        <label className="text-xs text-slate-600">Colour
          <input value={colour} onChange={e=>setColour(e.target.value)} aria-label="Colour" className={`${input} w-32`}/></label>
        <label className="text-xs text-slate-600 flex-1 min-w-40">Note
          <input value={note} onChange={e=>setNote(e.target.value)} className={`${input} w-full`}/></label>
      </div>
      {article && <div className="flex gap-2 flex-wrap mb-3">{sizes.map(sz=>{
        const d = diffOf[sz];
        return <label key={sz} className="text-[11px] text-slate-500 text-center">{sz}
          <input type="number" min="0" value={counted[sz]??""} aria-label={`Counted size ${sz}`}
            onChange={e=>setCounted(c=>({...c,[sz]:e.target.value}))}
            className="block w-16 border border-slate-300 rounded px-1 py-0.5 mono text-right text-sm"/>
          <span className="mono">book {fmt(book[sz]||0)}</span>
          {d && d.diff!==0 && <span className="block mono font-semibold" style={{color:d.diff<0?"#b91c1c":"#047857"}}>{d.diff>0?"+":""}{d.diff}</span>}
        </label>;})}</div>}
      <button disabled={busy||!adjustments.length} onClick={submit}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
        {busy?"Sending…":`Send ${adjustments.length} adjustment${adjustments.length===1?"":"s"} for approval`}</button>
    </>}
    {err && <div role="alert" className="mt-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{err}</div>}
    {msg && <div className="mt-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">{msg}</div>}

    <div className="text-sm font-semibold text-slate-700 mt-6 mb-2">Awaiting approval</div>
    {!pending.length ? <div className="text-xs text-slate-500">Nothing is waiting.</div>
      : <table className="w-full text-xs" style={{minWidth:640}}><thead><tr className="sign text-slate-500">
          {["Date","Article","Colour","Size","Change","Reason","Counted by",""].map(h=><th key={h} className={`py-2 px-2 ${h==="Change"?"text-right":"text-left"}`}>{h}</th>)}</tr></thead>
          <tbody>{pending.map(m=><tr key={m.id} className="border-t border-slate-100">
            <td className="px-2 py-1 mono">{m.moved_on}</td><td className="px-2">{m.article}</td><td className="px-2">{m.colour||"—"}</td>
            <td className="px-2 mono">{m.size}</td>
            <td className="px-2 mono text-right font-semibold" style={{color:m.qty<0?"#b91c1c":"#047857"}}>{m.qty>0?"+":""}{fmt(m.qty)}</td>
            <td className="px-2 text-slate-600">{m.reason}</td><td className="px-2">{m.created_by||""}</td>
            <td className="px-2 text-right whitespace-nowrap">{access==="approve"
              ? <><button onClick={()=>decide(m,"approve")} className="text-emerald-700 font-semibold underline mr-2">Approve</button>
                  <button onClick={()=>decide(m,"reject")} className="text-rose-700 underline">Reject</button></>
              : <span className="text-slate-400">store in-charge</span>}</td>
          </tr>)}</tbody></table>}
  </div>;
}

function Ledger({ moves, access, onChanged }){
  const [filter,setFilter]=useState("");
  const [err,setErr]=useState("");
  const rows = useMemo(()=>upperLedger(moves),[moves]);
  const shown = filter ? rows.filter(r=>`${r.article} ${r.colour} ${r.order_no||""} ${r.source||""}`.toUpperCase().includes(filter.toUpperCase())) : rows;
  async function remove(m){
    if(!window.confirm(`Delete this movement — ${m.qty} uppers of ${m.article} size ${m.size}? Re-enter it if it was wrong.`)) return;
    setErr("");
    try{ await api.deleteUpperMove(m.id); await onChanged(); }
    catch(e){ setErr(String(e.message||e)); }
  }
  const detail = m => m.kind==="in" ? `${SOURCE_TYPES[m.source_type]||""}: ${m.source||""}${m.rack?` · rack ${m.rack}`:""}`
    : ["qc_failed","rework_out","rework_in"].includes(m.kind) ? `${m.source||""}${m.rework?" · after rework":""}`
    : m.kind==="damaged" ? `${DAMAGE_AT[m.damaged_at]||""}${m.source?` · made by ${m.source}`:""}`
    : DESTINATIONS[m.destination]||"";
  if(!moves.length) return <div className="text-sm text-slate-500 text-center py-8">No movements recorded yet.</div>;
  return <div className="overflow-x-auto">
    <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter by article, colour, order or source"
      className="mb-2 text-sm border border-slate-300 rounded-lg px-2 py-1 w-72"/>
    {err && <div role="alert" className="mb-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{err}</div>}
    <table className="w-full text-xs" style={{minWidth:900}}><thead><tr className="sign text-slate-500">
      {["Date","What","Article","Colour","Size","In","Out","Balance","Order / card","Where","Reason",""].map(h=>
        <th key={h} className={`py-2 px-2 ${["In","Out","Balance"].includes(h)?"text-right":"text-left"}`}>{h}</th>)}</tr></thead>
      <tbody>{shown.map(m=><tr key={m.id} className="border-t border-slate-100" style={{opacity:m.status==="rejected"?.5:1}}>
        <td className="px-2 py-1 mono">{m.moved_on}</td>
        <td className="px-2">{(UPPER_KINDS[m.kind]||{}).label||m.kind}{m.status!=="approved"&&<span className="text-indigo-700"> ({m.status})</span>}</td>
        <td className="px-2">{m.article}</td><td className="px-2">{m.colour||"—"}</td><td className="px-2 mono">{m.size}</td>
        <td className="px-2 mono text-right text-emerald-700">{m.effect>0?fmt(m.effect):""}</td>
        <td className="px-2 mono text-right text-rose-700">{m.effect<0?fmt(-m.effect):m.effect===0&&m.status==="approved"&&m.kind!=="adjust"?`(${fmt(m.qty)})`:""}</td>
        <td className="px-2 mono text-right font-semibold">{fmt(m.balance)}</td>
        <td className="px-2 mono">{[m.mts?"MTS":m.order_no,m.job_card_no].filter(Boolean).join(" · ")}</td>
        <td className="px-2 text-slate-600">{detail(m)}</td><td className="px-2 text-slate-500">{m.reason||""}</td>
        <td className="px-2 text-right">{access && <button onClick={()=>remove(m)} className="text-rose-700 underline">delete</button>}</td>
      </tr>)}</tbody></table>
  </div>;
}

function Reports({ moving, shortage, fabrication, ratios, repair, rules, setRules, canEditRules, access, onTagged }){
  const [err,setErr]=useState("");
  const [tagging,setTagging]=useState(null);
  async function saveTag(t){
    setErr("");
    try{ await api.setUpperTag(t); setTagging(null); await onTagged(); }
    catch(e){ setErr(String(e.message||e)); }
  }
  const th = "py-2 px-2 text-left", thr = "py-2 px-2 text-right";
  return <div className="space-y-8">
    {err && <div role="alert" className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{err}</div>}
    <section>
      <div className="text-sm font-semibold text-slate-700">Moving vs non-moving</div>
      <div className="text-xs text-slate-500 mt-1 mb-2">Moving means issued in the last <b>{moving.moving_days}</b> days.
        An upper never issued is aged from when it first came in. A tag set by hand overrides this and keeps its reason.</div>
      <div className="flex gap-2 flex-wrap mb-3">{AGE_BUCKETS.map(b=><div key={b} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs">
        <div className="text-slate-500">{b} days</div><div className="mono font-semibold">{fmt(moving.buckets[b].pairs)} <span className="font-normal text-slate-400">· {moving.buckets[b].groups}</span></div></div>)}</div>
      {!moving.rows.length ? <div className="text-xs text-slate-500">Nothing in the store.</div>
        : <table className="w-full text-xs" style={{minWidth:720}}><thead><tr className="sign text-slate-500">
            <th className={th}>Article</th><th className={th}>Colour</th><th className={thr}>Uppers</th><th className={thr}>Days idle</th>
            <th className={th}>Ageing</th><th className={th}>Status</th><th className={th}>Reason</th><th className={th}></th></tr></thead>
          <tbody>{moving.rows.map(r=><tr key={`${r.article}|${r.colour}`} className="border-t border-slate-100 align-top">
            <td className="px-2 py-1">{r.article}</td><td className="px-2">{r.colour||"—"}</td>
            <td className="px-2 mono text-right">{fmt(r.on_hand)}</td><td className="px-2 mono text-right">{r.days_idle??"—"}</td>
            <td className="px-2 mono">{r.bucket||"—"}</td>
            <td className="px-2 font-semibold" style={{color:r.status==="moving"?"#047857":"#b45309"}}>{r.status==="moving"?"Moving":"Non-moving"}{r.manual?" (set)":""}</td>
            <td className="px-2 text-slate-600">{r.reason}</td>
            <td className="px-2 text-right">{access && (tagging&&tagging.article===r.article&&tagging.colour===r.colour
              ? <TagEditor row={r} onSave={saveTag} onCancel={()=>setTagging(null)} />
              : <button onClick={()=>setTagging(r)} className="text-indigo-700 underline">change</button>)}</td>
          </tr>)}</tbody></table>}
    </section>

    <section>
      <div className="text-sm font-semibold text-slate-700">Shortage — what live orders still need against the store</div>
      <div className="text-xs text-slate-500 mt-1 mb-2">Ordered, less what has been issued against that order (net of returns), by article and size.
        Orders that have shipped or closed are left out.</div>
      {!shortage.rows.length ? <div className="text-xs text-slate-500">No live order is waiting on uppers by size.</div>
        : <table className="w-full text-xs" style={{minWidth:640}}><thead><tr className="sign text-slate-500">
            <th className={th}>Article</th><th className={th}>Size</th><th className={thr}>Need</th><th className={thr}>In store</th>
            <th className={thr}>Short</th><th className={th}>Orders</th></tr></thead>
          <tbody>{shortage.rows.map(r=><tr key={`${r.article}|${r.size}`} className="border-t border-slate-100" style={{background:r.short>0?"#fff7ed":undefined}}>
            <td className="px-2 py-1">{r.article}</td><td className="px-2 mono">{r.size}</td><td className="px-2 mono text-right">{fmt(r.need)}</td>
            <td className="px-2 mono text-right">{fmt(r.available)}{r.colours.length?<span className="text-slate-400"> ({r.colours.join(", ")})</span>:""}</td>
            <td className={`px-2 mono text-right font-semibold ${r.short>0?"text-amber-700":"text-emerald-700"}`}>{fmt(r.short)}</td>
            <td className="px-2 mono text-slate-500">{r.orders.join(", ")}</td></tr>)}</tbody></table>}
      {shortage.sizes_unknown.length>0 && <div className="text-xs text-amber-700 mt-2">
        Ordered as a range with no sizes, so not matched size by size: {shortage.sizes_unknown.map(u=>`${u.article} ${fmt(u.pairs)} pairs (${u.orders.join(", ")})`).join("; ")}.</div>}
    </section>

    <section>
      <div className="text-sm font-semibold text-slate-700">Outside fabrication — sent, received, pending</div>
      <div className="text-xs text-slate-500 mt-1 mb-2">From stitching job work issued to outside fabricators in the Job Orders Database.
        {fabrication.due_days ? ` Overdue after ${fabrication.due_days} days.` : " No turnaround is set, so nothing is called overdue."}</div>
      {!fabrication.rows.length ? <div className="text-xs text-slate-500">No stitching has been sent outside.</div>
        : <table className="w-full text-xs" style={{minWidth:640}}><thead><tr className="sign text-slate-500">
            <th className={th}>Fabricator</th><th className={thr}>Jobs</th><th className={thr}>Sent</th><th className={thr}>Received</th>
            <th className={thr}>Pending</th><th className={thr}>Short</th><th className={thr}>Overdue</th></tr></thead>
          <tbody>{fabrication.fabricators.map(f=><tr key={f.fabricator} className="border-t border-slate-100">
            <td className="px-2 py-1">{f.fabricator}</td><td className="px-2 mono text-right">{f.jobs}</td><td className="px-2 mono text-right">{fmt(f.sent)}</td>
            <td className="px-2 mono text-right">{fmt(f.received)}</td><td className="px-2 mono text-right font-semibold">{fmt(f.pending)}</td>
            <td className="px-2 mono text-right">{fmt(f.shortage)}</td>
            <td className={`px-2 mono text-right ${f.overdue?"text-rose-700 font-semibold":""}`}>{f.overdue}</td></tr>)}</tbody></table>}
    </section>

    <section>
      <div className="text-sm font-semibold text-slate-700">QC by maker</div>
      <div className="text-xs text-slate-500 mt-1 mb-2">Failed at first inspection against everything that line or vendor sent in.
        Reworked uppers that fail again are shown beside it, not counted twice.</div>
      {!ratios.length ? <div className="text-xs text-slate-500">Nothing has been inspected yet.</div>
        : <table className="w-full text-xs" style={{minWidth:720}}><thead><tr className="sign text-slate-500">
            {["Line / vendor","Inspected","Passed","Failed","Rejection","Sent for rework","Back passed","Failed again","Scrapped"].map((h,i)=>
              <th key={h} className={i?thr:th}>{h}</th>)}</tr></thead>
          <tbody>{ratios.map(r=><tr key={r.source} className="border-t border-slate-100">
            <td className="px-2 py-1">{r.source}</td>
            {[r.inspected,r.passed,r.failed].map((v,i)=><td key={i} className="px-2 mono text-right">{fmt(v)}</td>)}
            <td className="px-2 mono text-right font-semibold">{r.ratio==null?"—":`${r.ratio}%`}</td>
            {[r.sent_for_rework,r.reworked_back,r.failed_again,r.scrapped].map((v,i)=><td key={i} className="px-2 mono text-right">{fmt(v)}</td>)}
          </tr>)}</tbody></table>}
    </section>

    <section>
      <div className="text-sm font-semibold text-slate-700">Repair rejection</div>
      <div className="text-xs text-slate-500 mt-1 mb-2">From the Repair screen: of the shoes sent for repair, how many were then rejected.
        {repair.overall.ratio!=null && <> Overall <b>{repair.overall.ratio}%</b> ({fmt(repair.overall.rejected)} of {fmt(repair.overall.sent)}).</>}</div>
      {!repair.articles.length ? <div className="text-xs text-slate-500">Nothing has been sent for repair.</div>
        : <table className="w-full text-xs" style={{minWidth:420}}><thead><tr className="sign text-slate-500">
            <th className={th}>Article</th><th className={thr}>Sent for repair</th><th className={thr}>Rejected</th><th className={thr}>Ratio</th></tr></thead>
          <tbody>{repair.articles.map(r=><tr key={r.article} className="border-t border-slate-100">
            <td className="px-2 py-1">{r.article}</td><td className="px-2 mono text-right">{fmt(r.sent)}</td>
            <td className="px-2 mono text-right">{fmt(r.rejected)}</td>
            <td className="px-2 mono text-right font-semibold">{r.ratio==null?"—":`${r.ratio}%`}</td></tr>)}</tbody></table>}
    </section>

    <RulesEditor rules={rules} setRules={setRules} canEdit={canEditRules} />
  </div>;
}

function TagEditor({ row, onSave, onCancel }){
  const [tag,setTag]=useState(row.status==="moving"?"non_moving":"moving");
  const [code,setCode]=useState("hold");
  const [reason,setReason]=useState("");
  return <div className="flex gap-1 flex-wrap justify-end items-center">
    <select value={tag} onChange={e=>setTag(e.target.value)} aria-label="Tag" className="text-xs border border-slate-300 rounded px-1 py-0.5">
      <option value="non_moving">Non-moving</option><option value="moving">Moving</option><option value="auto">Automatic</option></select>
    {tag==="non_moving" && <select value={code} onChange={e=>setCode(e.target.value)} aria-label="Reason code" className="text-xs border border-slate-300 rounded px-1 py-0.5">
      {Object.entries(HOLD_REASONS).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>}
    {tag!=="auto" && <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="reason" aria-label="Tag reason" className="text-xs border border-slate-300 rounded px-1 py-0.5 w-28"/>}
    <button onClick={()=>onSave({ article:row.article, colour:row.colour, tag, reason_code:tag==="non_moving"?code:null, reason })}
      className="text-xs font-semibold text-indigo-700 underline">save</button>
    <button onClick={onCancel} className="text-xs text-slate-500 underline">cancel</button>
  </div>;
}

/* The three rules the client has still to confirm. Moving days starts at
   their own 7; the other two are blank — and their alerts silent — until
   somebody says what they are. */
function RulesEditor({ rules, setRules, canEdit }){
  const [draft,setDraft]=useState({ moving_days:rules.moving_days, fabrication_due_days:rules.fabrication_due_days??"", rejection_alert_pct:rules.rejection_alert_pct??"",
    repair_rejection_alert_pct:rules.repair_rejection_alert_pct??"" });
  const [err,setErr]=useState(""),[msg,setMsg]=useState("");
  useEffect(()=>{ setDraft({ moving_days:rules.moving_days, fabrication_due_days:rules.fabrication_due_days??"", rejection_alert_pct:rules.rejection_alert_pct??"",
    repair_rejection_alert_pct:rules.repair_rejection_alert_pct??"" }); },[rules]);
  async function save(){
    setErr(""); setMsg("");
    const { rules:next, problems } = normalizeUpperRules(draft);
    if(problems.length){ setErr(problems.join("; ")); return; }
    try{ await api.putSettings({ upper_store_rules:next }); setRules(next); setMsg("Saved."); }
    catch(e){ setErr(String(e.message||e)); }
  }
  const field = (k, label, unit) => <label className="text-xs text-slate-600">{label}
    <span className="flex items-center gap-1"><input type="number" value={draft[k]} disabled={!canEdit} aria-label={label}
      onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))} className={`${input} w-20 mono`}/>{unit}</span></label>;
  return <section>
    <div className="text-sm font-semibold text-slate-700">Rules</div>
    <div className="text-xs text-slate-500 mt-1 mb-2">Still to be confirmed by the factory. Leave a box blank to keep that alert off.
      {!canEdit && " Only an administrator can change these."}</div>
    <div className="flex gap-3 flex-wrap items-end">
      {field("moving_days","Moving if issued within","days")}
      {field("fabrication_due_days","Fabrication overdue after","days")}
      {field("rejection_alert_pct","QC rejection alert at","%")}
      {field("repair_rejection_alert_pct","Repair rejection alert at","%")}
      {canEdit && <button onClick={save} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white">Save rules</button>}
    </div>
    {err && <div role="alert" className="mt-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{err}</div>}
    {msg && <div className="mt-2 text-xs text-emerald-800">{msg}</div>}
  </section>;
}
