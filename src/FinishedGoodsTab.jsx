import React, { useMemo, useState, useRef } from "react";
import * as XLSX from "xlsx";
import { REF as INPUTS } from "./lib/refdata.js";
import * as api from "./lib/client.js";
import { todayIso } from "./lib/today.js";
import { comboSizesForArticle } from "../shared/bridge.js";
import { finishedStock, mtoStock, MOVE_KINDS, validateMoves } from "../shared/finished-stock.js";

const fmt = n => (n==null||isNaN(n)) ? "—" : Number(n).toLocaleString("en-IN");

/* Every size an article is made in, in range order — the grid the stock is
   entered against. */
export function articleSizes(article){
  const a = (INPUTS.articles||{})[article];
  if(!a) return [];
  const out = [];
  for(const combo of a.combo_order || Object.keys(a.combos||{}))
    for(const s of comboSizesForArticle(article, combo)) if(!out.includes(String(s))) out.push(String(s));
  return out;
}

/* FINISHED GOODS — the shoes the dispatch clerk ships from.
   MTS stock: made for the shelf (opening counts, MTS orders moved to stock,
   stock job cards that came back), less what was issued out.
   MTO stock: made and packed for a customer order, not yet shipped.
   Both used to sit on the raw-material Stock screen, where nobody packing a
   lorry would look. */
export default function FinishedGoodsTab({ state, jobs = [], moves = [], actuals = [], dispatches = [], onChanged, readOnly = false }){
  const [view,setView]=useState("mts");
  const stock = useMemo(()=>finishedStock(moves, jobs), [moves, jobs]);
  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <div role="tablist" aria-label="Finished goods" className="inline-flex rounded-xl bg-slate-100 p-1 mb-4 flex-wrap">
      {[["mts","MTS stock"],["mto","MTO stock"],...(readOnly?[]:[["enter","Enter stock"]]),["moves","Movements"]].map(([k,label])=>
        <button key={k} role="tab" aria-selected={view===k} onClick={()=>setView(k)}
          className="text-sm font-semibold rounded-lg px-4 py-1.5"
          style={view===k?{background:"#fff",color:"#1e293b",boxShadow:"0 1px 2px rgba(15,23,42,.12)"}:{background:"transparent",color:"#64748b"}}>
          {label}</button>)}
    </div>
    {view==="mts" && <MtsStock stock={stock} />}
    {view==="mto" && <MtoStock state={state} actuals={actuals} dispatches={dispatches} />}
    {view==="enter" && <EnterStock orders={state.orders||[]} onSaved={async()=>{ if(onChanged) await onChanged(); setView("mts"); }} />}
    {view==="moves" && <Movements moves={moves} readOnly={readOnly} onChanged={onChanged} />}
  </div>;
}

function MtsStock({ stock }){
  if(!stock.articles.length) return <div className="text-sm text-slate-500 text-center py-8">
    Nothing is recorded in finished stock yet. Enter the opening count under <b>Enter stock</b>, use
    <b> Move to stock</b> on an MTS order in the Dispatch Book, or raise a job card for stock.</div>;
  return <div>
    <div className="flex gap-4 flex-wrap mb-3 text-xs">
      <span className="text-slate-500">Articles <b className="mono text-slate-800">{stock.articles.length}</b></span>
      <span className="text-slate-500">Pairs on hand <b className="mono text-slate-800">{fmt(stock.total_pairs)}</b></span>
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm"><thead>
        <tr className="text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
          <th className="text-left px-3 py-2">Article</th><th className="text-right px-3 py-2">Pairs</th>
          <th className="text-left px-3 py-2">By size</th><th className="text-left px-3 py-2">From</th></tr></thead>
        <tbody>{stock.articles.map(a=>(
          <tr key={a.article} className="border-t border-slate-100 align-top">
            <td className="px-3 py-2 font-medium text-slate-800">{a.article}</td>
            <td className="px-3 py-2 text-right mono font-semibold">{fmt(a.total)}</td>
            <td className="px-3 py-2 text-[11px] text-slate-600">
              {a.size_list.map(s=><span key={s.size} className="mr-3 whitespace-nowrap" style={{color:s.pairs<0?"#b91c1c":undefined}}>
                <b className="mono">{s.size}</b>: {fmt(s.pairs)}</span>)}
              {a.sizes_unknown>0 && <div className="text-amber-700">+{fmt(a.sizes_unknown)} pairs back on part-received stock cards, size not recorded</div>}
              {a.negative.length>0 && <div className="text-rose-700 font-semibold">
                More issued than ever came in for {a.negative.join(", ")} — enter the opening count or correct a movement.</div>}
            </td>
            <td className="px-3 py-2 text-[11px] text-slate-500">
              {a.from_moves!==0 && <div>ledger {fmt(a.from_moves)}</div>}
              {a.from_cards>0 && <div>stock job cards {fmt(a.from_cards)}</div>}</td>
          </tr>))}</tbody>
      </table>
    </div>
  </div>;
}

