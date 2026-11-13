import React, { useEffect, useMemo, useState } from "react";
import { todayIso } from "./lib/today.js";
import * as api from "./lib/client.js";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import { cardLedger, validateMovement, movementWarnings, effectiveIssueMode, issueModeOf,
         ISSUE_MODE_LABEL } from "../shared/material-issues.js";

const fmt = n => (n==null||isNaN(n)) ? "—" : Number(n).toLocaleString("en-IN",{maximumFractionDigits:3});
const sameJob = (a,b) => Number(a)===Number(b);

/* ONE JOB CARD'S MATERIAL ACCOUNT — what its BOM calls for, what has gone to
   it, what came back, and what is still to issue. Read-only: it is shown on
   Issue Material above the entry boxes, and on the Job Orders Database for
   anybody who needs to see where a card stands.
   `entry` adds the quantity column; without it the table only reports. */
export function CardLedger({ ledger, entry=null }){
  return <div>
    {!ledger.has_card && <div className="text-xs text-slate-600 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 mb-2">
      This job has no size-wise card, so there is no BOM quantity to check its material against.
      Anything issued is still recorded against it.</div>}
    {ledger.no_bom && <div className="text-xs text-amber-800 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mb-2">
      This card's article has no BOM for these sizes, so nothing says what it should be given.
      Anything issued is still recorded against it.</div>}
    {ledger.nothing_recorded && ledger.has_card && !ledger.no_bom && <div className="text-xs text-slate-600 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 mb-2">
      Nothing is logged against this card. A card raised before the issue log existed was booked on the
      stock sheet in total when it was raised, and is not itemised here.</div>}
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-xs" aria-label={`Material account for job card ${ledger.job_id}`}>
        <thead className="bg-slate-50 text-slate-500"><tr>
          <th className="text-left px-3 py-2">Material</th>
          <th className="text-left px-2">How issued</th>
          <th className="text-right px-2">BOM needs</th>
          <th className="text-right px-2">Issued</th>
          <th className="text-right px-2">Returned</th>
          <th className="text-right px-2" title="Issued less returned — what the job has kept.">Kept</th>
          <th className="text-right px-3">Still to issue</th>
          {entry && <th className="text-right px-3">{entry.label}</th>}
        </tr></thead>
        <tbody>
          {ledger.rows.map(r => <tr key={r.material_key} className="border-t border-slate-100">
            <td className="px-3 py-1.5">
              <span className="font-medium text-slate-800">{r.name}</span>
              {!r.on_bom && <span className="ml-2 text-[10.5px] font-semibold rounded-full px-2 py-0.5"
                style={{background:"#fff7ed",color:"#9a3412"}}>not on the BOM</span>}
            </td>
            <td className="px-2 whitespace-nowrap">
              <span className={r.mode==="on_demand"?"font-semibold text-indigo-700":"text-slate-600"}>{ISSUE_MODE_LABEL[r.mode]}</span>
              {!r.mode_set && <span className="text-slate-400"> · not set</span>}
            </td>
            <td className="px-2 text-right mono">{r.on_bom?fmt(r.required):"—"}</td>
            <td className="px-2 text-right mono">{r.issued?fmt(r.issued):"—"}</td>
            <td className="px-2 text-right mono">{r.returned?fmt(r.returned):"—"}</td>
            <td className="px-2 text-right mono font-semibold">{fmt(r.net)} <span className="text-slate-400 font-normal">{r.uom}</span></td>
            <td className="px-3 text-right mono">
              {!r.on_bom ? "—"
                : r.excess>0 ? <span className="text-amber-700 font-semibold" title="More than the BOM calls for has gone to this card.">{fmt(r.excess)} over</span>
                : r.balance>0 ? <span className="text-rose-700 font-semibold">{fmt(r.balance)}</span>
                : <span className="text-emerald-700">done</span>}
            </td>
            {entry && <td className="px-3 py-1 text-right">
              <input type="number" min="0" step="any" value={entry.qty[r.material_key]??""}
                aria-label={`${entry.label} ${r.name}`}
                onChange={e=>entry.onChange(r.material_key,e.target.value)}
                className="w-24 border border-slate-300 rounded px-2 py-1 bg-white mono text-right" /></td>}
          </tr>)}
          {!ledger.rows.length && <tr><td colSpan={entry?8:7} className="px-3 py-3 text-slate-500">
            No material is on this card's BOM and none has been issued to it.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}

/* Lazy, read-only view of one card — for the Job Orders Database. */
export function CardMaterials({ job }){
  const [moves,setMoves]=useState(null);
  const [err,setErr]=useState("");
  useEffect(()=>{
    let live=true;
    api.listMaterialIssues({job_id:job.id}).then(m=>{ if(live) setMoves(m); })
      .catch(e=>{ if(live) setErr(String(e.message||e)); });
    return()=>{ live=false; };
  },[job.id]);
  if(err) return <div role="alert" className="text-xs text-rose-700">{err}</div>;
  if(!moves) return <div className="text-xs text-slate-500">Loading what was issued to this card…</div>;
  return <CardLedger ledger={cardLedger(job,(INPUTS.articles||{})[job.article],moves,
    INPUTS.stock_meta||{},INPUTS.materials||{})} />;
}

/* ISSUE MATERIAL — the store keeper's screen.
   Choose the job card, see its account, type what is being handed over (or
   taken back) and save. A material set to "by job order" was released when the
   card was raised and normally needs nothing here; an "on demand" one is
   issued here when the floor asks. Nothing is refused for being more than the
   BOM or more than the register shows — both are said before saving. */
export default function IssueMaterialTab({ active=true, canWrite=true, onChanged=null }){
  const [jobs,setJobs]=useState(null);
  const [moves,setMoves]=useState([]);
  const [jobId,setJobId]=useState("");
  const [type,setType]=useState("issue");
  const [qty,setQty]=useState({});
  const [extra,setExtra]=useState([]);        // materials added that the BOM does not name
  const [search,setSearch]=useState("");
  const [date,setDate]=useState(todayIso);
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [confirmUndo,setConfirmUndo]=useState(null);
  const [version,setVersion]=useState(0);     // bumped when the register is reloaded

  /* A refresh that fails keeps the last good lists — see JobCardTab. */
  async function reload({ initial=false }={}){
    try{
      const [j,m]=await Promise.all([api.listJobWork(true),api.listMaterialIssues()]);
      setJobs(j); setMoves(m); if(!initial) setErr("");
    }catch(e){
      setErr((e&&e.message)||String(e));
      if(initial){ setJobs([]); setMoves([]); }
    }
  }
  /* Loaded when the screen is opened, not on a timer: it is mounted behind
     other screens so a half-typed issue survives a tab switch. */
  useEffect(()=>{ if(active) reload({ initial: jobs===null }); },[active]);

  const live=useMemo(()=>(jobs||[]).filter(j=>!j.cancelled),[jobs]);
  const openJobs=live.filter(j=>j.status!=="closed");
  const closedJobs=live.filter(j=>j.status==="closed");
  const job=live.find(j=>sameJob(j.id,jobId))||null;
  const jobMoves=useMemo(()=>moves.filter(m=>job&&sameJob(m.job_id,job.id)),[moves,job]);

  const ledger=useMemo(()=>{
    if(!job) return null;
    const base=cardLedger(job,(INPUTS.articles||{})[job.article],jobMoves,INPUTS.stock_meta||{},INPUTS.materials||{});
    /* A material the keeper added by hand shows as a row straight away, so
       there is a box to type its quantity into. */
    const have=new Set(base.rows.map(r=>r.material_key));
    const added=extra.filter(key=>!have.has(key)&&(INPUTS.materials||{})[key]).map(key=>({
      material_key:key,name:INPUTS.materials[key].name,uom:INPUTS.materials[key].uom,on_bom:false,
      mode:effectiveIssueMode((INPUTS.stock_meta||{})[key]),
      mode_set:issueModeOf((INPUTS.stock_meta||{})[key])!=null,
      required:0,issued:0,returned:0,net:0,balance:0,excess:0}));
    return {...base,rows:[...base.rows,...added]};
  },[job,jobMoves,extra,version]);

  const draft={ type, moved_on:date, note,
    lines:Object.entries(qty).filter(([,v])=>v!==""&&v!=null&&Number(v)!==0).map(([material_key,v])=>({material_key,qty:v})) };
  const checked=job&&draft.lines.length
    ? validateMovement(draft,{job,materials:INPUTS.materials||{},prior:jobMoves}) : null;
  const warnings=checked&&checked.ok?movementWarnings(checked.value,ledger,INPUTS.materials||{},INPUTS.stock_meta||{}):[];

  function choose(id){
    setJobId(id); setQty({}); setExtra([]); setSearch(""); setErr(""); setMsg(""); setConfirmUndo(null);
  }
  function fillBalances(){
    const next={};
    for(const r of ledger.rows) if(r.on_bom&&r.balance>0) next[r.material_key]=String(r.balance);
    setQty(next);
  }

  async function save(){
    if(!checked||!checked.ok) return;
    setBusy(true); setErr(""); setMsg("");
    try{
      const out=await api.addMaterialIssue({job_id:job.id,type,moved_on:date,note,
        lines:checked.value.lines.map(l=>({material_key:l.material_key,qty:l.qty}))});
      setMoves(current=>[...(out.movements||[]),...current]);
      setQty({}); setNote(""); setExtra([]);
      const n=(out.movements||[]).length;
      setMsg(`${n} material${n===1?"":"s"} ${type==="return"?"taken back from":"issued to"} job card ${job.id}. `
        + `The stock sheet is updated.`);
      await reloadReference().catch(()=>{});
      setVersion(v=>v+1);
      if(onChanged) await onChanged();
    }catch(e){ setErr((e&&e.message)||String(e)); }
    finally{ setBusy(false); }
  }

  async function undo(id){
    setBusy(true); setErr(""); setMsg("");
    try{
      const out=await api.undoMaterialIssue(id);
      setMoves(current=>current.filter(m=>m.id!==id));
      setMsg(out.note||"Undone.");
      await reloadReference().catch(()=>{});
      setVersion(v=>v+1);
      if(onChanged) await onChanged();
    }catch(e){
      setErr((e&&e.message)||String(e));
      await reload();      // the list may be what is out of date
    }
    finally{ setBusy(false); setConfirmUndo(null); }
  }

  if(jobs===null) return <div className="p-5 text-sm text-slate-500">Loading job cards…</div>;

  const needle=search.trim().toLowerCase();
  const onRows=new Set((ledger?ledger.rows:[]).map(r=>r.material_key));
  const found=needle ? Object.entries(INPUTS.materials||{})
    .filter(([key,m])=>!onRows.has(key)&&(m.name+" "+key).toLowerCase().includes(needle)).slice(0,8) : [];
  const optionLabel=j=>`${j.id} · ${j.fabricator} · ${j.article}${j.order_no?` · ${j.order_no}`:""} · ${fmt(j.qty)} pairs`;

  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <div className="flex items-end gap-3 flex-wrap mb-3">
      <label className="text-xs text-slate-600" style={{flex:"1 1 320px",maxWidth:560}}>Job card
        <select value={jobId} onChange={e=>choose(e.target.value)} aria-label="Job card"
          className="block mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 bg-white text-sm">
          <option value="">Choose the job card the material is for…</option>
          {openJobs.length>0 && <optgroup label="Open job cards">
            {openJobs.map(j=><option key={j.id} value={j.id}>{optionLabel(j)}</option>)}</optgroup>}
          {closedJobs.length>0 && <optgroup label="Closed job cards">
            {closedJobs.map(j=><option key={j.id} value={j.id}>{optionLabel(j)}</option>)}</optgroup>}
        </select></label>
      {job && ledger.has_card && !ledger.no_bom && <span className="text-xs font-semibold rounded-full px-3 py-1 mb-1"
        style={ledger.fully_issued?{background:"#ecfdf5",color:"#065f46"}:{background:"#fee2e2",color:"#991b1b"}}>
        {ledger.fully_issued?"Everything the BOM calls for has been issued"
          :`${ledger.pending} material${ledger.pending===1?"":"s"} still to issue`}</span>}
    </div>

    {!live.length && <div className="text-sm text-slate-500">
      There are no job cards yet. Material is issued against a job card, so raise one on Create Job Order first.</div>}
    {err && <div role="alert" className="text-xs text-rose-700 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 mb-3">{err}</div>}
    {msg && <div className="text-xs text-emerald-700 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 mb-3">{msg}</div>}

    {job && <>
      {canWrite && <div className="flex items-center gap-2 flex-wrap mb-2">
        <div role="tablist" aria-label="Movement" className="inline-flex rounded-xl bg-slate-100 p-1">
          {[["issue","Issue to the floor"],["return","Take back into the store"]].map(([k,label])=>
            <button key={k} role="tab" aria-selected={type===k} onClick={()=>{setType(k);setQty({});}}
              className="text-xs font-semibold rounded-lg px-3 py-1.5"
              style={type===k?{background:"#fff",color:"#1e293b",boxShadow:"0 1px 2px rgba(15,23,42,.12)"}
                :{background:"transparent",color:"#64748b"}}>{label}</button>)}
        </div>
        {type==="issue" && ledger.pending>0 && <button onClick={fillBalances}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white"
          title="Put each material's remaining BOM quantity in its box. Nothing is saved until you press Save.">
          Fill what is still to issue</button>}
      </div>}

      <CardLedger ledger={ledger} entry={canWrite?{ label:type==="return"?"Take back":"Issue now", qty,
        onChange:(key,value)=>setQty(q=>({...q,[key]:value})) }:null} />

      {canWrite && <>
        <div className="mt-3">
          <input value={search} onChange={e=>setSearch(e.target.value)} aria-label="Add another material"
            placeholder={type==="return"?"Search a material…":"Add a material that is not on this card's BOM…"}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 w-full" style={{maxWidth:420}} />
          {found.length>0 && <div className="mt-1 rounded-lg border border-slate-200 bg-white" style={{maxWidth:420}}>
            {found.map(([key,m])=><button key={key} onClick={()=>{setExtra(x=>[...x,key]);setSearch("");}}
              className="block w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50 border-b border-slate-100 last:border-0">
              {m.name} <span className="text-slate-400">{m.uom}</span></button>)}
          </div>}
        </div>

        <div className="flex items-end gap-3 flex-wrap mt-3">
          <label className="text-xs text-slate-600">Date
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} aria-label="Date"
              className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm" /></label>
          <label className="text-xs text-slate-600" style={{flex:"1 1 240px",maxWidth:420}}>Note
            <input value={note} onChange={e=>setNote(e.target.value)} maxLength={500} aria-label="Note"
              placeholder="Who asked, slip number — optional"
              className="block mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm" /></label>
          <button onClick={save} disabled={busy||!checked||!checked.ok}
            className="cta">
            {busy?"Saving…":type==="return"?"Save return":"Save issue"}</button>
        </div>
        {checked&&!checked.ok && <div role="alert" className="text-xs text-rose-700 mt-2">{checked.problems.join("; ")}</div>}
        {warnings.length>0 && <div className="text-xs text-amber-800 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mt-2">
          <b>This will still be saved.</b> {warnings.join(" ")}</div>}
      </>}

      <div className="text-xs font-semibold text-slate-700 mt-5 mb-1">Every movement against job card {job.id}</div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-xs" aria-label={`Movements against job card ${job.id}`}>
          <thead className="bg-slate-50 text-slate-500"><tr>
            <th className="text-left px-3 py-2">Date</th><th className="text-left px-2">Material</th>
            <th className="text-right px-2">Quantity</th><th className="text-left px-2">How</th>
            <th className="text-left px-2">By</th><th className="text-left px-2">Note</th><th /></tr></thead>
          <tbody>
            {jobMoves.map(m=><tr key={m.id} className="border-t border-slate-100">
              <td className="px-3 py-1.5 mono whitespace-nowrap">{m.moved_on}</td>
              <td className="px-2">{m.name}</td>
              <td className={`px-2 text-right mono ${m.type==="return"?"text-emerald-700":""}`}>
                {m.type==="return"?"− ":""}{fmt(m.qty)} {m.uom}</td>
              <td className="px-2 whitespace-nowrap">{m.type==="return"?"Returned":m.basis==="job_order"?"With the job order":"On demand"}</td>
              <td className="px-2">{m.moved_by||"—"}</td>
              <td className="px-2 text-slate-500">{m.note||""}</td>
              <td className="px-3 text-right whitespace-nowrap">
                {canWrite && (confirmUndo===m.id
                  ? <>
                      <button onClick={()=>undo(m.id)} disabled={busy}
                        className="font-semibold text-rose-700 hover:underline disabled:opacity-40">Yes, undo</button>
                      <button onClick={()=>setConfirmUndo(null)} className="ml-2 text-slate-600 hover:underline">Keep</button>
                    </>
                  : <button onClick={()=>setConfirmUndo(m.id)} disabled={busy}
                      title="For an entry keyed by mistake. The quantity goes back where it was."
                      className="text-slate-600 hover:underline disabled:opacity-40">Undo</button>)}
              </td>
            </tr>)}
            {!jobMoves.length && <tr><td colSpan={7} className="px-3 py-3 text-slate-500">Nothing has been logged against this card.</td></tr>}
          </tbody>
        </table>
      </div>
    </>}
  </div>;
}
