import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { existingArticleCode } from "../shared/bom-import.js";
import { packingArticleSourceFor } from "../shared/bridge.js";
import { parseReferenceWorkbook } from "../shared/reference-import.js";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import * as api from "./lib/client.js";

const MAX_WORKBOOK_BYTES=10*1024*1024,MAX_SHEETS=20,MAX_ROWS=25000;
function checkWorkbookFile(file){
  if(Number(file?.size)>MAX_WORKBOOK_BYTES) throw new Error("Workbook is larger than 10 MB. Remove embedded images or unused sheets and try again.");
}
function workbookSheets(wb){
  if(wb.SheetNames.length>MAX_SHEETS) throw new Error(`Workbook has more than ${MAX_SHEETS} sheets.`);
  let total=0;
  return wb.SheetNames.map(name=>{
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:null});
    total+=rows.length;if(total>MAX_ROWS) throw new Error(`Workbook has more than ${MAX_ROWS.toLocaleString()} rows.`);
    return {name,rows};
  });
}

function rateCount(bom){
  return Object.values(bom?.combos||{}).reduce((total,combo)=>total+
    Object.values(combo.rates||{}).reduce((n,stage)=>n+Object.keys(stage||{}).length,0),0);
}

/* One upload path for every article-master change. A workbook may contain BOM,
   packing and catalogue sheets together, or only the sheet being changed; it
   always goes through the same validation, preview and transactional save. */
