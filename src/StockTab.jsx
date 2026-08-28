import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import * as api from "./lib/client.js";

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

export default function StockTab({ onChanged }){
  const [edits,setEdits]=useState({});
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const [filter,setFilter]=useState("");
  const [cat,setCat]=useState("");

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

  const shown = rows.filter(r =>
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
    const header=["S.N","CATEGORY","ITEM DESCRIPTION","SIZE","UOM","OPENING STOCK","REC.","ISSUE",
      "STOCK","MIN. STOCK","ALERT","ORDER QUANTITY","RATE","STOCK VALUE"];
    const body=shown.map(r=>[r.sn,r.category,r.name,r.size,r.uom,r.opening,r.rec,r.issue,
      r.stock,r.min,r.alert?"LOW":"",r.order_qty,r.rate,r.value]);
    const ws=XLSX.utils.aoa_to_sheet([header,...body]);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"STOCK MASTER");
    XLSX.writeFile(wb,"stock-master.xlsx");
  }

  const TH={fontSize:10,fontWeight:700,padding:"5px 6px",background:"#1F3A5F",color:"#fff",
    border:"1px solid #cbd5e1",whiteSpace:"nowrap"};
  const TD={fontSize:11,padding:"3px 6px",border:"1px solid #e2e8f0"};

  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <div className="flex items-center gap-3 flex-wrap mb-3">
      <div>
        <div className="text-sm font-semibold text-slate-700">Stock register</div>
        <div className="text-xs text-slate-500">
          Stock = Opening + Rec. − Issue. Alert fires when stock falls below the minimum.
        </div>
      </div>
      <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Search item…"
        className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 ml-auto" />
      <select value={cat} onChange={e=>setCat(e.target.value)}
        className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
        <option value="">All categories</option>
        {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
      </select>
      <button onClick={exportSheet}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Export</button>
    </div>

    <div className="flex gap-4 flex-wrap mb-3 text-xs">
      <span className="text-slate-500">Items <b className="mono text-slate-800">{shown.length}</b></span>
      <span className="text-slate-500">Total stock <b className="mono text-slate-800">{fmt(totals.stock)}</b></span>
      <span className="text-slate-500">Stock value <b className="mono text-slate-800">₹{fmt(totals.value)}</b></span>
      {totals.alerts>0 && <span className="text-rose-700 font-semibold">{totals.alerts} below minimum</span>}
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
  </div>;
}
