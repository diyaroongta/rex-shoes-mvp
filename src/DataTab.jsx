import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { existingArticleCode } from "../shared/bom-import.js";
import { packingArticleSourceFor, pairsPerCarton } from "../shared/bridge.js";
import { parseReferenceWorkbook, COLUMN_LABELS, COLUMN_HELP, SHEET_COLUMNS,
  IGNORE_COLUMN, NOTE_COLUMN } from "../shared/reference-import.js";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import { families } from "../shared/product-codes.js";
import * as api from "./lib/client.js";

const MAX_WORKBOOK_BYTES=10*1024*1024,MAX_SHEETS=20,MAX_ROWS=25000;
function checkWorkbookFile(file){
  if(Number(file?.size)>MAX_WORKBOOK_BYTES) throw new Error("Workbook is larger than 10 MB. Remove embedded images or unused sheets and try again.");
}
function workbookSheets(wb){
  if(wb.SheetNames.length>MAX_SHEETS) throw new Error(`Workbook has more than ${MAX_SHEETS} sheets.`);
  let total=0;
  return wb.SheetNames.map(name=>{
    const sheet=wb.Sheets[name];
    const unresolved=Object.entries(sheet).filter(([address,cell])=>address[0]!=="!"&&cell?.f&&(cell.v==null||cell.v===""));
    if(unresolved.length) throw new Error(`${name}: ${unresolved.length} formula cell${unresolved.length===1?" has":"s have"} no saved result. Open the workbook in Excel, recalculate and save it, or paste those values before uploading.`);
    const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null});
    total+=rows.length;if(total>MAX_ROWS) throw new Error(`Workbook has more than ${MAX_ROWS.toLocaleString()} rows.`);
    return {name,rows};
  });
}

function flatBom(definition){
  const rows=new Map();
  for(const combo of definition?.combo_order||Object.keys(definition?.combos||{})){
    for(const [stage,materials] of Object.entries(definition?.combos?.[combo]?.rates||{})){
      for(const [material,rate] of Object.entries(materials||{})){
        const id=JSON.stringify([combo,stage,material]);
        rows.set(id,{id,combo,stage,material,rate:Number(rate)});
      }
    }
  }
  return rows;
}

function bomReview(current,incoming,mode){
  const before=flatBom(current), uploaded=flatBom(incoming);
  const added=[],changed=[],unchanged=[],removed=[];
  for(const row of uploaded.values()){
    const old=before.get(row.id);
    if(!old) added.push(row);
    else if(Number(old.rate)!==Number(row.rate)) changed.push({...row,oldRate:old.rate});
    else unchanged.push(row);
  }
  if(mode==="replace") for(const row of before.values()) if(!uploaded.has(row.id)) removed.push(row);
  const currentRanges=current?.combo_order||Object.keys(current?.combos||{});
  const uploadedRanges=incoming?.combo_order||Object.keys(incoming?.combos||{});
  const resultRanges=mode==="merge"?[...new Set([...currentRanges,...uploadedRanges])]:uploadedRanges;
  const resultRates=mode==="merge"?before.size+added.length:uploaded.size;
  return {before,uploaded,added,changed,unchanged,removed,currentRanges,uploadedRanges,resultRanges,resultRates};
}

