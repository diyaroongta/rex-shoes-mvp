import React, { useEffect, useMemo, useState } from "react";
import * as api from "./lib/client.js";
import { REF as INPUTS } from "./lib/refdata.js";
import JobCard from "./JobCard.jsx";
import { slipFor } from "../shared/job-work.js";
import { comboSizesForArticle } from "../shared/bridge.js";
import { optionLabel, TYPES, TYPE_LABEL, TYPE_HELP, RULES, validateFabricator } from "../shared/fabricators.js";
import { jobOrderBalance, jobOrderQueue } from "../shared/job-orders.js";

const fmt = n => n==null||isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");
const today = () => new Date().toISOString().slice(0,10);
const shortDate = iso => {
  const d=new Date(iso);
  return isNaN(d) ? String(iso).slice(0,10)
    : d.toLocaleDateString("en-IN",{day:"numeric",month:"short"});
};

/* Job Order creation. The Order Book supplies the article and ceiling; the
   operator supplies who receives it, the date and the exact size-wise cutting
   quantities. The Job Card is its printable document, not another workflow. */
export default function JobCardTab({ orders=[], initialOrderNo="", embedded=false, onIssued=null }){
  const [fabricators,setFabricators]=useState(null);
  const [jobs,setJobs]=useState(null);
  const [orderNo,setOrderNo]=useState("");
  const [fabricator,setFabricator]=useState("");
  const [date,setDate]=useState(today);
  const [qty,setQty]=useState({});
  const [sizes,setSizes]=useState({});
  const [card,setCard]=useState(null);
  const [stale,setStale]=useState(false);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [adding,setAdding]=useState(null);   // the inline "new fabricator" draft

  async function reload(){
    try{
      const [f,j]=await Promise.all([api.listFabricators(),api.listJobWork()]);
      setFabricators(f); setJobs(j);
    }catch(e){ setErr(e.message||String(e)); setFabricators([]); setJobs([]); }
  }
  useEffect(()=>{
    reload();
    const timer=setInterval(reload,60000);
    return()=>clearInterval(timer);
  },[]);

  const queue=useMemo(()=>jobOrderQueue(orders,jobs||[]),[orders,jobs]);
  const openOrders=queue.filter(row=>row.remaining>0);
  const order=orders.find(o=>o.order_no===orderNo)||null;
  const balance=order?jobOrderBalance(order,jobs||[]):null;
  const article=order?(INPUTS.articles||{})[order.article_code]:null;
  const who=(fabricators||[]).find(f=>f.name===fabricator)||null;

  function chooseOrder(no){
    setOrderNo(no); setCard(null); setStale(false); setErr(""); setMsg("");
    const row=queue.find(x=>x.order.order_no===no);
    if(!row){ setQty({}); setSizes({}); return; }
    const nextQty={},nextSizes={};
    for(const line of row.lines){
      nextQty[line.combo]=line.remaining;
      if(line.remaining_sizes) nextSizes[line.combo]={...line.remaining_sizes};
    }
    setQty(nextQty); setSizes(nextSizes);
  }

  useEffect(()=>{
    if(initialOrderNo&&jobs!==null&&orders.some(o=>o.order_no===initialOrderNo)&&orderNo!==initialOrderNo)
      chooseOrder(initialOrderNo);
  },[initialOrderNo,jobs,orders]);

  const lines=useMemo(()=>Object.entries(qty).filter(([,value])=>Number(value)>0).map(([combo,value])=>({
    combo, qty:Number(value), sizes:sizes[combo],
    size_order:order?comboSizesForArticle(order.article_code,combo):[],
  })),[qty,sizes,order]);
  const totalPairs=lines.reduce((a,line)=>a+line.qty,0);
  const over=balance?balance.lines.filter(line=>Number(qty[line.combo]||0)>line.remaining):[];
  const ready=!!order&&!!who&&totalPairs>0&&!over.length;

  function touched(){ if(card)setStale(true); }
  function setRange(combo,value){ setQty(q=>({...q,[combo]:value})); touched(); }
  function setSize(combo,size,value){
    setSizes(current=>{
      const group={...(current[combo]||{}),[size]:value};
      setQty(q=>({...q,[combo]:Object.values(group).reduce((a,n)=>a+(Number(n)||0),0)}));
      return {...current,[combo]:group};
    });
    touched();
  }

  function generate(){
    if(!ready)return;
    setCard({article:order.article_code,order_no:order.order_no,fabricator:who.name,
      slip:`JOB CARD — ${slipFor(who)}`,stage:"CUTTING & STITCHING",date,card_no:"",lines});
    setStale(false); setMsg("");
  }

  async function issue(){
    setBusy(true); setErr(""); setMsg("");
    try{
      const snapshot={...card,lines};
      const made=await api.issueJobWork({fabricator:who.name,article:order.article_code,qty:totalPairs,
        stage:"STITCHING",order_no:order.order_no,issued_on:date,
        note:`Job card for ${order.order_no}`,card:snapshot});
      setCard(c=>({...c,card_no:String(made.id)}));
      setJobs(current=>[made,...(current||[])]);
      setMsg(`Job order ${made.id} created for ${made.fabricator}: ${fmt(made.qty)} pairs.`);
      if(onIssued)await onIssued(made);
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  function print(){
    const node=document.querySelector(".job-card");
    if(!node)return;
    const w=window.open("","_blank","width=900,height=1000");
    if(!w){setErr("Popup blocked — allow popups to print the job card.");return;}
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Job card</title><style>*{box-sizing:border-box}body{margin:0;padding:12mm;font-family:Arial,Helvetica,sans-serif;color:#000}table{width:100%;border-collapse:collapse}[data-noprint]{display:none!important}.job-card-page{page-break-after:always}.job-card-page:last-child{page-break-after:auto}@page{size:A4 portrait;margin:10mm}</style></head><body>${node.outerHTML}<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`);
    w.document.close();
  }

  if(fabricators===null||jobs===null)return <div className="p-5 text-sm text-slate-500">Loading current Order Book balances…</div>;

  return <div className={embedded?"p-4 md:p-5 pb-3":"p-4 md:p-5"}>
    {msg&&<div role="status" className="mb-3 text-xs rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">{msg}</div>}
    {err&&<div role="alert" className="mb-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">{err}</div>}

    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      {/* THE ORDER THE CLIENT'S NOTE DESCRIBES, and in their words:
            1. Select fabricator (Line or External) from the dropdown.
            2. Select article/style and enter quantity to issue.
            3. System generates an issue slip.
          The screen asked for the order first, which is the app's own way round
          rather than the factory's — you decide who is free before you decide
          what to give them. */}
      <div className="serif text-base font-semibold mb-2">1 · Select fabricator</div>
      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-xs text-slate-600">Internal or external
          <select value={fabricator} aria-label="Send to" onChange={e=>{setFabricator(e.target.value);touched();}} className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm min-w-56">
            <option value="">— choose —</option>
            {fabricators.filter(f=>f.active).map(f=><option key={f.name} value={f.name}>{optionLabel(f)}</option>)}
          </select>
        </label>
        {/* A new line or job worker turns up mid-shift, and the job order that
            prompted it is already half entered. Sending the user to Setup to
            add one would discard it, so it is added from here. */}
        <button type="button" onClick={()=>setAdding(adding?null:{name:"",type:"external",rate:"",contact_person:"",contact_phone:"",tat_days:""})}
          className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white">
          {adding?"Cancel":"+ Add a fabricator"}</button>
        <label className="text-xs text-slate-600">Date
          <input type="date" value={date} aria-label="Job card date" onChange={e=>{setDate(e.target.value);touched();}} className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm"/>
        </label>
      </div>
      {adding&&<NewFabricator draft={adding} setDraft={setAdding}
        existing={fabricators}
        onSaved={async created=>{
          await reload();
          setFabricator(created.name); setAdding(null);
          setMsg(`${created.name} added. It is selected for this job order.`);
        }} onError={setErr} />}
      {who&&<div className="text-[11px] text-slate-600 mt-2">This raises a <b>{slipFor(who)}</b>. {who.payable?(who.rate>0?<>Payable at ₹{who.rate} per piece.</>:<>External rate/contact are still marked incomplete in Setup.</>):<>Internal work — nothing payable.</>}</div>}
    </div>

    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      <div className="serif text-base font-semibold mb-2">2 · Select article and quantity to issue</div>
      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-xs text-slate-600">Article / style
          <select value={orderNo} aria-label="Current Order" onChange={e=>chooseOrder(e.target.value)} className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm min-w-60" disabled={!who}>
            <option value="">{who?"— choose from Order Book —":"choose a fabricator first"}</option>
            {/* The PARTY and the DATE are on the row because two live orders
                for the same article are otherwise indistinguishable — "REX
                GOLA PLUS · 5,014 left" twice over reads as the same shoe
                listed twice rather than as two real orders. The party alone
                is not enough: Khandelwal School has TWO open Bolt orders, so
                the date is what separates those. */}
            {openOrders.map(row=><option key={row.order.order_no} value={row.order.order_no}>
              {row.order.order_no} · {row.order.article_code}{row.order.party?` · ${row.order.party}`:""}{row.order.order_date?` · ${shortDate(row.order.order_date)}`:""} · {fmt(row.remaining)} left
            </option>)}
          </select>
        </label>
      </div>
      {order&&<div className="mt-2 text-xs text-slate-600">Article <b>{order.article_code}</b> · Party <b>{order.party||"—"}</b> · <b>{fmt(balance.remaining)}</b> pairs still available for job orders.</div>}
    </div>

    {order&&<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      <div className="serif text-base font-semibold mb-1">3 · Enter the quantity size by size</div>
      <p className="text-xs text-slate-500 mb-3">Enter this job order size by size. Its printable document uses the supplied ARMOUR Job Card format.</p>
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-slate-500"><tr><th className="text-left py-1">Range</th><th className="text-right">Available</th><th className="text-left pl-4">This job card — pairs by size</th><th className="text-right">Total</th></tr></thead>
        <tbody>{balance.lines.map(line=>{
          const names=comboSizesForArticle(order.article_code,line.combo)||[];
          const hasExact=!!line.remaining_sizes&&names.length>0;
          return <tr key={line.combo} className="border-t border-slate-100"><td className="py-2 mono font-semibold">{line.combo}</td><td className="text-right mono text-slate-500">{fmt(line.remaining)}</td>
            <td className="pl-4 py-1">{hasExact?<div className="flex gap-2 flex-wrap">{names.map(size=><label key={size} className="text-[10px] text-slate-500">{size}<input type="number" min="0" max={line.remaining_sizes[size]||0} value={sizes[line.combo]?.[size]??0} aria-label={`${line.combo} size ${size} pairs`} onChange={e=>setSize(line.combo,size,e.target.value)} className="block w-16 border border-slate-300 rounded px-1 py-0.5 mono text-right text-xs"/></label>)}</div>
              :<input type="number" min="0" max={line.remaining} value={qty[line.combo]??0} aria-label={`Pairs of ${line.combo} on this card`} onChange={e=>setRange(line.combo,e.target.value)} className="w-24 border border-slate-300 rounded px-1.5 py-0.5 mono text-right"/>}</td>
            <td className="text-right mono font-semibold">{fmt(qty[line.combo]||0)}</td></tr>;
        })}</tbody><tfoot><tr className="border-t border-slate-200"><td className="py-2 font-semibold">TOTAL (PAIR)</td><td></td><td></td><td className="text-right mono font-semibold">{fmt(totalPairs)}</td></tr></tfoot>
      </table></div>
      {!!over.length&&<div className="mt-2 text-xs font-semibold text-rose-700">More than the unassigned balance was entered for {over.map(line=>line.combo).join(", ")}.</div>}
      {!article&&<div className="mt-2 text-[11px] rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1.5"><b>{order.article_code} has no BOM loaded</b>, so material rows will be blank until its BOM is loaded.</div>}
      <div className="flex gap-2 items-center mt-3"><button onClick={generate} disabled={!ready} className="text-xs font-semibold text-white rounded-lg px-4 py-1.5 bg-indigo-600 disabled:opacity-50">{card?(stale?"Update the preview":"Preview again"):"Preview Job Order"}</button>{stale&&<span className="text-[11px] text-amber-800 font-semibold">Inputs changed — update the preview before creating.</span>}{!who&&<span className="text-[11px] text-slate-500">Choose Rex Internal or New Durga Line.</span>}</div>
    </div>}

    {card&&<div className="rounded-2xl border border-slate-300 bg-white p-3 shadow-sm"><div data-noprint className="flex items-center gap-2 flex-wrap mb-2"><div className="text-sm font-semibold text-slate-800">4 · Issue slip</div><span className="text-[11px] text-slate-500">The note's step 3: the system generates the issue slip. Receiving and payment are steps 4 and 5, in Job Orders Database.</span><button onClick={issue} disabled={busy||stale||!!card.card_no} className="ml-auto text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-slate-800 disabled:opacity-40">{card.card_no?`Created as ${card.card_no}`:busy?"Creating…":"Confirm & Create Job Order"}</button><button onClick={print} disabled={stale} className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white disabled:opacity-40">Print / Save PDF</button></div><JobCard card={card} article={article}/></div>}
  </div>;
}

/* Adding a fabricator without leaving the job order.
   The SAME `RULES` object drives which fields appear and `validateFabricator`
   decides whether they are acceptable, so a field can never be demanded by the
   server and hidden by this form. */
function NewFabricator({ draft, setDraft, existing=[], onSaved, onError }){
  const [saving,setSaving]=useState(false);
  const rules=RULES[draft.type]||{};
  const set=(k,v)=>setDraft(d=>({...d,[k]:v}));
  const clash=existing.some(f=>f.name.trim().toLowerCase()===draft.name.trim().toLowerCase());
  /* The field names are the SCHEMA's — contact_person and contact_phone, not a
     single "contact". validateFabricator reads those two, so a form with one
     combined box left "a contact is required" permanently unsatisfied and the
     Save button permanently disabled: an external fabricator could never be
     added at all. */
  const check=validateFabricator({...draft,rate:draft.rate===""?null:Number(draft.rate),
    tat_days:draft.tat_days===""?null:Number(draft.tat_days)});
  const problems=clash?["That name is already on the fabricator list"]:check.problems;

  async function save(){
    setSaving(true);
    try{
      const created=await api.saveFabricator({name:draft.name.trim(),type:draft.type,
        rate:draft.rate===""?null:Number(draft.rate),
        contact_person:draft.contact_person.trim()||null,
        contact_phone:draft.contact_phone.trim()||null,
        tat_days:draft.tat_days===""?null:Number(draft.tat_days)});
      await onSaved(created&&created.name?created:{...draft,name:draft.name.trim()});
    }catch(e){ onError(e.message||String(e)); }
    finally{ setSaving(false); }
  }

  return <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
    <div className="text-xs font-semibold text-slate-800 mb-2">New fabricator</div>
    <div className="flex gap-3 flex-wrap items-end">
      <label className="text-xs text-slate-600">Name
        <input value={draft.name} aria-label="Fabricator name" onChange={e=>set("name",e.target.value)}
          placeholder="e.g. New Durga Line"
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm min-w-56"/></label>
      <label className="text-xs text-slate-600">Type
        <select value={draft.type} aria-label="Fabricator type" onChange={e=>set("type",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
          {TYPES.map(t=><option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
      {rules.rate!=="none"&&<label className="text-xs text-slate-600">
        {rules.rate==="flat"?"Flat sample charge (₹)":"Rate per piece (₹)"}
        <input type="number" min="0" step="0.01" value={draft.rate} aria-label="Rate"
          onChange={e=>set("rate",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-40"/></label>}
      <label className="text-xs text-slate-600">Contact person{rules.contact==="required"?"":" (optional)"}
        <input value={draft.contact_person} aria-label="Contact person"
          onChange={e=>set("contact_person",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-44"/></label>
      <label className="text-xs text-slate-600">Phone{rules.contact==="required"?"":" (optional)"}
        <input value={draft.contact_phone} aria-label="Contact phone" inputMode="tel"
          onChange={e=>set("contact_phone",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-40"/></label>
      <label className="text-xs text-slate-600">Turnaround (days)
        <input type="number" min="0" value={draft.tat_days} aria-label="Turnaround days"
          onChange={e=>set("tat_days",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-32"/></label>
    </div>
    <div className="text-[11px] text-slate-500 mt-2">{TYPE_HELP[draft.type]}</div>
    {!!problems.length&&draft.name&&<ul className="text-[11px] text-rose-700 mt-2 list-disc pl-4">
      {problems.map(p=><li key={p}>{p}</li>)}</ul>}
    <button onClick={save} disabled={saving||!!problems.length||!draft.name.trim()}
      className="mt-2 text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-indigo-600 disabled:opacity-50">
      {saving?"Saving…":"Save fabricator"}</button>
  </div>;
}
