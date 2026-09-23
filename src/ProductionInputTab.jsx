import React, { useMemo, useRef, useState } from "react";
import { planImpact } from "../shared/input-impact.js";
import { todayIso } from "./lib/today.js";
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
/* DATES ARE FORMATTED LOCALLY, NEVER THROUGH toISOString().
   `new Date("2026-09-21T00:00:00")` is LOCAL midnight, and in India that is
   18:30 the previous day in UTC — so toISOString().slice(0,10) handed back the
   day BEFORE. On the factory's own clock the week started on Sunday, ran
   Sunday to Thursday, and every row in the weekly Excel was filed a day early.
   It only looked right west of Greenwich, which is where it was written. */
const isoLocal=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
export const mondayOf=value=>{
  const date=new Date(`${value}T00:00:00`);
  if(isNaN(date)) return "";
  const day=(date.getDay()+6)%7;
  date.setDate(date.getDate()-day); return isoLocal(date);
};
export const plusDays=(iso,n)=>{const d=new Date(`${iso}T00:00:00`);if(isNaN(d))return "";d.setDate(d.getDate()+n);return isoLocal(d);};
const fmt=n=>Number(n||0).toLocaleString("en-IN",{maximumFractionDigits:0});

export function workbookFor(rows, weekStart){
  const wb=XLSX.utils.book_new();
  const end=plusDays(weekStart,5);
  const weekly=rows.filter(row=>row.production_on>=weekStart&&row.production_on<=end);
  const centres=workCentresInOrder(INPUTS.workcenters).filter(code=>weekly.some(row=>row.work_center===code));
  const matrix=[[`WEEKLY PRODUCTION PLAN · ${weekStart} to ${end}`]];
  const header=["DAY / DATE"];
  for(const code of centres) header.push((INPUTS.workcenters[code]||{}).name||code,"");
  matrix.push(header);
  matrix.push(["",...centres.flatMap(()=>["JOB DETAILS","PROPOSED / ACTUAL QTY"])]);
  const merges=[];
  for(let offset=0;offset<6;offset++){
    const date=plusDays(weekStart,offset),label=new Date(`${date}T00:00:00`).toLocaleDateString("en-IN",{weekday:"short"}).toUpperCase();
    const groups=centres.map(code=>weekly.filter(row=>row.production_on===date&&row.work_center===code));
    const height=Math.max(1,...groups.map(group=>group.length));
    const firstRow=matrix.length;
    for(let i=0;i<height;i++){
      const line=[i===0?`${label}\n${date}`:""];
      for(const group of groups){
        const row=group[i];
        line.push(row?`JC NO: ${row.job_card_no||"—"}\nARTICLE NAME: ${row.article}\nSIZE: ${row.size_ranges||"—"}\nORDER: ${row.order_no}\nPARTY NAME: ${row.party||"—"}\nSTAGE: ${row.stage}`:"");
        line.push(row?`PROPOSED: ${row.planned_pairs}\nACTUAL: ${row.actual_pairs==null?"":row.actual_pairs}`:"");
      }
      matrix.push(line);
    }
    if(height>1) merges.push({s:{r:firstRow,c:0},e:{r:firstRow+height-1,c:0}});
  }
  const totalRow=matrix.length;
  const totals=["WEEK TOTAL"];
  for(const code of centres){
    const centreRows=weekly.filter(row=>row.work_center===code);
    const planned=centreRows.reduce((n,row)=>n+(Number(row.planned_pairs)||0),0);
    const actual=centreRows.reduce((n,row)=>n+(Number(row.actual_pairs)||0),0);
    totals.push("",`PROPOSED: ${planned}\nACTUAL: ${actual}`);
  }
  matrix.push(totals);
  const weeklySheet=XLSX.utils.aoa_to_sheet(matrix);
  weeklySheet["!cols"]=[{wch:15},...centres.flatMap(()=>[{wch:34},{wch:16}])];
  weeklySheet["!rows"]=matrix.map((_,i)=>({hpt:i===0?28:i<3?24:i===totalRow?34:72}));
  weeklySheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:Math.max(0,header.length-1)}},...merges];
  for(let i=0;i<centres.length;i++) weeklySheet["!merges"].push({s:{r:1,c:1+i*2},e:{r:1,c:2+i*2}});
  weeklySheet["!freeze"]={xSplit:1,ySplit:3,topLeftCell:"B4",activePane:"bottomRight",state:"frozen"};
  weeklySheet["!autofilter"]={ref:`A3:${XLSX.utils.encode_col(Math.max(0,header.length-1))}${matrix.length}`};
  weeklySheet["!margins"]={left:0.25,right:0.25,top:0.5,bottom:0.5,header:0.2,footer:0.2};
  const border={top:{style:"thin",color:{rgb:"334155"}},bottom:{style:"thin",color:{rgb:"334155"}},left:{style:"thin",color:{rgb:"334155"}},right:{style:"thin",color:{rgb:"334155"}}};
  for(let r=0;r<matrix.length;r++) for(let c=0;c<header.length;c++){
    const addr=XLSX.utils.encode_cell({r,c});
    if(!weeklySheet[addr]) weeklySheet[addr]={t:"s",v:""};
    weeklySheet[addr].s={border,alignment:{vertical:"center",horizontal:c===0?"center":"left",wrapText:true},font:{name:"Arial",sz:9}};
  }
  weeklySheet.A1.s={...weeklySheet.A1.s,fill:{patternType:"solid",fgColor:{rgb:"FFF200"}},font:{name:"Arial",sz:14,bold:true},alignment:{horizontal:"center",vertical:"center"}};
  for(let c=0;c<header.length;c++){
    for(const r of [1,2]){
      const cell=weeklySheet[XLSX.utils.encode_cell({r,c})];
      cell.s={...cell.s,fill:{patternType:"solid",fgColor:{rgb:r===1?"F9B51B":"FFE7A3"}},font:{name:"Arial",sz:9,bold:true},alignment:{horizontal:"center",vertical:"center",wrapText:true}};
    }
    const cell=weeklySheet[XLSX.utils.encode_cell({r:totalRow,c})];
    cell.s={...cell.s,fill:{patternType:"solid",fgColor:{rgb:"F9B51B"}},font:{name:"Arial",sz:9,bold:true},alignment:{horizontal:c===0?"center":"left",vertical:"center",wrapText:true}};
  }
  XLSX.utils.book_append_sheet(wb,weeklySheet,"Weekly Planning Output");

  const input=[HEADERS,...weekly.map(row=>[
    row.production_on,row.work_center,(INPUTS.workcenters[row.work_center]||{}).name||row.work_center,
    row.stage,row.job_card_no||"",row.order_no,row.article,row.size_ranges,row.party,row.planned_pairs,
    row.actual_pairs==null?"":row.actual_pairs,row.note||"",row.unit_key,
  ])];
  const inputSheet=XLSX.utils.aoa_to_sheet(input);
  inputSheet["!cols"]=[{wch:16},{wch:20},{wch:26},{wch:16},{wch:15},{wch:15},{wch:24},{wch:18},{wch:22},{wch:16},{wch:17},{wch:30},{wch:24}];
  inputSheet["!autofilter"]={ref:`A1:M${Math.max(1,input.length)}`};
  inputSheet["!freeze"]={xSplit:0,ySplit:1,topLeftCell:"A2",activePane:"bottomLeft",state:"frozen"};
  for(let c=0;c<HEADERS.length;c++){
    const cell=inputSheet[XLSX.utils.encode_cell({r:0,c})];
    cell.s={fill:{patternType:"solid",fgColor:{rgb:"FFF200"}},font:{name:"Arial",sz:10,bold:true},
      alignment:{horizontal:"center",vertical:"center",wrapText:true},border};
  }
  XLSX.utils.book_append_sheet(wb,inputSheet,"Daily Input");
  return wb;
}