function MtoStock({ state, actuals, dispatches }){
  const mto = useMemo(()=>mtoStock(state.orders||[], actuals, dispatches), [state.orders, actuals, dispatches]);
  const orders=(state.orders||[]).filter(o=>/\bMTO\b/i.test(String(o.pi&&o.pi.order_nature||"")));
  return <div className="overflow-x-auto">
    <div className="text-sm font-semibold text-slate-700">MTO stock — made for a customer, not yet shipped</div>
    <div className="text-xs text-slate-500 mt-1 mb-3">
      Packed is what was reported against PACKING on Daily plan vs achievement (rejections taken off); shipped is the Dispatch Book.
      <b> Ready</b> is boxed and waiting for a lorry.</div>
    {!mto.rows.length
      ? <div className="text-sm text-slate-500 text-center py-6">No live order is marked MTO.</div>
      : <table className="w-full text-xs mb-6" style={{minWidth:640}}><thead><tr className="sign text-slate-500">
          {["Order","Party","Article","Ordered","Packed","Shipped","Ready","Still to make"].map(h=>
            <th key={h} className={`py-2 px-2 ${["Order","Party","Article"].includes(h)?"text-left":"text-right"}`}>{h}</th>)}</tr></thead>
          <tbody>{mto.rows.map(r=><tr key={r.order_no} className="border-t border-slate-100">
            <td className="px-2 py-1.5 mono font-semibold">{r.order_no}</td><td className="px-2">{r.party}</td><td className="px-2">{r.article}</td>
            <td className="px-2 mono text-right">{fmt(r.ordered)}</td><td className="px-2 mono text-right">{fmt(r.packed)}</td>
            <td className="px-2 mono text-right">{fmt(r.dispatched)}</td>
            <td className="px-2 mono text-right font-semibold text-emerald-700">{fmt(r.ready)}</td>
            <td className="px-2 mono text-right text-slate-500">{fmt(r.to_make)}</td></tr>)}</tbody></table>}
    <div className="text-sm font-semibold text-slate-700">MTO material availability</div>
    <div className="text-xs text-slate-500 mt-1 mb-3">Requirements and shortfall from the BOM against the current raw-material register.</div>
    <table className="w-full text-xs" style={{minWidth:820}}><thead><tr className="sign text-slate-500">
      {['Order / PI','Party','Article','Material','Required','Covered','Shortfall','UOM'].map(h=><th key={h} className={`py-2 px-2 ${['Required','Covered','Shortfall'].includes(h)?'text-right':'text-left'}`}>{h}</th>)}
    </tr></thead><tbody>{orders.flatMap(order=>{
      const materials=((state.procurement_by_order||{})[order.order_no]||{}).materials||[];
      return materials.map((m,index)=><tr key={`${order.order_no}-${m.material_key}`} className="border-t border-slate-100" style={{background:m.shortfall>0?'#fff7ed':'#fff'}}>
        <td className="py-2 px-2">{index===0&&<><div className="mono font-semibold">{order.order_no}</div><div className="mono text-slate-400">{order.pi&&order.pi.pi_no||'No PI'}</div></>}</td>
        <td className="px-2">{index===0?order.party:''}</td><td className="px-2">{index===0?order.article:''}</td><td className="px-2">{m.name}</td>
        <td className="px-2 mono text-right">{fmt(m.required)}</td><td className="px-2 mono text-right">{fmt(m.covered)}</td>
        <td className={`px-2 mono text-right font-semibold ${m.shortfall>0?'text-amber-700':'text-emerald-700'}`}>{fmt(m.shortfall)}</td><td className="px-2">{m.uom}</td>
      </tr>);
    })}</tbody></table>
  </div>;
}

