import React, { useState } from "react";
import * as XLSX from "xlsx";
import { parseOrderSheet, ORDER_TEMPLATE_HEADERS } from "../shared/order-import.js";
import { REF as INPUTS } from "./lib/refdata.js";
import * as api from "./lib/client.js";

const fmt = n => (n==null||isNaN(n)) ? "0" : Number(n).toLocaleString("en-IN");

/* Bulk order entry from a spreadsheet. Nothing is written until the whole file
   parses — a half-imported batch is worse than a rejected one. */
export default function BulkOrderTab({ onImported }){
  const [result,setResult]=useState(null);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const [err,setErr]=useState("");

  function downloadTemplate(){
    const ws = XLSX.utils.aoa_to_sheet([
      ORDER_TEMPLATE_HEADERS,
      ["Acme Traders","2026-08-10","JILL","11X1","5","","1","MTS","example row — delete me"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    XLSX.writeFile(wb, "factory-os-order-template.xlsx");
  }

  async function pick(file){
    setErr(""); setMsg(""); setResult(null);
    if(!file) return;
    try{
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:"array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:null });
      setResult(parseOrderSheet(rows, INPUTS, INPUTS.packing || {}));
    }catch(e){ setErr("Could not read that file: "+(e.message||e)); }
  }

  async function commit(){
    if(!result || !result.orders.length) return;
    setBusy(true); setErr("");
    try{
      const created = await api.createOrders(result.orders);
      setMsg(`${(created||[]).length} orders created: ${(created||[]).map(o=>o.order_no).join(", ")}`);
      setResult(null);
      onImported && onImported();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  const totalPairs = result ? result.orders.reduce((a,o)=>a+o.lines.reduce((b,l)=>b+l.qty,0),0) : 0;

  return <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
    <div className="text-sm font-semibold text-slate-700 mb-1">Add orders from a spreadsheet</div>
    <p className="text-xs text-slate-500 mb-3">
      One row per size range. Rows sharing the same party, date and article become a single order
      with several lines. Give either <b>Pairs</b> or <b>Cartons</b> — cartons are converted using
      the packing chart, and pairs wins if both are filled in.
    </p>

    <div className="flex gap-3 items-center flex-wrap mb-4">
      <button onClick={downloadTemplate}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">
        Download blank template
      </button>
      <label className="text-xs text-slate-600">
        <input type="file" accept=".xlsx,.xls,.csv"
          onChange={e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=""; pick(f); }}
          className="text-sm" />
      </label>
    </div>

    {err && <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-3">{err}</div>}
    {msg && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-3">{msg}</div>}

    {result && (
      <div className="border border-indigo-200 bg-indigo-50/50 rounded-xl p-4">
        <div className="text-sm font-semibold text-indigo-900 mb-2">
          {result.orders.length} orders · {fmt(totalPairs)} pairs · {result.rowCount} rows read
        </div>

        {!!result.errors.length && (
          <div className="mb-3">
            <div className="text-xs font-semibold text-rose-800 mb-1">
              {result.errors.length} row{result.errors.length>1?"s":""} rejected — fix the sheet and re-upload:
            </div>
            <div className="max-h-40 overflow-y-auto text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
              {result.errors.map((e,i)=><div key={i}>Row {e.row}: {e.error}</div>)}
            </div>
          </div>
        )}

        {!!result.orders.length && (
          <div className="max-h-56 overflow-y-auto mb-3">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-500">
                <th className="text-left py-1">Party</th><th className="text-left">Date</th>
                <th className="text-left">Article</th><th className="text-left">Lines</th>
                <th className="text-right">Pairs</th></tr></thead>
              <tbody>
                {result.orders.map((o,i)=>(
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1">{o.party}</td>
                    <td className="mono">{o.order_date}</td>
                    <td>{o.article_code}</td>
                    <td className="mono">{o.lines.map(l=>`${l.combo}:${fmt(l.qty)}`).join("  ")}</td>
                    <td className="text-right mono">{fmt(o.lines.reduce((a,l)=>a+l.qty,0))}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        )}

        {result.errors.length
          ? <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
              Nothing is imported while any row is rejected — a partly-imported batch is harder to
              unpick than a corrected sheet. Fix the rows above and upload again.
            </div>
          : <button disabled={busy||!result.orders.length} onClick={commit}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
              {busy?"Importing…":`Import ${result.orders.length} orders`}</button>}
      </div>
    )}
  </div>;
}