const changeLabel=row=>`${row.combo} · ${row.stage} · ${row.material}`;
const sameColourText=(a,b)=>String(a||"").trim().toUpperCase()===String(b||"").trim().toUpperCase();
const current_colours=article=>({sole:(article||{}).sole_colour||"",upper:(article||{}).upper_colour||""});

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
  const [mappingConfirm,setMappingConfirm]=useState(false);
  const [bomMode,setBomMode]=useState("merge");
  // Kept so a column decision can re-read the same file without re-picking it.
  const [sheets,setSheets]=useState(null);

  async function pickMaster(file){
    setErr("");setMsg("");setMasterPreview(null);setMasterConfirm(false);setRemoveConfirm(false);
    setMappingConfirm(false);setBomMode("merge");setSheets(null);
    if(!file)return;
    try{
      checkWorkbookFile(file);
      const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});
      const read=workbookSheets(wb);
      setSheets(read);
      showParse(parseReferenceWorkbook(read,INPUTS),file.name||"Article master");
    }catch(e){setErr("Could not read that master workbook: "+(e.message||e));}
  }

  /* Errors do not hide the preview when the file has columns still to be
     explained: reading a column the wrong way is itself a common cause of the
     errors, so the user must be able to correct the mapping and see them go. */
  function showParse(parsed,fileName){
    if(parsed.errors.length&&!(parsed.columns||[]).length){setErr(parsed.errors.slice(0,50).join("\n"));setMasterPreview(null);return;}
    setErr("");   // the preview lists the rows itself; one copy, next to the fix
    const replacements=parsed.boms.map(b=>existingArticleCode(INPUTS.articles,b.article)).filter(Boolean);
    setMasterPreview({...parsed,replacements,fileName});
  }

  /* The user says what one of their own columns means. The file is read again
     with that decision, so the preview below is the real outcome. */
  function chooseColumn(column,value){
    if(!sheets)return;
    // Only decisions the user actually made carry over; a suggestion the
    // importer is still asking about must not become an answer.
    const columnMap={};
    for(const c of masterPreview?.columns||[]) if(c.choice) columnMap[`${c.sheet}::${c.key}`]=c.choice;
    columnMap[`${column.sheet}::${column.key}`]=value;
    showParse(parseReferenceWorkbook(sheets,INPUTS,{columnMap}),masterPreview?.fileName);
  }

  function editMrp(article,combo,value){
    setMasterPreview(current=>({...current,mrp:{...current.mrp,
      [article]:{...(current.mrp[article]||{}),[combo]:value===""?null:Number(value)},
    }}));
  }

  async function commitMaster(){
    if(!masterPreview)return;
    if(masterPreview.errors.length){setErr("Fix the rows listed above before saving.");return;}
    if(undecidedColumns.length){
      setErr(`Say what ${undecidedColumns.map(c=>`"${c.header}"`).join(", ")} means before saving.`);return;
    }
    const mappingWarnings=masterPreview.warnings.filter(w=>/treated .+ as /i.test(w));
    if(mappingWarnings.length&&!mappingConfirm){setErr("Confirm the article-name mappings before saving.");return;}
    if(bomMode==="replace"&&masterPreview.replacements.length&&!masterConfirm){setErr("Confirm the existing BOM replacements before saving.");return;}
    if(bomMode==="replace"&&(masterPreview.removals||[]).length&&!removeConfirm){setErr("This file deletes size ranges that are loaded today. Confirm that, or add the missing ranges to the file.");return;}
    setBusy(true);setErr("");setMsg("");
    try{
      const {replacements,removals,fileName,columns,columnMap,errors,...batch}=masterPreview;
      for(const [article,chart] of Object.entries(batch.mrp||{})){
        batch.mrp[article]=Object.fromEntries(Object.entries(chart).filter(([,value])=>value!=null&&value!==""));
        if(!Object.keys(batch.mrp[article]).length) delete batch.mrp[article];
      }
      const r=await api.uploadBom({batch,bom_mode:bomMode,
        confirm_replace:bomMode==="replace"&&replacements.length>0,
        confirm_remove_ranges:bomMode==="replace"&&(removals||[]).length>0});
      await reloadReference();
      setMasterPreview(null);setMasterConfirm(false);setRemoveConfirm(false);setMappingConfirm(false);
      setMsg(`Master workbook saved safely in ${bomMode==="merge"?"update-only":"complete-replacement"} mode — ${r.articles.length} BOM article(s), ${r.packing_articles.length} combo packing article(s), ${(r.single_packing_articles||[]).length} single-size packing article(s), ${(r.mrp_articles||[]).length} MRP article(s) and ${r.catalogue_articles.length} catalogue article(s). A database revision was recorded.`);
      onChanged&&onChanged();
    }catch(e){setErr(String(e.message||e));}
    finally{setBusy(false);}
  }

  const undecidedColumns=(masterPreview?.columns||[]).filter(c=>!c.choice);
  const masterArticles = masterPreview ? [...new Set([
    ...masterPreview.boms.map(b=>b.article),
    ...Object.keys(masterPreview.packing),
    ...Object.keys(masterPreview.packingSingles),
    ...Object.keys(masterPreview.mrp),
    ...Object.keys(masterPreview.individualSizes||{}),
    ...Object.keys(masterPreview.catalogue),
  ])].sort() : [];

  const provisionalReference=masterPreview?(()=>{
    const ref={...INPUTS,articles:{...INPUTS.articles}};
    for(const bom of masterPreview.boms) ref.articles[bom.article]={
      ...(ref.articles[bom.article]||{}),sole_type:bom.soleType,
      combo_order:bom.combo_order,combos:bom.combos,
      ...(bom.soleColour?{sole_colour:bom.soleColour}:{}),
      ...(bom.upperColour?{upper_colour:bom.upperColour}:{}),
    };
    for(const [article,sizes] of Object.entries(masterPreview.individualSizes||{})) if(ref.articles[article])
      ref.articles[article]={...ref.articles[article],individual_sizes:[...new Set([
        ...(ref.articles[article].individual_sizes||[]),...(sizes||[]),
      ])]};
    for(const article of new Set([
      ...Object.keys(masterPreview.packing||{}),...Object.keys(masterPreview.packingSingles||{}),
    ])) if(ref.articles[article]) ref.articles[article]={...ref.articles[article],packing_source:"SELF"};
    for(const [article,entry] of Object.entries(masterPreview.catalogue||{})){
      if(!ref.articles[article]) continue;
      ref.articles[article]={...ref.articles[article]};
      if(entry.sole_type) ref.articles[article].sole_type=entry.sole_type;
      if(entry.sole_colour) ref.articles[article].sole_colour=entry.sole_colour;
      if(entry.upper_colour) ref.articles[article].upper_colour=entry.upper_colour;
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

      {!!masterPreview.replacements.length&&<details className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
        <summary className="text-xs font-semibold text-slate-700 cursor-pointer">Advanced: replace a complete existing BOM</summary>
        <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5 mt-2 mb-2">
          Safe update is selected. Existing database rows not included in this workbook will be kept.
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={`rounded-lg border p-3 cursor-pointer ${bomMode==="merge"?"border-emerald-400 bg-emerald-50":"border-slate-200"}`}>
            <div className="flex gap-2 items-start"><input type="radio" name="bom-mode" value="merge" checked={bomMode==="merge"}
              onChange={()=>{setBomMode("merge");setMasterConfirm(false);setRemoveConfirm(false);}} />
              <div><div className="text-xs font-semibold text-slate-900">Update only rows in this file</div>
                <div className="text-[11px] text-slate-600 mt-0.5">Adds new rows and updates matching rates. Existing rows omitted from Excel stay in the database.</div></div></div>
          </label>
          <label className={`rounded-lg border p-3 cursor-pointer ${bomMode==="replace"?"border-rose-400 bg-rose-50":"border-slate-200"}`}>
            <div className="flex gap-2 items-start"><input type="radio" name="bom-mode" value="replace" checked={bomMode==="replace"}
              onChange={()=>setBomMode("replace")} />
              <div><div className="text-xs font-semibold text-slate-900">Replace the complete BOM</div>
                <div className="text-[11px] text-slate-600 mt-0.5">The uploaded BOM becomes the whole BOM. Existing rows not in Excel are deleted after confirmation.</div></div></div>
          </label>
        </div>
      </details>}

      {/* Columns the factory added to their own copy of the template. Nothing
          in this file is imported from a guessed column: the importer says what
          it would do with each one and waits for a yes. */}
      {!!(masterPreview.columns||[]).length&&<div className={`mt-4 rounded-xl border px-3 py-3 ${undecidedColumns.length?"border-amber-300 bg-amber-50":"border-emerald-300 bg-emerald-50"}`}>
        <div className="text-xs font-semibold text-slate-900">
          {undecidedColumns.length
            ? `This file has ${undecidedColumns.length} column${undecidedColumns.length===1?"":"s"} we are not sure about — tell us what ${undecidedColumns.length===1?"it means":"they mean"}`
            : "Extra columns confirmed"}
        </div>
        <div className="text-[11px] text-slate-600 mt-0.5">
          Pick the field each one belongs to, keep it as a note, or leave it out. Nothing saves until each is answered.
        </div>
        <div className="grid gap-2 mt-2" style={{gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))"}}>
          {(masterPreview.columns||[]).map(column=>{
            const chosen=column.choice||"";
            const target=column.choice||column.applied;
            return <div key={`${column.sheet}::${column.key}`} className="rounded-lg bg-white border border-slate-200 p-2.5">
              <div className="text-xs font-semibold text-slate-900">
                {column.sheet} sheet · <span className="mono">{column.header}</span>
              </div>
              {!!column.samples.length&&<div className="text-[11px] text-slate-500 mt-0.5">
                Values in the file: {column.samples.join(", ")}
              </div>}
              <label className="block text-[11px] text-slate-600 mt-1.5">This column is
                <select value={chosen} onChange={e=>chooseColumn(column,e.target.value)}
                  className="block mt-0.5 w-full text-xs border border-slate-300 rounded px-1.5 py-1 bg-white">
                  <option value="">{column.suggestionLabel?`Choose — we would read it as ${column.suggestionLabel}`:"Choose what this column means"}</option>
                  {(SHEET_COLUMNS[column.sheet]||[]).map(field=>
                    <option key={field} value={field}>{COLUMN_LABELS[field]}</option>)}
                  <option value={NOTE_COLUMN}>Something new — keep it as a note</option>
                  <option value={IGNORE_COLUMN}>Not needed — leave it out</option>
                </select></label>
              <div className="text-[11px] text-slate-500 mt-1">
                {target===NOTE_COLUMN?"Recorded against the article or material and shown in Factory OS. No calculation uses it."
                  :target===IGNORE_COLUMN?"Not imported."
                  :COLUMN_HELP[target]||`Read as ${COLUMN_LABELS[target]||target}.`}
              </div>
            </div>;
          })}
        </div>
      </div>}

      {!!masterPreview.errors.length&&<div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5">
        <div className="text-xs font-semibold text-rose-900 mb-1">
          {masterPreview.errors.length} row{masterPreview.errors.length===1?"":"s"} cannot be read — nothing will save until they are fixed
        </div>
        <div className="text-[11px] text-rose-800 max-h-40 overflow-auto">
          {masterPreview.errors.slice(0,50).map((e,i)=><div key={i}>• {e}</div>)}
        </div>
      </div>}

      <div className="grid gap-3 mt-4" style={{gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))"}}>
        {masterArticles.map(article=>{
          const existing=existingArticleCode(INPUTS.articles,article);
          const current=existing&&INPUTS.articles[existing];
          const bom=masterPreview.boms.find(b=>b.article===article);
          const definition=bom||current||{};
          const ranges=definition.combo_order||Object.keys(definition.combos||{});
          const oldRanges=current?(current.combo_order||Object.keys(current.combos||{})):[];
          const review=bom?bomReview(current,bom,bomMode):null;
          const comboPacking=masterPreview.packing[article]||{};
          const singlePacking=masterPreview.packingSingles[article]||{};
          const catalogue=masterPreview.catalogue[article];
          const source=packingArticleSourceFor(provisionalReference,article);
          const mrpCombos=[...new Set([...ranges,...Object.keys(masterPreview.mrp[article]||{})])];
          const packingRanges=[...new Set([...oldRanges,...ranges,...Object.keys(comboPacking)])];
          return <div key={article} className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">{article}</div>
              <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${existing?"bg-amber-100 text-amber-900":"bg-emerald-100 text-emerald-900"}`}>
                {existing?"Will update":"Will add"}</span>
            </div>
            <div className="mt-2 text-xs text-slate-700 leading-relaxed">
              {review
                ? existing
                  ? <><b>{review.changed.length}</b> BOM rate{review.changed.length===1?"":"s"} will change{review.added.length?`, ${review.added.length} will be added`:""}. <b>No database rows will be deleted.</b></>
                  : <>New article with <b>{review.uploadedRanges.length}</b> size range{review.uploadedRanges.length===1?"":"s"} and <b>{review.uploaded.size}</b> BOM rate{review.uploaded.size===1?"":"s"}.</>
                : <>No BOM change.</>}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {Object.keys(comboPacking).length||Object.keys(singlePacking).length
                ? `Packing: ${Object.keys(comboPacking).length} range rule(s) + ${Object.keys(singlePacking).length} individual-size rule(s).`
                : source!==article?`Packing: uses ${source}.`:"No packing change."}
              {catalogue?` Catalogue: ${catalogue.sole_type||catalogue.description||"details updated"}.`:""}
            </div>
            {/* Optional standard colours. Say what they will do, because they
                change new orders rather than anything in the plan. */}
            {(()=>{
              const sole=bom?.soleColour||catalogue?.sole_colour||"";
              const upper=bom?.upperColour||catalogue?.upper_colour||"";
              if(!sole&&!upper) return null;
              const onFile=current_colours(current);
              const parts=[sole&&`sole ${sole}`,upper&&`upper ${upper}`].filter(Boolean);
              const changed=(sole&&!sameColourText(sole,onFile.sole))||(upper&&!sameColourText(upper,onFile.upper));
              return <div className="mt-1 text-[11px] text-slate-500">
                Standard colours: {parts.join(", ")}{changed&&(onFile.sole||onFile.upper)
                  ?` (replacing ${[onFile.sole&&`sole ${onFile.sole}`,onFile.upper&&`upper ${onFile.upper}`].filter(Boolean).join(", ")})`:""}.
                {" "}Used to prefill new orders; existing orders are untouched.
              </div>;
            })()}

            <details className="mt-3 border-t border-slate-100 pt-2">
              <summary className="text-xs font-semibold text-indigo-700 cursor-pointer">Review details</summary>
              <div className="mt-2">
            {review?<>
              <div className="grid grid-cols-3 gap-1.5 mt-3 text-center">
                <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] text-slate-500">Current BOM</div><div className="text-xs font-semibold">{review.currentRanges.length} ranges · {review.before.size} rates</div></div>
                <div className="rounded-lg bg-indigo-50 p-2"><div className="text-[10px] text-slate-500">Uploaded BOM</div><div className="text-xs font-semibold">{review.uploadedRanges.length} ranges · {review.uploaded.size} rates</div></div>
                <div className={`rounded-lg p-2 ${review.removed.length?"bg-rose-50":"bg-emerald-50"}`}><div className="text-[10px] text-slate-500">Result after save</div><div className="text-xs font-semibold">{review.resultRanges.length} ranges · {review.resultRates} rates</div></div>
              </div>
              <div className="flex gap-1.5 flex-wrap mt-2 text-[10px] font-semibold">
                <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">{review.added.length} added</span>
                <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">{review.changed.length} changed</span>
                <span className="rounded-full bg-rose-100 text-rose-800 px-2 py-0.5">{review.removed.length} removed</span>
                <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{review.unchanged.length} unchanged</span>
              </div>
              <details className="mt-2 border-t border-slate-100 pt-2">
                <summary className="text-xs font-semibold text-indigo-700 cursor-pointer">Show exact BOM changes</summary>
                <div className="mt-2 max-h-56 overflow-auto text-[11px] space-y-1">
                  {review.added.map(row=><div key={`a${row.id}`} className="text-emerald-800">+ {changeLabel(row)} = {row.rate}/pair</div>)}
                  {review.changed.map(row=><div key={`c${row.id}`} className="text-amber-800">~ {changeLabel(row)}: {row.oldRate} → {row.rate}/pair</div>)}
                  {review.removed.map(row=><div key={`r${row.id}`} className="text-rose-800">− {changeLabel(row)} ({row.rate}/pair)</div>)}
                  {!review.added.length&&!review.changed.length&&!review.removed.length&&<div className="text-slate-500">No BOM values change.</div>}
                </div>
              </details>
              <details className="mt-2">
                <summary className="text-xs font-semibold text-indigo-700 cursor-pointer">Preview full imported BOM ({review.uploaded.size} rates)</summary>
                <div className="overflow-auto max-h-64 mt-2 border border-slate-200 rounded-lg"><table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-50"><tr><th className="text-left px-2 py-1">Range</th><th className="text-left">Stage</th><th className="text-left">Material</th><th className="text-right px-2">Rate/pair</th></tr></thead>
                  <tbody>{[...review.uploaded.values()].map(row=><tr key={row.id} className="border-t border-slate-100"><td className="px-2 py-1 mono">{row.combo}</td><td>{row.stage}</td><td>{row.material}</td><td className="text-right px-2 mono">{row.rate}</td></tr>)}</tbody>
                </table></div>
              </details>
            </>:<div className="mt-2 text-xs text-slate-500">No BOM change</div>}

            <div className="border-t border-slate-100 mt-3 pt-2">
              <div className="text-xs font-semibold text-slate-700 mb-1">Packing changes</div>
              {source!==article&&!Object.keys(comboPacking).length?<div className="text-xs text-slate-600">Uses {source} packing list. No packing change in this file.</div>
              :<div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr className="text-slate-500"><th className="text-left">Range</th><th className="text-right">Current</th><th className="text-right">Uploaded</th><th className="text-right">Result</th></tr></thead>
                <tbody>{packingRanges.map(combo=>{const currentPpc=existing?pairsPerCarton(existing,combo):null;const uploaded=comboPacking[combo];return <tr key={combo} className="border-t border-slate-100"><td className="py-1 mono">{combo}</td><td className="text-right mono">{currentPpc??"—"}</td><td className="text-right mono">{uploaded??"—"}</td><td className="text-right mono font-semibold">{uploaded??currentPpc??"Not set"}</td></tr>;})}</tbody>
              </table></div>}
              {!!Object.keys(singlePacking).length&&<div className="text-[11px] text-slate-600 mt-1">Plus {Object.keys(singlePacking).length} uploaded individual-size packing rule(s).</div>}
            </div>

            <div className="border-t border-slate-100 mt-3 pt-2 text-xs text-slate-600">
              <b>Catalogue:</b> {catalogue?[catalogue.description,catalogue.sole_type,
                catalogue.price!=null?`Default ₹${catalogue.price}`:null,catalogue.photo_file_name?`Photo: ${catalogue.photo_file_name}`:null]
                .filter(Boolean).join(" · ")||"Update details":"No catalogue change"}
            </div>
            {!!mrpCombos.length&&<div className="border-t border-slate-100 mt-3 pt-2">
              <div className="text-xs font-semibold text-slate-700 mb-1">MRP values from workbook (optional)</div>
              <div className="grid grid-cols-2 gap-1.5">{mrpCombos.map(combo=><label key={combo} className="text-[11px] text-slate-500">{combo.replace("::"," · size ")}
                <input type="number" min={0} value={(masterPreview.mrp[article]||{})[combo]??""}
                  placeholder={(INPUTS.mrp?.[existing||article]||{})[combo]??"Leave unchanged"}
                  onChange={e=>editMrp(article,combo,e.target.value)}
                  className="block mt-0.5 w-full text-xs border border-slate-200 rounded px-1.5 py-1 mono" /></label>)}</div>
            </div>}
              </div>
            </details>
          </div>;
        })}
      </div>

      {!!masterPreview.warnings.filter(w=>!/treated .+ as /i.test(w)).length&&<details className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mt-3">
        <summary className="font-semibold cursor-pointer">View {masterPreview.warnings.filter(w=>!/treated .+ as /i.test(w)).length} automatic correction{masterPreview.warnings.filter(w=>!/treated .+ as /i.test(w)).length===1?"":"s"}</summary>
        <div className="mt-2">{masterPreview.warnings.filter(w=>!/treated .+ as /i.test(w)).map((warning,i)=><div key={i}>• {warning}</div>)}</div>
      </details>}
      {!!masterPreview.warnings.filter(w=>/treated .+ as /i.test(w)).length&&<div className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 mt-3">
        <div className="font-semibold mb-1">Article-name mapping requires review</div>
        {masterPreview.warnings.filter(w=>/treated .+ as /i.test(w)).map((warning,i)=><div key={i}>⚠ {warning}</div>)}
        <label className="flex gap-2 items-start mt-2">
          <input type="checkbox" checked={mappingConfirm} onChange={e=>setMappingConfirm(e.target.checked)} />
          I checked these mappings and confirm the workbook rows belong to the article shown.
        </label>
      </div>}
      {bomMode==="replace"&&!!masterPreview.replacements.length&&<label className="flex gap-2 items-start text-xs text-amber-900 mt-3">
        <input type="checkbox" checked={masterConfirm} onChange={e=>setMasterConfirm(e.target.checked)} />
        I approve replacing the complete BOM for {masterPreview.replacements.join(", ")}. Existing BOM rows not present in this file will be deleted.
      </label>}

      {/* A BOM upload replaces an article's ranges outright. Saying "replaces
          the BOM" is not the same as showing WHICH ranges disappear, and a file
          sent to fix one rate is exactly the file that omits the rest. */}
      {bomMode==="replace"&&!!(masterPreview.removals||[]).length&&<div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2.5">
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
          Any order already placed on those ranges keeps its machine time but loses its material. If you only intend
          to correct or add rows, switch to <b>Update only rows in this file</b> above.
        </div>
        <label className="flex gap-2 items-start text-xs text-rose-900 mt-2">
          <input type="checkbox" checked={removeConfirm} onChange={e=>setRemoveConfirm(e.target.checked)} />
          I mean to delete those size ranges.
        </label>
      </div>}

      <div className="flex gap-2 mt-3">
        <button disabled={busy
                          ||!!masterPreview.errors.length
                          ||!!undecidedColumns.length
                          ||(masterPreview.warnings.some(w=>/treated .+ as /i.test(w))&&!mappingConfirm)
                          ||(bomMode==="replace"&&masterPreview.replacements.length&&!masterConfirm)
                          ||(bomMode==="replace"&&(masterPreview.removals||[]).length&&!removeConfirm)} onClick={commitMaster}
          className={`text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40 ${bomMode==="replace"?"bg-rose-700":"bg-indigo-600"}`}>
          {busy?"Saving everything…":bomMode==="replace"&&masterPreview.replacements.length
            ?`Replace ${masterPreview.replacements.join(", ")} BOM and save`
            :`Save ${masterArticles.length} article${masterArticles.length===1?"":"s"}`}</button>
        <button disabled={busy} onClick={()=>{setMasterPreview(null);setMasterConfirm(false);setRemoveConfirm(false);setMappingConfirm(false);}}
          className="text-xs font-semibold px-4 py-2 rounded-lg border border-slate-300 bg-white">Cancel</button>
      </div>
    </div>}

    <ProductCodes onChanged={onChanged} />
    <ReferenceHistory onChanged={onChanged} />
  </div>;
}

/* Product codes. Eighteen Jack articles are eighteen variants of one product,
   and the factory wants to say "JACK07" rather than read out a colour and a
   closure. The codes are ASSIGNED, not derived on the fly: once JACK07 is on a
   job card it has to keep meaning the same article, so running this again only
   fills in the articles that have none. */
function ProductCodes({ onChanged }){
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const [err,setErr]=useState("");
  const [open,setOpen]=useState(false);

  const articles=Object.keys(INPUTS.articles||{});
  const codes={};
  for(const a of articles) if(INPUTS.articles[a].product_code) codes[a]=INPUTS.articles[a].product_code;
  const uncoded=articles.filter(a=>!codes[a]);
  const grouped=families(articles,codes);
  const familyNames=Object.keys(grouped).sort();

  async function assign(){
    setBusy(true); setErr(""); setMsg("");
    try{
      const r=await api.assignProductCodes();
      await reloadReference();
      setMsg(r.newly_coded
        ? `${r.newly_coded} article${r.newly_coded===1?"":"s"} coded. Articles already carrying a code kept it.`
        : "Every article already has a code — nothing was changed.");
      if(r.conflicts&&r.conflicts.length) setErr(r.conflicts.join("\n"));
      setOpen(true);
      onChanged&&onChanged();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  if(!articles.length) return null;

  return <div className="border-t border-slate-200 pt-4 mt-5">
    <div className="text-sm font-semibold text-slate-700 mb-1">Product codes</div>
    <p className="text-xs text-slate-500 mb-3">
      One code family per product, numbered per variant — the eighteen Jacks read
      JACK01 to JACK18. A code is given once and then kept, so a code already printed
      on a job card or a PI never moves to a different article.
    </p>
    {err && <div className="text-xs whitespace-pre-line rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-2">{err}</div>}
    {msg && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-2">{msg}</div>}
    <div className="flex items-center gap-3 flex-wrap mb-3">
      <button disabled={busy||!uncoded.length} onClick={assign}
        className="text-xs font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">
        {busy?"Assigning…":uncoded.length?`Assign codes to ${uncoded.length} article${uncoded.length===1?"":"s"}`:"All articles are coded"}</button>
      <button onClick={()=>setOpen(o=>!o)} className="text-xs font-semibold text-indigo-700 hover:underline">
        {open?"Hide":`Show ${familyNames.length} famil${familyNames.length===1?"y":"ies"}`}</button>
    </div>
    {open && <div className="grid gap-2 sm:grid-cols-2">
      {familyNames.map(f=>(
        <div key={f} className="rounded-lg border border-slate-200 bg-white p-2.5">
          <div className="text-xs font-semibold text-slate-800">{f}
            <span className="text-slate-400 font-normal"> · {grouped[f].length}</span></div>
          <table className="w-full text-[11px] mt-1">
            <tbody>{grouped[f].map(({article,code})=>(
              <tr key={article} className="border-t border-slate-100">
                <td className="py-0.5 pr-2 font-mono font-semibold text-indigo-700 whitespace-nowrap">
                  {code||<span className="text-slate-300 font-sans font-normal">not coded</span>}</td>
                <td className="py-0.5 text-slate-600">{article}</td>
              </tr>))}
            </tbody>
          </table>
        </div>))}
    </div>}
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
