import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { REF as INPUTS } from "./lib/refdata.js";
import { fromDay, workCentresInOrder } from "../shared/engine.js";
import { plannedProductionRows, productionActualSummary, validateProductionActuals,
         withProductionActuals } from "../shared/production-actuals.js";
import * as api from "./lib/client.js";

const HEADERS=["Production Date","Work Centre Code","Work Centre","Stage","Job Card No","Order No",
  "Article","Size Range","Party","Planned Pairs","Achieved Pairs","Note","Plan Row ID"];
const isoDate=value=>{
  if(value instanceof Date) return value.toISOString().slice(0,10);
  if(typeof value==="number"){
    const d=XLSX.SSF.parse_date_code(value);
    return d?`${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`:"";
  }
  return String(value||"").slice(0,10);
};
const mondayOf=value=>{
  const date=new Date(`${value}T00:00:00`),day=(date.getDay()+6)%7;
  date.setDate(date.getDate()-day); return date.toISOString().slice(0,10);
};
const plusDays=(iso,n)=>{const d=new Date(`${iso}T00:00:00`);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
const fmt=n=>Number(n||0).toLocaleString("en-IN",{maximumFractionDigits:0});

function workbookFor(rows, weekStart){
  const wb=XLSX.utils.book_new();
  const end=plusDays(weekStart,5);
  const weekly=rows.filter(row=>row.production_on>=weekStart&&row.production_on<=end);
  const centres=workCentresInOrder(INPUTS.workcenters).filter(code=>weekly.some(row=>row.work_center===code));
  const matrix=[[`WEEKLY PRODUCTION PLAN · ${weekStart} to ${end}`]];
  const header=["DAY / DATE"];
  for(const code of centres) header.push((INPUTS.workcenters[code]||{}).name||code,"PLAN / ACTUAL");
  matrix.push(header);
  for(let offset=0;offset<6;offset++){
    const date=plusDays(weekStart,offset),label=new Date(`${date}T00:00:00`).toLocaleDateString("en-IN",{weekday:"short"}).toUpperCase();
    const groups=centres.map(code=>weekly.filter(row=>row.production_on===date&&row.work_center===code));
    const height=Math.max(1,...groups.map(group=>group.length));
    for(let i=0;i<height;i++){
      const line=[i===0?`${label}\n${date}`:""];
      for(const group of groups){
        const row=group[i];
        line.push(row?`JC NO: ${row.job_card_no||"—"}\nORDER: ${row.order_no}\nARTICLE: ${row.article}\nSIZE: ${row.size_ranges||"—"}\nPARTY: ${row.party||"—"}\nSTAGE: ${row.stage}`:"");
        line.push(row?`PLAN: ${row.planned_pairs}\nACTUAL: ${row.actual_pairs==null?"":row.actual_pairs}`:"");
      }
      matrix.push(line);
    }
  }
  const weeklySheet=XLSX.utils.aoa_to_sheet(matrix);
  weeklySheet["!cols"]=[{wch:15},...centres.flatMap(()=>[{wch:34},{wch:16}])];
  weeklySheet["!rows"]=matrix.map((_,i)=>({hpt:i<2?24:62}));
  weeklySheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:Math.max(0,header.length-1)}}];
  XLSX.utils.book_append_sheet(wb,weeklySheet,"Weekly Planning Output");

  const input=[HEADERS,...weekly.map(row=>[
    row.production_on,row.work_center,(INPUTS.workcenters[row.work_center]||{}).name||row.work_center,
    row.stage,row.job_card_no||"",row.order_no,row.article,row.size_ranges,row.party,row.planned_pairs,
    row.actual_pairs==null?"":row.actual_pairs,row.note||"",row.unit_key,
  ])];
  const inputSheet=XLSX.utils.aoa_to_sheet(input);
  inputSheet["!cols"]=[{wch:16},{wch:20},{wch:26},{wch:16},{wch:15},{wch:15},{wch:24},{wch:18},{wch:22},{wch:16},{wch:17},{wch:30},{wch:24}];
  inputSheet["!autofilter"]={ref:`A1:M${Math.max(1,input.length)}`};
  XLSX.utils.book_append_sheet(wb,inputSheet,"Daily Input");
  return wb;
}

