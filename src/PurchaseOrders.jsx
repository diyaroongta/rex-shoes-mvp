import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import * as api from "./lib/client.js";
import { todayIso } from "./lib/today.js";
import { purchaseOrderProgress, purchaseOrderSummary, templateRows } from "../shared/purchase-orders.js";
import { REF as INPUTS } from "./lib/refdata.js";
import { parsePurchaseOrderRows, PURCHASE_ORDER_TEMPLATE_HEADERS } from "../shared/purchase-order-import.js";

const fmt=(n,d=2)=>Number(n||0).toLocaleString("en-IN",{maximumFractionDigits:d});
const nice=date=>date?new Date(`${String(date).slice(0,10)}T00:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}):"—";
const STATUS={open:["Open","#fff7ed","#9a3412"],partial:["Part received","#eff6ff","#1d4ed8"],received:["Received","#ecfdf5","#047857"],cancelled:["Cancelled","#f1f5f9","#64748b"]};
const fileBytes=file=>typeof file?.arrayBuffer==="function"?file.arrayBuffer():new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||new Error("Could not read file"));reader.readAsArrayBuffer(file);
});

function Status({value}){
  const [label,bg,color]=STATUS[value]||STATUS.open;
  return <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{background:bg,color}}>{label}</span>;
}

export default function PurchaseOrders({materials=[],allMaterials=materials,canCreate=true,canReceive=true,onStockChanged}){
  const [orders,setOrders]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [screen,setScreen]=useState(canCreate?"upload":"register"),[chosen,setChosen]=useState(null);
  const [busy,setBusy]=useState(false);
  /* Tracking filter on the register: everything, outstanding, received. */
  const [show,setShow]=useState("outstanding");
  const [receiving,setReceiving]=useState(null),[receiptDate,setReceiptDate]=useState(todayIso());
  const [receiptQty,setReceiptQty]=useState({}),[receiptNote,setReceiptNote]=useState("");
  const [uploadPreview,setUploadPreview]=useState(null),[uploadName,setUploadName]=useState("");
  const [uploadKey,setUploadKey]=useState(0),[uploadMessage,setUploadMessage]=useState("");

  const load=async()=>{setLoading(true);setError("");try{setOrders(await api.listPurchaseOrders());}
    catch(e){setError(`Could not load purchase orders: ${e.message||e}`);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const live=useMemo(()=>orders.map(purchaseOrderProgress),[orders]);
  const detail=chosen?live.find(o=>o.po_no===chosen)||null:null;

  function downloadTemplate(){
    /* Filled from the stock register: one PO group per supplier, the
       supplier's rate and dispatch location (shared/purchase-orders.js). */
    const rows=templateRows(materials, INPUTS.stock_meta||{}, todayIso());
    const sheet=XLSX.utils.aoa_to_sheet([PURCHASE_ORDER_TEMPLATE_HEADERS,...rows]);
    sheet["!cols"]=[{wch:14},{wch:25},{wch:13},{wch:20},{wch:38},{wch:30},{wch:34},{wch:12},{wch:18},{wch:14}];
    sheet["!autofilter"]={ref:`A1:J${Math.max(1,rows.length+1)}`};
    sheet["!freeze"]={xSplit:0,ySplit:1};
    const instructions=XLSX.utils.aoa_to_sheet([
      ["FACTORY OS — PURCHASE ORDER UPLOAD"],
      ["1. One row is one material. Do not rename the headings."],
      ["2. Rows with the same PO GROUP become one purchase order."],
      ["3. Use a new PO GROUP when the supplier or terms change (PO-2, PO-3, etc.)."],
      ["4. Supplier and PO date are required. Supplier, rate and dispatch location are pre-filled from the stock register where it has them."],
      ["5. Enter dates as YYYY-MM-DD. Keep MATERIAL KEY unchanged."],
      ["6. You may enter supplier/dates/additional information once per group; Factory OS applies them to that group."],
      ["7. Upload the completed workbook, review every warning, then create the POs together."],
    ]);
    instructions["!cols"]=[{wch:110}];
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,sheet,"Purchase Orders");
    XLSX.utils.book_append_sheet(workbook,instructions,"Read me");
    XLSX.writeFile(workbook,"factory-os-purchase-order-upload.xlsx");
  }
  async function inspectWorkbook(file){
    setError("");setUploadMessage("");setUploadPreview(null);setUploadName(file?.name||"");
    if(!file)return;
    if(file.size>10*1024*1024){setError("The PO workbook is larger than 10 MB. Split it into smaller uploads.");return;}
    try{
      /* Keep Excel dates as serial numbers. Converting them to JavaScript Date
         objects first can move a date back one day in Indian time zones. */
      const workbook=XLSX.read(await fileBytes(file),{type:"array",cellDates:false});
      const wanted=workbook.Sheets["Purchase Orders"]||workbook.Sheets[workbook.SheetNames[0]];
      if(!wanted)throw new Error("The workbook has no worksheets");
      const matrix=XLSX.utils.sheet_to_json(wanted,{header:1,raw:true,defval:"",blankrows:false});
      if(matrix.length>5002)throw new Error("The PO workbook has more than 5,000 lines. Split it into smaller uploads.");
      setUploadPreview(parsePurchaseOrderRows(matrix,allMaterials));
    }catch(e){setError(`Could not read the PO workbook: ${e.message||e}`);}
  }
  async function importWorkbook(){
    if(!uploadPreview||uploadPreview.errors.length||!uploadPreview.purchase_orders.length)return;
    setBusy(true);setError("");setUploadMessage("");
    try{
      const payload=uploadPreview.purchase_orders.map(({upload_group,...order})=>order);
      const made=await api.createPurchaseOrders(payload);
      const count=Array.isArray(made)?made.length:Number(made?.purchase_orders?.length)||payload.length;
      await load();setUploadMessage(`${count} purchase order${count===1?"":"s"} created from ${uploadName}.`);
      setUploadPreview(null);setUploadName("");setUploadKey(key=>key+1);setScreen("register");
    }catch(e){setError(`Could not import purchase orders: ${e.message||e}`);}finally{setBusy(false);}
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
      {canCreate&&<button onClick={()=>setScreen("upload")} className={`text-xs font-semibold rounded-lg px-3 py-1.5 border ${screen==="upload"?"bg-indigo-600 text-white border-indigo-600":"bg-white border-slate-300"}`}>Upload PO Excel</button>}
      <button onClick={()=>setScreen("register")} className={`text-xs font-semibold rounded-lg px-3 py-1.5 border ${screen==="register"?"bg-indigo-600 text-white border-indigo-600":"bg-white border-slate-300"}`}>PO register</button>
      <span className="ml-auto text-xs text-slate-500">{live.filter(o=>["open","partial"].includes(o.status)).length} open</span>
    </div>
    {error&&<div role="alert" className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-3" data-noprint>{error}</div>}
    {uploadMessage&&<div role="status" className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2 mb-3" data-noprint>{uploadMessage}</div>}

    {screen==="upload"&&canCreate&&<div data-noprint className="rounded-xl border border-indigo-200 bg-white p-4">
      <div className="text-sm font-semibold text-slate-800">Create purchase orders from Excel</div>
      <p className="text-xs text-slate-600 mt-1 mb-3">Download the buying list — supplier, supplier rate and dispatch location come straight from the stock register, one PO group per supplier. Check dates and quantities, then upload it here. Materials with no supplier on the register are left blank for you to fill.</p>
      <div className="flex gap-2 flex-wrap items-center">
        <button onClick={downloadTemplate} className="text-xs font-semibold rounded-lg px-3 py-2 border border-indigo-300 text-indigo-700 bg-indigo-50">Download prefilled PO template</button>
        <label className="text-xs font-semibold rounded-lg px-3 py-2 bg-indigo-600 text-white cursor-pointer">Upload completed Excel
          <input key={uploadKey} aria-label="Upload purchase order Excel" type="file" accept=".xlsx,.xls" className="sr-only" onChange={e=>inspectWorkbook(e.target.files?.[0])}/>
        </label>
        <span className="text-xs text-slate-500">{uploadName||`${materials.length} current shortfall line${materials.length===1?"":"s"} in the template`}</span>
      </div>
      {uploadPreview&&<div className="mt-4 rounded-lg border border-slate-200 p-3">
        <div className="text-xs font-semibold text-slate-800">Upload check</div>
        <div className="text-xs text-slate-600 mt-1">{uploadPreview.purchase_orders.length} PO group{uploadPreview.purchase_orders.length===1?"":"s"} · {uploadPreview.row_count} material line{uploadPreview.row_count===1?"":"s"}</div>
        {!!uploadPreview.errors.length&&<div role="alert" className="mt-2 rounded bg-rose-50 border border-rose-200 p-2 text-xs text-rose-800"><b>Fix these in Excel and upload again:</b><ul className="list-disc ml-5 mt-1">{uploadPreview.errors.map(message=><li key={message}>{message}</li>)}</ul></div>}
        {!uploadPreview.errors.length&&<div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-slate-500"><th className="text-left">Group</th><th className="text-left">Supplier</th><th className="text-left">PO date</th><th className="text-left">Expected</th><th className="text-right">Materials</th><th className="text-right">Quantity</th></tr></thead><tbody>{uploadPreview.purchase_orders.map(order=><tr key={order.upload_group} className="border-t border-slate-100"><td className="py-1.5 mono">{order.upload_group}</td><td>{order.supplier}</td><td className="mono">{order.po_date}</td><td className="mono">{order.expected_on||"—"}</td><td className="text-right">{order.lines.length}</td><td className="text-right mono">{fmt(order.lines.reduce((sum,line)=>sum+line.ordered_qty,0))}</td></tr>)}</tbody></table></div>}
        <button disabled={busy||!!uploadPreview.errors.length||!uploadPreview.purchase_orders.length} onClick={importWorkbook} className="mt-3 text-xs font-semibold rounded-lg px-3 py-2 bg-emerald-700 text-white disabled:opacity-40">{busy?"Creating POs…":`Create ${uploadPreview.purchase_orders.length} purchase order${uploadPreview.purchase_orders.length===1?"":"s"}`}</button>
      </div>}
    </div>}

    {screen==="register"&&<div data-noprint>
      {/* PO TRACKING — outstanding, received, and what is still to arrive. */}
      {!loading&&!!live.length&&(()=>{ const t=purchaseOrderSummary(orders,todayIso());
        const tile=(k,label,value,sub,tone)=><button key={k} onClick={()=>setShow(k)} aria-pressed={show===k}
          className="text-left rounded-xl border px-3 py-2" style={{borderColor:show===k?"#4f46e5":"#e2e8f0",background:"#fff"}}>
          <div className="text-[11px] text-slate-500">{label}</div>
          <div className="mono text-lg font-semibold" style={{color:tone||"#1e293b"}}>{value}</div>
          {sub&&<div className="text-[10px] text-slate-500">{sub}</div>}</button>;
        return <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {tile("outstanding","Outstanding POs",t.outstanding,`${t.open} open · ${t.partial} part received${t.overdue?` · ${t.overdue} overdue`:""}`,t.overdue?"#b91c1c":undefined)}
          {tile("pending","Pending to arrive",`₹${fmt(t.pending_value,0)}`,`${t.pending_lines} material line${t.pending_lines===1?"":"s"}`)}
          {tile("received","Received in full",t.received,null,"#047857")}
          {tile("all","All POs",t.total,t.cancelled?`${t.cancelled} cancelled`:null)}
        </div>; })()}
      {loading?<div className="text-sm text-slate-500 py-4">Loading purchase orders…</div>:!live.length?<div className="text-sm text-slate-500 py-4">No purchase orders yet.</div>:
      <div className="overflow-x-auto"><table className="w-full text-sm" style={{minWidth:850}}>
        <thead><tr className="text-xs uppercase tracking-wide text-slate-500"><th className="text-left py-2">PO</th><th className="text-left">Supplier</th><th className="text-left">Expected</th><th className="text-left">Materials</th><th className="text-right">Value</th><th className="text-left">Status</th><th></th></tr></thead>
        <tbody>{live.filter(o=>show==="all"?true:show==="received"?o.status==="received"
          :o.status==="open"||o.status==="partial").map(order=><React.Fragment key={order.po_no}><tr className="border-t border-slate-200 bg-white">
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
