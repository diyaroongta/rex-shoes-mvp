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

/* TWO THINGS PEOPLE DO WITH STOCK, SO TWO VIEWS.
   The register used to be one fourteen-column spreadsheet in which every cell
   was an input, so LOOKING at the store and CHANGING it were the same act:
   finding one figure meant reading past two hundred editable boxes, and a
   stray keystroke while scrolling was an edit. The store keeper's day is two
   separate jobs — "what have we got" and "a delivery just came in" — and each
   now has a screen of its own. Correcting a figure is still possible, but it
   is a deliberate act on ONE row, from View stock. */
export default function StockTab({ state, onChanged }){
  const [mode,setMode]=useState("view");
  const [material,setMaterial]=useState({name:"",uom:"",colour:"",opening:"",min:"",rate:""});
  const [materialMsg,setMaterialMsg]=useState("");
  const [materialErr,setMaterialErr]=useState("");
  // Bumped after every save so the register re-reads the reloaded reference.
  const [version,setVersion]=useState(0);
  const refreshed=async()=>{ setVersion(v=>v+1); if(onChanged) await onChanged(); };

  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <div role="tablist" aria-label="Stock" className="inline-flex rounded-xl bg-slate-100 p-1 mb-4">
      {[["add","Add Stock"],["view","View Stock"],["mto","MTO Stock"],["material","Add New Material"]].map(([k,label])=>
        <button key={k} role="tab" aria-selected={mode===k} onClick={()=>setMode(k)}
          className="text-sm font-semibold rounded-lg px-4 py-1.5 transition-colors"
          style={mode===k
            ? {background:"#fff",color:"#1e293b",boxShadow:"0 1px 2px rgba(15,23,42,.12)"}
            : {background:"transparent",color:"#64748b"}}>{label}</button>)}
    </div>
    {mode==="view" ? <ViewStock version={version} onSaved={refreshed} />
      : mode==="add" ? <AddStock version={version} onSaved={refreshed} onViewAll={()=>setMode("view")} />
      : mode==="mto" ? <MtoStock state={state} />
      : <div>
          <div className="text-sm font-semibold text-slate-800 mb-1">Add New Material</div>
          <div className="text-xs text-slate-500 mb-3">Use this only when the material is not already in the BOM material master.</div>
          <NewMaterial draft={material} setDraft={setMaterial} existing={INPUTS.materials}
            onSaved={async()=>{setMaterial({name:"",uom:"",colour:"",opening:"",min:"",rate:""});setMaterialMsg("Material added. It can now be stocked and used by BOMs.");setMaterialErr("");await refreshed();}}
            onError={setMaterialErr}/>
          {materialMsg&&<div className="text-xs text-emerald-700">{materialMsg}</div>}
          {materialErr&&<div role="alert" className="text-xs text-rose-700">{materialErr}</div>}
        </div>}
  </div>;
}

/* One row per material, computed the same way everywhere on this screen.
   Stock = Opening + Received − Issued: the identity that makes the register
   auditable rather than a free-floating number. */
function stockRows(){
  const meta = INPUTS.stock_meta || {};
  return Object.entries(INPUTS.materials||{}).map(([key,m],i)=>{
    const md = meta[key] || {};
    const opening = Number(md.opening ?? m.stock ?? 0);
    const rec     = Number(md.rec ?? 0);
    const issue   = Number(md.issue ?? 0);
    const stock   = opening + rec - issue;
    const min     = Number(md.min_stock ?? 0);
    const rate    = Number(md.rate ?? 0);
    /* RECORDED, as opposed to a zero nobody ever counted. An untouched
       material reads 0 either way, so the two are told apart by whether any
       figure exists for it at all. 195 of 266 materials were in this state
       when it was first measured — the register is unfilled, not noisy. */
    const counted = stock !== 0 || rec > 0 || issue > 0 || min > 0 || meta[key] != null;
    return {
      key, sn:i+1, category: md.category ?? guessCategory(m.name),
      name: m.name, size: md.size ?? "", uom: m.uom, notes: m.notes,
      opening, rec, issue, stock, min, rate, value: stock * rate, counted,
      low: min > 0 && stock < min,
      alert: min > 0 && stock < min,
      order_qty: min > 0 && stock < min ? min-stock : 0,
    };
  });
}

