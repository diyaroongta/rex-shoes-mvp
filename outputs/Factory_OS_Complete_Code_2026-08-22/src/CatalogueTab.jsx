import React, { useState, useEffect } from "react";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import { articlePhoto } from "../shared/catalogue-seed.js";
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

export default function CatalogueTab({onChanged}){
  const [cat,setCat]=useState({});
  const [busy,setBusy]=useState("");
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [version,setVersion]=useState(0);
  const [mrpEdits,setMrpEdits]=useState({});
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
    if(await saveReference(code,{mrp:{[code]:clean}},"range MRPs"))
      setMrpEdits(all=>{const next={...all};delete next[code];return next;});
  }

  return <div>
    {err && <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-3">{err}</div>}
    {msg && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-3">{msg}</div>}
    <p className="text-xs text-slate-500 mb-4">
      Every article is editable here, including Gola Plus and articles added through a BOM upload.
      Photos are resized to 640px. Sole process, machine assignment and range prices update the shared planning reference.
    </p>
    <div className="grid gap-4" style={{gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))"}}>
      {arts.map(code=>{
        const e=cat[code]||{}; const a=INPUTS.articles[code];
        const combos=a.combo_order||Object.keys(a.combos||{});
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
            <details className="mt-3 border-t border-slate-100 pt-2">
              <summary className="text-xs font-semibold text-indigo-700 cursor-pointer">Edit MRP by size range</summary>
              <div className="grid grid-cols-2 gap-2 mt-2" key={`${code}:${version}`}>
                {combos.map(combo=><label key={combo} className="text-xs text-slate-500">{combo}
                  <input type="number" min={0}
                    value={(mrpEdits[code]&&mrpEdits[code][combo])??(INPUTS.mrp&&INPUTS.mrp[code]&&INPUTS.mrp[code][combo])??""}
                    onChange={ev=>setMrpEdits(all=>({...all,[code]:{...(all[code]||{}),[combo]:ev.target.value}}))}
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
            </details>
          </div>
        </div>;})}
    </div>
  </div>;
}
