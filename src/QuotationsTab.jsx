import React, { useEffect, useMemo, useState } from "react";
import * as api from "./lib/client.js";
import { REF as INPUTS } from "./lib/refdata.js";
import { comboSizesForArticle } from "../shared/bridge.js";
import { priceQuotation, validateQuotation, quotationAge, quotationSummary,
         STATUS_LABEL, canMoveTo } from "../shared/quotation.js";
import { inr } from "../shared/pi.js";
import PiDocument from "./PiDocument.jsx";

/* QUOTATIONS — what a customer is offered, before there is an order.
 *
 * Priced by the PI's own arithmetic (shared/quotation.js), so the figure
 * quoted is the figure invoiced. Saving one releases NOTHING: no order, no PI
 * number, no material demand, no machine time. It becomes work only when
 * somebody raises the PI and records the number against it.
 */

const today = () => new Date().toISOString().slice(0,10);
const fmt = n => n==null||isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");

export default function QuotationsTab({ readOnly=false }){
  const [list,setList]=useState(null);
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState("");
  const [open,setOpen]=useState(null);          // a saved quotation being looked at
  const [draft,setDraft]=useState(()=>blank());

  useEffect(()=>{ api.listQuotations().then(setList).catch(e=>setErr(e.message||String(e))); },[]);

  const articles=Object.keys(INPUTS.articles||{});
  const priced=useMemo(()=>priceQuotation(draft),[draft]);
  const check=useMemo(()=>validateQuotation(draft),[draft]);
  const summary=useMemo(()=>quotationSummary(list||[],today()),[list]);

  function blankItem(code){
    const combos=Object.keys(((INPUTS.articles||{})[code]||{}).combos||{});
    return { article_code:code, article_label:code, mrp:(INPUTS.mrp||{})[code]||{},
             sole_colour:((INPUTS.articles||{})[code]||{}).sole_colour||"",
             upper_colour:((INPUTS.articles||{})[code]||{}).upper_colour||"",
             lines: combos.length?[{ combo:combos[0], sizes:{} }]:[] };
  }
  function blank(){ return { quote_date:today(), party:"", city:"", valid_days:15,
                             discount_pct:"", items:[], note:"" }; }
  const set=(patch)=>setDraft(d=>({...d,...patch}));
  const setItem=(i,patch)=>setDraft(d=>({...d,items:d.items.map((it,x)=>x===i?{...it,...patch}:it)}));
  const setLine=(i,li,patch)=>setItem(i,{lines:draft.items[i].lines.map((l,x)=>x===li?{...l,...patch}:l)});

  async function save(){
    setBusy("save"); setErr(""); setMsg("");
    try{
      const made=await api.createQuotation({...draft,
        discount_pct: draft.discount_pct===""?null:Number(draft.discount_pct)});
      setList(current=>[made,...(current||[])]);
      setDraft(blank());
      setMsg(`${made.quote_no} saved for ${made.party}: ${fmt(made.pairs)} pairs, ${inr(made.total)}. `
        + `Nothing has been released into production — convert it when the customer orders.`);
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(""); }
  }

  async function move(quote,status){
    const pi = status==="converted"
      ? window.prompt(`Which PI number did ${quote.quote_no} become?`)
      : null;
    if(status==="converted" && !String(pi||"").trim()) return;
    setBusy(quote.quote_no); setErr(""); setMsg("");
    try{
      const updated=await api.setQuotationStatus(quote.quote_no,status,pi||undefined);
      setList(current=>(current||[]).map(x=>x.quote_no===updated.quote_no?updated:x));
      setMsg(`${updated.quote_no}: ${STATUS_LABEL[updated.status]}.`);
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(""); }
  }

  function print(){
    const node=document.querySelector(".quotation-doc");
    if(!node) return;
    const w=window.open("","_blank","width=900,height=1000");
    if(!w){ setErr("Popup blocked — allow popups to print the quotation."); return; }
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation</title>`
      +`<style>*{box-sizing:border-box}body{margin:0;padding:10mm;font-family:Arial,Helvetica,sans-serif;color:#000}`
      +`[data-noprint]{display:none!important}@page{size:A4 portrait;margin:8mm}</style></head><body>`
      +`${node.outerHTML}<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`);
    w.document.close();
  }

  if(list===null&&!err) return <div className="p-5 text-sm text-slate-500">Loading quotations…</div>;

  return <div className="p-4 md:p-5">
    {err&&<div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-3">{err}</div>}
    {msg&&<div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-3">{msg}</div>}

    <div className="flex gap-4 flex-wrap mb-4">
      {[["Open",summary.open],["Accepted",summary.accepted],["Converted",summary.converted],
        ["Not taken",summary.lost],["Past validity",summary.expired]].map(([label,value])=>
        <div key={label}><div className="text-[11px] text-slate-500">{label}</div>
          <div className="text-base font-semibold mono text-slate-800">{fmt(value)}</div></div>)}
      <div><div className="text-[11px] text-slate-500">Live quoted value</div>
        <div className="text-base font-semibold mono text-slate-800">{inr(summary.value)}</div></div>
    </div>

    {!readOnly&&<div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm mb-4">
      <div className="text-sm font-semibold text-slate-800 mb-1">New quotation</div>
      <p className="text-xs text-slate-500 mb-3">
        Priced exactly as the invoice will be — same rate, same deduction order. Saving it
        releases nothing into production.
      </p>
      <div className="grid gap-3 mb-3" style={{gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))"}}>
        <label className="text-xs text-slate-600">Customer
          <input value={draft.party} aria-label="Customer" onChange={e=>set({party:e.target.value})}
            className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5" /></label>
        <label className="text-xs text-slate-600">City
          <input value={draft.city} onChange={e=>set({city:e.target.value})}
            className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5" /></label>
        <label className="text-xs text-slate-600">Date
          <input type="date" value={draft.quote_date} onChange={e=>set({quote_date:e.target.value})}
            className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5" /></label>
        <label className="text-xs text-slate-600">Valid for (days)
          <input type="number" min={0} value={draft.valid_days} onChange={e=>set({valid_days:e.target.value})}
            className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 mono" /></label>
        <label className="text-xs text-slate-600">Discount %
          <input type="number" min={0} max={100} value={draft.discount_pct} placeholder="40 (standard)"
            aria-label="Discount %" onChange={e=>set({discount_pct:e.target.value})}
            className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 mono" /></label>
      </div>

      {draft.items.map((item,i)=><div key={i} className="rounded-xl border border-slate-200 p-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <select value={item.article_code} aria-label={`Article ${i+1}`}
            onChange={e=>setDraft(d=>({...d,items:d.items.map((it,x)=>x===i?blankItem(e.target.value):it)}))}
            className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            {articles.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
          <button type="button" onClick={()=>setDraft(d=>({...d,items:d.items.filter((_,x)=>x!==i)}))}
            className="text-xs text-rose-700 underline">remove</button>
        </div>
        {item.lines.map((line,li)=>{
          const sizes=comboSizesForArticle(item.article_code,line.combo)||[];
          const combos=Object.keys(((INPUTS.articles||{})[item.article_code]||{}).combos||{});
          return <div key={li} className="mb-2">
            <select value={line.combo} aria-label={`Size range ${li+1}`}
              onChange={e=>setLine(i,li,{combo:e.target.value,sizes:{}})}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white mb-1">
              {combos.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <div className="flex gap-2 flex-wrap">
              {sizes.map(size=><label key={size} className="text-[11px] text-slate-500">{size}
                <input type="number" min={0} value={line.sizes[size]??""} aria-label={`${line.combo} ${size}`}
                  onChange={e=>setLine(i,li,{sizes:{...line.sizes,[size]:e.target.value===""?"":Number(e.target.value)}})}
                  className="block w-16 text-xs border border-slate-200 rounded px-1.5 py-1 mono" /></label>)}
              {!sizes.length&&<span className="text-[11px] text-amber-700">This range has no sizes on file.</span>}
            </div>
          </div>;
        })}
        <button type="button" onClick={()=>setItem(i,{lines:[...item.lines,
            {combo:Object.keys(((INPUTS.articles||{})[item.article_code]||{}).combos||{})[0],sizes:{}}]})}
          className="text-xs text-indigo-700 font-semibold">+ another size range</button>
      </div>)}

      <button type="button" disabled={!articles.length}
        onClick={()=>setDraft(d=>({...d,items:[...d.items,blankItem(articles[0])]}))}
        className="text-xs font-semibold border border-slate-300 bg-white rounded-lg px-3 py-1.5 disabled:opacity-40">
        + Add an article</button>

      {!!draft.items.length&&<div className="mt-3 flex items-center gap-4 flex-wrap">
        <div className="text-xs text-slate-600">
          <b>{fmt(check.pairs)}</b> pairs · <b>{inr(priced.totals.total)}</b> after the deduction ladder
        </div>
        <button onClick={save} disabled={busy==="save"||!check.ok}
          className="text-xs font-semibold text-white bg-indigo-600 rounded-lg px-4 py-1.5 disabled:opacity-40">
          {busy==="save"?"Saving…":"Save quotation"}</button>
      </div>}
      {!!draft.items.length&&!check.ok&&<ul className="text-[11px] text-amber-800 mt-2 list-disc pl-4">
        {check.problems.map(p=><li key={p}>{p}</li>)}</ul>}
    </div>}

    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-slate-800 mb-2">Quotations</div>
      {!list||!list.length
        ? <div className="text-sm text-slate-500 py-6 text-center">No quotation has been raised yet.</div>
        : <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500">
              <th className="py-1">No.</th><th className="py-1">Date</th><th className="py-1">Customer</th>
              <th className="py-1 text-right">Pairs</th><th className="py-1 text-right">Value</th>
              <th className="py-1">Status</th><th className="py-1"></th></tr></thead>
            <tbody>{list.map(quote=>{
              const age=quotationAge(quote,today());
              return <tr key={quote.quote_no} className="border-t border-slate-100">
                <td className="py-1.5 mono font-semibold">{quote.quote_no}</td>
                <td className="py-1.5">{quote.quote_date}
                  {age.expired&&(quote.status==="draft"||quote.status==="sent")
                    &&<span className="text-rose-700 font-semibold"> · past validity</span>}</td>
                <td className="py-1.5">{quote.party}</td>
                <td className="py-1.5 mono text-right">{fmt(quote.pairs)}</td>
                <td className="py-1.5 mono text-right">{inr(quote.total)}</td>
                <td className="py-1.5">{STATUS_LABEL[quote.status]||quote.status}
                  {quote.converted_pi_no&&<span className="text-slate-500"> · {quote.converted_pi_no}</span>}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <button onClick={()=>setOpen(open&&open.quote_no===quote.quote_no?null:quote)}
                    className="text-indigo-700 underline mr-2">
                    {open&&open.quote_no===quote.quote_no?"hide":"view"}</button>
                  {!readOnly&&["sent","accepted","converted","lost"].filter(s=>canMoveTo(quote.status,s))
                    .map(s=><button key={s} disabled={busy===quote.quote_no} onClick={()=>move(quote,s)}
                      className="text-slate-600 underline mr-2 disabled:opacity-40">{STATUS_LABEL[s]}</button>)}
                </td></tr>;})}
            </tbody>
          </table>}
    </div>

    {open&&<div className="mt-4 rounded-2xl border border-slate-300 bg-white p-3 shadow-sm">
      <div data-noprint className="flex items-center gap-2 mb-2">
        <div className="text-sm font-semibold text-slate-800">{open.quote_no}</div>
        <button onClick={print} className="ml-auto text-xs font-semibold border border-slate-300 rounded-lg px-3 py-1.5">
          Print / Save PDF</button>
      </div>
      <div className="quotation-doc">
        <PiDocument heading="QUOTATION" piNo={open.quote_no}
          order={{ ...(open.snapshot||{}), order_no:open.quote_no, party:open.party, city:open.city,
                   order_date:open.quote_date, items:(open.snapshot||{}).items||[] }}
          article={{}} mrp={{}}
          terms={(open.snapshot||{}).discount_pct==null?undefined:{discount_pct:Number((open.snapshot||{}).discount_pct)}} />
      </div>
    </div>}
  </div>;
}
