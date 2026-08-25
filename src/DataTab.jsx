import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { parseBom } from "../shared/bom-import.js";
import { parseReferenceWorkbook } from "../shared/reference-import.js";
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
  const [confirmReplace,setConfirmReplace]=useState(false);
  const [masterPreview,setMasterPreview]=useState(null);
  const [masterConfirm,setMasterConfirm]=useState(false);
  const [removeConfirm,setRemoveConfirm]=useState(false);   // deleting loaded size ranges

  async function pick(file){
    setErr(""); setMsg(""); setPreview(null); setConfirmReplace(false);
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
    const replacing=!!INPUTS.articles[preview.article];
    if(replacing&&!confirmReplace){setErr(`Confirm that ${preview.article}'s existing BOM should be replaced.`);return;}
    setBusy(true); setErr(""); setMsg("");
    try{
      const r=await api.uploadBom({ parsed:{...preview, soleType:sole}, confirm_replace:replacing });
      await reloadReference();
      setMsg(`${r.article} ${r.replaced?"replaced":"added"} — ${r.combos} size ranges, ${r.rates} rates. `+
             (r.new_materials.length?`${r.new_materials.length} new materials at stock 0.`:"No new materials.")+
             ` Reference data now holds ${r.articles_total} articles and ${r.materials_total} materials.`);
      setPreview(null);
      onChanged && onChanged();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  async function pickMaster(file){
    setErr("");setMsg("");setMasterPreview(null);setMasterConfirm(false);setRemoveConfirm(false);
    if(!file)return;
    try{
      const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});
      const sheets=wb.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:null})}));
      const parsed=parseReferenceWorkbook(sheets,INPUTS);
      if(parsed.errors.length){setErr(parsed.errors.slice(0,8).join(" "));return;}
      const replacements=parsed.boms.map(b=>b.article).filter(a=>INPUTS.articles[a]);
      setMasterPreview({...parsed,replacements});
    }catch(e){setErr("Could not read that master workbook: "+(e.message||e));}
  }

  async function commitMaster(){
    if(!masterPreview)return;
    if(masterPreview.replacements.length&&!masterConfirm){setErr("Confirm the existing BOM replacements before saving.");return;}
    if((masterPreview.removals||[]).length&&!removeConfirm){setErr("This file deletes size ranges that are loaded today. Confirm that, or add the missing ranges to the file.");return;}
    setBusy(true);setErr("");setMsg("");
    try{
      const {replacements,removals,...batch}=masterPreview;
      const r=await api.uploadBom({batch,confirm_replace:replacements.length>0,
        confirm_remove_ranges:(removals||[]).length>0});
      await reloadReference();
      setMasterPreview(null);setMasterConfirm(false);setRemoveConfirm(false);
      setMsg(`Master workbook saved safely — ${r.articles.length} BOM article(s), ${r.packing_articles.length} combo packing article(s), ${(r.single_packing_articles||[]).length} single-size packing article(s), ${(r.mrp_articles||[]).length} MRP article(s) and ${r.catalogue_articles.length} catalogue article(s). A database revision was recorded.`);
      onChanged&&onChanged();
    }catch(e){setErr(String(e.message||e));}
    finally{setBusy(false);}
  }

  const warn = preview ? preview.warnings.reduce((a,w)=>{ (a[w.type]=a[w.type]||[]).push(w); return a; },{}) : {};
  const rateCount = preview ? Object.values(preview.combos)
    .reduce((a,c)=>a+Object.values(c.rates).reduce((b,st)=>b+Object.keys(st).length,0),0) : 0;
  const masterArticles = masterPreview ? [...new Set([
    ...masterPreview.boms.map(b=>b.article),
    ...Object.keys(masterPreview.packing),
    ...Object.keys(masterPreview.catalogue),
  ])].sort() : [];

  return <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
    <div className="text-sm font-semibold text-slate-700 mb-1">Upload the Factory OS article master</div>
    <p className="text-xs text-slate-500 mb-3">
      Use the standard workbook for BOM, packing and catalogue details. The complete file is validated first,
      then saved in one database transaction with a revision snapshot. Nothing is partly saved when a row is invalid.
    </p>
    <div className="flex gap-3 items-center flex-wrap mb-3">
      <a href="/Factory_OS_Reference_Upload_Template.xlsx" download
        className="text-xs font-semibold border border-slate-300 bg-white rounded-lg px-3 py-2">Download upload template</a>
      <input type="file" accept=".xlsx" onChange={e=>pickMaster(e.target.files&&e.target.files[0])} className="text-sm" />
    </div>
    {masterPreview&&<div className="border border-slate-200 bg-slate-50 rounded-xl p-4 mb-5">
      <div className="text-sm font-semibold text-slate-800">Ready to save</div>
      <div className="text-xs text-slate-600 mt-1">
        {masterPreview.boms.length} BOM article(s) · {Object.keys(masterPreview.packing).length} combo packing article(s) · {Object.keys(masterPreview.packingSingles).length} single-size packing article(s) · {Object.keys(masterPreview.mrp).length} MRP article(s) · {Object.keys(masterPreview.catalogue).length} catalogue article(s)
      </div>
      <div className="text-xs font-semibold text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mt-3">
        Articles read from this file: {masterArticles.join(", ")}
      </div>
      {masterArticles.length>1&&<div className="text-xs text-amber-800 mt-2">
        This workbook contains more than one Article Code. Confirm that every name above is intended before saving.
      </div>}
      {!!masterPreview.warnings.length&&<div className="text-xs text-amber-800 mt-2">{masterPreview.warnings.join(" ")}</div>}
      {!!masterPreview.replacements.length&&<label className="flex gap-2 items-start text-xs text-amber-900 mt-3">
        <input type="checkbox" checked={masterConfirm} onChange={e=>setMasterConfirm(e.target.checked)} />
        I understand this will replace the complete BOM for: {masterPreview.replacements.join(", ")}. Packing and catalogue rows are merged without deleting omitted values.
      </label>}

      {/* A BOM upload replaces an article's ranges outright. Saying "replaces
          the BOM" is not the same as showing WHICH ranges disappear, and a file
          sent to fix one rate is exactly the file that omits the rest. */}
      {!!(masterPreview.removals||[]).length&&<div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2.5">
        <div className="text-xs font-semibold text-rose-900 mb-1">
          This file is missing size ranges that are loaded today — saving it deletes them
        </div>
        {masterPreview.removals.map(rm=>(
          <div key={rm.article} className="text-xs text-rose-800">
            <b>{rm.article}</b> loses <b className="mono">{rm.ranges.join(", ")}</b>
            {rm.rates>0 && <> and {rm.rates} material rate{rm.rates===1?"":"s"}</>}
          </div>
        ))}
        <div className="text-xs text-rose-800 mt-1.5">
          Any order already placed on those ranges keeps its machine time but loses its material —
          it would order nothing and still occupy the line. To correct one rate, include <b>every</b>
          range for that article in the file, not only the one you are changing.
        </div>
        <label className="flex gap-2 items-start text-xs text-rose-900 mt-2">
          <input type="checkbox" checked={removeConfirm} onChange={e=>setRemoveConfirm(e.target.checked)} />
          I mean to delete those size ranges.
        </label>
      </div>}

      <div className="flex gap-2 mt-3">
        <button disabled={busy||(masterPreview.replacements.length&&!masterConfirm)
                          ||((masterPreview.removals||[]).length&&!removeConfirm)} onClick={commitMaster}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">{busy?"Saving…":"Validate and save all"}</button>
        <button disabled={busy} onClick={()=>{setMasterPreview(null);setMasterConfirm(false);setRemoveConfirm(false);}}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Discard</button>
      </div>
    </div>}

    <div className="border-t border-slate-200 pt-4">
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
      {INPUTS.articles[preview.article]&&<label className="flex gap-2 items-start text-xs text-amber-900 mb-3">
        <input type="checkbox" checked={confirmReplace} onChange={e=>setConfirmReplace(e.target.checked)} />
        I confirm that the existing {preview.article} BOM should be replaced. A revision snapshot will be kept.
      </label>}

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
        <button disabled={busy||(!!INPUTS.articles[preview.article]&&!confirmReplace)} onClick={commit}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">
          {busy?"Saving…":`Load ${preview.article} into reference data`}</button>
        <button onClick={()=>setPreview(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Discard</button>
      </div>
    </div>}
    </div>

    <MrpEditor onChanged={onChanged} />
    <StockEditor onChanged={onChanged} />
    <ReferenceHistory onChanged={onChanged} />
  </div>;
}

