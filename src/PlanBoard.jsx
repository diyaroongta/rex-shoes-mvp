import React, { useEffect, useMemo, useRef, useState } from "react";
import { REF as INPUTS } from "./lib/refdata.js";
import { todayIso } from "./lib/today.js";
import { dayIndex, fromDay, workCalendar, normalizeOverride } from "../shared/engine.js";
import { boardRows, boardSpan, checkMove, lockAsIs, unlockStage, unlockAll, cleanOverride, moveEffects,
         dropTargets, weeklySheets } from "../shared/plan-board.js";
import { productionActualKey } from "../shared/production-actuals.js";
import PlanSheet from "./PlanSheet.jsx";

const fmt = n => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");
const nice = iso => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day:"numeric", month:"short" });
const dow = iso => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday:"short" });
/* How a job is named in a sentence: the card when it has one, else the order. */
const nameOf = b => b.card_no ? `Card ${b.card_no}` : b.order_no;
const shortName = b => b.card_no ? `JC ${b.card_no}` : b.order_no;

/* The sheet's own colours, kept to four: a grid, a header fill, and one tint
   each for "today" and "over capacity". Everything else is black on white. */
const LINE = "#cfd6e0", HEAD = "#eef1f5", TODAY = "#f3f6ff", OVER = "#fff7e0", CLOSED = "#f4f5f7";
const TH = { border:`1px solid ${LINE}`, background:HEAD, padding:"6px 8px", fontSize:11, fontWeight:700,
             textAlign:"left", verticalAlign:"bottom", color:"#1f2937" };
const TD = { border:`1px solid ${LINE}`, padding:0, verticalAlign:"top", minWidth:170 };
const BTN = "text-xs font-semibold px-3 py-1 rounded-lg border border-slate-300 bg-white disabled:opacity-50";
const WEEKS_AT_A_TIME = 4;

/* THE PRODUCTION PLAN, LAID OUT LIKE THE FACTORY'S OWN PLANNING SHEET.
 *
 * One table per week. A row is a day, a column is a work centre, and a cell
 * lists the jobs running there that day with that day's pairs — the layout of
 * the weekly planning workbook the factory already keeps, so it reads without
 * a legend. This replaced a board of floating bars over a second table that
 * said the same thing: two pictures of one plan, each needing the other.
 *
 * The engine still proposes and the planner still decides. Clicking a job
 * opens it; dragging it to another day or machine moves it. A job that is
 * moved is LOCKED there — every re-plan works around it — and the screen says
 * so each time, with an Undo, because a lock made by a slip of the mouse is
 * otherwise invisible until the plan stops flowing. Every rule about what a
 * move may do is in shared/plan-board.js; this file only draws.
 *
 * `setPlanOverride` is absent for anyone but the Production Planner and the
 * administrator: the sheet is then read-only, and the server refuses the edit
 * in any case.
 */