/* Entering finished stock by hand: the opening count, pairs put in, pairs
   issued out to a customer, or a count correction — size by size. Also takes
   the MTS stock sheet (Formats) back as an upload. */
function EnterStock({ orders, onSaved }){
  const articles = useMemo(()=>Object.keys(INPUTS.articles||{}).sort(), []);
  const [article,setArticle]=useState("");
  const [kind,setKind]=useState("opening");
  const [date,setDate]=useState(todayIso());
  const [orderNo,setOrderNo]=useState("");
  const [note,setNote]=useState("");
  const [qty,setQty]=useState({});
  const [busy,setBusy]=useState(false),[err,setErr]=useState(""),[msg,setMsg]=useState("");
  const fileRef=useRef(null);
  const sizes = article ? articleSizes(article) : [];
  const total = Object.values(qty).reduce((a,v)=>a+(Number(v)||0),0);

  async function save(rows){
    setErr(""); setMsg(""); setBusy(true);
    try{
      const { problems } = validateMoves(rows);
      if(problems.length) throw new Error(problems.slice(0,6).join("; "));
      const r = await api.addFinishedStock(rows);
      setMsg(`${r.saved} movement${r.saved===1?"":"s"} recorded.`); setQty({});
      if(onSaved) await onSaved();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }
  function submit(){
    if(!article){ setErr("Choose the article."); return; }
    if(kind==="issued" && !orderNo.trim()){ setErr("Name the order the pairs were issued to."); return; }
    save(Object.entries(qty).filter(([,v])=>Number(v)).map(([size,v])=>({
      article, size, kind, qty:Number(v), moved_on:date, order_no:orderNo||null, note })));
  }
  async function upload(file){
    setErr("");
    try{
      const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});
      const ws=wb.Sheets["MTS Stock"]||wb.Sheets[wb.SheetNames[0]];
      const data=XLSX.utils.sheet_to_json(ws,{defval:"",raw:true});
      const rows=data.filter(r=>String(r.Article||"").trim()&&Number(r.Pairs||r.Qty||0)).map(r=>({
        article:String(r.Article).trim(), size:String(r.Size).trim(),
        kind:String(r.Kind||"opening").trim().toLowerCase()||"opening",
        qty:Number(r.Pairs||r.Qty), moved_on:String(r.Date||"").slice(0,10)||todayIso(), note:String(r.Note||"").trim() }));
      if(!rows.length) throw new Error("No rows with an article and a number of pairs were found.");
      const unknown=[...new Set(rows.map(r=>r.article).filter(a=>!(INPUTS.articles||{})[a]))];
      if(unknown.length) throw new Error(`Not on the article master: ${unknown.slice(0,5).join(", ")}`);
      await save(rows);
    }catch(e){ setErr(String(e.message||e)); }
    finally{ if(fileRef.current) fileRef.current.value=""; }
  }

  return <div>
    <div className="text-sm font-semibold text-slate-700 mb-1">Enter finished stock</div>
    <p className="text-xs text-slate-500 mb-3">
      Size by size. <b>Opening stock</b> is the count already on the shelf; <b>issued</b> takes pairs out for a customer order;
      a <b>count adjustment</b> is entered with its sign (−12 for twelve missing). Or fill the MTS stock sheet from Formats &amp; sheets and upload it.</p>
    <div className="flex gap-2 flex-wrap items-end mb-3">
      <label className="text-xs text-slate-600">Article
        <select value={article} onChange={e=>{setArticle(e.target.value);setQty({});}} aria-label="Article"
          className="block mt-0.5 text-sm border border-slate-300 rounded-lg px-2 py-1 bg-white max-w-xs">
          <option value="">Choose…</option>{articles.map(a=><option key={a} value={a}>{a}</option>)}</select></label>
      <label className="text-xs text-slate-600">What
        <select value={kind} onChange={e=>setKind(e.target.value)} aria-label="Movement kind"
          className="block mt-0.5 text-sm border border-slate-300 rounded-lg px-2 py-1 bg-white">
          {Object.entries(MOVE_KINDS).filter(([k])=>k!=="from_order").map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></label>
      <label className="text-xs text-slate-600">Date
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="block mt-0.5 text-sm border border-slate-300 rounded-lg px-2 py-1 mono"/></label>
      <label className="text-xs text-slate-600">Order {kind==="issued"?"(required)":"(optional)"}
        <input list="fg-orders" value={orderNo} onChange={e=>setOrderNo(e.target.value)} aria-label="Order number"
          className="block mt-0.5 text-sm border border-slate-300 rounded-lg px-2 py-1 mono w-28"/>
        <datalist id="fg-orders">{orders.map(o=><option key={o.order_no} value={o.order_no}>{o.party}</option>)}</datalist></label>
      <label className="text-xs text-slate-600 flex-1 min-w-40">Note
        <input value={note} onChange={e=>setNote(e.target.value)} className="block mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2 py-1"/></label>
    </div>
    {article && (sizes.length
      ? <div className="flex gap-2 flex-wrap mb-3">{sizes.map(sz=><label key={sz} className="text-[11px] text-slate-500 text-center">{sz}
          <input type="number" value={qty[sz]??""} aria-label={`Pairs of size ${sz}`}
            onChange={e=>setQty(q=>({...q,[sz]:e.target.value}))}
            className="block w-16 border border-slate-300 rounded px-1 py-0.5 mono text-right text-sm"/></label>)}</div>
      : <div className="text-xs text-amber-700 mb-3">This article has no size ranges on file.</div>)}
    <div className="flex gap-2 items-center flex-wrap">
      <button disabled={busy||!total} onClick={submit}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
        {busy?"Saving…":`Record ${fmt(total)} pairs`}</button>
      <label className={`text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white ${busy?"opacity-50":"cursor-pointer"}`}>
        Upload MTS stock sheet
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" disabled={busy} onChange={e=>e.target.files[0]&&upload(e.target.files[0])}/></label>
    </div>
    {err && <div role="alert" className="mt-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{err}</div>}
    {msg && <div className="mt-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">{msg}</div>}
  </div>;
}

function Movements({ moves, readOnly, onChanged }){
  const [err,setErr]=useState("");
  async function remove(m){
    if(!window.confirm(`Delete this movement — ${m.qty} pairs of ${m.article} size ${m.size}? Re-enter it if it was wrong.`)) return;
    setErr("");
    try{ await api.deleteFinishedStock(m.id); if(onChanged) await onChanged(); }
    catch(e){ setErr(String(e.message||e)); }
  }
  if(!moves.length) return <div className="text-sm text-slate-500 text-center py-8">No movements recorded yet.</div>;
  return <div className="overflow-x-auto">
    {err && <div role="alert" className="mb-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{err}</div>}
    <table className="w-full text-xs" style={{minWidth:640}}><thead><tr className="sign text-slate-500">
      {["Date","Article","Size","Pairs","What","Order","Note",""].map(h=><th key={h} className={`py-2 px-2 ${h==="Pairs"?"text-right":"text-left"}`}>{h}</th>)}</tr></thead>
      <tbody>{moves.map(m=><tr key={m.id} className="border-t border-slate-100">
        <td className="px-2 py-1 mono">{m.moved_on}</td><td className="px-2">{m.article}</td><td className="px-2 mono">{m.size}</td>
        <td className="px-2 mono text-right" style={{color:m.qty<0?"#b91c1c":"#047857"}}>{m.qty>0?"+":""}{fmt(m.qty)}</td>
        <td className="px-2">{(MOVE_KINDS[m.kind]||{}).label||m.kind}</td><td className="px-2 mono">{m.order_no||""}</td>
        <td className="px-2 text-slate-500">{m.note||""}</td>
        <td className="px-2 text-right">{!readOnly && !m.dispatch_id && <button onClick={()=>remove(m)} className="text-rose-700 underline">delete</button>}</td>
      </tr>)}</tbody></table>
  </div>;
}