export default function ProductionInputTab({state,actuals=[],onChanged}){
  const today=new Date().toISOString().slice(0,10);
  const [weekStart,setWeekStart]=useState(()=>mondayOf(today));
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  const fileRef=useRef(null);
  const planned=useMemo(()=>plannedProductionRows(state,INPUTS.origin,fromDay),[state]);
  const rows=useMemo(()=>withProductionActuals(planned,actuals),[planned,actuals]);
  const summary=useMemo(()=>productionActualSummary(planned,actuals,today),[planned,actuals,today]);
  const weekEnd=plusDays(weekStart,5);
  const visible=rows.filter(row=>row.production_on>=weekStart&&row.production_on<=weekEnd);

  function download(){
    XLSX.writeFile(workbookFor(rows,weekStart),`production-plan-${weekStart}.xlsx`);
    setMessage("Weekly plan downloaded. Fill only Achieved Pairs and Note on the Daily Input sheet, then upload the same file.");
  }

  async function upload(file){
    setError("");setMessage("");setBusy(true);
    try{
      const wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:false});
      const ws=wb.Sheets["Daily Input"];
      if(!ws) throw new Error('The workbook needs a sheet named "Daily Input". Download a fresh template here first.');
      const data=XLSX.utils.sheet_to_json(ws,{defval:"",raw:true});
      const entered=data.filter(row=>String(row["Achieved Pairs"]).trim()!=="").map(row=>({
        production_on:isoDate(row["Production Date"]),work_center:row["Work Centre Code"],
        stage:row.Stage,job_card_no:row["Job Card No"],order_no:row["Order No"],unit_key:row["Plan Row ID"],article:row.Article,
        size_ranges:row["Size Range"],party:row.Party,planned_pairs:Number(row["Planned Pairs"]),
        actual_pairs:Number(row["Achieved Pairs"]),note:row.Note,
      }));
      if(!entered.length) throw new Error("No Achieved Pairs were filled in.");
      const checked=validateProductionActuals(entered,planned);
      if(!checked.ok) throw new Error(checked.problems.slice(0,8).join("; "));
      const result=await api.saveProductionActuals(checked.rows);
      await onChanged();
      setMessage(`${result.saved} plan-versus-achievement row${result.saved===1?"":"s"} saved. Production Plan and Executive MIS now use them.`);
    }catch(e){setError(e.message||String(e));}
    finally{setBusy(false);if(fileRef.current)fileRef.current.value="";}
  }

  return <div className="space-y-4">
    <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-64">
          <div className="text-sm font-semibold text-slate-800">Daily plan vs achievement</div>
          <p className="text-xs text-slate-500 mt-1">The plan is filled from Factory OS. Your team enters only <b>Achieved Pairs</b> and, if needed, a note.</p>
        </div>
        <label className="text-xs text-slate-600">Week starting
          <input type="date" value={weekStart} onChange={e=>setWeekStart(mondayOf(e.target.value))}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white mono"/></label>
        <button onClick={download} className="text-xs font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white self-end">Download weekly Excel</button>
        <label className={`text-xs font-semibold px-3 py-2 rounded-lg border border-slate-300 bg-white self-end ${busy?"opacity-50":"cursor-pointer"}`}>
          {busy?"Uploading…":"Upload completed Excel"}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" disabled={busy} className="hidden" onChange={e=>e.target.files[0]&&upload(e.target.files[0])}/>
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <Metric label="Today's plan" value={`${fmt(summary.planned_pairs)} pairs`} />
        <Metric label="Today's achievement" value={`${fmt(summary.actual_pairs)} pairs`} />
        <Metric label="Rows reported" value={`${summary.recorded_rows} of ${summary.planned_rows}`} />
      </div>
      {error&&<div role="alert" className="mt-3 text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">{error}</div>}
      {message&&<div className="mt-3 text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2">{message}</div>}
    </section>

    <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm overflow-x-auto">
      <div className="text-sm font-semibold text-slate-800">Week preview · {weekStart} to {weekEnd}</div>
      <p className="text-xs text-slate-500 mt-1 mb-3">This is the same plan that is placed into the Excel workbook.</p>
      <table className="w-full text-xs" style={{minWidth:950}}><thead><tr className="sign text-slate-500">
        {['Date','Work centre','Stage','Job card / Order','Article','Size range','Party','Plan','Achievement'].map(h=><th key={h} className={`py-2 px-2 ${['Plan','Achievement'].includes(h)?'text-right':'text-left'}`}>{h}</th>)}
      </tr></thead><tbody>{visible.map(row=><tr key={`${row.production_on}-${row.work_center}-${row.stage}-${row.order_no}`} className="border-t border-slate-100">
        <td className="py-2 px-2 mono">{row.production_on}</td><td className="px-2">{(INPUTS.workcenters[row.work_center]||{}).name||row.work_center}</td>
        <td className="px-2">{row.stage}</td><td className="px-2"><div className="mono font-semibold">{row.job_card_no||'Whole order'}</div><div className="mono text-slate-400">{row.order_no}</div></td><td className="px-2">{row.article}</td>
        <td className="px-2">{row.size_ranges||'—'}</td><td className="px-2">{row.party||'—'}</td><td className="px-2 mono text-right">{fmt(row.planned_pairs)}</td>
        <td className={`px-2 mono text-right font-semibold ${row.actual_pairs==null?'text-slate-300':'text-emerald-700'}`}>{row.actual_pairs==null?'Not entered':fmt(row.actual_pairs)}</td>
      </tr>)}</tbody></table>
      {!visible.length&&<div className="text-sm text-slate-500 text-center py-8">Nothing is scheduled in this Monday–Saturday week.</div>}
    </section>
  </div>;
}

function Metric({label,value}){return <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-3"><div className="sign text-slate-500" style={{fontSize:10}}>{label}</div><div className="mono text-lg font-semibold text-slate-800 mt-1">{value}</div></div>;}