export default function PlanBoard({ state, caps, actuals = [], setPlanOverride = null, onReplan = null,
                                    planWith = null, onApplySheet = null }){
  const origin = INPUTS.origin;
  /* Drawn from the capacities the plan was BUILT from, not the seed's. */
  const wcs = useMemo(() => {
    const out = {};
    for(const [code, wc] of Object.entries(INPUTS.workcenters || {}))
      out[code] = { ...wc, capacity_per_day:(caps && caps[code]) ?? wc.capacity_per_day };
    return out;
  }, [caps]);
  const ctx = { wcs, articles:INPUTS.articles, origin, calendar:state.calendar };
  const rows = useMemo(() => boardRows(state, wcs).filter(r => r.blocks.length), [state, wcs]);
  const span = useMemo(() => boardSpan(rows), [rows]);
  const { off } = useMemo(() => workCalendar(state.calendar, origin), [state.calendar, origin]);
  const today = dayIndex(todayIso(), origin);

  const [earlier, setEarlier] = useState(0);          // weeks shown before the current one
  const [shown, setShown] = useState(WEEKS_AT_A_TIME);
  const [selected, setSelected] = useState(null);     // block id
  const [dragging, setDragging] = useState(null);
  const [refusal, setRefusal] = useState("");
  const [effects, setEffects] = useState(null);
  const [note, setNote] = useState("");
  const [undo, setUndo] = useState(null);             // { block, override } — the override as it was
  const [form, setForm] = useState({ date:"", work_center:"", days:"" });
  const before = useRef(null);
  const canEdit = !!setPlanOverride;

  /* THE KNOCK-ON EFFECT, computed rather than described: the plan as it was
     when the job was moved, against the plan the engine then produced. */
  useEffect(() => {
    if(!before.current || before.current === state) return;
    setEffects(moveEffects(before.current, state));
    before.current = null;
  }, [state]);

  const units = useMemo(() => new Map((state.units || []).map(u => [u.unit_key, u])), [state]);
  const blocks = useMemo(() => new Map(rows.flatMap(r => r.blocks).map(b => [b.id, b])), [rows]);
  const picked = selected ? blocks.get(selected) : null;
  useEffect(() => {
    if(picked) setForm({ date:picked.start_date, work_center:picked.work_center,
      days:String((normalizeOverride((units.get(picked.unit_key) || {}).override).days || {})[picked.stage] || "") });
  }, [selected, picked && picked.start_date, picked && picked.work_center]);
  const actualBy = useMemo(() => new Map((actuals || []).map(a => [productionActualKey(a), a])), [actuals]);
  /* The job opens ABOVE the tables. Clicked in the third week down, it would
     open a screen away and look as though nothing had happened. */
  const boxRef = useRef(null);
  useEffect(() => { if(selected && boxRef.current && boxRef.current.scrollIntoView)
    boxRef.current.scrollIntoView({ behavior:"smooth", block:"nearest" }); }, [selected]);

  if(!span) return <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center text-slate-500 text-sm mb-4">
    Nothing is on the plan yet — a job appears here once a job order is raised for it.</div>;

  /* Opens on this week. A plan that is wholly in the past opens at its start,
     so there is always something on the page. */
  const mondayOf = d => d - ((new Date(fromDay(d, origin) + "T00:00:00Z").getUTCDay() + 6) % 7);
  const anchor = today > span.last ? span.first : Math.max(span.first, today);
  const firstWeek = mondayOf(span.first), lastWeek = mondayOf(span.last);
  const start = Math.max(firstWeek, mondayOf(anchor) - 7 * earlier);
  const end = Math.min(lastWeek, mondayOf(anchor) + 7 * (shown - 1));
  const weeks = weeklySheets(rows, start, end + 6, origin);
  const lockedBlocks = [...blocks.values()].filter(b => b.locked);
  const valid = dragging ? new Set(dropTargets(units.get(dragging.unit_key) || {}, dragging.stage, wcs, INPUTS.articles)) : null;
  const overDays = rows.reduce((n, r) => n + r.over_days.filter(o => o.day >= start && o.day <= end + 6).length, 0);
  const lateJobs = new Set([...blocks.values()].filter(b => b.late).map(b => b.unit_key)).size;

  function apply(block, override, text){
    const unit = units.get(block.unit_key);
    before.current = state;
    setUndo({ block, override:cleanOverride(unit ? unit.override : {}) });
    setRefusal(""); setEffects(null); setNote(text);
    setPlanOverride(block.order_no, override, block.unit_key);
  }
  function move(block, date, work_center){
    const out = checkMove(state, { unit_key:block.unit_key, stage:block.stage, date, work_center }, ctx);
    if(!out.ok){ setRefusal(out.reason); setEffects(null); setNote(""); setUndo(null); return; }
    apply(block, out.override, `${nameOf(block)} ${block.stage} moved to ${nice(out.start_date)}`
      + (work_center && work_center !== block.work_center ? ` on ${wcs[work_center].name}` : "") + " and locked there."
      + (out.warning ? ` ⚠ ${out.warning}` : ""));
  }
  function setDays(block){
    const unit = units.get(block.unit_key); if(!unit) return;
    const ov = normalizeOverride(unit.override), n = Math.floor(Number(form.days));
    const daysMap = { ...ov.days };
    if(n >= 1) daysMap[block.stage] = n; else delete daysMap[block.stage];
    /* A duration set by hand replaces a day-by-day split that came off a sheet. */
    const daily = { ...(ov.daily || {}) };
    delete daily[block.stage];
    apply(block, cleanOverride({ ...ov, days:daysMap, daily }), n >= 1
      ? `${nameOf(block)} ${block.stage} set to run in ${n} day${n === 1 ? "" : "s"}.`
      : `${nameOf(block)} ${block.stage} goes back to its capacity-based duration.`);
  }
  function undoLast(){
    const u = undo;
    before.current = state;
    setUndo(null); setRefusal(""); setEffects(null);
    setNote(`Undone — ${nameOf(u.block)} ${u.block.stage} is back as it was.`);
    setPlanOverride(u.block.order_no, u.override, u.block.unit_key);
  }
  async function unlockEverything(){
    const keys = [...new Set(lockedBlocks.map(b => b.unit_key))];
    if(!window.confirm(`Unlock all ${lockedBlocks.length} locked job stage${lockedBlocks.length === 1 ? "" : "s"}?\n\n`
      + "They go back to the automatic planner, which will place them again from scratch.")) return;
    const n = lockedBlocks.length;
    before.current = state;
    setUndo(null); setRefusal(""); setEffects(null); setSelected(null);
    await onApplySheet(keys.map(k => ({ order_no:units.get(k).order_no, unit_key:k, override:unlockAll(units.get(k)) })));
    setNote(`${n} locked job stage${n === 1 ? "" : "s"} handed back to the automatic planner.`);
  }
  async function replan(){
    setRefusal(""); setEffects(null); setUndo(null);
    if(onReplan) await onReplan();
    const n = lockedBlocks.length;
    setNote(`Re-planned. ${n} locked job stage${n === 1 ? "" : "s"} kept in place; everything else was planned around ${n === 1 ? "it" : "them"}.`);
  }

  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mb-4" data-print-area>
    {/* ---- title, and the things a planner does to the whole plan ---- */}
    <div className="mb-2">
      <div className="text-base font-semibold text-slate-800">Weekly production plan</div>
      <div className="text-xs text-slate-500">
        {canEdit ? "Click a job to move, resize or lock it — or drag it to another day or machine."
                 : "Read-only — only the Production Planner or an administrator can change the plan."}</div>
    </div>
    <PlanSheet state={state} wcs={wcs} planWith={planWith} onApply={onApplySheet}>
      {canEdit && <button className={BTN} onClick={replan} title="Run the automatic planner again around every locked job">Re-plan</button>}
      <button className={BTN} onClick={() => window.print()}>Print</button>
    </PlanSheet>

    {/* ---- the plan at a glance ---- */}
    <div className="grid gap-2 mb-3" style={{ gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))" }}>
      <Figure label="Jobs on the plan" value={fmt(units.size)} />
      <Figure label="Running late" value={fmt(lateJobs)} tone={lateJobs ? "#be123c" : null} hint="miss their dispatch promise" />
      <Figure label="Days over capacity" value={fmt(overDays)} tone={overDays ? "#b45309" : null} hint="in the weeks shown" />
      <Figure label="Locked by a planner" value={fmt(lockedBlocks.length)} tone={lockedBlocks.length ? "#1d4ed8" : null}
        hint={lockedBlocks.length ? "re-planning works around these" : "everything is planned automatically"}
        action={canEdit && onApplySheet && lockedBlocks.length
          ? <button onClick={unlockEverything} className="text-[11px] font-semibold text-indigo-700 underline" data-noprint>Unlock all</button> : null} />
    </div>

    {refusal && <div role="alert" className="mb-3 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
      Not moved. {refusal}</div>}
    {note && !refusal && <div role="status" className="mb-3 text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-noprint>
      <span>{note}</span>
      {undo && canEdit && <button onClick={undoLast} className="ml-2 font-semibold text-indigo-700 underline">Undo</button>}
      {effects && (effects.length
        ? <table className="mt-1.5 text-xs" aria-label="Dispatch dates that moved"><tbody>{effects.map(e =>
            <tr key={e.unit_key} style={{ color:e.sla === "breach" ? "#be123c" : undefined }}>
              <td className="pr-3 mono font-semibold">{e.card_no ? `Card ${e.card_no} · ` : ""}{e.order_no}</td>
              <td className="pr-3">dispatch {nice(e.from)} → {nice(e.to)}</td>
              <td className="pr-3 mono">{e.moved_days > 0 ? "+" : ""}{e.moved_days} day{Math.abs(e.moved_days) === 1 ? "" : "s"}</td>
              <td>{e.sla === "breach" ? `misses its promise by ${e.days_late} day${e.days_late === 1 ? "" : "s"}` : ""}</td></tr>)}</tbody></table>
        : <span className="text-slate-500"> No dispatch date changed.</span>)}</div>}

    <div ref={boxRef} style={{ scrollMarginTop:90 }} />
    {picked && <JobBox block={picked} unit={units.get(picked.unit_key)} wcs={wcs} form={form} setForm={setForm} canEdit={canEdit}
      targets={dropTargets(units.get(picked.unit_key) || {}, picked.stage, wcs, INPUTS.articles)}
      onMove={() => move(picked, form.date, form.work_center)} onDays={() => setDays(picked)}
      onLock={() => apply(picked, lockAsIs(units.get(picked.unit_key), picked.stage), `${nameOf(picked)} ${picked.stage} locked where it is.`)}
      onUnlock={() => apply(picked, unlockStage(units.get(picked.unit_key), picked.stage), `${nameOf(picked)} ${picked.stage} unlocked — the automatic planner places it again.`)}
      onClose={() => setSelected(null)} />}

    {start > firstWeek && <div className="mb-2" data-noprint>
      <button className={BTN} onClick={() => setEarlier(n => n + WEEKS_AT_A_TIME)}>↑ Show earlier weeks</button></div>}

    {/* ---- one sheet per week ---- */}
    {weeks.map(week => <div key={week.monday} className="mb-5">
      <div className="flex items-baseline gap-2 mb-1">
        <div className="text-sm font-bold tracking-wide text-slate-800 uppercase">Week of {nice(week.from)} – {nice(week.to)}</div>
        {week.monday <= today && today <= week.monday + 6 && <span className="text-[11px] font-semibold text-indigo-700">this week</span>}
        {!week.any && <span className="text-[11px] text-slate-400">nothing planned</span>}
      </div>
      <div className="overflow-x-auto" style={{ border:`1px solid ${LINE}` }}>
        <table role="grid" aria-label={`Plan for the week of ${week.from}`} style={{ borderCollapse:"collapse", width:"100%", fontSize:12 }}>
          <thead><tr>
            <th style={{ ...TH, position:"sticky", left:0, zIndex:2, minWidth:92 }}>Date</th>
            {rows.map(r => <th key={r.work_center} scope="col" aria-label={r.name}
                style={{ ...TH, opacity:valid && !valid.has(r.work_center) ? 0.35 : 1 }}>
              <div>{r.name}</div>
              <div style={{ fontWeight:400, color:"#64748b" }} className="mono">{fmt(r.capacity_per_day)} a day{r.exclusive ? " · one mould" : ""}</div></th>)}
          </tr></thead>
          <tbody>{week.days.map(d => {
            const closed = off(d.day), isToday = d.day === today;
            const rowBg = isToday ? TODAY : closed ? CLOSED : "#fff";
            return <tr key={d.day}>
              <th scope="row" style={{ ...TH, background:isToday ? "#e4eaff" : closed ? "#e9ebef" : HEAD, position:"sticky", left:0, zIndex:1,
                                       verticalAlign:"top", whiteSpace:"nowrap" }}>
                <div>{dow(d.date)}</div>
                <div className="mono" style={{ fontWeight:400 }}>{nice(d.date)}</div>
                {closed && <div style={{ fontWeight:400, color:"#64748b" }}>closed</div>}
                {isToday && <div style={{ fontWeight:600, color:"#3730a3" }}>today</div>}
              </th>
              {rows.map(r => {
                const cell = d.cells[r.work_center];
                const cap = r.capacity_per_day, used = cell ? cell.pairs : 0;
                const over = used > cap + 1e-6, greyed = valid && !valid.has(r.work_center);
                return <td key={r.work_center} role="gridcell" aria-label={`${r.name} ${d.date}`}
                  onDragOver={e => { if(dragging && !greyed) e.preventDefault(); }}
                  onDrop={e => { e.preventDefault(); if(dragging){ move(dragging, d.date, r.work_center); setDragging(null); } }}
                  style={{ ...TD, background:over ? OVER : rowBg, opacity:greyed ? 0.35 : 1 }}>
                  {cell && cell.jobs.map(({ block:b, pairs }) => {
                    const actual = actualBy.get(productionActualKey({ production_on:d.date, work_center:b.work_center, stage:b.stage,
                      order_no:b.order_no, unit_key:b.unit_key }));
                    const isPicked = selected === b.id;
                    return <div key={b.id} role="button" tabIndex={0} draggable={canEdit}
                      onDragStart={ev => { setDragging(b); setRefusal(""); try{ ev.dataTransfer.setData("text/plain", b.id); ev.dataTransfer.effectAllowed = "move"; }catch(_){ } }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => setSelected(isPicked ? null : b.id)}
                      onKeyDown={e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); setSelected(isPicked ? null : b.id); } }}
                      aria-pressed={isPicked}
                      aria-label={`${nameOf(b)} ${b.stage} on ${d.date}, ${fmt(Math.round(pairs))} pairs${b.locked ? ", locked" : ""}${b.late ? ", late" : ""}`}
                      title={`${nameOf(b)} · ${b.order_no}\n${b.party} · ${b.article}\n${b.stage}: ${fmt(b.pairs)} pairs, ${nice(b.start_date)} – ${nice(b.end_date)}`}
                      style={{ display:"block", padding:"4px 8px", borderBottom:`1px solid ${LINE}`, cursor:canEdit ? "grab" : "pointer",
                        borderLeft:`3px solid ${b.locked ? "#2563eb" : "transparent"}`,
                        background:isPicked ? "#e0e7ff" : b.locked ? "#f1f6ff" : "transparent" }}>
                      <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                        <span className="mono" style={{ fontWeight:700, color:"#111827", whiteSpace:"nowrap" }}>{b.locked ? "🔒 " : ""}{shortName(b)}</span>
                        {(b.late || b.precedence_broken) && <span style={{ fontSize:10, fontWeight:700, color:"#be123c" }}>
                          {b.precedence_broken ? "out of order" : "late"}</span>}
                        <span className="mono" style={{ marginLeft:"auto", fontWeight:700 }}>{fmt(Math.round(pairs))}</span>
                      </div>
                      <div style={{ fontSize:11, color:"#475569", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:230 }}>
                        {b.article}</div>
                      <div style={{ fontSize:10, color:"#94a3b8", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:230 }}>
                        {b.party}{actual ? <span style={{ color:"#047857", fontWeight:600 }}> · made {fmt(Number(actual.actual_pairs))}</span> : null}</div>
                    </div>;
                  })}
                  {cell
                    ? <div className="mono" style={{ padding:"3px 8px", fontSize:10, textAlign:"right", color:over ? "#b45309" : "#94a3b8", fontWeight:over ? 700 : 400 }}>
                        {cell.jobs.length > 1 ? `${fmt(Math.round(used))} · ` : ""}{Math.round(100 * used / cap)}% of {fmt(cap)}
                        {over ? ` · +${fmt(Math.round(used - cap))} over` : ""}</div>
                    : <div style={{ padding:"4px 8px" }}>&nbsp;</div>}
                </td>;
              })}
            </tr>;
          })}</tbody>
          <tfoot><tr>
            <th scope="row" style={{ ...TH, position:"sticky", left:0, zIndex:1 }}>Week total</th>
            {rows.map(r => <td key={r.work_center} className="mono" style={{ ...TD, background:HEAD, padding:"5px 8px", textAlign:"right", fontWeight:700 }}>
              {week.totals[r.work_center] ? fmt(Math.round(week.totals[r.work_center])) : "—"}</td>)}
          </tr></tfoot>
        </table>
      </div>
    </div>)}

    {end < lastWeek && <div className="mb-3" data-noprint>
      <button className={BTN} onClick={() => setShown(n => n + WEEKS_AT_A_TIME)}>↓ Show later weeks</button>
      <span className="ml-2 text-xs text-slate-500">The plan runs to {nice(fromDay(span.last, origin))}.</span></div>}

    <div className="flex gap-x-5 gap-y-1 flex-wrap text-[11px] text-slate-500" data-noprint>
      <span>The figure beside a job is its pairs for that day.</span>
      <span><span style={{ borderLeft:"3px solid #2563eb", paddingLeft:4 }}>🔒 locked</span> — a planner put it there; re-planning works around it</span>
      <span><b style={{ color:"#be123c" }}>late</b> — the job misses its dispatch promise</span>
      <span><span style={{ background:OVER, padding:"0 4px" }}>shaded</span> — the line is over its daily capacity</span>
    </div>
  </div>;
}

