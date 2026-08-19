import React, { useState, useEffect } from "react";
import * as api from "./lib/client.js";

const BLANK = { name:"", city:"", discount_pct:40, gst_pct:5, payment_split_pct:50,
  dispatch_timeline:"45 days", order_nature:"",
  deductions:[{label:"F.O.R.",pct:2},{label:"Cash Discount",pct:3},{label:"GST Dis",pct:4.760}] };

/* Party master. These terms are the agreement with the customer, so they are
   set here and shown read-only on the invoice — a PI must not be able to
   quietly deviate from them. */
export default function PartiesTab(){
  const [parties,setParties]=useState([]);
  const [edit,setEdit]=useState(null);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");

  const load=()=>api.listParties().then(setParties).catch(e=>setErr(e.message||String(e)));
  useEffect(()=>{ load(); },[]);

  async function save(){
    if(!edit.name.trim()){ setErr("Party name is required."); return; }
    setBusy(true); setErr("");
    try{ await api.saveParty(edit); await load(); setEdit(null); setMsg("Saved."); }
    catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }
  async function remove(name){
    if(!confirm(`Deactivate ${name}? Existing orders keep their terms.`)) return;
    try{ await api.removeParty(name); await load(); }catch(e){ setErr(String(e.message||e)); }
  }

  const setD=(i,k,v)=>setEdit(e=>({...e,deductions:e.deductions.map((d,j)=>j===i?{...d,[k]:v}:d)}));

  return <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
    <div className="flex items-center gap-3 mb-1">
      <div>
        <div className="text-sm font-semibold text-slate-700">Parties &amp; terms</div>
        <div className="text-xs text-slate-500">
          Discount, deductions and payment terms per customer. Invoices read these — they cannot be
          changed on an individual PI.
        </div>
      </div>
      <button onClick={()=>{setEdit({...BLANK}); setMsg("");}}
        className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white">Add party</button>
    </div>

    {err && <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 my-2">{err}</div>}
    {msg && <div className="text-xs text-emerald-700 my-2">{msg}</div>}

    {edit && (
      <div className="border border-indigo-200 bg-indigo-50/60 rounded-xl p-4 my-3">
        <div className="grid gap-2 mb-3" style={{gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))"}}>
          {[["Party name","name","text"],["City","city","text"],["Discount %","discount_pct","number"],
            ["GST %","gst_pct","number"],["Payment split %","payment_split_pct","number"],
            ["Dispatch timeline","dispatch_timeline","text"]].map(([lab,k,type])=>(
            <label key={k} className="text-xs text-slate-600">{lab}
              <input type={type} value={edit[k]??""} onChange={e=>setEdit(s=>({...s,[k]:type==="number"?e.target.value:e.target.value}))}
                className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5" /></label>))}
          <label className="text-xs text-slate-600">Order nature
            <input list="order-nature-options" value={edit.order_nature||""}
              onChange={e=>setEdit(s=>({...s,order_nature:e.target.value}))}
              className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5" /></label>
        </div>
        <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1">
          Deductions — applied in this order, each on the running balance
        </div>
        <div className="flex gap-2 flex-wrap mb-3">
          {edit.deductions.map((d,i)=>(
            <div key={i} className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 flex gap-1 items-end">
              <label className="text-xs text-slate-500">label
                <input value={d.label} onChange={e=>setD(i,"label",e.target.value)}
                  className="block w-28 text-sm border border-slate-300 rounded px-1 py-0.5" /></label>
              <label className="text-xs text-slate-500">%
                <input type="number" step="0.001" value={d.pct} onChange={e=>setD(i,"pct",e.target.value)}
                  className="block w-20 text-sm border border-slate-300 rounded px-1 py-0.5 mono" /></label>
              <button onClick={()=>setEdit(s=>({...s,deductions:s.deductions.filter((_,j)=>j!==i)}))}
                className="text-rose-500 text-sm leading-none pb-1">×</button>
            </div>))}
          <button onClick={()=>setEdit(s=>({...s,deductions:[...s.deductions,{label:"",pct:0}]}))}
            className="text-xs font-semibold px-2 py-1 rounded-lg border border-slate-300 bg-white self-end">+ deduction</button>
        </div>
        <div className="flex gap-2">
          <button disabled={busy} onClick={save}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">
            {busy?"Saving…":"Save party"}</button>
          <button onClick={()=>setEdit(null)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Cancel</button>
        </div>
      </div>
    )}

    {!parties.length && !edit && <p className="text-xs text-slate-400 mt-3">
      No parties yet. Add one and its terms will be applied automatically whenever an order is raised for it.
    </p>}

    {!!parties.length && (
      <table className="w-full text-sm mt-3">
        <thead><tr className="text-xs uppercase tracking-wide text-slate-500">
          <th className="text-left py-2">Party</th><th className="text-left">City</th>
          <th className="text-right">Discount</th><th className="text-left pl-3">Deductions</th>
          <th className="text-right">GST</th><th className="text-left pl-3">Timeline</th><th></th></tr></thead>
        <tbody>
          {parties.map(p=>(
            <tr key={p.name} className="border-t border-slate-100">
              <td className="py-2 font-semibold">{p.name}</td>
              <td className="text-slate-600">{p.city||"—"}</td>
              <td className="text-right mono">{p.discount_pct}%</td>
              <td className="pl-3 text-xs text-slate-500 mono">
                {(p.deductions||[]).map(d=>`${d.label} ${d.pct}%`).join("  ·  ")||"—"}</td>
              <td className="text-right mono">{p.gst_pct}%</td>
              <td className="pl-3 text-slate-600">{p.dispatch_timeline}</td>
              <td className="text-right">
                <button onClick={()=>{setEdit({...BLANK,...p}); setMsg("");}}
                  className="text-xs font-semibold text-slate-600 hover:underline mr-2">Edit</button>
                <button onClick={()=>remove(p.name)} className="text-rose-500 text-sm leading-none">×</button></td>
            </tr>))}
        </tbody>
      </table>
    )}
  </div>;
}
