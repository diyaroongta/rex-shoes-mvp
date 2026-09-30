import React, { useEffect, useMemo, useRef, useState } from "react";
import { planImpact } from "../shared/input-impact.js";
import { productionActualKey } from "../shared/production-actuals.js";
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
const STAGE_WORD={CUTTING:"Cutting",PREPARATION:"Preparation",STITCHING:"Stitching",UPPER_QC:"Upper QC",
  MOLDING:"Molding",PACKING:"Packing",DISPATCH:"Dispatch",TRANSIT:"Transit"};

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

/* "Mon 21 Sep" rather than a bare ISO date, because the empty state is read
   as a sentence. */
const niceDay = iso => {
  const d = new Date(String(iso)+"T00:00:00");
  return isNaN(d) ? String(iso)
    : d.toLocaleDateString("en-GB",{weekday:"short",day:"2-digit",month:"short"});
};

export default function ProductionInputTab({state,actuals=[],onChanged,replan}){
  const today=todayIso();
  const [weekStart,setWeekStart]=useState(()=>mondayOf(today));
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  /* WHAT THE ENTRY JUST DID. Saving used to say only "saved", while four other
     things moved — the card's plan, the order's dispatch date, tomorrow's
     machine load and the delivery status the customer is judged on. */
  const [impact,setImpact]=useState(null);
  /* TYPED ON THE SCREEN, not only in a workbook. The factory's ask was that
     the ERP asks for production against the planned job cards — downloading a
     file, filling it and uploading it again is three steps for one number.
     The Excel round trip stays for a week's worth at a time. */
  const [entry,setEntry]=useState({});
  const fileRef=useRef(null);
  const planned=useMemo(()=>plannedProductionRows(state,INPUTS.origin,fromDay),[state]);
  const rows=useMemo(()=>withProductionActuals(planned,actuals),[planned,actuals]);
  const summary=useMemo(()=>productionActualSummary(planned,actuals,today),[planned,actuals,today]);
  const weekEnd=plusDays(weekStart,5);
  /* A DAY AT A TIME, BECAUSE THAT IS WHAT IS BEING REPORTED.
     The screen showed a whole Monday-to-Saturday week as one flat list of
     number boxes, so reporting today's production meant finding today's rows
     among five other days' and filling them one at a time. The floor reports
     ONE day; the week stays a click away for catching up. */
  const [day,setDay]=useState(()=>today);
  const [scope,setScope]=useState("day");        // "day" | "week"
  /* OPEN ON A DAY THAT HAS WORK ON IT. Landing on today is right when today
     is a working day, and useless on a Sunday or before the first job starts
     — the screen would greet the operator with an empty table and no hint
     that the plan is fine, just not today. Once the date is touched it is
     theirs and this never fires again. */
  const chosenDay=useRef(false);
  useEffect(()=>{
    if(chosenDay.current||!rows.length) return;
    if(rows.some(r=>r.production_on===today)){ chosenDay.current=true; return; }
    const ahead=rows.map(r=>r.production_on).filter(d=>d>=today).sort();
    const earliest=ahead.length?ahead[0]:rows.map(r=>r.production_on).sort().pop();
    if(earliest){ setDay(earliest); setWeekStart(mondayOf(earliest)); }
    chosenDay.current=true;
  },[rows,today]);
  const visible=rows.filter(row=>scope==="week"
    ? row.production_on>=weekStart&&row.production_on<=weekEnd
    : row.production_on===day);

  /* WHAT IS TYPED BUT NOT YET SAVED, as it is typed. Reporting used to be
     numbers going into boxes with no total until after the save. */
  const typed=useMemo(()=>{
    let plannedPairs=0, enteredPairs=0, filled=0;
    for(const row of visible){
      plannedPairs+=Number(row.planned_pairs)||0;
      const raw=entry[productionActualKey(row)];
      const has=raw!=null&&String(raw).trim()!=="";
      const value=has?Number(raw):(row.actual_pairs==null?null:Number(row.actual_pairs));
      if(value!=null&&!Number.isNaN(value)){ enteredPairs+=value; filled+=1; }
    }
    return { plannedPairs, enteredPairs, filled, rows:visible.length,
             pct: plannedPairs>0?Math.round(100*enteredPairs/plannedPairs):null };
  },[visible,entry]);

  /* BULK ENTRY, AND IT IS STILL AN ASSERTION.
     Nothing is pre-filled and nothing auto-saves: these write into the boxes,
     the operator sees every figure, and Save is still a separate press. A day
     that ran to plan is one click instead of forty identical numbers, and a
     line that ran at about 85% is one figure instead of forty arithmetic
     sums — which is how the floor actually reports it. */
  function fillAll(factorPct){
    setEntry(current=>{
      const next={...current};
      for(const row of visible){
        if(row.recorded_only) continue;        // already reported; not work to fill in
        const key=productionActualKey(row);
        const planned=Number(row.planned_pairs)||0;
        next[key]=String(Math.round(planned*(Number(factorPct)||0)/100));
      }
      return next;
    });
  }
  const [pct,setPct]=useState("85");

  function download(){
    XLSX.writeFile(workbookFor(rows,weekStart),`weekly-production-plan-${weekStart}.xlsx`,{cellStyles:true});
    setMessage("Weekly plan downloaded. Fill only Achieved Pairs and Note on the Daily Input sheet, then upload the same file.");
  }

  async function saveTyped(){
    setError("");setMessage("");setBusy(true);
    try{
      const rows=Object.entries(entry)
        .filter(([,v])=>String(v).trim()!=="")
        .map(([key,value])=>{
          const row=(planned||[]).find(r=>productionActualKey(r)===key);
          return row?{...row,actual_pairs:Number(value)}:null;
        }).filter(Boolean);
      if(!rows.length) throw new Error("Type the pairs achieved against at least one row first.");
      const checked=validateProductionActuals(rows,planned);
      if(!checked.ok) throw new Error(checked.problems.slice(0,8).join("; "));
      const after=typeof replan==="function"?replan(checked.rows):null;
      const result=await api.saveProductionActuals(checked.rows);
      await onChanged();
      setEntry({});
      setImpact(after?planImpact(state,after,checked.rows):planImpact(state,state,checked.rows));
      setMessage(`${result.saved} row${result.saved===1?"":"s"} saved.`);
    }catch(e){setError(e.message||String(e));}
    finally{setBusy(false);}
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
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <div className="text-sm font-semibold text-slate-800">
          {scope==="day"?"Report production":`Week · ${weekStart} to ${weekEnd}`}</div>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 ml-auto">
          {[["day","One day"],["week","Whole week"]].map(([k,label])=>
            <button key={k} onClick={()=>setScope(k)} aria-pressed={scope===k}
              className="text-xs font-semibold rounded-md px-2.5 py-1"
              style={scope===k?{background:"#fff",color:"#1e293b"}:{background:"transparent",color:"#64748b"}}>
              {label}</button>)}
        </div>
      </div>
      {scope==="day" && <div className="flex items-center gap-2 flex-wrap mb-3">
        <button onClick={()=>setDay(plusDays(day,-1))} aria-label="Previous day"
          className="text-xs font-semibold rounded-lg px-2 py-1 border border-slate-300 bg-white">←</button>
        <input type="date" value={day} onChange={e=>setDay(e.target.value)} aria-label="Production date"
          className="border border-slate-300 rounded-lg px-2 py-1 bg-white mono text-xs"/>
        <button onClick={()=>setDay(plusDays(day,1))} aria-label="Next day"
          className="text-xs font-semibold rounded-lg px-2 py-1 border border-slate-300 bg-white">→</button>
        {day!==today && <button onClick={()=>setDay(today)}
          className="text-xs font-semibold text-indigo-700">Today</button>}
      </div>}

      {/* HOW THE FLOOR ACTUALLY REPORTS IT: "everything ran" or "we were at
          about 85%". Both write into the boxes below — every figure stays
          visible and editable, and Save is still a separate press. */}
      {!!visible.length && <div className="flex items-center gap-2 flex-wrap mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-xs font-semibold text-slate-600">Fill every row:</span>
        <button onClick={()=>fillAll(100)} disabled={busy}
          className="text-xs font-semibold rounded-lg px-2.5 py-1 border border-slate-300 bg-white disabled:opacity-40">
          Ran to plan</button>
        <div className="flex items-center gap-1">
          <input type="number" min="0" max="200" value={pct} onChange={e=>setPct(e.target.value)}
            aria-label="Percent of plan achieved"
            className="w-16 border border-slate-300 rounded px-1.5 py-1 mono text-right text-xs bg-white"/>
          <span className="text-xs text-slate-500">% of plan</span>
          <button onClick={()=>fillAll(pct)} disabled={busy}
            className="text-xs font-semibold rounded-lg px-2.5 py-1 border border-slate-300 bg-white disabled:opacity-40">
            Apply</button>
        </div>
        <button onClick={()=>setEntry({})} disabled={busy}
          className="text-xs font-semibold text-slate-500 ml-1 disabled:opacity-40">Clear</button>
        <span className="text-xs text-slate-600 ml-auto">
          <b className="mono">{fmt(typed.enteredPairs)}</b> of <b className="mono">{fmt(typed.plannedPairs)}</b> pairs
          {typed.pct!=null && <> · <b className="mono">{typed.pct}%</b></>}
          {" "}· {typed.filled} of {typed.rows} rows
        </span>
      </div>}
      {/* SIX COLUMNS, NOT NINE. At nine, with a 950px floor, the Achievement
          box — the only thing this table is for — sat off the right edge on a
          laptop. Nothing is dropped: the stage sits under its machine, the
          party under the order, the size range under the article. */}
      <table className="w-full text-xs" style={{minWidth:620}}><thead><tr className="sign text-slate-500">
        {['Date','Where','Job card / Order','Article','Plan','Achievement'].map(h=><th key={h} className={`py-2 px-2 ${['Plan','Achievement'].includes(h)?'text-right':'text-left'}`}>{h}</th>)}
      </tr></thead><tbody>{visible.map(row=><tr key={`${row.production_on}-${row.work_center}-${row.stage}-${row.order_no}`} className="border-t border-slate-100 align-top">
        <td className="py-2 px-2 mono whitespace-nowrap">{row.production_on}</td>
        <td className="py-2 px-2"><div>{(INPUTS.workcenters[row.work_center]||{}).name||row.work_center}</div>
          <div className="text-slate-400">{STAGE_WORD[row.stage]||row.stage}</div></td>
        <td className="py-2 px-2"><div className="mono font-semibold">{row.job_card_no?`Card ${row.job_card_no}`:'Whole order'}</div>
          <div className="text-slate-400"><span className="mono">{row.order_no}</span>{row.party?` · ${row.party}`:''}</div></td>
        <td className="py-2 px-2"><div>{row.article}</div><div className="mono text-slate-400">{row.size_ranges||'—'}</div></td>
        <td className="py-2 px-2 mono text-right">{fmt(row.planned_pairs)}
          {/* A row the plan no longer carries, because recording it is what
              took it off the plan. It is history and stays visible, so the day
              it was entered against does not read as empty. */}
          {row.recorded_only && <div className="text-[10px] text-slate-400 font-normal">recorded</div>}</td>
        <td className="px-2 text-right">
          {/* What was recorded stands until it is deliberately typed over —
              the box shows the saved figure rather than an empty field that
              reads as "nothing was ever entered". */}
          <div className="flex items-center gap-1 justify-end">
            <input type="number" min={0} disabled={busy} data-production-input
              aria-label={`Pairs achieved for ${row.job_card_no||row.order_no} ${row.stage} on ${row.production_on}`}
              value={entry[productionActualKey(row)] ?? (row.actual_pairs==null?"":row.actual_pairs)}
              placeholder="—"
              onChange={e=>setEntry(d=>({...d,[productionActualKey(row)]:e.target.value}))}
              /* Enter moves to the next row rather than doing nothing, so a
                 column of figures is typed without reaching for the mouse. */
              onKeyDown={e=>{ if(e.key!=="Enter") return; e.preventDefault();
                const all=[...document.querySelectorAll("[data-production-input]")];
                const at=all.indexOf(e.currentTarget);
                if(at>-1&&all[at+1]) all[at+1].focus(); }}
              className={`w-24 border rounded px-1.5 py-1 mono text-right ${
                row.actual_pairs==null?"border-slate-300":"border-emerald-300 text-emerald-800"}`} />
            {/* One click for the commonest entry of all. */}
            {!row.recorded_only && <button type="button" disabled={busy}
              title={`This row ran to plan — ${fmt(row.planned_pairs)} pairs`}
              aria-label={`${row.job_card_no||row.order_no} ${row.stage} ran to plan`}
              onClick={()=>setEntry(d=>({...d,[productionActualKey(row)]:String(Number(row.planned_pairs)||0)}))}
              className="text-[10px] font-semibold text-slate-500 hover:text-indigo-700 disabled:opacity-40">=plan</button>}
          </div>
        </td>
      </tr>)}</tbody></table>
      {!!visible.length&&<div className="flex items-center gap-3 flex-wrap mt-3">
        <button onClick={saveTyped} disabled={busy||!Object.values(entry).some(v=>String(v).trim()!=="")}
          className="text-xs font-semibold rounded-lg px-4 py-2 bg-indigo-600 text-white disabled:opacity-40">
          {busy?"Saving…":"Save today's production"}</button>
        <span className="text-xs text-slate-500">
          Type the pairs achieved against any row and save. The plan re-plans what is left, and the panel above
          says what moved.</span>
      </div>}
      {!visible.length&&<div className="text-sm text-slate-500 text-center py-8">
        {scope==="day"
          ? <>Nothing is scheduled for {niceDay(day)}.{" "}
              <button onClick={()=>setScope("week")} className="font-semibold text-indigo-700">Show the whole week</button></>
          : <>Nothing is scheduled in this Monday–Saturday week.</>}
      </div>}
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
  const span=(a,b)=>a===b?date(a):`${date(a)}–${date(b)}`;
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

    {/* Stage by stage — the re-plan a dispatch date can absorb without moving. */}
    {!!(impact.stage_moves||[]).length && <div className="mt-3">
      <div className="text-xs font-semibold text-slate-600 mb-1">Stages re-planned</div>
      {impact.stage_moves.slice(0,8).map(m=>(
        <div key={m.unit_key+m.stage} className="text-xs text-slate-600">
          <span className="mono">{m.card_no?`card ${m.card_no}`:m.order_no}</span> · <b>{STAGE_WORD[m.stage]||m.stage}</b> —{" "}
          {span(m.start_before,m.end_before)} → <b className="mono">{span(m.start_after,m.end_after)}</b>
        </div>))}
      {impact.stage_moves.length>8 && <div className="text-[11px] text-slate-400">…and {impact.stage_moves.length-8} more.</div>}
      <div className="text-[11px] text-slate-400 mt-0.5">
        What was not made is planned from the next day, and every stage behind it moves back to make room.
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
