import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { REF as INPUTS } from "./lib/refdata.js";
import * as api from "./lib/client.js";
import { productionSummary, validateProductionLog } from "../shared/production-log.js";

const localToday = () => {
  const d=new Date(),pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};
const fmt = n => Number(n||0).toLocaleString("en-IN");
const duration = minutes => {
  const n=Number(minutes)||0,h=Math.floor(n/60),m=n%60;
  return h?`${h}h${m?` ${m}m`:""}`:`${m}m`;
};
const header = value => String(value||"").trim().toUpperCase()
  .replace(/[._-]+/g," ").replace(/\s+/g," ");

const HEADERS={
  "PRODUCTION DATE":"production_on",DATE:"production_on",
  SHIFT:"shift",
  "WORK CENTRE CODE":"work_center","WORK CENTER CODE":"work_center",
  "WORK CENTRE":"work_center","WORK CENTER":"work_center",MACHINE:"work_center",
  "ORDER NO":"order_no","ORDER NUMBER":"order_no","JOB NO":"order_no","JOB NUMBER":"order_no",
  "GOOD PAIRS":"good_pairs","PAIRS GOOD":"good_pairs","GOOD OUTPUT":"good_pairs",
  "REJECTED PAIRS":"rejected_pairs","PAIRS REJECTED":"rejected_pairs",REJECTS:"rejected_pairs",
  "DOWNTIME MINUTES":"downtime_minutes",DOWNTIME:"downtime_minutes",
  "DOWNTIME REASON":"downtime_reason","REASON FOR DOWNTIME":"downtime_reason",
  SUPERVISOR:"supervisor",REMARKS:"note",NOTES:"note",NOTE:"note",
};
const REQUIRED=["production_on","shift","work_center","order_no","good_pairs",
  "rejected_pairs","downtime_minutes","downtime_reason"];
const TEMPLATE_HEADERS=["Production Date","Shift","Work Centre Code","Order No","Good Pairs",
  "Rejected Pairs","Downtime Minutes","Downtime Reason","Supervisor","Remarks"];

function isoCell(value){
  if(value instanceof Date && !Number.isNaN(value.getTime()))
    return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
  if(typeof value==="number"){
    const p=XLSX.SSF.parse_date_code(value);
    if(p) return `${p.y}-${String(p.m).padStart(2,"0")}-${String(p.d).padStart(2,"0")}`;
  }
  const text=String(value||"").trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const indian=text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(indian) return `${indian[3]}-${indian[2].padStart(2,"0")}-${indian[1].padStart(2,"0")}`;
  return text;
}

async function fingerprint(buffer){
  const input=Uint8Array.from(new Uint8Array(buffer));
  if(globalThis.crypto?.subtle) try{
    const bytes=await globalThis.crypto.subtle.digest("SHA-256",input);
    return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,"0")).join("");
  }catch(_){ /* Older browsers/test DOMs fall through to the stable local hash. */ }
  let hash=2166136261;
  for(const n of input){ hash^=n; hash=Math.imul(hash,16777619); }
  return (hash>>>0).toString(16);
}

function fileBuffer(file){
  if(typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error||new Error("Could not read that spreadsheet."));
    reader.readAsArrayBuffer(file);
  });
}

function locateTable(workbook){
  for(const sheetName of workbook.SheetNames){
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,raw:true,defval:null});
    for(let i=0;i<Math.min(rows.length,25);i++){
      const mapped=(rows[i]||[]).map(cell=>HEADERS[header(cell)]).filter(Boolean);
      if(new Set(mapped).size>=5) return {sheetName,rows,headerIndex:i};
    }
  }
  return null;
}

