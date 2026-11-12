import React, { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import * as api from "./lib/client.js";
import { parseStockWorkbook, importPlan } from "../shared/store-register.js";

const fmt = n => (n==null||isNaN(n)) ? "" : Number(n).toLocaleString("en-IN",{maximumFractionDigits:2});

/* LOAD THE FACTORY'S OWN STOCK SHEET onto the Item Register.
   Their monthly workbook — SOLE MASTER, INSOLE MASTER, CHEMICAL MASTER … — as
   they keep it, .numbers or .xlsx. Read in the browser, previewed, and only
   then written: new items in ONE request (one history snapshot, not six
   hundred), changed figures on existing items in a second. Rows that cannot be
   loaded are named by sheet and row, never dropped in silence. */
export default function StockSheetImport({ onLoaded }){
  const fileRef = useRef(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function read(file){
    setErr(""); setMsg(""); setPlan(null);
    try{
      const wb = XLSX.read(await file.arrayBuffer(), { type:"array" });
      const sheets = {};
      for(const name of wb.SheetNames)
        sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, defval:"", raw:true });
      const parsed = parseStockWorkbook(sheets);
      if(!parsed.ok) throw new Error(parsed.problems.join("; "));
      setPlan({ file:file.name, parsed, ...importPlan(parsed.items, INPUTS.materials || {}, INPUTS.stock_meta || {}) });
    }catch(e){ setErr(`${file.name}: ${e.message || e}`); }
    finally{ if(fileRef.current) fileRef.current.value = ""; }
  }

  async function apply(){
    setBusy(true); setErr("");
    try{
      if(plan.create.length) await api.addMaterials(plan.create);
      if(Object.keys(plan.update).length) await api.patchReference({ stock_meta:plan.update });
      await reloadReference();
      setMsg(`${plan.create.length} item${plan.create.length === 1 ? "" : "s"} added, ${plan.changes.length} updated from ${plan.file}.`);
      setPlan(null);
      if(onLoaded) await onLoaded();
    }catch(e){ setErr(e.message || String(e)); }
    finally{ setBusy(false); }
  }

  const byCategory = plan ? plan.parsed.items.reduce((m, i) => ({ ...m, [i.category]:(m[i.category] || 0) + 1 }), {}) : {};
  return <>
    <label className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-800 cursor-pointer">
      Load factory stock sheet
      <input ref={fileRef} type="file" accept=".numbers,.xlsx,.xls" className="hidden" aria-label="Factory stock sheet"
        onChange={e => e.target.files[0] && read(e.target.files[0])}/>
    </label>
    {(err || msg || plan) && <div className="w-full">
      {err && <div role="alert" className="text-xs text-rose-700 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 mt-1">{err}</div>}
      {msg && <div className="text-xs text-emerald-800 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 mt-1">{msg}</div>}
      {plan && <div className="text-xs text-slate-700 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 mt-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span><b>{plan.file}</b>{plan.parsed.month && <> · {plan.parsed.month}</>} — <b>{plan.parsed.items.length}</b> items read:{" "}
            {Object.entries(byCategory).map(([c, n]) => `${c} ${n}`).join(", ")}</span>
          <button disabled={busy || (!plan.create.length && !plan.changes.length)} onClick={apply}
            className="ml-auto text-xs font-semibold text-white bg-amber-700 rounded-lg px-3 py-1.5 disabled:opacity-50">
            {busy ? "Loading…" : `Add ${plan.create.length} new · update ${plan.changes.length}`}</button>
          <button onClick={() => setPlan(null)} className="text-xs font-semibold border border-slate-300 bg-white rounded-lg px-3 py-1.5">Cancel</button>
        </div>
        <ul className="list-disc pl-5 mt-1.5 space-y-0.5">
          <li><b>{plan.create.length}</b> new item{plan.create.length === 1 ? "" : "s"}; <b>{plan.changes.length}</b> already on the register with a changed figure; {plan.unchanged} unchanged. A blank cell changes nothing.</li>
          {plan.changes.length > 0 && <li>Changes: {plan.changes.slice(0, 8).map(c => `${c.name} (${c.diff.map(d => `${d.field} ${fmt(d.before) || "—"} → ${fmt(d.after) || d.after}`).join(", ")})`).join("; ")}
            {plan.changes.length > 8 && ` and ${plan.changes.length - 8} more`}.</li>}
          {/* A duplicate is the store's to settle and is said loudly; the summary
              block under the packing items is not an item and is said quietly. */}
          {plan.parsed.skipped.filter(s => !/not an item row/.test(s.reason)).length > 0 && <li className="text-rose-800"><b>Not loaded:</b>{" "}
            {plan.parsed.skipped.filter(s => !/not an item row/.test(s.reason)).map(s => `${s.name} — ${s.where}: ${s.reason}`).join("; ")}.</li>}
          {plan.parsed.skipped.some(s => /not an item row/.test(s.reason)) && <li className="text-slate-500">
            Not read as items (no S.N or UOM): {plan.parsed.skipped.filter(s => /not an item row/.test(s.reason)).map(s => s.name).join(", ")}.</li>}
          {plan.parsed.warnings.length > 0 && <li><details><summary className="cursor-pointer">
            {plan.parsed.warnings.length} cell{plan.parsed.warnings.length === 1 ? "" : "s"} could not be read as a figure and {plan.parsed.warnings.length === 1 ? "was" : "were"} left blank</summary>
            <ul className="list-[circle] pl-5">{plan.parsed.warnings.map(w => <li key={w}>{w}</li>)}</ul></details></li>}
          {plan.parsed.daily_figures > 0 && <li>The sheet has <b>{plan.parsed.daily_figures}</b> figure{plan.parsed.daily_figures === 1 ? "" : "s"} in its
            daily REC./ISSUE columns. They are <b>not</b> loaded — the opening stock is. Enter the month's movements in the Issue Register,
            or fold them into OPENING STOCK before loading.</li>}
        </ul>
      </div>}
    </div>}
  </>;
}