function Figure({ label, value, tone, hint, action }){
  return <div style={{ border:`1px solid ${LINE}`, borderRadius:8, padding:"8px 10px" }}>
    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className="flex items-baseline gap-2">
      <div className="text-xl font-bold mono" style={{ color:tone || "#0f172a" }}>{value}</div>{action}</div>
    {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
  </div>;
}

/* ONE JOB, OPENED. What it is on the left, in a plain two-column table; what
   can be done to it on the right. Why it is locked is said in words — "why is
   this locked?" was the first question the board got. */
function JobBox({ block, unit, wcs, form, setForm, canEdit, targets, onMove, onDays, onLock, onUnlock, onClose }){
  const input = "text-sm border border-slate-300 rounded-lg px-2 py-1 bg-white";
  const warnings = ((unit && unit.plan_warnings) || []).filter(w => w.stage === block.stage && w.kind !== "stage_locked");
  const row = (k, v) => <tr><td className="pr-4 py-0.5 text-slate-500 whitespace-nowrap align-top">{k}</td><td className="py-0.5 text-slate-900">{v}</td></tr>;
  return <div className="mb-3 rounded-lg p-3" style={{ border:"1px solid #c7d2fe", background:"#f8faff" }} role="region" aria-label="Selected job" data-noprint>
    <div className="flex items-start gap-4 flex-wrap">
      <table className="text-xs"><tbody>
        {row("Job", <b>{block.card_no ? `Card ${block.card_no} · ` : ""}{block.order_no}</b>)}
        {row("Party", block.party || "—")}
        {row("Article", block.article)}
        {row("Stage", `${block.stage} on ${(wcs[block.work_center] || {}).name || block.work_center}`)}
        {row("Pairs", <span className="mono">{fmt(block.pairs)} — {Object.entries(block.days)
          .map(([d, n]) => `${nice(fromDay(Number(d), INPUTS.origin))}: ${fmt(Math.round(n))}`).join(" · ")}</span>)}
        {row("Planning", block.locked
          ? <span><span style={{ color:"#1d4ed8", fontWeight:600 }}>🔒 Locked — {block.from_sheet ? "set by an uploaded planning sheet" : "a planner moved it or locked it here"}.</span>
              {" "}<span style={{ color:"#475569" }}>Re-planning will not move it until it is unlocked.</span></span>
          : "Automatic — the planner places it and may move it when the plan changes.")}
      </tbody></table>
      {canEdit && <div className="flex items-end gap-2 flex-wrap ml-auto">
        <label className="text-xs text-slate-600">Start on
          <input type="date" value={form.date} onChange={e => setForm({ ...form, date:e.target.value })} aria-label="Start this job on" className={`${input} block mt-0.5`} /></label>
        {targets.length > 1 && <label className="text-xs text-slate-600">Machine
          <select value={form.work_center} onChange={e => setForm({ ...form, work_center:e.target.value })} aria-label="Run this job on" className={`${input} block mt-0.5`}>
            {targets.map(code => <option key={code} value={code}>{wcs[code].name}</option>)}</select></label>}
        <button onClick={onMove} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-700 text-white">Move and lock</button>
        <label className="text-xs text-slate-600">Run in days
          <input type="number" min="1" value={form.days} onChange={e => setForm({ ...form, days:e.target.value })} placeholder="auto"
            aria-label="Run this job in days" className={`${input} block mt-0.5 w-20`} /></label>
        <button onClick={onDays} className={BTN} style={{ padding:"6px 12px" }}>Set days</button>
        {block.locked
          ? <button onClick={onUnlock} className={BTN} style={{ padding:"6px 12px" }}>Unlock</button>
          : <button onClick={onLock} className={BTN} style={{ padding:"6px 12px" }}>Lock as-is</button>}
      </div>}
      <button onClick={onClose} className="text-xs font-semibold text-slate-500 hover:underline">Close</button>
    </div>
    {warnings.map((w, i) => <div key={i} className="mt-1.5 text-xs" style={{ color:w.kind === "precedence_broken" || w.kind === "locked_clash" ? "#be123c" : "#92400e" }}>{w.message}</div>)}
  </div>;
}
