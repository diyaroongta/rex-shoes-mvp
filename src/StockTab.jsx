import React, { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import * as api from "./lib/client.js";
import { stockSheetRows, stockPatchFromRows } from "../shared/stock-upload.js";

/* Stock register in the factory's own STOCK MASTER layout:
   S.N · Category · Item Description · Size · UOM · Opening · Rec. · Issue ·
   Stock · Min Stock · Alert · Order Qty · Rate · Stock Value.

   Stock/Rec./Issue are kept per material in reference data. Rec. and Issue are
   movement totals since the opening figure, so Stock = Opening + Rec − Issue,
   and that identity is what makes the register auditable rather than a
   free-floating number. */

const CATEGORIES = ["SOLE","INSOLE","CHEMICAL","INNER","TOUNG LABEL","OUTER","VELCRO","LACE",
  "BUCKLE","EYELET","FABRIC","GRINDERY","BINDING","M PARTS","PVC COMPOUND","PVC INK",
  "STATIONERY","HOUSE KEEPING"];

const fmt = n => (n==null||isNaN(n)) ? "" : Number(n).toLocaleString("en-IN",{maximumFractionDigits:2});

/* Best-guess category from the material name — a starting point the user can
   correct, never silently authoritative. */
function guessCategory(name){
  const n = String(name||"").toUpperCase();
  if(/SOLE/.test(n)) return "SOLE";
  if(/INSOLE/.test(n)) return "INSOLE";
  if(/VELCRO/.test(n)) return "VELCRO";
  if(/LACE/.test(n)) return "LACE";
  if(/BUCKLE|PF-/.test(n)) return "BUCKLE";
  if(/EYELET/.test(n)) return "EYELET";
  if(/BINDING/.test(n)) return "BINDING";
  if(/LABEL/.test(n)) return "TOUNG LABEL";
  if(/REXINE|REXION|MESH|SKINFIT|ASTER|ASTAR|DRILL|FABRIC|CLOTH|LYCRA/.test(n)) return "FABRIC";
  if(/THREAD|TAPE|TAG|STICKER|TISSUE|PAPER|POLYBAG|PP BAG|CTN|STRAP|INNER|WRAP/.test(n)) return "GRINDERY";
  if(/SHEET|FOAM|TEXION|STIFNER|STIFFNER|TOE PUFF/.test(n)) return "M PARTS";
  if(/SHINER|EMYLE|INK/.test(n)) return "CHEMICAL";
  return "";
}

export default function StockTab({ state, onChanged }){
  const [section,setSection]=useState("view");
  const [edits,setEdits]=useState({});
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const [filter,setFilter]=useState("");
  const [cat,setCat]=useState("");
  /* 266 materials: 195 have never had a figure recorded, 71 have. The first
     instinct — hide the ones "not in use" — was wrong, and measuring said so:
     nearly every material IS used by some article's BOM, so that filter hid
     THREE rows. The register is not noisy, it is UNFILLED. So the view names
     the real states and shows their counts, and defaults to All rather than
     hiding anything by surprise. */
  const [view,setView]=useState("all");
  const [adding,setAdding]=useState(null);
  const [err,setErr]=useState("");
  const [pendingUpload,setPendingUpload]=useState(null);
  const fileRef=useRef(null);

  const meta = INPUTS.stock_meta || {};

  const rows = useMemo(()=>{
    return Object.entries(INPUTS.materials).map(([key,m],i)=>{
      const md = meta[key] || {};
      const opening = Number(md.opening ?? m.stock ?? 0);
      const rec     = Number(md.rec ?? 0);
      const issue   = Number(md.issue ?? 0);
      const stock   = opening + rec - issue;
      const min     = Number(md.min_stock ?? 0);
      const rate    = Number(md.rate ?? 0);
      return {
        key, sn:i+1,
        category: md.category ?? guessCategory(m.name),
        name: m.name, size: md.size ?? "", uom: m.uom, notes: m.notes,
        opening, rec, issue, stock, min,
        alert: min > 0 && stock < min,
        order_qty: min > 0 && stock < min ? min - stock : 0,
        rate, value: stock * rate,
      };
    });
  },[meta, INPUTS.materials]);

  /* A figure was RECORDED, as opposed to a stock of zero that somebody
     actually counted. `opening ?? m.stock` means an untouched material reads as
     0 either way, so the two are told apart by whether stock_meta holds
     anything for it at all. */
  const recorded = r => r.stock !== 0 || r.rec > 0 || r.issue > 0 || r.min > 0 || meta[r.key] != null;
  const VIEWS = {
    all:      { label:"All materials",        test:()=>true },
    blank:    { label:"No figure recorded",   test:r=>!recorded(r) },
    counted:  { label:"Has a figure",         test:r=>recorded(r) },
    below:    { label:"Below minimum",        test:r=>r.alert },
  };
  const counts = Object.fromEntries(
    Object.entries(VIEWS).map(([k,v])=>[k, rows.filter(v.test).length]));

  const shown = rows.filter(r =>
    (VIEWS[view]||VIEWS.all).test(r) &&
    (!filter || (r.name+" "+r.key).toLowerCase().includes(filter.toLowerCase())) &&
    (!cat || r.category === cat));

  const totals = shown.reduce((a,r)=>({ stock:a.stock+r.stock, value:a.value+r.value,
    alerts:a.alerts+(r.alert?1:0) }), {stock:0,value:0,alerts:0});

  const set=(key,field,v)=>setEdits(e=>({...e,[key]:{...(e[key]||{}),[field]:v}}));
  const val=(r,field)=> (edits[r.key]&&edits[r.key][field]!=null) ? edits[r.key][field] : r[field];

  async function save(){
    const patch={};
    for(const [key,fields] of Object.entries(edits)){
      const clean={};
      for(const [f,v] of Object.entries(fields)){
        if(v==="" || v==null) continue;
        clean[f] = ["category","size"].includes(f) ? String(v) : Number(v);
      }
      if(Object.keys(clean).length) patch[key]=clean;
    }
    if(!Object.keys(patch).length) return;
    setBusy(true);
    try{
      await api.patchReference({ stock_meta: patch });
      await reloadReference();
      setMsg(`${Object.keys(patch).length} items updated.`);
      setEdits({}); onChanged && onChanged();
    }catch(e){ setMsg(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  function exportSheet(){
    const ws=XLSX.utils.aoa_to_sheet(stockSheetRows(rows));
    ws["!cols"]=[{wch:6},{hidden:true},{wch:18},{wch:38},{wch:12},{wch:10},{wch:15},{wch:16},{wch:14},{wch:14},{wch:13},{wch:10},{wch:16},{wch:12},{wch:16}];
    ws["!autofilter"]={ref:`A1:O${rows.length+1}`};
    ws["!freeze"]={xSplit:0,ySplit:1,topLeftCell:"A2",activePane:"bottomLeft",state:"frozen"};
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"STOCK MASTER");
    const help=XLSX.utils.aoa_to_sheet([
      ["HOW TO UPDATE STOCK"],
      ["Edit only these columns on STOCK MASTER:"],
      ["CATEGORY, SIZE, OPENING STOCK, TOTAL RECEIVED, TOTAL ISSUED, MIN. STOCK and RATE"],
      ["Do not change ITEM DESCRIPTION or UOM. STOCK, ALERT, ORDER QUANTITY and STOCK VALUE are calculated after upload."],
      ["TOTAL RECEIVED and TOTAL ISSUED are cumulative totals, not today's movement."],
    ]);
    help["!cols"]=[{wch:115}];
    XLSX.utils.book_append_sheet(wb,help,"READ ME");
    XLSX.writeFile(wb,"stock-master-input.xlsx");
  }

  async function readUpload(file){
    setErr("");setMsg("");setPendingUpload(null);
    try{
      const wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:false});
      const ws=wb.Sheets["STOCK MASTER"];
      if(!ws) throw new Error('The workbook needs a sheet named "STOCK MASTER". Download a fresh input sheet first.');
      const checked=stockPatchFromRows(XLSX.utils.sheet_to_json(ws,{defval:"",raw:true}),rows);
      if(!checked.ok) throw new Error(checked.problems.slice(0,10).join("; "));
      if(!checked.changes.length){setMsg("No stock values changed in this workbook.");return;}
      setPendingUpload(checked);
    }catch(e){setErr(e.message||String(e));}
    finally{if(fileRef.current)fileRef.current.value="";}
  }

  async function applyUpload(){
    if(!pendingUpload)return;
    setBusy(true);setErr("");setMsg("");
    try{
      await api.patchReference({stock_meta:pendingUpload.patch});
      await reloadReference();
      const count=pendingUpload.changes.length;
      setPendingUpload(null);setMsg(`${count} stock item${count===1?"":"s"} updated from the spreadsheet.`);
      if(onChanged)await onChanged();
    }catch(e){setErr(e.message||String(e));}
    finally{setBusy(false);}
  }

  const TH={fontSize:10,fontWeight:700,padding:"5px 6px",background:"#1F3A5F",color:"#fff",
    border:"1px solid #cbd5e1",whiteSpace:"nowrap"};
  const TD={fontSize:11,padding:"3px 6px",border:"1px solid #e2e8f0"};

  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <div className="flex gap-2 flex-wrap mb-4" role="tablist" aria-label="Stock functions">
      {[["add","Add Stock"],["view","View Stock"],["mto","MTO Stock"],["material","Add New Material"]].map(([key,label])=><button
        key={key} role="tab" aria-selected={section===key} onClick={()=>{setSection(key);if(key==="material"&&!adding)setAdding({name:"",uom:"",colour:"",opening:"",min:"",rate:""});}}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
        style={{background:section===key?"#0B6BCB":"#fff",color:section===key?"#fff":"#334155",borderColor:section===key?"#0B6BCB":"#CBD5E1"}}>{label}</button>)}
    </div>

    {section==="add" ? <AddStock rows={rows} onChanged={async()=>{await reloadReference();if(onChanged)await onChanged();}} />
    : section==="mto" ? <MtoStock state={state} />
    : section==="material" ? <>
      <div className="mb-3"><div className="text-sm font-semibold text-slate-700">Add New Material</div>
        <div className="text-xs text-slate-500">Use this only when the material does not already exist in the BOM material master.</div></div>
      <NewMaterial draft={adding||{name:"",uom:"",colour:"",opening:"",min:"",rate:""}} setDraft={setAdding} existing={INPUTS.materials}
        onSaved={async()=>{setAdding({name:"",uom:"",colour:"",opening:"",min:"",rate:""});setMsg("Material added. It can now be stocked and used by BOMs.");if(onChanged)await onChanged();}}
        onError={setErr}/>{msg&&<div className="text-xs text-emerald-700 mt-2">{msg}</div>}
    </>
    : <>
    <div className="flex items-center gap-3 flex-wrap mb-3">
      <div>
        <div className="text-sm font-semibold text-slate-700">Stock register</div>
        <div className="text-xs text-slate-500">
          Stock = Opening + Rec. − Issue. Alert fires when stock falls below the minimum.
        </div>
      </div>
      <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Search item…"
        className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 ml-auto" />
      <select value={view} onChange={e=>setView(e.target.value)} aria-label="Which materials"
        className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
        {Object.entries(VIEWS).map(([k,v])=>
          <option key={k} value={k}>{v.label} ({counts[k]})</option>)}
      </select>
      <select value={cat} onChange={e=>setCat(e.target.value)}
        className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
        <option value="">All categories</option>
        {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
      </select>
      <button onClick={exportSheet}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Download input sheet</button>
      <label className={`text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white ${busy?"opacity-50":"cursor-pointer"}`}>
        Upload completed sheet
        <input ref={fileRef} type="file" accept=".xlsx,.xls" disabled={busy} className="hidden"
          onChange={e=>e.target.files[0]&&readUpload(e.target.files[0])}/>
      </label>
    </div>

    {err && <div role="alert" className="mb-3 text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">{err}</div>}
    {pendingUpload&&<div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
      <div className="text-xs font-semibold text-amber-900">Check before updating</div>
      <div className="text-xs text-amber-800 mt-1">
        {pendingUpload.changes.length} material{pendingUpload.changes.length===1?"":"s"} will change. Calculated columns are ignored.
      </div>
      <div className="text-[11px] text-amber-800 mt-2">
        {pendingUpload.changes.slice(0,8).map(change=><div key={change.key}>
          {change.name}: {change.fields.join(", ")}</div>)}
        {pendingUpload.changes.length>8&&<div>…and {pendingUpload.changes.length-8} more</div>}
      </div>
      <div className="flex gap-2 mt-3">
        <button disabled={busy} onClick={applyUpload}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">
          {busy?"Updating…":"Apply spreadsheet changes"}</button>
        <button disabled={busy} onClick={()=>setPendingUpload(null)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Cancel</button>
      </div>
    </div>}
    <div className="flex gap-4 flex-wrap mb-3 text-xs">
      <span className="text-slate-500">Items <b className="mono text-slate-800">{shown.length}</b></span>
      <span className="text-slate-500">Total stock <b className="mono text-slate-800">{fmt(totals.stock)}</b></span>
      <span className="text-slate-500">Stock value <b className="mono text-slate-800">₹{fmt(totals.value)}</b></span>
      {totals.alerts>0 && <span className="text-rose-700 font-semibold">{totals.alerts} below minimum</span>}
      {/* The number that actually matters, and it is not flattering: most of the
          register has never been filled in, so the stock every shortfall is
          netted against is mostly an assumed zero. */}
      {counts.blank>0 && <button onClick={()=>setView(view==="blank"?"all":"blank")}
        className="font-semibold hover:underline" style={{color:"#c2410c"}}>
        {counts.blank} never counted{view==="blank"?" — show all":""}</button>}
    </div>

    <div className="overflow-x-auto" style={{maxHeight:"60vh"}}>
      <table style={{borderCollapse:"collapse",width:"100%"}}>
        <thead style={{position:"sticky",top:0}}>
          <tr>{["S.N","CATEGORY","ITEM DESCRIPTION","SIZE","UOM","OPENING STOCK","REC.","ISSUE",
                "STOCK","MIN. STOCK","ALERT","ORDER QTY","RATE","STOCK VALUE"]
                .map(h=><th key={h} style={TH}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map(r=>{
            const opening=Number(val(r,"opening"))||0, rec=Number(val(r,"rec"))||0, issue=Number(val(r,"issue"))||0;
            const stock=opening+rec-issue;
            const min=Number(val(r,"min"))||0, rate=Number(val(r,"rate"))||0;
            const low=min>0&&stock<min;
            return <tr key={r.key} style={{background:low?"#fef2f2":"#fff"}}>
              <td style={{...TD,textAlign:"center"}}>{r.sn}</td>
              <td style={TD}>
                <select value={val(r,"category")||""} onChange={e=>set(r.key,"category",e.target.value)}
                  style={{fontSize:11,border:"none",background:"transparent",width:"100%"}}>
                  <option value="">—</option>
                  {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                </select></td>
              <td style={TD}>{r.name}
                {/* Free-text columns kept from the BOM upload. Shown where the
                    material is, used by nothing. */}
                {r.notes&&Object.keys(r.notes).length>0&&<div style={{fontSize:10,color:"#64748b"}}>
                  {Object.entries(r.notes).map(([label,value])=>`${label}: ${value}`).join(" · ")}
                </div>}</td>
              <td style={TD}><input value={val(r,"size")||""} onChange={e=>set(r.key,"size",e.target.value)}
                style={{fontSize:11,border:"none",width:56,background:"transparent"}} /></td>
              <td style={{...TD,textAlign:"center"}}>{r.uom}</td>
              {["opening","rec","issue"].map(f=>(
                <td key={f} style={TD}><input type="number" value={val(r,f)}
                  onChange={e=>set(r.key,f,e.target.value)}
                  style={{fontSize:11,border:"none",width:64,textAlign:"right",background:"transparent"}} /></td>))}
              <td style={{...TD,textAlign:"right",fontWeight:600}}>{fmt(stock)}</td>
              <td style={TD}><input type="number" value={val(r,"min")}
                onChange={e=>set(r.key,"min",e.target.value)}
                style={{fontSize:11,border:"none",width:60,textAlign:"right",background:"transparent"}} /></td>
              <td style={{...TD,textAlign:"center",color:"#b91c1c",fontWeight:700}}>{low?"LOW":""}</td>
              <td style={{...TD,textAlign:"right"}}>{low?fmt(min-stock):""}</td>
              <td style={TD}><input type="number" value={val(r,"rate")}
                onChange={e=>set(r.key,"rate",e.target.value)}
                style={{fontSize:11,border:"none",width:60,textAlign:"right",background:"transparent"}} /></td>
              <td style={{...TD,textAlign:"right"}}>{fmt(stock*rate)}</td>
            </tr>;})}
        </tbody>
      </table>
    </div>

    {msg && <div className="text-xs text-slate-600 mt-2">{msg}</div>}
    <button disabled={busy||!Object.keys(edits).length} onClick={save}
      className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
      {busy?"Saving…":`Save ${Object.keys(edits).length||""} change${Object.keys(edits).length===1?"":"s"}`}</button>
    </>}
  </div>;
}

function AddStock({rows,onChanged}){
  const [key,setKey]=useState(""),[qty,setQty]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const selected=rows.find(row=>row.key===key);
  async function save(){
    const amount=Number(qty);
    if(!selected||!Number.isFinite(amount)||amount<=0){setMessage("Choose a material and enter a quantity greater than zero.");return;}
    setBusy(true);setMessage("");
    try{
      await api.patchReference({stock_meta:{[selected.key]:{rec:Number(selected.rec||0)+amount}}});
      await onChanged();setQty("");setMessage(`${fmt(amount)} ${selected.uom} added to ${selected.name}.`);
    }catch(e){setMessage(e.message||String(e));}finally{setBusy(false);}
  }
  return <div className="max-w-3xl">
    <div className="text-sm font-semibold text-slate-700">Add received stock</div>
    <div className="text-xs text-slate-500 mt-1 mb-4">Select an existing material and enter the received quantity. The stock register updates automatically.</div>
    <div className="flex gap-3 flex-wrap items-end">
      <label className="text-xs text-slate-600 flex-1 min-w-64">Material
        <select value={key} onChange={e=>setKey(e.target.value)} className="block mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 bg-white text-sm">
          <option value="">Select material…</option>{rows.map(row=><option key={row.key} value={row.key}>{row.name} · {row.uom}</option>)}
        </select></label>
      <label className="text-xs text-slate-600">Quantity received
        <input aria-label="Quantity received" type="number" min="0" step="0.01" value={qty} onChange={e=>setQty(e.target.value)}
          className="block mt-1 w-36 border border-slate-300 rounded-lg px-2 py-2 mono text-right"/></label>
      <button disabled={busy} onClick={save} className="text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{busy?"Saving…":"Add stock"}</button>
    </div>
    {selected&&<div className="mt-3 text-xs text-slate-600">Current stock: <b className="mono">{fmt(selected.stock)} {selected.uom}</b></div>}
    {message&&<div className="mt-3 text-xs text-slate-700">{message}</div>}
  </div>;
}

function MtoStock({state}){
  const orders=(state&&state.orders||[]).filter(order=>/\bMTO\b/i.test(String(order.pi&&order.pi.order_nature||"")));
  return <div className="overflow-x-auto">
    <div className="text-sm font-semibold text-slate-700">MTO material availability</div>
    <div className="text-xs text-slate-500 mt-1 mb-3">Only live orders whose Order Nature is MTO are shown. Requirements and shortfall come from their existing BOMs and the current stock register.</div>
    <table className="w-full text-xs" style={{minWidth:820}}><thead><tr className="sign text-slate-500">
      {['Order / PI','Party','Article','Material','Required','Covered','Shortfall','UOM'].map(h=><th key={h} className={`py-2 px-2 ${['Required','Covered','Shortfall'].includes(h)?'text-right':'text-left'}`}>{h}</th>)}
    </tr></thead><tbody>{orders.flatMap(order=>{
      const group=(state.procurement_by_order||{})[order.order_no];
      const materials=group&&group.materials||[];
      return materials.map((m,index)=><tr key={`${order.order_no}-${m.material_key}`} className="border-t border-slate-100" style={{background:m.shortfall>0?'#fff7ed':'#fff'}}>
        <td className="py-2 px-2">{index===0&&<><div className="mono font-semibold">{order.order_no}</div><div className="mono text-slate-400">{order.pi&&order.pi.pi_no||'No PI'}</div></>}</td>
        <td className="px-2">{index===0?order.party:''}</td><td className="px-2">{index===0?order.article:''}</td><td className="px-2">{m.name}</td>
        <td className="px-2 mono text-right">{fmt(m.required)}</td><td className="px-2 mono text-right">{fmt(m.covered)}</td>
        <td className={`px-2 mono text-right font-semibold ${m.shortfall>0?'text-amber-700':'text-emerald-700'}`}>{fmt(m.shortfall)}</td><td className="px-2">{m.uom}</td>
      </tr>);
    })}</tbody></table>
    {!orders.length&&<div className="text-sm text-slate-500 text-center py-8">No live order is marked MTO.</div>}
    {!!orders.length&&!orders.some(order=>((state.procurement_by_order||{})[order.order_no]||{}).materials?.length)&&<div className="text-sm text-amber-700 text-center py-8">These MTO orders do not yet have BOM material requirements.</div>}
  </div>;
}

/* Adding a material the BOM has never mentioned.
   The UOM is part of the material's IDENTITY, not a display preference — the
   key is `NAME||UOM` — and the colour is folded into the name, because black
   and blue rexine are bought, stocked and netted separately. Both rules are the
   BOM importer's, followed here so a material added by hand and one added by
   upload land on the same key instead of becoming two materials. */
function NewMaterial({ draft, setDraft, existing = {}, onSaved, onError }){
  const [saving,setSaving]=useState(false);
  const set=(k,v)=>setDraft(d=>({...d,[k]:v}));
  const name=String(draft.name||"").trim().toUpperCase();
  const uom=String(draft.uom||"").trim().toUpperCase();
  const colour=String(draft.colour||"").trim().toUpperCase();
  const full=colour && !name.split(/[^A-Z0-9.]+/).filter(Boolean).includes(colour) ? `${name} ${colour}` : name;
  const key=name&&uom ? `${full}||${uom}` : "";
  const clash=!!key && !!existing[key];

  const problems=[];
  if(!name) problems.push("A material name is required");
  if(!uom) problems.push("A unit of measure is required — it is part of the material's identity");
  if(clash) problems.push(`${key} is already on the material list`);
  for(const [f,label] of [["opening","Opening stock"],["min","Minimum"],["rate","Rate"]]){
    const v=draft[f];
    if(v!=="" && v!=null && (!Number.isFinite(Number(v)) || Number(v)<0)) problems.push(`${label} must be 0 or more`);
  }

  async function save(){
    setSaving(true);
    try{
      await api.addMaterial({ name, uom, colour: colour||null,
        opening: draft.opening===""?0:Number(draft.opening),
        min: draft.min===""?0:Number(draft.min),
        rate: draft.rate===""?0:Number(draft.rate) });
      await reloadReference();
      await onSaved();
    }catch(e){ onError(e.message||String(e)); }
    finally{ setSaving(false); }
  }

  return <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
    <div className="text-xs font-semibold text-slate-800 mb-2">New material</div>
    <div className="flex gap-3 flex-wrap items-end">
      <label className="text-xs text-slate-600">Name
        <input value={draft.name} aria-label="Material name" onChange={e=>set("name",e.target.value)}
          placeholder='e.g. REXINE 54"'
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm min-w-56"/></label>
      <label className="text-xs text-slate-600">Colour (optional)
        <input value={draft.colour} aria-label="Material colour" onChange={e=>set("colour",e.target.value)}
          placeholder="BLACK"
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-32"/></label>
      <label className="text-xs text-slate-600">UOM
        <input value={draft.uom} aria-label="Unit of measure" onChange={e=>set("uom",e.target.value)}
          placeholder="MTR"
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-24"/></label>
      <label className="text-xs text-slate-600">Opening stock
        <input type="number" min="0" value={draft.opening} aria-label="Opening stock"
          onChange={e=>set("opening",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-28 mono text-right"/></label>
      <label className="text-xs text-slate-600">Minimum
        <input type="number" min="0" value={draft.min} aria-label="Minimum stock"
          onChange={e=>set("min",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-24 mono text-right"/></label>
      <label className="text-xs text-slate-600">Rate
        <input type="number" min="0" step="0.01" value={draft.rate} aria-label="Rate"
          onChange={e=>set("rate",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-24 mono text-right"/></label>
      <button onClick={save} disabled={saving||problems.length>0}
        className="text-xs font-semibold text-white rounded-lg px-4 py-2 bg-indigo-600 disabled:opacity-50">
        {saving?"Adding…":"Add material"}</button>
    </div>
    {/* Show the key that will be created, because the colour folding surprises
        people the first time — "REXINE 54\" BLACK||MTR", not two fields. */}
    {key && <div className="text-[11px] text-slate-500 mt-2">Will be stored as <span className="mono">{key}</span></div>}
    {!!problems.length && (name||uom) && <ul className="text-[11px] text-rose-700 mt-2 list-disc pl-4">
      {problems.map(p=><li key={p}>{p}</li>)}</ul>}
    <div className="text-[11px] text-slate-500 mt-1">
      Setting a <b>minimum</b> is what makes the below-minimum alert and the order quantity work — no material
      on the register has one today, so neither currently fires.
    </div>
  </div>;
}
