import React, { useEffect, useMemo, useState } from "react";
import * as api from "./lib/client.js";
import { todayIso } from "./lib/today.js";
import { purchaseOrderProgress } from "../shared/purchase-orders.js";

const fmt=(n,d=2)=>Number(n||0).toLocaleString("en-IN",{maximumFractionDigits:d});
const nice=date=>date?new Date(`${String(date).slice(0,10)}T00:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}):"—";
const STATUS={open:["Open","#fff7ed","#9a3412"],partial:["Part received","#eff6ff","#1d4ed8"],received:["Received","#ecfdf5","#047857"],cancelled:["Cancelled","#f1f5f9","#64748b"]};

function Status({value}){
  const [label,bg,color]=STATUS[value]||STATUS.open;
  return <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{background:bg,color}}>{label}</span>;
}

export default function PurchaseOrders({materials=[],canCreate=true,canReceive=true,onStockChanged}){
  const [orders,setOrders]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [screen,setScreen]=useState("register"),[chosen,setChosen]=useState(null);
  const [supplier,setSupplier]=useState(""),[poDate,setPoDate]=useState(todayIso()),[expected,setExpected]=useState("");
  const [additional,setAdditional]=useState(""),[selected,setSelected]=useState({}),[busy,setBusy]=useState(false);
  const [receiving,setReceiving]=useState(null),[receiptDate,setReceiptDate]=useState(todayIso());
  const [receiptQty,setReceiptQty]=useState({}),[receiptNote,setReceiptNote]=useState("");

  const load=async()=>{setLoading(true);setError("");try{setOrders(await api.listPurchaseOrders());}
    catch(e){setError(`Could not load purchase orders: ${e.message||e}`);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const live=useMemo(()=>orders.map(purchaseOrderProgress),[orders]);
  const detail=chosen?live.find(o=>o.po_no===chosen)||null:null;

  function toggle(material,on){
    setSelected(current=>{const next={...current};if(on)next[material.material_key]={...material,
      ordered_qty:Number(material.shortfall)||0,rate:material.rate==null?"":material.rate};else delete next[material.material_key];return next;});
  }
  function lineField(key,field,value){setSelected(current=>({...current,[key]:{...current[key],[field]:value}}));}
  async function create(){
    const lines=Object.values(selected).map(m=>({material_key:m.material_key,name:m.name,uom:m.uom,
      ordered_qty:Number(m.ordered_qty),...(String(m.rate??"").trim()===""?{}:{rate:Number(m.rate)})}));
    setBusy(true);setError("");
    try{
      const made=await api.createPurchaseOrder({supplier,po_date:poDate,expected_on:expected||null,
        additional_information:additional,lines});
      await load();setChosen(made.po_no);setScreen("register");setSupplier("");setExpected("");setAdditional("");setSelected({});
    }catch(e){setError(`Could not create purchase order: ${e.message||e}`);}finally{setBusy(false);}
  }
  function startReceipt(order){
    const p=purchaseOrderProgress(order);setReceiving(p.po_no);setReceiptDate(todayIso());setReceiptNote("");
    setReceiptQty(Object.fromEntries(p.lines.filter(l=>l.balance_qty>0).map(l=>[l.material_key,""])));
  }
  async function receive(order){
    const lines=order.lines.map(l=>({material_key:l.material_key,quantity:Number(receiptQty[l.material_key])||0})).filter(l=>l.quantity>0);
    setBusy(true);setError("");
    try{
      await api.receivePurchaseOrder(order.po_no,receiptDate,lines,receiptNote);
      if(onStockChanged)await onStockChanged();
      await load();setReceiving(null);setReceiptQty({});setReceiptNote("");
    }catch(e){setError(`Could not record receipt: ${e.message||e}`);}finally{setBusy(false);}
  }
  async function cancel(order){
    if(!window.confirm(`Cancel ${order.po_no}? Received quantities stay in stock; only its outstanding balance is cancelled.`))return;
    setBusy(true);setError("");try{await api.cancelPurchaseOrder(order.po_no);await load();}
    catch(e){setError(`Could not cancel ${order.po_no}: ${e.message||e}`);}finally{setBusy(false);}
  }

  return <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4" data-noprint={!detail||undefined}>
    <div className="flex items-center gap-2 flex-wrap mb-3" data-noprint>
      <div className="text-sm font-semibold text-slate-800 mr-2">Purchase orders</div>
      <button onClick={()=>setScreen("register")} className={`text-xs font-semibold rounded-lg px-3 py-1.5 border ${screen==="register"?"bg-indigo-600 text-white border-indigo-600":"bg-white border-slate-300"}`}>PO register</button>
      {canCreate&&<button onClick={()=>setScreen("create")} className={`text-xs font-semibold rounded-lg px-3 py-1.5 border ${screen==="create"?"bg-indigo-600 text-white border-indigo-600":"bg-white border-slate-300"}`}>Create purchase order</button>}
      <span className="ml-auto text-xs text-slate-500">{live.filter(o=>["open","partial"].includes(o.status)).length} open</span>
    </div>
    {error&&<div role="alert" className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-3" data-noprint>{error}</div>}

    {screen==="create"&&canCreate&&<div data-noprint className="rounded-xl border border-indigo-200 bg-white p-4">
      <div className="grid gap-3 md:grid-cols-4 mb-3">
        <label className="text-xs text-slate-600 md:col-span-2">Supplier *
          <input aria-label="Supplier" value={supplier} onChange={e=>setSupplier(e.target.value)} className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5"/></label>
        <label className="text-xs text-slate-600">PO date *
          <input aria-label="PO date" type="date" value={poDate} onChange={e=>setPoDate(e.target.value)} className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 mono"/></label>
        <label className="text-xs text-slate-600">Expected delivery
          <input aria-label="Expected delivery" type="date" value={expected} onChange={e=>setExpected(e.target.value)} className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 mono"/></label>
      </div>
      <label className="text-xs text-slate-600 block mb-3">Additional information
        <textarea aria-label="Additional information" value={additional} onChange={e=>setAdditional(e.target.value)} rows={2}
          placeholder="Terms, delivery instructions, contact or any other PO note"
          className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5"/></label>
      <div className="text-xs font-semibold text-slate-700 mb-1">Choose from the current buying list</div>
      {!materials.length?<div className="text-xs text-slate-500 py-3">There is no current material shortfall to put on a PO.</div>:
      <div className="overflow-x-auto"><table className="w-full text-xs" style={{minWidth:700}}>
        <thead><tr className="text-slate-500"><th className="text-left py-1">Use</th><th className="text-left">Material</th><th className="text-right">Shortfall</th><th className="text-right">Order qty</th><th className="text-right">Rate</th><th className="text-left">UOM</th></tr></thead>
        <tbody>{materials.map(m=>{const picked=selected[m.material_key];return <tr key={m.material_key} className="border-t border-slate-100">
          <td className="py-1.5"><input aria-label={`Add ${m.name} to PO`} type="checkbox" checked={!!picked} onChange={e=>toggle(m,e.target.checked)}/></td>
          <td>{m.name}</td><td className="text-right mono">{fmt(m.shortfall)}</td>
          <td className="text-right">{picked?<input aria-label={`${m.name} ordered quantity`} type="number" min="0" step="any" value={picked.ordered_qty} onChange={e=>lineField(m.material_key,"ordered_qty",e.target.value)} className="w-24 text-right border border-slate-300 rounded px-1 py-0.5 mono"/>:"—"}</td>
          <td className="text-right">{picked?<input aria-label={`${m.name} rate`} type="number" min="0" step="any" value={picked.rate} onChange={e=>lineField(m.material_key,"rate",e.target.value)} className="w-24 text-right border border-slate-300 rounded px-1 py-0.5 mono"/>:"—"}</td>
          <td className="pl-2 mono text-slate-500">{m.uom}</td></tr>;})}</tbody>
      </table></div>}
      <button disabled={busy||!supplier.trim()||!Object.keys(selected).length} onClick={create}
        className="mt-3 text-xs font-semibold rounded-lg px-3 py-1.5 bg-indigo-600 text-white disabled:opacity-40">{busy?"Creating…":"Generate purchase order"}</button>
    </div>}

    {screen==="register"&&<div data-noprint>
      {loading?<div className="text-sm text-slate-500 py-4">Loading purchase orders…</div>:!live.length?<div className="text-sm text-slate-500 py-4">No purchase orders yet.</div>:
      <div className="overflow-x-auto"><table className="w-full text-sm" style={{minWidth:850}}>
        <thead><tr className="text-xs uppercase tracking-wide text-slate-500"><th className="text-left py-2">PO</th><th className="text-left">Supplier</th><th className="text-left">Expected</th><th className="text-left">Materials</th><th className="text-right">Value</th><th className="text-left">Status</th><th></th></tr></thead>
        <tbody>{live.map(order=><React.Fragment key={order.po_no}><tr className="border-t border-slate-200 bg-white">
          <td className="py-2 mono font-semibold">{order.po_no}</td><td>{order.supplier}</td><td className="text-xs mono">{nice(order.expected_on)}</td>
          <td className="text-xs">{order.lines.length} · {order.lines.filter(l=>l.balance_qty<=1e-6).length} complete</td>
          <td className="text-right mono">{order.lines.some(l=>l.rate!=null)?`₹${fmt(order.value)}`:"—"}</td>
          <td><Status value={order.status}/></td><td className="text-right whitespace-nowrap"><button onClick={()=>setChosen(chosen===order.po_no?null:order.po_no)} className="text-xs font-semibold text-indigo-700 mr-2">{chosen===order.po_no?"Close":"View / print"}</button>
            {canReceive&&["open","partial"].includes(order.status)&&<button onClick={()=>startReceipt(order)} className="text-xs font-semibold text-emerald-700 mr-2">Receive</button>}
            {canCreate&&["open","partial"].includes(order.status)&&<button onClick={()=>cancel(order)} className="text-xs text-slate-500">Cancel</button>}</td></tr>
          {receiving===order.po_no&&<tr><td colSpan={7} className="p-3 bg-emerald-50 border-t border-emerald-200">
            <div className="text-xs font-semibold text-emerald-900 mb-2">Receive against {order.po_no}</div>
            <div className="flex gap-3 flex-wrap mb-2"><label className="text-xs text-slate-600">Receipt date<input aria-label="Receipt date" type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)} className="block mt-1 border border-slate-300 rounded px-2 py-1"/></label>
              {order.lines.filter(l=>l.balance_qty>0).map(l=><label key={l.material_key} className="text-xs text-slate-600">{l.name} · max {fmt(l.balance_qty)} {l.uom}<input aria-label={`${l.name} received quantity`} type="number" min="0" max={l.balance_qty} step="any" value={receiptQty[l.material_key]||""} onChange={e=>setReceiptQty(q=>({...q,[l.material_key]:e.target.value}))} className="block mt-1 w-28 border border-slate-300 rounded px-2 py-1 text-right mono"/></label>)}</div>
            <label className="text-xs text-slate-600 block">Receipt note<input aria-label="Receipt note" value={receiptNote} onChange={e=>setReceiptNote(e.target.value)} className="block mt-1 w-full border border-slate-300 rounded px-2 py-1"/></label>
            <div className="mt-2 flex gap-2"><button disabled={busy} onClick={()=>receive(order)} className="text-xs font-semibold bg-emerald-700 text-white rounded px-3 py-1.5 disabled:opacity-40">{busy?"Saving…":"Save receipt & update stock"}</button><button onClick={()=>setReceiving(null)} className="text-xs border border-slate-300 bg-white rounded px-3 py-1.5">Cancel</button></div>
          </td></tr>}</React.Fragment>)}</tbody>
      </table></div>}
    </div>}

    {detail&&<div data-print-area className="mt-4 bg-white border border-slate-300 p-5 text-slate-900">
      <div className="flex items-start gap-3 mb-4"><div><div className="text-2xl font-bold tracking-wide">REX</div><div className="text-xs text-slate-500">PURCHASE ORDER</div></div><div className="ml-auto text-right"><div className="mono font-bold">{detail.po_no}</div><div className="text-xs">{nice(detail.po_date)}</div></div></div>
      <div className="grid grid-cols-2 gap-3 text-sm mb-4"><div><span className="text-slate-500">Supplier</span><div className="font-semibold">{detail.supplier}</div></div><div><span className="text-slate-500">Expected delivery</span><div>{nice(detail.expected_on)}</div></div></div>
      <table className="w-full text-sm border-collapse"><thead><tr>{["Material","Qty","UOM","Rate","Amount","Received","Balance"].map(h=><th key={h} className="border border-slate-300 px-2 py-1 text-left">{h}</th>)}</tr></thead>
        <tbody>{detail.lines.map(l=><tr key={l.material_key}><td className="border border-slate-300 px-2 py-1">{l.name}</td><td className="border border-slate-300 px-2 py-1 text-right mono">{fmt(l.ordered_qty)}</td><td className="border border-slate-300 px-2 py-1">{l.uom}</td><td className="border border-slate-300 px-2 py-1 text-right mono">{l.rate==null?"—":fmt(l.rate)}</td><td className="border border-slate-300 px-2 py-1 text-right mono">{l.rate==null?"—":fmt(Number(l.rate)*Number(l.ordered_qty))}</td><td className="border border-slate-300 px-2 py-1 text-right mono">{fmt(l.received_qty)}</td><td className="border border-slate-300 px-2 py-1 text-right mono">{fmt(l.balance_qty)}</td></tr>)}</tbody></table>
      <div className="mt-3 text-sm"><b>Additional information:</b> {detail.additional_information||"None"}</div>
      {!!detail.receipts.length&&<div className="mt-3 text-xs text-slate-600"><b>Receipt history:</b> {detail.receipts.map(r=>`${nice(r.received_on)}${r.note?` — ${r.note}`:""}`).join("; ")}</div>}
      <div className="mt-4 flex items-center"><Status value={detail.status}/><button onClick={()=>window.print()} className="ml-auto text-xs font-semibold border border-slate-300 rounded px-3 py-1.5">Print / save PDF</button></div>
    </div>}
  </div>;
}
