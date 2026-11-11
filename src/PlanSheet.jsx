import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { REF as INPUTS } from "./lib/refdata.js";
import { todayIso } from "./lib/today.js";
import { planRows, sheetRows, helpRows, parsePlanSheet, planFromSheet, settle,
         PLAN_SHEET, SNAPSHOT_SHEET, HELP_SHEET } from "../shared/plan-sheet.js";
import { moveEffects } from "../shared/plan-board.js";

const fmt = n => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");
const nice = iso => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day:"numeric", month:"short" });
const BTN = "text-xs font-semibold px-3 py-1 rounded-lg border border-slate-300 bg-white disabled:opacity-50";
/* FileReader rather than file.arrayBuffer(): older Safari on the factory's
   own machines, and the test browser, have the first and not the second. */
const bytesOf = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error("the file could not be opened"));
  reader.readAsArrayBuffer(file);
});
const daysText = days => Object.keys(days || {}).sort().map(d => `${nice(d)}: ${fmt(days[d])}`).join(" · ") || "—";

/* THE PLAN AS A SPREADSHEET — the way the factory already plans.
 *
 *   1. Download   the plan as it stands, one row per job, stage and day
 *   2. Edit       in Excel: move a day, change a machine, change the pairs,
 *                 split a job over more days
 *   3. Upload     the same file. What changed is shown BEFORE anything is
 *                 saved, with the dispatch dates it moves; only then is it
 *                 applied.
 *
 * The reading, the comparing and every rule about what a sheet may do are in
 * shared/plan-sheet.js. This only turns a workbook into rows and back, and
 * shows the answer. An upload is checked by the real planner (`planWith`)
 * before it is offered, so the preview is the plan that will be saved.
 */