export default function ProductionInputTab({state,actuals=[],onChanged,replan}){
  const today=todayIso();
  const [weekStart,setWeekStart]=useState(()=>mondayOf(today));
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  /* WHAT THE ENTRY JUST DID. Saving used to say only "saved", while four other
     things moved — the card's plan, the order's dispatch date, tomorrow's
     machine load and the delivery status the customer is judged on. */
  const [impact,setImpact]=useState(null);
  const fileRef=useRef(null);
  const planned=useMemo(()=>plannedProductionRows(state,INPUTS.origin,fromDay),[state]);
  const rows=useMemo(()=>withProductionActuals(planned,actuals),[planned,actuals]);
  const summary=useMemo(()=>productionActualSummary(planned,actuals,today),[planned,actuals,today]);
  const weekEnd=plusDays(weekStart,5);
  const visible=rows.filter(row=>row.production_on>=weekStart&&row.production_on<=weekEnd);

  function download(){
    XLSX.writeFile(workbookFor(rows,weekStart),`weekly-production-plan-${weekStart}.xlsx`,{cellStyles:true});
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
      /* The plan as it stands, and the plan this entry produces — compared, so
         the screen can SAY what changed rather than ask to be trusted. Both
         come from the same pure planner the rest of the app uses. */
      const after=typeof replan==="function"?replan(checked.rows):null;
      const result=await api.saveProductionActuals(checked.rows);
      await onChanged();
      setImpact(after?planImpact(state, after, checked.rows):planImpact(state, state, checked.rows));
      setMessage(`${result.saved} plan-versus-achievement row${result.saved===1?"":"s"} saved.`);
    }catch(e){setError(e.message||String(e));}
    finally{setBusy(false);if(fileRef.current)fileRef.current.value="";}
  }

  return <div className="space-y-4">
    {impact && <ImpactPanel impact={impact} onClose={()=>setImpact(null)} />}
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

/* WHAT YOUR ENTRY JUST DID.
   Four things move when the floor reports a number, and a screen that says
   only "saved" leaves a person to trust that the right four moved. This shows
   the row that was written, the dates that changed because of it, and — just
   as deliberately — the things that did NOT change, because "the buying list
   is untouched" is information, and its absence reads as nobody having
   checked. */
