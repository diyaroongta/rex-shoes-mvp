import React, { useState, useEffect } from "react";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import { articlePhoto } from "../shared/catalogue-seed.js";
import { comboSizesForArticleIn } from "../shared/bridge.js";
import { mrpForSize } from "../shared/pi.js";
import * as api from "./lib/client.js";

const fmt = n => (n==null||isNaN(n)) ? "0" : Number(n).toLocaleString("en-IN");

/* Images are resized in the browser before upload — a phone photo is several
   megabytes and none of that detail survives a catalogue card. */
function shrink(file, maxDim=640, quality=0.8){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const scale=Math.min(1, maxDim/Math.max(img.width,img.height));
        const c=document.createElement("canvas");
        c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
        c.getContext("2d").drawImage(img,0,0,c.width,c.height);
        resolve(c.toDataURL("image/jpeg",quality));
      };
      img.onerror=()=>reject(new Error("That file isn't a readable image."));
      img.src=fr.result;
    };
    fr.onerror=()=>reject(new Error("Could not read that file."));
    fr.readAsDataURL(file);
  });
}

export default function CatalogueTab({onChanged,onAddBom}){
  const [cat,setCat]=useState({});
  const [busy,setBusy]=useState("");
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [version,setVersion]=useState(0);
  const [mrpEdits,setMrpEdits]=useState({});
  const [showAdd,setShowAdd]=useState(false);
  const [newEntry,setNewEntry]=useState({article_code:"",description:"",price:"",sole_type:"EVA"});
  const [missingBom,setMissingBom]=useState("");
  const [deleteCandidate,setDeleteCandidate]=useState("");
  const arts=Object.keys(INPUTS.articles);

  useEffect(()=>{ api.getCatalogue().then(setCat).catch(e=>setErr(e.message||String(e))); },[]);

  async function upload(code,file){
    if(!file) return;
    setBusy(code); setErr("");setMsg("");
    try{
      const image=await shrink(file);
      await api.putCatalogue({article_code:code,image});
      setCat(c=>({...c,[code]:{...(c[code]||{}),article_code:code,image}}));
      await reloadReference();
      if(onChanged) onChanged();
      setMsg(`${code}: photo saved.`);
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(""); }
  }
  async function saveField(code,patch){
    try{ setErr("");setMsg("");await api.putCatalogue({article_code:code,...patch});
         setCat(c=>({...c,[code]:{...(c[code]||{}),article_code:code,...patch}}));
         await reloadReference();
         if(onChanged) onChanged();
         setMsg(`${code}: catalogue details saved.`); }
    catch(e){ setErr(String(e.message||e)); }
  }
  async function saveReference(code,patch,label){
    setBusy(`${code}:reference`);setErr("");setMsg("");
    try{
      await api.patchReference(patch);
      await reloadReference();
      setVersion(v=>v+1);
      if(onChanged) onChanged();
      setMsg(`${code}: ${label} saved and applied to planning and new PIs.`);
      return true;
    }catch(e){setErr(String(e.message||e));return false;}
    finally{setBusy("");}
  }
  async function saveMrp(code){
    const edits=mrpEdits[code]||{};
    const clean={};
    for(const [combo,value] of Object.entries(edits)){
      const n=Number(value);
      if(!Number.isFinite(n)||n<0){setErr(`${code} ${combo}: MRP must be 0 or more.`);return;}
      clean[combo]=n;
    }
    if(!Object.keys(clean).length) return;
    if(await saveReference(code,{mrp:{[code]:clean}},"size-by-size MRPs"))
      setMrpEdits(all=>{const next={...all};delete next[code];return next;});
  }

  async function addCatalogueItem(e){
    e.preventDefault();setBusy("new");setErr("");setMsg("");setMissingBom("");
    try{
      const result=await api.putCatalogue({...newEntry,create_catalogue_only:true});
      await reloadReference();
      setCat(c=>({...c,[result.article_code]:{article_code:result.article_code,
        description:newEntry.description,price:newEntry.price===""?null:Number(newEntry.price)}}));
      setVersion(v=>v+1);setShowAdd(false);
      setNewEntry({article_code:"",description:"",price:"",sole_type:"EVA"});
      if(onChanged) onChanged();
      setMsg(`${result.article_code} was added to the catalogue.`);
      if(result.missing_bom) setMissingBom(result.article_code);
    }catch(e){setErr(String(e.message||e));}
    finally{setBusy("");}
  }

  async function deleteCatalogueItem(code,confirmBom=false){
    setBusy(`${code}:delete`);setErr("");setMsg("");
    try{
      await api.deleteCatalogue(code,confirmBom);
      await reloadReference();
      setCat(current=>{const next={...current};delete next[code];return next;});
      setDeleteCandidate("");
      if(missingBom===code) setMissingBom("");
      setVersion(v=>v+1);
      if(onChanged) onChanged();
      setMsg(`${code} was removed from the catalogue. The change can be restored from Data & BOM history.`);
    }catch(e){setErr(String(e.message||e));}
    finally{setBusy("");}
  }

  return <div>
    {err && <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-3">{err}</div>}
    {msg && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-3">{msg}</div>}
    {missingBom&&<div className="text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 mb-3 flex items-center gap-3 flex-wrap">
      <span><b>{missingBom} has catalogue details but no BOM or sizes.</b> It cannot be ordered or scheduled yet.</span>
      <button onClick={()=>onAddBom&&onAddBom(missingBom)} className="text-xs font-semibold bg-amber-700 text-white rounded-lg px-3 py-1.5">Add its BOM now</button>
    </div>}
    <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
      <p className="text-xs text-slate-500 max-w-2xl">
        Add or edit catalogue details here. An article added without a BOM stays clearly marked and cannot be ordered until its BOM is uploaded.
      </p>
      <button onClick={()=>setShowAdd(v=>!v)} className="text-xs font-semibold bg-indigo-600 text-white rounded-lg px-3 py-2">
        {showAdd?"Cancel":"Add new catalogue item"}</button>
    </div>
    {showAdd&&<form onSubmit={addCatalogueItem} className="bg-white border border-indigo-200 rounded-xl p-4 mb-4">
      <div className="text-sm font-semibold text-slate-800 mb-3">New catalogue item</div>
      <div className="grid gap-3" style={{gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))"}}>
        <label className="text-xs text-slate-600">Article code or name
          <input required value={newEntry.article_code} onChange={e=>setNewEntry(x=>({...x,article_code:e.target.value}))}
            className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5" /></label>
        <label className="text-xs text-slate-600">Description
          <input value={newEntry.description} onChange={e=>setNewEntry(x=>({...x,description:e.target.value}))}
            className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5" /></label>
        <label className="text-xs text-slate-600">Optional default price
          <input type="number" min={0} value={newEntry.price} onChange={e=>setNewEntry(x=>({...x,price:e.target.value}))}
            className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5" /></label>
        <label className="text-xs text-slate-600">Sole process
          <select value={newEntry.sole_type} onChange={e=>setNewEntry(x=>({...x,sole_type:e.target.value}))}
            className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            <option value="EVA">EVA</option><option value="PVC">PVC</option><option value="PU">PU</option><option value="STUCK-ON">Stuck-on</option>
          </select></label>
      </div>
      <div className="text-xs text-amber-800 mt-3">This creates only the catalogue item. Factory OS will ask for its BOM before it can be used in an order.</div>
      <button disabled={busy==="new"} type="submit" className="mt-3 text-xs font-semibold bg-indigo-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">
        {busy==="new"?"Adding…":"Add to catalogue"}</button>
    </form>}
    <div className="grid gap-4" style={{gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))"}}>
      {arts.map(code=>{
        const e=cat[code]||{}; const a=INPUTS.articles[code];
        const combos=a.combo_order||Object.keys(a.combos||{});
        const sizeEntries=combos.flatMap(combo=>comboSizesForArticleIn(INPUTS,code,combo)
          .map(size=>({combo,size,key:`${combo}::${String(size).toUpperCase()}`})));
        return <div key={code} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-40 bg-slate-100 flex items-center justify-center relative">
            {(e.image || articlePhoto(code))
              ? <img src={e.image || articlePhoto(code)} alt={code} className="w-full h-full object-cover" />
              : <span className="text-xs text-slate-400">No photo — add one and it appears on this article&rsquo;s invoices</span>}
            <label className="absolute bottom-2 right-2 text-xs font-semibold bg-white/95 border border-slate-300 rounded-lg px-2 py-1 cursor-pointer">
              {busy===code ? "Uploading…" : e.image ? "Replace" : "Add photo"}
              <input type="file" accept="image/*" className="hidden"
                onChange={ev=>upload(code, ev.target.files && ev.target.files[0])} />
            </label>
          </div>
          <div className="p-3">
            <div className="text-sm font-semibold text-slate-800 leading-tight">{code}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {a.sole_type} sole{a.sole_assumed && <span className="text-amber-600"> · assumed</span>} · {combos.length} size ranges
            </div>
            {!combos.length&&<button onClick={()=>onAddBom&&onAddBom(code)}
              className="mt-2 w-full text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5">
              Missing BOM — add now</button>}
            {(deleteCandidate===code
              ? <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2">
                  <div className="text-xs text-rose-900">{combos.length
                    ? <>Delete <b>{code}</b>? Its BOM ({combos.length} size range{combos.length===1?"":"s"} and their material rates), packing and MRP go with it. Restorable from Data &amp; BOM history.</>
                    : <>Delete <b>{code}</b>? It has no BOM, so its empty article record and catalogue details will both be removed.</>}</div>
                  <div className="flex gap-2 mt-2">
                    <button type="button" disabled={busy===`${code}:delete`} onClick={()=>deleteCatalogueItem(code,combos.length>0)}
                      className="text-xs font-semibold text-white bg-rose-700 rounded px-2 py-1 disabled:opacity-40">
                      {busy===`${code}:delete`?"Deleting…":`Confirm delete ${code}`}</button>
                    <button type="button" disabled={busy===`${code}:delete`} onClick={()=>setDeleteCandidate("")}
                      className="text-xs font-semibold border border-slate-300 bg-white rounded px-2 py-1">Cancel</button>
                  </div>
                </div>
              : <button type="button" onClick={()=>setDeleteCandidate(code)}
                  className="mt-2 w-full text-xs font-semibold text-rose-700 border border-rose-200 bg-white rounded-lg px-2 py-1.5">
                  Delete {code} from catalogue</button>)}
            <div className="mono text-xs text-slate-400 mt-1 truncate" title={combos.join(", ")}>{combos.join(", ")}</div>
            <input defaultValue={e.description||""} placeholder="Description"
              onBlur={ev=>saveField(code,{description:ev.target.value})}
              className="mt-2 w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
            <label className="block text-xs text-slate-500 mt-2">Default price / pair
              <input type="number" min={0} defaultValue={e.price??""} placeholder="—"
                onBlur={ev=>saveField(code,{price:ev.target.value})}
                className="mt-0.5 w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 mono" /></label>
            <label className="block text-xs text-slate-500 mt-2">Sole process
              <select value={a.sole_type} disabled={busy===`${code}:reference`}
                onChange={ev=>saveReference(code,{sole_type:{[code]:ev.target.value}},"sole process")}
                className="mt-0.5 w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50">
                <option value="PVC">PVC</option><option value="PU">PU</option><option value="EVA">EVA</option><option value="STUCK-ON">Stuck-on</option>
              </select></label>
            {a.sole_type==="PVC"&&<label className="block text-xs text-slate-500 mt-2">PVC machine
              <select value={a.molding_machine||""} disabled={busy===`${code}:reference`}
                onChange={ev=>saveReference(code,{molding_machine:{[code]:ev.target.value||null}},"PVC machine")}
                className="mt-0.5 w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50">
                <option value="">Choose machine</option><option value="ROTARY">PVC Rotary</option><option value="VERTICAL">PVC Vertical</option>
              </select></label>}
            {!!combos.length&&<details className="mt-3 border-t border-slate-100 pt-2">
              <summary className="text-xs font-semibold text-indigo-700 cursor-pointer">Edit MRP size by size</summary>
              <div className="text-[10px] text-slate-500 mt-1">Every size is saved separately. The grey hint is its current price.</div>
              <div className="grid grid-cols-3 gap-2 mt-2" key={`${code}:${version}`}>
                {sizeEntries.map(({combo,size,key})=><label key={key} className="text-xs text-slate-500">{combo} · {size}
                  <input type="number" min={0}
                    value={(mrpEdits[code]&&mrpEdits[code][key])??(INPUTS.mrp&&INPUTS.mrp[code]&&
                      (INPUTS.mrp[code][key]??INPUTS.mrp[code][size]))??""}
                    placeholder={String(mrpForSize((INPUTS.mrp&&INPUTS.mrp[code])||{},combo,size)??"Not set")}
                    onChange={ev=>setMrpEdits(all=>({...all,[code]:{...(all[code]||{}),[key]:ev.target.value}}))}
                    className="mt-0.5 w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 mono" />
                </label>)}
              </div>
              <div className="flex gap-2 mt-2">
                <button disabled={busy===`${code}:reference`||!Object.keys(mrpEdits[code]||{}).length} onClick={()=>saveMrp(code)}
                  className="text-xs font-semibold bg-indigo-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">Save MRP changes</button>
                <button disabled={busy===`${code}:reference`||!Object.keys(mrpEdits[code]||{}).length}
                  onClick={()=>setMrpEdits(all=>{const next={...all};delete next[code];return next;})}
                  className="text-xs font-semibold border border-slate-300 bg-white rounded-lg px-3 py-1.5 disabled:opacity-40">Discard</button>
              </div>
            </details>}
          </div>
        </div>;})}
    </div>
  </div>;
}