export default function PlanSheet({ state, wcs, planWith = null, onApply = null }){
  const origin = INPUTS.origin;
  const ctx = { wcs, articles:INPUTS.articles, origin, calendar:state.calendar };
  const [sheet, setSheet] = useState(null);        // { name, rows, baseline, problems }
  const [lockAll, setLockAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const input = useRef(null);
  const rows = useMemo(() => planRows(state, wcs, origin), [state, wcs, origin]);

  function download(){
    const wb = XLSX.utils.book_new();
    const widths = [12, 6, 13, 24, 9, 10, 22, 26, 22, 8, 7, 30].map(wch => ({ wch }));
    for(const name of [PLAN_SHEET, SNAPSHOT_SHEET]){
      const ws = XLSX.utils.aoa_to_sheet(sheetRows(rows));
      ws["!cols"] = widths;
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    const help = XLSX.utils.aoa_to_sheet(helpRows(wcs));
    help["!cols"] = [{ wch:44 }, { wch:70 }, { wch:12 }];
    XLSX.utils.book_append_sheet(wb, help, HELP_SHEET);
    XLSX.writeFile(wb, `production-plan-${todayIso()}.xlsx`);
    setMsg(`Plan downloaded — ${fmt(rows.length)} rows. Edit the "Plan" sheet and upload the same file here.`); setErr("");
  }

  async function read(file){
    setErr(""); setMsg(""); setSheet(null); setLockAll(false);
    try{
      const wb = XLSX.read(await bytesOf(file));
      const grid = name => XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, raw:true, defval:"" });
      const planName = wb.SheetNames.includes(PLAN_SHEET) ? PLAN_SHEET : wb.SheetNames[0];
      const up = parsePlanSheet(grid(planName));
      const base = wb.SheetNames.includes(SNAPSHOT_SHEET) ? parsePlanSheet(grid(SNAPSHOT_SHEET)) : { rows:null };
      setSheet({ name:file.name, rows:up.rows, problems:up.problems, baseline:base.rows });
    }catch(e){ setErr(`That file could not be read as an Excel workbook: ${e.message || e}`); }
    if(input.current) input.current.value = "";
  }

  /* Worked out from the sheet AND the live plan each time either changes, so
     a plan that moves while the preview is open is never applied stale. */
  const result = useMemo(() => {
    if(!sheet || sheet.problems.length) return null;
    const raw = planFromSheet(sheet.rows, sheet.baseline, state, { ...ctx, lockAll });
    return planWith ? settle(raw, planWith) : raw;
  }, [sheet, state, lockAll, planWith]);
  const effects = useMemo(() => result && result.preview ? moveEffects(state, result.preview) : [], [result, state]);

  async function apply(){
    setBusy(true); setErr("");
    try{
      const n = result.changes.length, out = await onApply(result.overrides);
      if(out && out.failed && out.failed.length) setErr(`Not everything was saved: ${out.failed.join("; ")}`);
      else setMsg(`Plan updated from ${sheet.name}: ${n} job stage${n === 1 ? "" : "s"} now follow the sheet and are locked. Everything else was re-planned around them.`);
      setSheet(null);
    }catch(e){ setErr(String(e.message || e)); }
    finally{ setBusy(false); }
  }

  return <div className="mb-3">
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-slate-600">Plan as a sheet</span>
      <button onClick={download} disabled={!rows.length} className={BTN}>Download plan (.xlsx)</button>
      {onApply && <>
        <button onClick={() => input.current && input.current.click()} className={BTN}>Upload edited plan</button>
        <input ref={input} type="file" accept=".xlsx,.xls" aria-label="Upload an edited plan workbook" className="hidden"
          onChange={e => e.target.files && e.target.files[0] && read(e.target.files[0])} />
      </>}
      <span className="text-xs text-slate-500">Download, change dates, machines or pairs in Excel, and upload the same file — the plan follows the sheet.</span>
    </div>
    {err && <div role="alert" className="mt-2 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
    {msg && !sheet && <div role="status" className="mt-2 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</div>}

    {sheet && <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3" role="region" aria-label="Uploaded plan">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="text-sm font-semibold text-slate-800">{sheet.name}</div>
        <button onClick={() => setSheet(null)} className="ml-auto text-xs font-semibold text-slate-500 hover:underline">Discard</button>
      </div>

      {!!sheet.problems.length && <div role="alert" className="mt-2 text-xs text-rose-800">
        <b>Nothing was applied.</b> {sheet.problems.length === 1 && !/^Row/.test(sheet.problems[0]) ? "" : "These rows could not be read — correct them and upload the file again, so no part of the sheet is lost:"}
        <ul className="mt-1 ml-4 list-disc">{sheet.problems.slice(0, 12).map((p, i) => <li key={i}>{p}</li>)}</ul>
        {sheet.problems.length > 12 && <div>…and {sheet.problems.length - 12} more.</div>}
      </div>}

      {result && <>
        <div className="mt-1 text-xs text-slate-600">
          <b className="text-slate-800">{result.changes.length}</b> job stage{result.changes.length === 1 ? "" : "s"} will follow the sheet
          {!lockAll && <> · {result.unchanged} left as planned</>}
          {!!result.skipped.length && <> · <b className="text-rose-700">{result.skipped.length} job{result.skipped.length === 1 ? "" : "s"} cannot be applied</b></>}
          {!!result.not_in_sheet && <> · {result.not_in_sheet} not in the sheet, left as they are</>}
          {!result.used_baseline && <> · compared with the live plan (this file carries no "{SNAPSHOT_SHEET}" sheet)</>}
        </div>
        <label className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-slate-700">
          <input type="checkbox" checked={lockAll} onChange={e => setLockAll(e.target.checked)} aria-label="Lock every block in the sheet" />
          Lock every block in the sheet, not only the ones I changed</label>

        {!!result.skipped.length && <div role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          <b>Not applied — correct these in the sheet and upload again.</b> A job is applied whole or not at all.
          <ul className="mt-1 space-y-1">{result.skipped.map(s => <li key={s.unit_key}><b>{s.label}</b>
            <ul className="ml-4 list-disc">{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></li>)}</ul></div>}
        {!!result.ignored.length && <div className="mt-2 text-xs text-amber-800">
          {result.ignored.slice(0, 5).map((t, i) => <div key={i}>{t}</div>)}
          {result.ignored.length > 5 && <div>…and {result.ignored.length - 5} more rows for jobs no longer on the plan.</div>}</div>}

        {!!result.changes.length && <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs" aria-label="Changes from the uploaded plan">
            <thead><tr className="text-left text-slate-500"><th className="pr-3 py-1">Job</th><th className="pr-3">Stage</th>
              <th className="pr-3">Now</th><th className="pr-3">In the sheet</th></tr></thead>
            <tbody>{result.changes.map(c => <tr key={`${c.unit_key}|${c.stage}`} className="border-t border-indigo-100 align-top">
              <td className="pr-3 py-1 mono font-semibold whitespace-nowrap">{c.card_no ? `Card ${c.card_no} · ` : ""}{c.order_no}
                <div className="font-sans font-normal text-slate-500">{c.party} · {c.article}</div></td>
              <td className="pr-3 py-1">{c.stage}{!c.changed && <div className="text-slate-400">unchanged, locked</div>}</td>
              <td className="pr-3 py-1 text-slate-500">{c.from.name}<div className="mono">{daysText(c.from.days)}</div></td>
              <td className="pr-3 py-1"><span style={{ fontWeight:c.to.work_center !== c.from.work_center ? 700 : 400 }}>{c.to.name}</span>
                <div className="mono text-slate-800">{daysText(c.to.days)}</div>
                {c.notes.map((n, i) => <div key={i} className="text-amber-800">{n}</div>)}</td>
            </tr>)}</tbody>
          </table></div>}

        {!!result.changes.length && result.preview && <div className="mt-2 text-xs text-slate-700">
          <b>What it does to dispatch:</b>{" "}
          {effects.length
            ? <ul className="mt-0.5 space-y-0.5">{effects.map(e => <li key={e.unit_key} className="mono" style={{ color:e.sla === "breach" ? "#be123c" : undefined }}>
                {e.card_no ? `Card ${e.card_no} · ` : ""}{e.order_no} — {nice(e.from)} → {nice(e.to)} ({e.moved_days > 0 ? "+" : ""}{e.moved_days} day{Math.abs(e.moved_days) === 1 ? "" : "s"})
                {e.sla === "breach" ? ` · misses its promise by ${e.days_late} day${e.days_late === 1 ? "" : "s"}` : ""}</li>)}</ul>
            : <span className="text-slate-500">no dispatch date changes.</span>}</div>}

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button disabled={busy || !result.changes.length} onClick={apply}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-700 text-white disabled:opacity-50">
            {result.changes.length ? `Apply ${result.changes.length} change${result.changes.length === 1 ? "" : "s"} to the plan` : "Nothing to apply"}</button>
          {!result.changes.length && !result.skipped.length && <span className="text-xs text-slate-500">
            The sheet matches the plan as it was downloaded — nothing was changed in it.</span>}
          {!!result.changes.length && <span className="text-xs text-slate-500">Applied blocks are locked; unlock one on the board to hand it back to the planner.</span>}
        </div>
      </>}
    </div>}
  </div>;
}