function ImpactPanel({impact,onClose}){
  const n=v=>Number(v||0).toLocaleString("en-IN");
  const date=iso=>!iso?"—":new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
  return <section className="bg-white border-2 border-indigo-300 rounded-2xl p-4 shadow-sm">
    <div className="flex items-baseline gap-2 flex-wrap">
      <div className="text-sm font-semibold text-slate-800">What this entry changed</div>
      <div className="text-xs text-slate-500">
        {n(impact.pairs_recorded)} pairs recorded against {n(impact.pairs_planned)} planned
        {impact.behind_pairs>0 && <> · <b className="text-amber-700">{n(impact.behind_pairs)} short</b></>}
        {impact.ahead_pairs>0 && <> · <b className="text-emerald-700">{n(impact.ahead_pairs)} ahead</b></>}
      </div>
      <button onClick={onClose} className="ml-auto text-xs text-slate-500 px-1.5">close</button>
    </div>

    {/* 1. WHAT WAS STORED. The row, named the way the database names it. */}
    <div className="mt-3">
      <div className="text-xs font-semibold text-slate-600 mb-1">Written to the database</div>
      <div className="overflow-x-auto">
        <table className="text-xs w-full" style={{borderCollapse:"collapse"}}>
          <thead><tr className="text-slate-500">
            <th className="text-left py-1">Table</th><th className="text-left">Row</th>
            <th className="text-right">Planned</th><th className="text-right">Achieved</th><th className="text-right">Gap</th>
          </tr></thead>
          <tbody>
            {impact.stored.slice(0,8).map((r,i)=>(
              <tr key={i} style={{borderTop:"1px solid #f1f5f9"}}>
                <td className="mono py-1 text-slate-500">{r.table}</td>
                <td className="mono text-slate-700">{r.key}</td>
                <td className="mono text-right">{n(r.planned_pairs)}</td>
                <td className="mono text-right font-semibold">{n(r.actual_pairs)}</td>
                <td className="mono text-right" style={{color:r.gap<0?"#b45309":r.gap>0?"#047857":"#64748b"}}>
                  {r.gap>0?"+":""}{n(r.gap)}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
      {impact.stored.length>8 && <div className="text-xs text-slate-400 mt-1">…and {impact.stored.length-8} more rows.</div>}
    </div>

    {/* 2. WHAT MOVED BECAUSE OF IT. */}
    {!!impact.cards.length && <div className="mt-3">
      <div className="text-xs font-semibold text-slate-600 mb-1">Job cards re-planned</div>
      {impact.cards.map(c=>(
        <div key={c.unit_key} className="text-xs text-slate-600">
          <span className="mono">{c.card_no?`card ${c.card_no}`:c.unit_key}</span> on{" "}
          <span className="mono">{c.order_no}</span> — finishes {date(c.dispatch_before)} →{" "}
          <b className="mono">{date(c.dispatch_after)}</b>
          <span className="text-slate-400"> ({c.days_moved>0?"+":""}{c.days_moved} day{Math.abs(c.days_moved)===1?"":"s"})</span>
        </div>))}
      <div className="text-[11px] text-slate-400 mt-0.5">
        The pairs still to make are re-planned from the next working day — the balance cannot be made again yesterday.
      </div>
    </div>}

    {!!impact.orders.length && <div className="mt-3">
      <div className="text-xs font-semibold text-slate-600 mb-1">Orders whose promise moved</div>
      {impact.orders.map(o=>(
        <div key={o.order_no} className="text-xs text-slate-600">
          <span className="mono">{o.order_no}</span> {o.party?`· ${o.party}`:""} — dispatch {date(o.dispatch_before)} →{" "}
          <b className="mono" style={{color:o.worse?"#b91c1c":"#047857"}}>{date(o.dispatch_after)}</b>
          {o.sla_before!==o.sla_after && <> · status {o.sla_before_label} → <b>{o.sla_after_label}</b></>}
        </div>))}
    </div>}

    {!!impact.load.length && <div className="mt-3">
      <div className="text-xs font-semibold text-slate-600 mb-1">Machine loading</div>
      {impact.load.slice(0,6).map(l=>(
        <div key={l.work_center} className="text-xs text-slate-600">
          <span className="mono">{l.work_center}</span> — {n(l.pairs_before)} → <b className="mono">{n(l.pairs_after)}</b> pairs still to make
          <span className="text-slate-400"> ({l.delta>0?"+":""}{n(l.delta)})</span>
        </div>))}
    </div>}

    {/* 3. WHAT DID NOT CHANGE — said, not omitted. */}
    <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2">
      <div className="text-xs font-semibold text-slate-600 mb-0.5">Unchanged</div>
      {impact.unchanged.map((line,i)=><div key={i} className="text-[11px] text-slate-500">{line}</div>)}
    </div>
  </section>;
}