const STATUS = {
  low:      { label:"Below minimum", bg:"#fee2e2", fg:"#991b1b" },
  ok:       { label:"In stock",      bg:"#ecfdf5", fg:"#065f46" },
  empty:    { label:"Nil",           bg:"#f1f5f9", fg:"#475569" },
  uncounted:{ label:"Not counted",   bg:"#fff7ed", fg:"#9a3412" },
};
const statusOf = r => !r.counted ? "uncounted" : r.low ? "low" : r.stock > 0 ? "ok" : "empty";

function ViewStock({ version, onSaved }){
  const [q,setQ]=useState("");
  const [cat,setCat]=useState("");
  /* The four tiles ARE the filters. The numbers that matter — what is short,
     what nobody has counted — are the first thing on the screen and one click
     from the rows behind them, instead of options in a dropdown. */
  const [show,setShow]=useState("all");
  const [open,setOpen]=useState(null);
  const [pendingUpload,setPendingUpload]=useState(null);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const [err,setErr]=useState("");
  const fileRef=useRef(null);

  const rows = useMemo(stockRows, [version, INPUTS.materials, INPUTS.stock_meta]);
  const tiles = [
    ["all",       "Materials",      rows.length, "#1e293b"],
    ["low",       "Below minimum",  rows.filter(r=>r.low).length, "#b91c1c"],
    ["uncounted", "Never counted",  rows.filter(r=>!r.counted).length, "#c2410c"],
    ["value",     "Stock value",    "₹"+fmt(rows.reduce((a,r)=>a+r.value,0)), "#1e293b"],
  ];
  const test = { all:()=>true, value:()=>true, low:r=>r.low, uncounted:r=>!r.counted }[show] || (()=>true);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(r => test(r)
    && (!needle || (r.name+" "+r.key+" "+r.category).toLowerCase().includes(needle))
    && (!cat || r.category===cat));

  function exportSheet(){
    const header=["S.N","CATEGORY","ITEM DESCRIPTION","SIZE","UOM","OPENING STOCK","REC.","ISSUE",
      "STOCK","MIN. STOCK","ALERT","ORDER QUANTITY","RATE","STOCK VALUE"];
    const body=shown.map(r=>[r.sn,r.category,r.name,r.size,r.uom,r.opening,r.rec,r.issue,
      r.stock,r.min,r.low?"LOW":"",r.low?r.min-r.stock:0,r.rate,r.value]);
    const ws=XLSX.utils.aoa_to_sheet([header,...body]);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"STOCK MASTER");
    XLSX.writeFile(wb,"stock-master.xlsx");
  }

  function downloadInput(){
    const ws=XLSX.utils.aoa_to_sheet(stockSheetRows(rows));
    ws["!cols"]=[{wch:6},{hidden:true},{wch:18},{wch:38},{wch:12},{wch:10},{wch:15},{wch:16},{wch:14},{wch:14},{wch:13},{wch:10},{wch:16},{wch:12},{wch:16}];
    ws["!autofilter"]={ref:`A1:O${rows.length+1}`};
    ws["!freeze"]={xSplit:0,ySplit:1,topLeftCell:"A2",activePane:"bottomLeft",state:"frozen"};
    const help=XLSX.utils.aoa_to_sheet([
      ["HOW TO UPDATE STOCK"],
      ["Edit only CATEGORY, SIZE, OPENING STOCK, TOTAL RECEIVED, TOTAL ISSUED, MIN. STOCK and RATE on STOCK MASTER."],
      ["Do not change ITEM DESCRIPTION, UOM or MATERIAL KEY. Calculated columns are refreshed after upload."],
      ["TOTAL RECEIVED and TOTAL ISSUED are cumulative totals, not today's movement."],
    ]);
    help["!cols"]=[{wch:115}];
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"STOCK MASTER");
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
      await onSaved();
    }catch(e){setErr(e.message||String(e));}
    finally{setBusy(false);}
  }

  return <div>
    <div className="grid gap-2 mb-4" style={{gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))"}}>
      {tiles.map(([k,label,value,tone])=>{
        const active = show===k && k!=="value";
        return <button key={k} onClick={()=>k!=="value" && setShow(active&&k!=="all"?"all":k)}
          aria-pressed={active} disabled={k==="value"}
          className="text-left rounded-xl border px-3 py-2.5 transition-colors"
          style={{borderColor:active?"#6366f1":"#e2e8f0",background:active?"#eef2ff":"#fff",
            cursor:k==="value"?"default":"pointer"}}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mono text-xl font-semibold" style={{color:tone}}>{value}</div>
        </button>;
      })}
    </div>

    <div className="flex items-center gap-2 flex-wrap mb-3">
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search a material…"
        aria-label="Search stock"
        className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 min-w-0" style={{flex:"1 1 220px",maxWidth:340}} />
      <select value={cat} onChange={e=>setCat(e.target.value)} aria-label="Category"
        className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
        <option value="">All categories</option>
        {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
      </select>
      <span className="text-xs text-slate-500 ml-auto">{shown.length} shown</span>
      <button onClick={exportSheet}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Export to Excel</button>
      <button onClick={downloadInput}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Download stock input</button>
      <label className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white cursor-pointer">
        Upload completed sheet
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e=>e.target.files[0]&&readUpload(e.target.files[0])}/>
      </label>
    </div>

    {err&&<div role="alert" className="text-xs text-rose-700 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 mb-3">{err}</div>}
    {msg&&<div className="text-xs text-emerald-700 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 mb-3">{msg}</div>}
    {pendingUpload&&<div className="text-xs text-slate-700 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 mb-3 flex items-center gap-3 flex-wrap">
      <span><b>{pendingUpload.changes.length}</b> stock item{pendingUpload.changes.length===1?"":"s"} will be updated.</span>
      <button disabled={busy} onClick={applyUpload} className="ml-auto text-xs font-semibold text-white bg-amber-700 rounded-lg px-3 py-1.5 disabled:opacity-50">{busy?"Updating…":"Confirm upload"}</button>
      <button onClick={()=>setPendingUpload(null)} className="text-xs font-semibold border border-slate-300 bg-white rounded-lg px-3 py-1.5">Cancel</button>
    </div>}

    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm" style={{borderCollapse:"collapse"}}>
        <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
          <th className="text-left px-3 py-2">Material</th>
          <th className="text-right px-3 py-2">In stock</th>
          <th className="text-right px-3 py-2 hidden sm:table-cell">Minimum</th>
          <th className="text-left px-3 py-2 hidden sm:table-cell">Status</th>
          <th className="text-right px-3 py-2 hidden sm:table-cell">Value</th>
          <th className="px-2 py-2" aria-label="Details"/>
        </tr></thead>
        <tbody>
          {shown.map(r=>{
            const st=STATUS[statusOf(r)];
            const isOpen=open===r.key;
            return <React.Fragment key={r.key}>
              <tr onClick={()=>setOpen(isOpen?null:r.key)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                style={{background:isOpen?"#f8fafc":undefined}}>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{r.name}</div>
                  <div className="text-[11px] text-slate-400">{r.category||"No category"}{r.size?` · ${r.size}`:""}</div>
                  {/* On a phone the status sits under the name. As its own
                      column it was the first thing to scroll off the right
                      edge — and it is the one signal the screen exists for. */}
                  <div className="sm:hidden mt-1">
                    <span className="text-[11px] font-semibold rounded-full px-2 py-0.5"
                      style={{background:st.bg,color:st.fg}}>{st.label}</span>
                    {r.low && <span className="text-[11px] text-rose-700 ml-1.5">order {fmt(r.min-r.stock)}</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right mono font-semibold text-slate-800 whitespace-nowrap">
                  {fmt(r.stock)} <span className="text-slate-400 font-normal text-xs">{r.uom}</span></td>
                <td className="px-3 py-2 text-right mono text-slate-500 hidden sm:table-cell">{r.min?fmt(r.min):"—"}</td>
                <td className="px-3 py-2 hidden sm:table-cell">
                  <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap"
                    style={{background:st.bg,color:st.fg}}>{st.label}</span>
                  {r.low && <span className="text-[11px] text-rose-700 ml-1.5 whitespace-nowrap">order {fmt(r.min-r.stock)}</span>}
                </td>
                <td className="px-3 py-2 text-right mono text-slate-600 hidden sm:table-cell">{r.rate?"₹"+fmt(r.value):"—"}</td>
                <td className="px-2 py-2 text-slate-400 text-xs">{isOpen?"▲":"▼"}</td>
              </tr>
              {isOpen && <tr><td colSpan={6} className="px-3 pb-3 bg-slate-50">
                <StockDetail row={r} onSaved={onSaved} />
              </td></tr>}
            </React.Fragment>;
          })}
          {!shown.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
            Nothing matches.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}

/* The arithmetic behind one figure, and the one place a figure is CORRECTED.
   Editing is a deliberate step — press Correct, change, save — on a single
   material, not a side effect of scrolling past a grid of inputs. */
function StockDetail({ row, onSaved }){
  const [edit,setEdit]=useState(null);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const FIELDS=[["opening","Opening"],["rec","Received"],["issue","Issued"],["min","Minimum"],["rate","Rate ₹"]];

  async function save(){
    const clean={};
    for(const [f,v] of Object.entries(edit)){
      if(v===""||v==null) continue;
      if(["category","size"].includes(f)){ if(String(v)!==String(row[f]||"")) clean[f]=String(v); continue; }
      const n=Number(v);
      if(!Number.isFinite(n)||n<0){ setErr(`${f} must be 0 or more`); return; }
      if(n!==Number(row[f])) clean[f]=n;
    }
    if(!Object.keys(clean).length){ setEdit(null); return; }
    setBusy(true); setErr("");
    try{
      await api.patchReference({ stock_meta:{ [row.key]:clean } });
      await reloadReference();
      setEdit(null);
      await onSaved();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  const cell="rounded-lg border border-slate-200 bg-white px-3 py-2";
  if(!edit) return <div className="pt-2">
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className={cell}><span className="text-[11px] text-slate-500 block">Opening</span><b className="mono">{fmt(row.opening)}</b></span>
      <span className="text-slate-400">+</span>
      <span className={cell}><span className="text-[11px] text-slate-500 block">Received</span><b className="mono">{fmt(row.rec)}</b></span>
      <span className="text-slate-400">−</span>
      <span className={cell}><span className="text-[11px] text-slate-500 block">Issued</span><b className="mono">{fmt(row.issue)}</b></span>
      <span className="text-slate-400">=</span>
      <span className={cell} style={{borderColor:"#6366f1"}}><span className="text-[11px] text-slate-500 block">In stock</span>
        <b className="mono">{fmt(row.stock)} {row.uom}</b></span>
      <span className="text-xs text-slate-500 ml-2">Rate {row.rate?`₹${fmt(row.rate)} / ${row.uom}`:"not set"}</span>
      <button onClick={()=>setEdit({category:row.category||"",size:row.size||"",opening:row.opening,
          rec:row.rec,issue:row.issue,min:row.min,rate:row.rate})}
        className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Correct figures</button>
    </div>
    {row.notes&&Object.keys(row.notes).length>0&&<div className="text-[11px] text-slate-500 mt-2">
      {Object.entries(row.notes).map(([label,value])=>`${label}: ${value}`).join(" · ")}</div>}
    {!row.min && <div className="text-[11px] text-slate-500 mt-2">
      No minimum set, so this material can never raise a below-minimum alert.</div>}
  </div>;

  return <div className="pt-2">
    <div className="flex gap-3 flex-wrap items-end">
      <label className="text-xs text-slate-600">Category
        <select value={edit.category} onChange={e=>setEdit(d=>({...d,category:e.target.value}))}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
          <option value="">—</option>{CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <label className="text-xs text-slate-600">Size
        <input value={edit.size} onChange={e=>setEdit(d=>({...d,size:e.target.value}))}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-24"/></label>
      {FIELDS.map(([f,label])=>
        <label key={f} className="text-xs text-slate-600">{label}
          <input type="number" min="0" value={edit[f]} aria-label={`${label} for ${row.name}`}
            onChange={e=>setEdit(d=>({...d,[f]:e.target.value}))}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-24 mono text-right"/></label>)}
      <button onClick={save} disabled={busy}
        className="text-xs font-semibold text-white rounded-lg px-4 py-2 bg-indigo-600 disabled:opacity-50">
        {busy?"Saving…":"Save"}</button>
      <button onClick={()=>{setEdit(null);setErr("");}} disabled={busy}
        className="text-xs font-semibold rounded-lg px-3 py-2 border border-slate-300 bg-white">Cancel</button>
    </div>
    <div className="text-[11px] text-slate-500 mt-2">
      For correcting a mistake. A delivery that just arrived goes in through <b>Add stock</b>, so it is added to what is
      already received rather than typed over it.</div>
    {err && <div role="alert" className="text-xs text-rose-700 mt-2">{err}</div>}
  </div>;
}

/* BOOKING A DELIVERY IN — the store keeper's most frequent act, so it is one
   short form: which material, how much. The quantity is ADDED on the server
   (`rec_add`), inside the reference row lock, so two people booking deliveries
   at once both land. Sending a new running total from the browser would let
   the second save quietly erase the first. */
function AddStock({ version, onSaved, onViewAll }){
  const rows = useMemo(stockRows, [version, INPUTS.materials, INPUTS.stock_meta]);
  const [q,setQ]=useState("");
  const [pick,setPick]=useState(null);
  const [qty,setQty]=useState("");
  const [rate,setRate]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [booked,setBooked]=useState([]);     // this sitting only — not a stored history
  const [adding,setAdding]=useState(null);

  const chosen = pick && rows.find(r=>r.key===pick);
  const needle = q.trim().toLowerCase();
  const matches = needle && !chosen
    ? rows.filter(r=>(r.name+" "+r.key+" "+r.category).toLowerCase().includes(needle)).slice(0,8) : [];
  const amount = Number(qty);
  const valid = chosen && Number.isFinite(amount) && amount > 0
    && (rate==="" || (Number.isFinite(Number(rate)) && Number(rate) >= 0));

  async function book(){
    if(!valid) return;
    setBusy(true); setErr("");
    try{
      const fields={ rec_add:amount };
      if(rate!=="") fields.rate=Number(rate);
      await api.patchReference({ stock_meta:{ [chosen.key]:fields } });
      await reloadReference();
      const after = stockRows().find(r=>r.key===chosen.key);
      setBooked(b=>[{ key:chosen.key, name:chosen.name, uom:chosen.uom, qty:amount,
        stock: after ? after.stock : null, at:new Date() }, ...b]);
      setPick(null); setQ(""); setQty(""); setRate("");
      await onSaved();
    }catch(e){ setErr(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  return <div className="grid gap-4" style={{gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))"}}>
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="text-sm font-semibold text-slate-800 mb-1">Record a delivery</div>
      <div className="text-xs text-slate-500 mb-3">Pick the material, enter what arrived. It is added to the stock.</div>

      <label className="text-xs font-medium text-slate-600">Material
        {chosen
          ? <div className="mt-1 flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{chosen.name}</div>
                <div className="text-[11px] text-slate-500">In stock now: <b className="mono">{fmt(chosen.stock)} {chosen.uom}</b></div>
              </div>
              <button onClick={()=>{setPick(null);setQ("");}} className="text-xs font-semibold text-indigo-700">Change</button>
            </div>
          : <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Type to search, e.g. rexine"
              aria-label="Material to receive" autoComplete="off"
              className="block mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"/>}
      </label>
      {!!matches.length && <ul role="listbox" aria-label="Matching materials"
          className="mt-1 rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        {matches.map(r=><li key={r.key}>
          <button role="option" aria-selected={false} onClick={()=>setPick(r.key)}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2">
            <span className="text-sm text-slate-800 flex-1 truncate">{r.name}</span>
            <span className="mono text-xs text-slate-500 whitespace-nowrap">{fmt(r.stock)} {r.uom}</span>
          </button></li>)}
      </ul>}
      {needle && !chosen && !matches.length && <div className="text-xs text-slate-500 mt-1">
        No material called that. <button onClick={()=>setAdding({name:q,uom:"",colour:"",opening:"",min:"",rate:""})}
          className="font-semibold text-indigo-700">Add it as a new material</button></div>}

      <div className="flex gap-3 mt-3 flex-wrap">
        <label className="text-xs font-medium text-slate-600">Quantity received
          <div className="mt-1 flex items-center rounded-lg border border-slate-300 overflow-hidden bg-white">
            <input type="number" min="0" step="any" value={qty} onChange={e=>setQty(e.target.value)}
              aria-label="Quantity received" disabled={!chosen}
              className="px-3 py-2 text-sm mono text-right w-32 outline-none disabled:bg-slate-50"/>
            <span className="px-2 text-xs text-slate-500 bg-slate-50 self-stretch flex items-center">{chosen?chosen.uom:"UOM"}</span>
          </div></label>
        <label className="text-xs font-medium text-slate-600">Rate ₹ (optional)
          <input type="number" min="0" step="0.01" value={rate} onChange={e=>setRate(e.target.value)}
            aria-label="Rate for this delivery" disabled={!chosen} placeholder={chosen&&chosen.rate?String(chosen.rate):""}
            className="block mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm mono text-right w-28 disabled:bg-slate-50"/></label>
      </div>
      {chosen && valid && <div className="text-xs text-slate-600 mt-3">
        Stock will go from <b className="mono">{fmt(chosen.stock)}</b> to <b className="mono">{fmt(chosen.stock+amount)} {chosen.uom}</b>.</div>}
      {err && <div role="alert" className="text-xs text-rose-700 mt-2">{err}</div>}
      <button onClick={book} disabled={!valid||busy}
        className="mt-3 w-full text-sm font-semibold text-white rounded-lg px-4 py-2.5 bg-indigo-600 disabled:opacity-40">
        {busy?"Adding…":"Add to stock"}</button>
    </div>

    <div className="rounded-xl border border-slate-200 p-4">
      <div className="text-sm font-semibold text-slate-800 mb-1">Added in this sitting</div>
      {booked.length
        ? <ul className="divide-y divide-slate-100">
            {booked.map((b,i)=><li key={i} className="py-2 flex items-center gap-2 text-sm">
              <span className="text-emerald-600">✓</span>
              <span className="flex-1 min-w-0 truncate">{b.name}</span>
              <span className="mono text-emerald-700 whitespace-nowrap">+{fmt(b.qty)} {b.uom}</span>
              {b.stock!=null && <span className="mono text-xs text-slate-500 whitespace-nowrap">now {fmt(b.stock)}</span>}
            </li>)}
          </ul>
        : <div className="text-xs text-slate-500">Deliveries you record here are listed so you can check them off
            against the challan. The full figures are always in <button onClick={onViewAll}
            className="font-semibold text-indigo-700">View stock</button>.</div>}

      <div className="border-t border-slate-100 mt-4 pt-3">
        {adding
          ? <NewMaterial draft={adding} setDraft={setAdding} existing={INPUTS.materials}
              onSaved={async()=>{ setAdding(null); setErr(""); await onSaved(); }}
              onError={setErr} />
          : <button onClick={()=>setAdding({name:"",uom:"",colour:"",opening:"",min:"",rate:""})}
              className="text-xs font-semibold text-indigo-700">+ A material that is not on the list</button>}
      </div>
    </div>
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
