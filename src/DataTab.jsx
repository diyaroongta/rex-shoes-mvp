import React, { useState } from "react";
import * as XLSX from "xlsx";
import { parseBom } from "../shared/bom-import.js";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import * as api from "./lib/client.js";

const SOLES = ["EVA","PVC","PU","STUCK-ON"];
const fmt = n => (n==null||isNaN(n)) ? "0" : Number(n).toLocaleString("en-IN");

/* Upload a per-article BOM workbook. The sheet is parsed in the browser with
   the SAME shared parser the server validates against, so what you preview is
   exactly what gets stored. */
export default function DataTab({ onChanged }){
  const [preview,setPreview]=useState(null);
  const [sole,setSole]=useState("EVA");
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const [err,setErr]=useState("");

  async function pick(file){
    setErr(""); setMsg(""); setPreview(null);
    if(!file) return;
    try{
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
      const p=parseBom(rows,{soleRate:2,soleType:sole});
      if(p.error){ setErr(p.error); return; }
      setPreview(p);
    }catch(e){ setErr("Could not read that file: "+(e.message||e)); }
  }

  async function commit(){
    if(!preview) return;
    setBusy(true); setErr(""); setMsg("");
    try{
      const r=await api.uploadBom({ parsed:{...preview, soleType:sole} });
      await reloadReference();
      setMsg(`${r.article} ${r.replaced?"replaced":"added"} — ${r.combos} size ranges, ${r.rates} rates. `+
             (r.new_materials.length?`${r.new_materials.length} new materials at stock 0.`:"No new materials.")+
             ` Reference data now holds ${r.articles_total} articles and ${r.materials_total} materials.`);
      setPreview(null);
      onChanged && onChanged();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  const warn = preview ? preview.warnings.reduce((a,w)=>{ (a[w.type]=a[w.type]||[]).push(w); return a; },{}) : {};
  const rateCount = preview ? Object.values(preview.combos)
    .reduce((a,c)=>a+Object.values(c.rates).reduce((b,st)=>b+Object.keys(st).length,0),0) : 0;

  return <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
    <div className="text-sm font-semibold text-slate-700 mb-1">Upload a BOM workbook</div>
    <p className="text-xs text-slate-500 mb-4">
      One article per file, in the same layout your factory already uses — an ARTICLE row, a SIZE RANGE row
      per combo, then numbered component rows. The BURN column is read as the per-pair rate.
      Uploading here writes straight to the database: no code change, no redeploy.
    </p>

    <div className="flex gap-3 items-end flex-wrap mb-4">
      <label className="text-xs text-slate-600">Sole type for this article
        <select value={sole} onChange={e=>setSole(e.target.value)}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
          {SOLES.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
      <label className="text-xs text-slate-600">Workbook
        <input type="file" accept=".xlsx,.xls" onChange={e=>pick(e.target.files&&e.target.files[0])}
          className="block mt-1 text-sm" /></label>
    </div>

    {err && <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-3">{err}</div>}
    {msg && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-3">{msg}</div>}

    {preview && <div className="border border-indigo-200 bg-indigo-50/50 rounded-xl p-4 mb-4">
      <div className="text-sm font-semibold text-indigo-900 mb-2">
        {preview.article} — {preview.combo_order.length} size ranges, {rateCount} rates, {Object.keys(preview.materials).length} materials
      </div>
      <div className="text-xs text-slate-600 mb-2">Size ranges: <span className="mono">{preview.combo_order.join(", ")}</span></div>
      {INPUTS.articles[preview.article] &&
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mb-2">
          <b>{preview.article} already exists</b> and will be replaced by this upload.</div>}

      {!!warn["cm-converted"] && <div className="text-xs text-slate-600 mb-1">
        <b>{warn["cm-converted"].length} rows converted CM → MTR</b> so they merge with the materials already held in metres.</div>}
      {!!warn["unit-typo"] && <div className="text-xs text-slate-600 mb-1">
        <b>{warn["unit-typo"].length} unit typo fixed</b> ({warn["unit-typo"][0].detail}).</div>}
      {!!warn["no-rate"] && <details className="text-xs text-slate-600 mb-2">
        <summary className="cursor-pointer"><b>{warn["no-rate"].length} rows had no rate</b> — treated as not used in that size range</summary>
        <div className="mt-1 pl-3">
          {warn["no-rate"].map((w,i)=><div key={i} className="mono">{w.combo} · {w.component}</div>)}
        </div>
        <div className="mt-1 pl-3 text-slate-500">Check these are genuinely unused there. If they should have a quantity, fix the sheet and re-upload.</div>
      </details>}

      <div className="flex gap-2">
        <button disabled={busy} onClick={commit}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">
          {busy?"Saving…":`Load ${preview.article} into reference data`}</button>
        <button onClick={()=>setPreview(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Discard</button>
      </div>
    </div>}

    <StockEditor onChanged={onChanged} />
  </div>;
}

/* Materials sitting at zero stock make procurement show the FULL requirement
   rather than a shortfall — safe, but not the real picture. Surface them. */
function StockEditor({ onChanged }){
  const [edits,setEdits]=useState({});
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const zero=Object.entries(INPUTS.materials).filter(([,m])=>!m.stock);

  async function save(){
    const stock={};
    for(const [k,v] of Object.entries(edits)) if(v!=="" && v!=null) stock[k]=Number(v);
    if(!Object.keys(stock).length) return;
    setBusy(true);
    try{ await api.patchReference({stock}); await reloadReference();
         setMsg(`${Object.keys(stock).length} stock figures saved.`); setEdits({}); onChanged && onChanged(); }
    catch(e){ setMsg(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  if(!zero.length) return <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
    Every material has a stock figure — procurement is showing true shortfalls.</div>;

  return <div className="border-t border-slate-200 pt-4">
    <div className="text-sm font-semibold text-slate-700 mb-1">Stock still to fill ({zero.length})</div>
    <p className="text-xs text-slate-500 mb-3">
      These are at zero, so procurement lists their full requirement instead of the shortfall.
      That over-orders rather than under-orders, but it isn't the real picture.
    </p>
    <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
      <table className="w-full text-sm">
        <tbody>{zero.map(([k,m])=>(
          <tr key={k} className="border-b border-slate-100 last:border-0">
            <td className="py-1.5 px-2 mono text-xs text-slate-600">{m.name}</td>
            <td className="py-1.5 px-2 text-xs text-slate-400">{m.uom}</td>
            <td className="py-1.5 px-2 w-32">
              <input type="number" min={0} placeholder="0" value={edits[k]??""}
                onChange={e=>setEdits(s=>({...s,[k]:e.target.value}))}
                className="w-full text-sm border border-slate-300 rounded px-1.5 py-1 mono" /></td>
          </tr>))}</tbody>
      </table>
    </div>
    {msg && <div className="text-xs text-slate-600 mt-2">{msg}</div>}
    <button disabled={busy||!Object.keys(edits).length} onClick={save}
      className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
      {busy?"Saving…":"Save stock figures"}</button>
  </div>;
}
