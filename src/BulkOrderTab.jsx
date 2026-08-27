import React, { useState } from "react";
import * as XLSX from "xlsx";
import { parseOrderWorkbook } from "../shared/order-import.js";
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
    const headers=["PI NO","ORDER DATE","CUSTOMER NAME","CITY","ARTICLE NAME","COLOUR","SOLE COLOUR","CLOSURE (LACE/VELCRO)","DISPATCH TIMELINE","SOLE","CURRENT STATUS 2.0","PRINT",
      "5s","6s","7s","8s","9s","10s","11s","12s","13s","1","2","3","4","5","6","7","8","9","10","11","12","TOTAL"];
    const example=["","2026-08-20","Example customer","Delhi","SPIKE","Black","Black","Velcro","45 days","EVA","PRODUCTION NOT STARTED","No",
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,null];
    const rows=[headers,example,Array(headers.length).fill("")];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const firstSize=headers.indexOf("5s"), lastSize=headers.indexOf("12"), total=headers.indexOf("TOTAL");
    ws[`${XLSX.utils.encode_col(total)}2`]={t:"n",f:`SUM(${XLSX.utils.encode_col(firstSize)}2:${XLSX.utils.encode_col(lastSize)}2)`};
    ws["!freeze"]={xSplit:5,ySplit:1};
    ws["!autofilter"]={ref:`A1:${XLSX.utils.encode_col(headers.length-1)}3`};
    ws["!cols"]=headers.map((h,i)=>({wch:i===2?24:i===4?22:i<11?16:8}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    const help=XLSX.utils.aoa_to_sheet([
      ["Factory OS order template"],
      ["Use one row per article. Enter PAIRS under each individual size, just like the supplied Order Book."],
      ["Required to import a row: ORDER DATE, CUSTOMER NAME, ARTICLE NAME, and at least one supported size quantity."],
      ["5s–13s are Small sizes. The later 1–12 columns are Large sizes. L means Large; write Lace or Velcro in full only in the separate Closure column."],
      ["Dispatch Timeline is per order (for example, 30 days or 45 days)."],
      ["The importer also reads the existing INSTITUTIONAL ORDER BOOK and MTO ORDER BOOK sheet layouts, including .xlsm files."],
    ]);
    help["!cols"]=[{wch:110}];
    XLSX.utils.book_append_sheet(wb, help, "Read me");
    XLSX.writeFile(wb, "factory-os-order-template.xlsx");
  }

  async function pick(file){
    setErr(""); setMsg(""); setResult(null);
    if(!file) return;
    try{
      if(Number(file.size)>10*1024*1024) throw new Error("Workbook is larger than 10 MB. Remove embedded images or unused sheets and try again.");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:"array" });
      if(wb.SheetNames.length>20) throw new Error("Workbook has more than 20 sheets.");
      let totalRows=0;
      const sheets=wb.SheetNames.map(sheetName=>{
        const ws=wb.Sheets[sheetName];
        const unresolved=Object.entries(ws).filter(([address,cell])=>address[0]!=="!"&&cell?.f&&(cell.v==null||cell.v===""));
        if(unresolved.length) throw new Error(`${sheetName}: ${unresolved.length} formula cell${unresolved.length===1?" has":"s have"} no saved result. Open the workbook in Excel, recalculate and save it, or paste those values before uploading.`);
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
        totalRows+=rows.length;if(totalRows>25000) throw new Error("Workbook has more than 25,000 rows.");
        return {sheetName,rows};
      });
      setResult(parseOrderWorkbook(sheets,INPUTS,INPUTS.packing||{}));
    }catch(e){ setErr("Could not read that file: "+(e.message||e)); }
  }

  async function commit(){
    if(!result || !result.orders.length) return;
    setBusy(true); setErr("");
    try{
      const created = await api.createOrders(result.orders);
      setMsg(`${(created||[]).length} orders created and sent to the schedule: ${(created||[]).map(o=>o.order_no).join(", ")}`);
      setResult(null);
      if(onImported) await onImported();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  const totalPairs = result ? result.orders.reduce((a,o)=>a+o.lines.reduce((b,l)=>b+l.qty,0),0) : 0;

  return <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
    <div className="text-sm font-semibold text-slate-700 mb-1">Add orders from a spreadsheet</div>
    <p className="text-xs text-slate-500 mb-3">
      One row per article, with all individual sizes across that row. This importer reads the supplied
      Institutional and MTO Order Book layouts, the new template, and the previous Factory OS templates.
    </p>

    <div className="flex gap-3 items-center flex-wrap mb-4">
      <button onClick={()=>{
          try{ downloadTemplate(); setMsg("Blank template downloaded as factory-os-order-template.xlsx."); }
          catch(e){ setErr(`Could not build the template: ${e.message||e}`); }
        }}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">
        Download blank template
      </button>
      <label className="text-xs text-slate-600">
        <input type="file" accept=".xlsx,.xlsm,.xls,.csv"
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

        {!!result.warnings?.length && (
          <div className="mb-3">
            <div className="text-xs font-semibold text-amber-800 mb-1">{result.warnings.length} warning{result.warnings.length>1?"s":""} (recognised rows can still be imported):</div>
            <div className="max-h-40 overflow-y-auto text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
              {result.warnings.map((e,i)=><div key={i}>Row {e.row}: {e.error}</div>)}
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