export default function ProductionInputTab({ orders=[],logs=[],loading=false,loadError="",onChanged }){
  const [preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [confirmVoid,setConfirmVoid]=useState(null);
  const fileInput=useRef(null);
  const todaySummary=useMemo(()=>productionSummary(logs,localToday()),[logs]);
  const orderMap=useMemo(()=>Object.fromEntries(orders.map(order=>[String(order.order_no),order])),[orders]);
  const centreNameMap=useMemo(()=>Object.fromEntries(Object.entries(INPUTS.workcenters||{})
    .map(([code,wc])=>[header(wc.name),code])),[]);

  async function readFile(file){
    if(!file) return;
    setBusy(true);setErr("");setMsg("");setPreview(null);
    try{
      if(file.size>5*1024*1024) throw new Error("The spreadsheet is larger than 5 MB. Remove images and unused sheets, then try again.");
      const buffer=await fileBuffer(file);
      const workbook=XLSX.read(buffer,{type:"array",cellDates:true});
      const found=locateTable(workbook);
      if(!found) throw new Error("No daily-production table was found. Use the downloadable template so the column headings match.");
      const names=found.rows[found.headerIndex]||[];
      const columns={}; names.forEach((name,index)=>{ const key=HEADERS[header(name)]; if(key&&columns[key]==null) columns[key]=index; });
      const missing=REQUIRED.filter(key=>columns[key]==null);
      if(missing.length) throw new Error(`The spreadsheet is missing required columns: ${missing.map(key=>TEMPLATE_HEADERS[REQUIRED.indexOf(key)]).join(", ")}.`);
      const fileId=await fingerprint(buffer);
      const parsed=[];
      for(let i=found.headerIndex+1;i<found.rows.length;i++){
        const cells=found.rows[i]||[];
        if(!cells.some(value=>value!==null&&String(value).trim()!=="")) continue;
        const value=key=>columns[key]==null?"":cells[columns[key]];
        const rawCentre=String(value("work_center")||"").trim();
        const upper=rawCentre.toUpperCase();
        const workCenter=(INPUTS.workcenters||{})[upper]?upper:centreNameMap[header(rawCentre)]||upper;
        const orderNo=String(value("order_no")||"").trim();
        const order=orderMap[orderNo];
        const centre=(INPUTS.workcenters||{})[workCenter];
        const row={
          _row:i+1,import_key:`${fileId}:${found.sheetName}:${i+1}`,
          production_on:isoCell(value("production_on")),shift:String(value("shift")||"").trim(),
          work_center:workCenter,order_no:orderNo,
          article:order?(order.article_code||order.article||""):"",
          stage:centre?String(centre.stage||"").toUpperCase():"",
          good_pairs:value("good_pairs"),rejected_pairs:value("rejected_pairs"),
          downtime_minutes:value("downtime_minutes"),downtime_reason:String(value("downtime_reason")||"").trim(),
          supervisor:String(value("supervisor")||"").trim(),note:String(value("note")||"").trim(),
        };
        const errors=[];
        if(!order) errors.push(`Order ${orderNo||"(blank)"} is not a live Order Book number.`);
        if(!centre) errors.push(`Work centre ${rawCentre||"(blank)"} is not recognised.`);
        if(order&&centre){
          const checked=validateProductionLog(row,{today:localToday()});
          errors.push(...checked.problems);
          Object.assign(row,checked.value,{_row:i+1,import_key:row.import_key});
        }
        parsed.push({...row,_errors:errors});
      }
      if(!parsed.length) throw new Error("The spreadsheet has headings but no production rows.");
      setPreview({fileName:file.name,sheetName:found.sheetName,rows:parsed});
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  async function importRows(){
    if(!preview||preview.rows.some(row=>row._errors.length)) return;
    setBusy(true);setErr("");setMsg("");
    try{
      const entries=preview.rows.map(({_errors,...row})=>row);
      const result=await api.importProductionLogs(entries);
      if(onChanged) await onChanged();
      setMsg(`${result.imported} production row${result.imported===1?"":"s"} imported from ${preview.fileName}. The MIS dashboard is updated.`);
      setPreview(null);if(fileInput.current) fileInput.current.value="";
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  function downloadTemplate(){
    const workbook=XLSX.utils.book_new();
    const entry=XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
    entry["!cols"]=[14,10,24,16,14,16,19,28,20,38].map(wch=>({wch}));
    entry["!autofilter"]={ref:"A1:J1"};
    XLSX.utils.book_append_sheet(workbook,entry,"Daily production");
    const instructions=XLSX.utils.aoa_to_sheet([
      ["FACTORY OS — DAILY PRODUCTION UPLOAD"],[],
      ["One row = one work centre + one shift + one Order No."],
      ["Use the work-centre codes and live Order Nos shown in the other tabs."],
      ["If output is zero, enter 0 in Good Pairs and record downtime minutes and the reason."],
      ["Dates may be entered as DD/MM/YYYY or YYYY-MM-DD."],
      ["Do not rename the columns. Re-uploading the same file is blocked to prevent double counting."],
    ]);
    instructions["!cols"]=[{wch:100}];
    XLSX.utils.book_append_sheet(workbook,instructions,"Instructions");
    const centres=XLSX.utils.aoa_to_sheet([["Work Centre Code","Work Centre","Stage"],
      ...Object.entries(INPUTS.workcenters||{}).map(([code,wc])=>[code,wc.name||code,wc.stage||""])]);
    centres["!cols"]=[{wch:26},{wch:34},{wch:20}];
    XLSX.utils.book_append_sheet(workbook,centres,"Work centres");
    const liveOrders=XLSX.utils.aoa_to_sheet([["Order No","Article","Customer"],
      ...orders.map(order=>[order.order_no,order.article_code||order.article||"",order.party||""])]);
    liveOrders["!cols"]=[{wch:18},{wch:30},{wch:32}];
    XLSX.utils.book_append_sheet(workbook,liveOrders,"Live orders");
    XLSX.writeFile(workbook,"factory-os-daily-production-template.xlsx");
  }

  async function voidEntry(id){
    setBusy(true);setErr("");setMsg("");
    try{ await api.voidProductionLog(id);setConfirmVoid(null);if(onChanged) await onChanged();
      setMsg("The incorrect row was removed from live totals and retained in the audit history."); }
    catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  const previewSummary=preview?productionSummary(preview.rows):null;
  const badRows=preview?preview.rows.filter(row=>row._errors.length):[];

  return <div className="space-y-4">
    {msg&&<div role="status" className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2">{msg}</div>}
    {(err||loadError)&&<div role="alert" className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">{err||loadError}</div>}

    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[["Good pairs today",fmt(todaySummary.good_pairs),"#047857"],
        ["Rejected today",fmt(todaySummary.rejected_pairs),todaySummary.rejected_pairs?"#BE123C":"#64748B"],
        ["Downtime today",duration(todaySummary.downtime_minutes),todaySummary.downtime_minutes?"#B45309":"#64748B"],
        ["Rows today",fmt(todaySummary.entries),"#0B6BCB"]].map(([label,value,color])=><div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="sign text-[10px] text-slate-500">{label}</div><div className="mono text-xl font-semibold mt-1" style={{color}}>{value}</div>
        </div>)}
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="serif text-lg font-semibold">Upload the daily production spreadsheet</div>
      <p className="text-xs text-slate-500 mt-1">The team fills one standard sheet. Factory OS checks every row before importing anything, then updates the MIS dashboard in one step.</p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4 text-xs">
        {[['1','Download the template'],['2','Fill one row per machine, shift and order'],['3','Upload the completed XLSX or CSV'],['4','Review and import all rows']].map(([n,label])=><div key={n} className="rounded-lg bg-slate-50 border border-slate-200 p-3"><b className="mono text-indigo-700">{n}</b><div className="mt-1 text-slate-700">{label}</div></div>)}
      </div>
      <div className="flex gap-3 flex-wrap items-center mt-4">
        <button onClick={downloadTemplate} className="rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-800 text-xs font-semibold px-4 py-2">Download daily template</button>
        <label className="rounded-lg bg-indigo-600 text-white text-xs font-semibold px-4 py-2 cursor-pointer">
          {busy&&!preview?"Reading spreadsheet…":"Choose spreadsheet"}
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv,.tsv" className="hidden" aria-label="Daily production spreadsheet" onChange={e=>readFile(e.target.files?.[0])}/>
        </label>
        <span className="text-[11px] text-slate-500">Article and stage are filled automatically from Order No and Work Centre Code.</span>
      </div>
    </section>

    {preview&&<section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm overflow-x-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><div className="serif text-lg font-semibold">Check before importing</div><div className="text-xs text-slate-500 mt-1">{preview.fileName} · {preview.sheetName} · {preview.rows.length} row{preview.rows.length===1?"":"s"}</div></div>
        <div className="flex gap-3 text-xs"><span>Good <b className="mono text-emerald-700">{fmt(previewSummary.good_pairs)}</b></span><span>Rejected <b className="mono text-rose-700">{fmt(previewSummary.rejected_pairs)}</b></span><span>Downtime <b className="mono text-amber-700">{duration(previewSummary.downtime_minutes)}</b></span></div>
      </div>
      {badRows.length>0&&<div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs px-3 py-2 mt-3"><b>{badRows.length} row{badRows.length===1?" has":"s have"} errors.</b> Nothing will be imported until the spreadsheet is corrected and uploaded again.</div>}
      <table className="w-full text-xs mt-3" style={{minWidth:980}}><thead><tr className="sign text-[9px] text-slate-500"><th className="text-left py-1">Excel row</th><th className="text-left">Date / shift</th><th className="text-left">Work centre</th><th className="text-left">Order / article</th><th className="text-right">Good</th><th className="text-right">Rejected</th><th className="text-right">Downtime</th><th className="text-left pl-3">Check</th></tr></thead>
        <tbody>{preview.rows.map(row=><tr key={row._row} className="border-t border-slate-100"><td className="mono py-2">{row._row}</td><td><div className="mono">{row.production_on}</div><div className="text-slate-400">Shift {row.shift}</div></td><td><div className="font-semibold">{row.work_center}</div><div className="text-slate-400">{row.stage||"—"}</div></td><td><div className="mono font-semibold">{row.order_no}</div><div className="text-slate-500">{row.article||"—"}</div></td><td className="mono text-right">{fmt(row.good_pairs)}</td><td className="mono text-right">{fmt(row.rejected_pairs)}</td><td className="mono text-right">{duration(row.downtime_minutes)}</td><td className="pl-3 max-w-xs">{row._errors.length?<span className="text-rose-700">{row._errors.join(" ")}</span>:<span className="text-emerald-700">Ready</span>}</td></tr>)}</tbody>
      </table>
      <div className="flex justify-end gap-3 mt-4"><button onClick={()=>{setPreview(null);if(fileInput.current)fileInput.current.value="";}} className="text-xs text-slate-600">Cancel</button><button onClick={importRows} disabled={busy||badRows.length>0} className="rounded-lg bg-indigo-600 text-white text-xs font-semibold px-5 py-2 disabled:opacity-40">{busy?"Importing…":`Import ${preview.rows.length} row${preview.rows.length===1?"":"s"}`}</button></div>
    </section>}

    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm overflow-x-auto">
      <div className="flex items-start justify-between gap-3 mb-3"><div><div className="serif text-lg font-semibold">Recent imported production</div><p className="text-xs text-slate-500 mt-1">Incorrect rows can be removed from live totals without erasing the audit trail.</p></div>{loading&&<span className="text-xs text-slate-400">Refreshing…</span>}</div>
      {!logs.length?<div className="text-sm text-slate-400 py-6 text-center">No daily production has been imported yet.</div>:<table className="w-full text-xs" style={{minWidth:940}}><thead><tr className="sign text-[9px] text-slate-500"><th className="text-left py-2">Date / shift</th><th className="text-left">Work centre</th><th className="text-left">Order / article</th><th className="text-left">Stage</th><th className="text-right">Good</th><th className="text-right">Rejected</th><th className="text-right">Downtime</th><th className="text-left pl-3">Reason / remarks</th><th></th></tr></thead><tbody>{logs.slice(0,100).map(row=><React.Fragment key={row.id}><tr className="border-t border-slate-100"><td className="py-2"><div className="mono">{String(row.production_on).slice(0,10)}</div><div className="text-slate-400">Shift {row.shift}</div></td><td><div className="font-semibold">{(INPUTS.workcenters||{})[row.work_center]?.name||row.work_center}</div><div className="mono text-slate-400">{row.work_center}</div></td><td><div className="mono font-semibold">{row.order_no}</div><div className="text-slate-500">{row.article}</div></td><td>{row.stage}</td><td className="mono text-right font-semibold text-emerald-700">{fmt(row.good_pairs)}</td><td className="mono text-right text-rose-700">{fmt(row.rejected_pairs)}</td><td className="mono text-right text-amber-700">{duration(row.downtime_minutes)}</td><td className="pl-3"><div>{row.downtime_reason||"—"}</div>{row.note&&<div className="text-slate-400">{row.note}</div>}</td><td className="text-right"><button onClick={()=>setConfirmVoid(row.id)} className="text-rose-500" aria-label={`Correct entry ${row.id}`}>Correct</button></td></tr>{confirmVoid===row.id&&<tr><td colSpan={9} className="pb-2"><div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 flex items-center gap-3"><span className="text-xs text-amber-900">Remove this row from live totals?</span><button onClick={()=>voidEntry(row.id)} disabled={busy} className="text-xs font-semibold rounded bg-rose-700 text-white px-3 py-1.5">Yes, remove</button><button onClick={()=>setConfirmVoid(null)} className="text-xs text-slate-600">Cancel</button></div></td></tr>}</React.Fragment>)}</tbody></table>}
    </section>
  </div>;
}