/* MRP per size range. The PI prints one row per size, and every size in a range
   shares that range's MRP — so this is the smallest thing that has to be filled
   in before an invoice can be issued. */
function MrpEditor({ onChanged }){
  const [article,setArticle]=useState("");
  const [edits,setEdits]=useState({});
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const arts=Object.keys(INPUTS.articles);
  const mrp=INPUTS.mrp||{};
  const chosen=article||arts[0]||"";
  const combos=chosen?(INPUTS.articles[chosen].combo_order||Object.keys(INPUTS.articles[chosen].combos||{})):[];
  const priced=arts.filter(a=>{
    const cs=INPUTS.articles[a].combo_order||[];
    return cs.length && cs.every(c=>(mrp[a]||{})[c]!=null);
  }).length;

  async function save(){
    const clean={};
    for(const [c,v] of Object.entries(edits)) if(v!==""&&v!=null) clean[c]=Number(v);
    if(!Object.keys(clean).length) return;
    setBusy(true);
    try{
      await api.patchReference({ mrp:{ [chosen]: clean } });
      await reloadReference();
      setMsg(`${Object.keys(clean).length} MRP figures saved for ${chosen}.`);
      setEdits({}); onChanged && onChanged();
    }catch(e){ setMsg(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  return <div className="border-t border-slate-200 pt-4 mb-5">
    <div className="text-sm font-semibold text-slate-700 mb-1">MRP by size range</div>
    <p className="text-xs text-slate-500 mb-3">
      The Proforma Invoice needs an MRP for every size range. Rate is MRP less the customer&rsquo;s
      discount. {priced} of {arts.length} articles are fully priced &mdash; an unpriced range prints
      as a dash and is left out of the invoice total rather than being guessed.
    </p>
    <select value={chosen} onChange={e=>{setArticle(e.target.value); setEdits({}); setMsg("");}}
      className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white mb-3">
      {arts.map(a=><option key={a} value={a}>{a}{(mrp[a]&&Object.keys(mrp[a]).length)?"":"  — not priced"}</option>)}
    </select>
    <div className="flex gap-2 flex-wrap">
      {combos.map(c=>(
        <label key={c} className="text-xs text-slate-600">
          <span className="mono font-semibold">{c}</span>
          <input type="number" min={0} placeholder={(mrp[chosen]||{})[c]??"—"}
            value={edits[c]??""} onChange={e=>setEdits(x=>({...x,[c]:e.target.value}))}
            className="block mt-0.5 w-24 text-sm border border-slate-300 rounded px-1.5 py-1 mono" /></label>))}
    </div>
    {msg && <div className="text-xs text-slate-600 mt-2">{msg}</div>}
    <button disabled={busy||!Object.keys(edits).length} onClick={save}
      className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
      {busy?"Saving…":"Save MRP"}</button>
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

/* Undo. Every reference change already writes a snapshot into
   reference_data_history; without a way to restore one those snapshots are
   just disk. A wrong BOM upload replaces an article's rates outright, so this
   is the difference between a bad file costing a minute and costing a day of
   retyping. */
function ReferenceHistory({ onChanged }){
  const [rows,setRows]=useState(null);
  const [busy,setBusy]=useState(0);
  const [msg,setMsg]=useState("");
  const [err,setErr]=useState("");
  const [confirming,setConfirming]=useState(null);

  const load=()=>api.referenceHistory().then(setRows).catch(e=>{setErr(e.message||String(e));setRows([]);});
  useEffect(()=>{ load(); },[]);

  async function restore(id){
    setBusy(id); setErr(""); setMsg("");
    try{
      const r=await api.restoreReference(id);
      await reloadReference();
      setMsg(`Rolled back to the state before that ${r.undid} change`
        +(r.article_code?` (${r.article_code})`:"")
        +`. Reference data now holds ${r.articles_total} articles and ${r.materials_total} materials.`);
      setConfirming(null); await load();
      onChanged && onChanged();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(0); }
  }

  if(!rows) return null;
  const when = iso => { const d=new Date(iso); return isNaN(d)?String(iso)
    :d.toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}); };

  return <div className="border-t border-slate-200 pt-4 mt-5">
    <div className="text-sm font-semibold text-slate-700 mb-1">Recent reference changes</div>
    <p className="text-xs text-slate-500 mb-3">
      Each row is the state <b>before</b> that change. Restoring one puts the whole reference document
      back to that point — the restore is itself recorded, so it can be undone too.
    </p>
    {err && <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-2">{err}</div>}
    {msg && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-2">{msg}</div>}
    {!rows.length
      ? <div className="text-xs text-slate-400">No changes recorded yet.</div>
      : <table className="w-full text-xs">
          <thead><tr className="text-slate-500"><th className="text-left py-1">When</th>
            <th className="text-left">Change</th><th className="text-left">Article</th><th></th></tr></thead>
          <tbody>{rows.map(r=>(
            <React.Fragment key={r.revision_id}>
              <tr className="border-t border-slate-100">
                <td className="py-1 mono">{when(r.created_at)}</td>
                <td>{r.change_type}</td>
                <td className="text-slate-600">{r.article_code||"—"}</td>
                <td className="text-right">
                  <button onClick={()=>{setConfirming(confirming===r.revision_id?null:r.revision_id);setMsg("");setErr("");}}
                    className="text-xs font-semibold text-indigo-700 hover:underline">
                    {confirming===r.revision_id?"Cancel":"Restore this point"}</button></td>
              </tr>
              {confirming===r.revision_id && <tr><td colSpan={4} className="pb-2">
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 flex items-center gap-3 flex-wrap">
                  <div className="text-xs text-amber-900">
                    Put the <b>entire</b> reference document — every article, BOM, packing chart, MRP and
                    stock figure — back to how it was before this {r.change_type} change on {when(r.created_at)}?
                    <span className="block mt-0.5">Anything saved since then is undone. Orders are not affected.</span>
                  </div>
                  <button disabled={busy===r.revision_id} onClick={()=>restore(r.revision_id)}
                    className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-700 text-white disabled:opacity-50">
                    {busy===r.revision_id?"Restoring…":"Restore"}</button>
                </div></td></tr>}
            </React.Fragment>))}
          </tbody>
        </table>}
  </div>;
}