export default function DataTab({ onChanged }){
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const [err,setErr]=useState("");
  const [masterPreview,setMasterPreview]=useState(null);
  const [masterConfirm,setMasterConfirm]=useState(false);
  const [removeConfirm,setRemoveConfirm]=useState(false);   // deleting loaded size ranges

  async function pickMaster(file){
    setErr("");setMsg("");setMasterPreview(null);setMasterConfirm(false);setRemoveConfirm(false);
    if(!file)return;
    try{
      checkWorkbookFile(file);
      const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});
      const sheets=workbookSheets(wb);
      const parsed=parseReferenceWorkbook(sheets,INPUTS);
      if(parsed.errors.length){setErr(parsed.errors.slice(0,50).join("\n"));return;}
      const replacements=parsed.boms.map(b=>existingArticleCode(INPUTS.articles,b.article)).filter(Boolean);
      setMasterPreview({...parsed,replacements,fileName:file.name||"Article master"});
    }catch(e){setErr("Could not read that master workbook: "+(e.message||e));}
  }

  function editMrp(article,combo,value){
    setMasterPreview(current=>({...current,mrp:{...current.mrp,
      [article]:{...(current.mrp[article]||{}),[combo]:value===""?null:Number(value)},
    }}));
  }

  async function commitMaster(){
    if(!masterPreview)return;
    if(masterPreview.replacements.length&&!masterConfirm){setErr("Confirm the existing BOM replacements before saving.");return;}
    if((masterPreview.removals||[]).length&&!removeConfirm){setErr("This file deletes size ranges that are loaded today. Confirm that, or add the missing ranges to the file.");return;}
    setBusy(true);setErr("");setMsg("");
    try{
      const {replacements,removals,fileName,...batch}=masterPreview;
      for(const [article,chart] of Object.entries(batch.mrp||{})){
        batch.mrp[article]=Object.fromEntries(Object.entries(chart).filter(([,value])=>value!=null&&value!==""));
        if(!Object.keys(batch.mrp[article]).length) delete batch.mrp[article];
      }
      const r=await api.uploadBom({batch,confirm_replace:replacements.length>0,
        confirm_remove_ranges:(removals||[]).length>0});
      await reloadReference();
      setMasterPreview(null);setMasterConfirm(false);setRemoveConfirm(false);
      setMsg(`Master workbook saved safely — ${r.articles.length} BOM article(s), ${r.packing_articles.length} combo packing article(s), ${(r.single_packing_articles||[]).length} single-size packing article(s), ${(r.mrp_articles||[]).length} MRP article(s) and ${r.catalogue_articles.length} catalogue article(s). A database revision was recorded.`);
      onChanged&&onChanged();
    }catch(e){setErr(String(e.message||e));}
    finally{setBusy(false);}
  }

  const masterArticles = masterPreview ? [...new Set([
    ...masterPreview.boms.map(b=>b.article),
    ...Object.keys(masterPreview.packing),
    ...Object.keys(masterPreview.packingSingles),
    ...Object.keys(masterPreview.mrp),
    ...Object.keys(masterPreview.catalogue),
  ])].sort() : [];

  const provisionalReference=masterPreview?(()=>{
    const ref={...INPUTS,articles:{...INPUTS.articles}};
    for(const bom of masterPreview.boms) ref.articles[bom.article]={
      ...(ref.articles[bom.article]||{}),sole_type:bom.soleType,
      combo_order:bom.combo_order,combos:bom.combos,
    };
    for(const article of new Set([
      ...Object.keys(masterPreview.packing||{}),...Object.keys(masterPreview.packingSingles||{}),
    ])) if(ref.articles[article]) ref.articles[article]={...ref.articles[article],packing_source:"SELF"};
    for(const [article,entry] of Object.entries(masterPreview.catalogue||{})){
      if(!ref.articles[article]) continue;
      ref.articles[article]={...ref.articles[article]};
      if(entry.sole_type) ref.articles[article].sole_type=entry.sole_type;
      if(Object.prototype.hasOwnProperty.call(entry,"packing_source")){
        if(entry.packing_source) ref.articles[article].packing_source=entry.packing_source;
        else if((masterPreview.packing||{})[article]||(masterPreview.packingSingles||{})[article])
          ref.articles[article].packing_source="SELF";
        else delete ref.articles[article].packing_source;
      }
    }
    return ref;
  })():INPUTS;

  return <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
    <div className="text-base font-semibold text-slate-800 mb-1">Article master upload</div>
    <p className="text-xs text-slate-500 mb-3">
      One workbook can update BOMs, sizes, packing rules, catalogue details and optional MRP. Uploading only previews
      the changes; nothing reaches the database until you confirm below.
    </p>
    <div className="flex gap-3 items-center flex-wrap mb-3">
      <a href="/Factory_OS_Reference_Upload_Template.xlsx" download
        className="text-xs font-semibold border border-slate-300 bg-white rounded-lg px-3 py-2">Download upload template</a>
      <label className="text-xs font-semibold bg-indigo-600 text-white rounded-lg px-3 py-2 cursor-pointer">
        Choose completed workbook
        <input type="file" accept=".xlsx,.xls" onChange={e=>pickMaster(e.target.files&&e.target.files[0])} className="sr-only" />
      </label>
    </div>
    {err && <div className="text-xs whitespace-pre-line rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-3">{err}</div>}
    {msg && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-3">{msg}</div>}
    {masterPreview&&<div className="border border-indigo-200 bg-indigo-50/30 rounded-xl p-4 mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><div className="text-sm font-semibold text-slate-800">Review changes before saving</div>
          <div className="text-xs text-slate-500 mt-0.5">{masterPreview.fileName} · {masterArticles.length} article{masterArticles.length===1?"":"s"}</div></div>
        <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">Workbook validated</div>
      </div>

      <div className="grid gap-3 mt-4" style={{gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))"}}>
        {masterArticles.map(article=>{
          const existing=existingArticleCode(INPUTS.articles,article);
          const current=existing&&INPUTS.articles[existing];
          const bom=masterPreview.boms.find(b=>b.article===article);
          const definition=bom||current||{};
          const ranges=definition.combo_order||Object.keys(definition.combos||{});
          const oldRanges=current?(current.combo_order||Object.keys(current.combos||{})):[];
          const added=bom?ranges.filter(c=>!oldRanges.includes(c)):[];
          const removed=bom?oldRanges.filter(c=>!ranges.includes(c)):[];
          const comboPacking=masterPreview.packing[article]||{};
          const singlePacking=masterPreview.packingSingles[article]||{};
          const catalogue=masterPreview.catalogue[article];
          const source=packingArticleSourceFor(provisionalReference,article);
          const mrpCombos=ranges.length?ranges:Object.keys(masterPreview.mrp[article]||{});
          return <div key={article} className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">{article}</div>
              <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${existing?"bg-amber-100 text-amber-900":"bg-emerald-100 text-emerald-900"}`}>
                {existing?"Existing article — update":"New article — add"}</span>
            </div>
            <div className="mt-2 space-y-1.5 text-xs text-slate-600">
              <div><b>BOM:</b> {bom?`${ranges.length} size ranges, ${rateCount(bom)} material rates`:"No BOM change"}</div>
              <div><b>Sizes:</b> {ranges.length?<span className="mono">{ranges.join(", ")}</span>:"None"}</div>
              {!!added.length&&<div className="text-emerald-700"><b>Add sizes:</b> {added.join(", ")}</div>}
              {!!removed.length&&<div className="text-rose-700"><b>Remove sizes:</b> {removed.join(", ")}</div>}
              <div><b>Packing:</b> {source!==article?`Link to ${source}`:
                Object.keys(comboPacking).length?Object.entries(comboPacking).map(([c,n])=>`${c}: ${n}`).join(" · "):
                Object.keys(singlePacking).length?`${Object.keys(singlePacking).length} individual-size rules`:"No packing change"}</div>
              <div><b>Catalogue:</b> {catalogue?[catalogue.description,catalogue.sole_type,
                catalogue.price!=null?`Default ₹${catalogue.price}`:null,catalogue.photo_file_name?`Photo: ${catalogue.photo_file_name}`:null]
                .filter(Boolean).join(" · ")||"Update details":"No catalogue change"}</div>
            </div>
            {!!mrpCombos.length&&<div className="border-t border-slate-100 mt-3 pt-2">
              <div className="text-xs font-semibold text-slate-700 mb-1">Optional MRP by size range</div>
              <div className="grid grid-cols-2 gap-1.5">{mrpCombos.map(combo=><label key={combo} className="text-[11px] text-slate-500">{combo}
                <input type="number" min={0} value={(masterPreview.mrp[article]||{})[combo]??""}
                  placeholder={(INPUTS.mrp?.[existing||article]||{})[combo]??"Leave unchanged"}
                  onChange={e=>editMrp(article,combo,e.target.value)}
                  className="block mt-0.5 w-full text-xs border border-slate-200 rounded px-1.5 py-1 mono" /></label>)}</div>
            </div>}
          </div>;
        })}
      </div>

      {!!masterPreview.warnings.length&&<div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3 whitespace-pre-line">
        <b>Workbook notes</b>{"\n"}{masterPreview.warnings.join("\n")}</div>}
      {!!masterPreview.replacements.length&&<label className="flex gap-2 items-start text-xs text-amber-900 mt-3">
        <input type="checkbox" checked={masterConfirm} onChange={e=>setMasterConfirm(e.target.checked)} />
        I approve replacing the complete BOM for: {masterPreview.replacements.join(", ")}.
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
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40">{busy?"Saving everything…":"Confirm and save to database"}</button>
        <button disabled={busy} onClick={()=>{setMasterPreview(null);setMasterConfirm(false);setRemoveConfirm(false);}}
          className="text-xs font-semibold px-4 py-2 rounded-lg border border-slate-300 bg-white">Cancel</button>
      </div>
    </div>}

    <ReferenceHistory onChanged={onChanged} />
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
