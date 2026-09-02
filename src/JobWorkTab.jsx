import React, { useEffect, useMemo, useState } from "react";
import * as api from "./lib/client.js";
import { REF as INPUTS } from "./lib/refdata.js";
import { selectableFor, TYPE_LABEL } from "../shared/fabricators.js";
import { validateIssue, summarise, withFabricators, slipFor,
         SAMPLE_STATUS, SAMPLE_LABEL } from "../shared/job-work.js";

/* Job work — assigning stitching to a line or an outside fabricator.
 *
 * ONE dropdown for "who is doing this", whether the answer is Line 2 or a
 * fabricator in the next town. That is the whole point of the client's design:
 * two lists would mean two screens and two ways to get the same question
 * wrong. What differs between them is only the slip that prints and whether
 * money is involved, and both follow from the fabricator's type.
 */

const fmt = n => n==null||isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");
const inr = n => "₹" + Number(n||0).toLocaleString("en-IN",{maximumFractionDigits:2});

const BLANK = { fabricator:"", article:"", qty:"", stage:"STITCHING", order_no:"", note:"" };

export default function JobWorkTab({ orders=[] }){
  const [fabricators, setFabricators] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [receiving, setReceiving] = useState(null);   // {id, qty, received}
  const [gotBack, setGotBack] = useState("");
  const [slipFor_, setSlip] = useState(null);         // a job opened as a printable slip

  async function reload(){
    try{
      const [f, j] = await Promise.all([api.listFabricators(), api.listJobWork()]);
      setFabricators(f); setJobs(j); setErr("");
    }catch(e){ setErr(e.message||String(e)); setFabricators([]); }
  }
  useEffect(()=>{ reload(); },[]);

  const articles = Object.keys(INPUTS.articles||{});
  const chosen = (fabricators||[]).find(f => f.name === form.fabricator) || null;
  /* Samples are kept out of bulk and bulk out of samples — the list offered
     depends on which kind of work this is. */
  const canTake = useMemo(()=>selectableFor(fabricators||[], chosen && chosen.type==="sample" ? "sample" : "bulk"),
                          [fabricators, chosen]);
  const everyone = (fabricators||[]).filter(f => f.active);
  const check = validateIssue(form, chosen);
  const bucket = useMemo(()=>withFabricators(jobs), [jobs]);
  const rows = useMemo(()=>jobs.map(j => summarise(j, (fabricators||[]).find(f=>f.name===j.fabricator))),
                       [jobs, fabricators]);
  const open = rows.filter(r => r.status !== "closed");
  const done = rows.filter(r => r.status === "closed");

  async function issue(){
    setBusy(true); setErr(""); setMsg("");
    try{
      const made = await api.issueJobWork({ ...form, qty:Number(form.qty)||0 });
      await reload();
      setForm(BLANK);
      setMsg(`${made.slip} raised for ${made.fabricator}: ${fmt(made.qty)} × ${made.article}.`);
      setSlip(made);
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  async function takeBack(close){
    setBusy(true); setErr("");
    try{
      const out = await api.receiveJobWork(receiving.id, Number(gotBack)||0, close);
      await reload();
      setReceiving(null); setGotBack("");
      setMsg(out.shortage > 0
        ? `${out.fabricator}: closed ${fmt(out.shortage)} short — that balance is recorded, not forgotten.`
        : `${out.fabricator}: ${fmt(out.received)} of ${fmt(out.qty)} back.`);
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  async function verdict(id, status){
    setBusy(true); setErr("");
    try{ await api.setSampleStatus(id, status); await reload(); setMsg(`Sample marked ${SAMPLE_LABEL[status]}.`); }
    catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  function printSlip(){
    const node = document.querySelector(".job-slip");
    if(!node) return;
    const w = window.open("","_blank","width=800,height=1000");
    if(!w){ setErr("Popup blocked — allow popups to print the slip."); return; }
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${slipFor_.slip}</title>`
      + `<style>*{box-sizing:border-box}body{margin:0;padding:14mm;font-family:Arial,Helvetica,sans-serif;color:#000}`
      + `table{width:100%;border-collapse:collapse}td,th{border:1px solid #000;padding:5px 7px;font-size:12px}`
      + `[data-noprint]{display:none!important}@page{size:A4 portrait;margin:12mm}</style></head>`
      + `<body>${node.outerHTML}<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`);
    w.document.close();
  }

  if(fabricators === null) return <div className="p-5 text-sm text-slate-500">Loading job work…</div>;

  if(!everyone.length) return <div className="p-5">
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
      <b>No fabricators or lines yet.</b> Work can only be assigned to somebody — add the internal
      lines and any outside job workers under <b>Setup → Fabricators &amp; lines</b> first.
    </div></div>;

  return <div className="p-4 md:p-5">
    {msg && <div role="status" className="mb-3 text-xs rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">{msg}</div>}
    {err && <div role="alert" className="mb-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">{err}</div>}

    {/* What is physically out, per the note's "with fabricator/line" bucket. */}
    {!!bucket.length && <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm mb-3">
      <div className="text-sm font-semibold text-slate-800 mb-2">Out with lines and fabricators</div>
      <div className="flex gap-4 flex-wrap">
        {bucket.map(b => <div key={b.fabricator} className="text-xs">
          <div className="font-semibold text-slate-800">{b.fabricator}</div>
          <div className="mono text-slate-600">{fmt(b.with_them)} out · {b.open_jobs} open</div>
          {b.shortage > 0 && <div className="text-rose-700 font-semibold">{fmt(b.shortage)} short</div>}
        </div>)}
      </div>
    </div>}

    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-4">
      <div className="text-sm font-semibold text-slate-800 mb-2">Assign work</div>
      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-xs text-slate-600">Send to
          <select value={form.fabricator} aria-label="Send to"
            onChange={e=>setForm(f=>({...f,fabricator:e.target.value}))}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm min-w-56">
            <option value="">— choose a line or fabricator —</option>
            {everyone.map(f => <option key={f.name} value={f.name}>
              {f.name} · {TYPE_LABEL[f.type]}</option>)}
          </select></label>

        <label className="text-xs text-slate-600">Article
          <select value={form.article} aria-label="Article"
            onChange={e=>setForm(f=>({...f,article:e.target.value}))}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
            <option value="">— choose —</option>
            {articles.map(a => <option key={a}>{a}</option>)}
          </select></label>

        <label className="text-xs text-slate-600">Production order
          <select value={form.order_no} aria-label="Production order"
            onChange={e=>setForm(f=>({...f,order_no:e.target.value}))}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
            <option value="">— none —</option>
            {orders.filter(o=>!form.article||o.article_code===form.article)
                   .map(o => <option key={o.order_no} value={o.order_no}>{o.order_no}</option>)}
          </select></label>

        <label className="text-xs text-slate-600">Quantity
          <input type="number" min="1" value={form.qty} aria-label="Quantity"
            onChange={e=>setForm(f=>({...f,qty:e.target.value}))}
            className="block mt-1 w-28 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm mono" /></label>

        <label className="text-xs text-slate-600 flex-1 min-w-40">Note
          <input value={form.note} aria-label="Note"
            onChange={e=>setForm(f=>({...f,note:e.target.value}))}
            className="block mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm" /></label>
      </div>

      {chosen && <div className="text-[11px] text-slate-600 mt-2">
        This will raise an <b>{slipFor(chosen)}</b>.{" "}
        {chosen.payable
          ? <>Payable at {inr(chosen.rate)}{chosen.type==="sample"?" flat":" per piece"}.</>
          : <>Internal line — nothing payable.</>}
        {chosen.tat_days ? ` Turnaround ${chosen.tat_days} day${chosen.tat_days===1?"":"s"}.` : ""}
      </div>}

      {!check.ok && (form.fabricator || form.qty) &&
        <div className="mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
          {check.problems.map((p,i)=><div key={i}>{p}</div>)}
        </div>}

      <button onClick={issue} disabled={busy || !check.ok}
        className="mt-3 text-xs font-semibold text-white rounded-lg px-3 py-2 bg-slate-800 disabled:opacity-40">
        {busy ? "Issuing…" : chosen ? `Raise the ${slipFor(chosen)}` : "Issue"}
      </button>
    </div>

    {slipFor_ && <JobSlip job={slipFor_} onPrint={printSlip} onClose={()=>setSlip(null)} />}

    <Register title={`Out now (${open.length})`} rows={open} empty="Nothing is out with anyone."
      onReceive={r=>{ setReceiving(r); setGotBack(String(r.outstanding)); }}
      onSlip={setSlip} onVerdict={verdict} busy={busy}
      receiving={receiving} gotBack={gotBack} setGotBack={setGotBack}
      onConfirm={takeBack} onCancel={()=>setReceiving(null)} />

    {!!done.length && <Register title={`Completed (${done.length})`} rows={done} onSlip={setSlip} closed />}
  </div>;
}

function Register({ title, rows, empty, onReceive, onSlip, onVerdict, busy,
                    receiving, gotBack, setGotBack, onConfirm, onCancel, closed }){
  return <div className="mb-4">
    <div className="text-xs font-semibold text-slate-700 mb-1">{title}</div>
    <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500"><tr>
          <th className="text-left px-3 py-2">Sent to</th>
          <th className="text-left px-2">Article</th>
          <th className="text-right px-2">Issued</th>
          <th className="text-right px-2">Back</th>
          <th className="text-right px-2">{closed?"Short":"Still out"}</th>
          <th className="text-right px-2">Amount</th>
          <th className="text-left px-2">Sample</th>
          <th></th>
        </tr></thead>
        <tbody>
          {rows.map(r => <React.Fragment key={r.id}>
            <tr className="border-t border-slate-100">
              <td className="px-3 py-1.5">
                <div className="font-medium text-slate-800">{r.fabricator}</div>
                <div className="text-[10.5px] text-slate-500 mono">{r.issued_on} · {r.slip}</div>
              </td>
              <td className="px-2">{r.article}{r.order_no && <span className="text-slate-400 mono"> · {r.order_no}</span>}</td>
              <td className="text-right px-2 mono">{fmt(r.issued)}</td>
              <td className="text-right px-2 mono">{fmt(r.received)}</td>
              <td className={`text-right px-2 mono ${closed&&r.shortage>0?"text-rose-700 font-semibold":""}`}>
                {fmt(closed ? r.shortage : r.outstanding)}</td>
              <td className="text-right px-2 mono">
                {r.payable ? inr(r.amount) : <span className="text-slate-400">—</span>}</td>
              <td className="px-2">
                {r.sample
                  ? <span className="font-semibold" style={{color:
                      r.sample_status==="approved"?"#047857":r.sample_status==="rejected"?"#be123c":"#92400e"}}>
                      {SAMPLE_LABEL[r.sample_status]||"—"}</span>
                  : <span className="text-slate-300">—</span>}
              </td>
              <td className="text-right px-3 whitespace-nowrap">
                <button onClick={()=>onSlip(r)} className="text-slate-600 hover:underline">Slip</button>
                {!closed && <button onClick={()=>onReceive(r)} disabled={busy}
                  className="ml-2 font-semibold text-indigo-700 hover:underline disabled:opacity-40">Receive</button>}
                {r.sample && !closed && <span className="ml-2">
                  {SAMPLE_STATUS.filter(s=>s!=="pending").map(sst =>
                    <button key={sst} onClick={()=>onVerdict(r.id, sst)} disabled={busy}
                      className="ml-1 text-[10.5px] text-slate-600 hover:underline">{SAMPLE_LABEL[sst]}</button>)}
                </span>}
              </td>
            </tr>
            {receiving && receiving.id === r.id && (
              <tr className="bg-indigo-50/50"><td colSpan={8} className="px-3 py-2">
                <div className="flex items-end gap-2 flex-wrap">
                  <label className="text-xs text-slate-700">How many came back
                    <input type="number" min="1" max={r.outstanding} value={gotBack}
                      aria-label={`Pieces back from ${r.fabricator}`}
                      onChange={e=>setGotBack(e.target.value)}
                      className="block mt-1 w-28 border border-slate-300 rounded px-2 py-1 bg-white mono" /></label>
                  <button onClick={()=>onConfirm(false)} disabled={busy}
                    className="text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-indigo-700 disabled:opacity-40">
                    Record</button>
                  {/* Closing accepts the balance as never coming back. Until
                      then it is still out, not short. */}
                  <button onClick={()=>onConfirm(true)} disabled={busy}
                    className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-rose-300 text-rose-800 bg-white disabled:opacity-40">
                    Record and close short</button>
                  <button onClick={onCancel}
                    className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white">Cancel</button>
                </div>
              </td></tr>)}
          </React.Fragment>)}
          {!rows.length && <tr><td colSpan={8} className="px-3 py-3 text-slate-500">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}

/* The document that goes out with the work. A Job Work Challan and an Internal
   Issue Slip are the same movement on different paper, so it is one component
   that prints its own title. */
function JobSlip({ job, onPrint, onClose }){
  return <div className="rounded-2xl border border-slate-300 bg-white p-3 shadow-sm mb-4">
    <div data-noprint className="flex items-center gap-2 mb-2">
      <div className="text-sm font-semibold text-slate-800">{job.slip}</div>
      <button onClick={onPrint} className="ml-auto text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-slate-800">
        Print / Save PDF</button>
      <button onClick={onClose} className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white">Close</button>
    </div>
    <div className="job-slip" style={{color:"#000",fontFamily:"Arial,Helvetica,sans-serif"}}>
      <div style={{textAlign:"center",marginBottom:8}}>
        <img src="/brand/rex-logo.jpg" alt="REX" style={{height:38,objectFit:"contain"}} />
      </div>
      <div style={{textAlign:"center",fontSize:15,fontWeight:700,marginBottom:10}}>{job.slip}</div>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <tbody>
          <tr><td style={C(1)}>Issued to</td><td style={C()}>{job.fabricator}</td>
              <td style={C(1)}>Slip No</td><td style={C()}>{job.id}</td></tr>
          <tr><td style={C(1)}>Date</td><td style={C()}>{job.issued_on}</td>
              <td style={C(1)}>Stage</td><td style={C()}>{job.stage}</td></tr>
          <tr><td style={C(1)}>Article</td><td style={C()}>{job.article}</td>
              <td style={C(1)}>Production order</td><td style={C()}>{job.order_no||"—"}</td></tr>
          <tr><td style={C(1)}>Quantity issued</td><td style={C()}><b>{fmt(job.qty)}</b></td>
              <td style={C(1)}>{job.payable?"Rate":"Payable"}</td>
              <td style={C()}>{job.payable?inr(job.rate):"No — internal line"}</td></tr>
          {job.note && <tr><td style={C(1)}>Note</td><td style={C()} colSpan={3}>{job.note}</td></tr>}
        </tbody>
      </table>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:34,fontSize:11}}>
        <div>Issued by ____________________</div>
        <div>Received by ____________________</div>
      </div>
    </div>
  </div>;
}
const C = (label) => ({ border:"1px solid #000", padding:"5px 7px", fontSize:12,
                        fontWeight: label?600:400, background: label?"#f8fafc":"#fff", width: label?"18%":"32%" });
