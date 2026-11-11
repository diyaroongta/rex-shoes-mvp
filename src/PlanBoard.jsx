import React, { useEffect, useMemo, useRef, useState } from "react";
import { REF as INPUTS } from "./lib/refdata.js";
import { todayIso } from "./lib/today.js";
import { dayIndex, fromDay, workCalendar, normalizeOverride } from "../shared/engine.js";
import { boardRows, boardSpan, checkMove, lockAsIs, unlockStage, cleanOverride, moveEffects,
         dropTargets } from "../shared/plan-board.js";
import PlanSheet from "./PlanSheet.jsx";

const fmt = n => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");
const DAY_W = 96, LANE_H = 50, NAME_W = 148, WINDOW = 21;
const nice = iso => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day:"numeric", month:"short" });
/* How a job is named in a sentence: the card when it has one, else the order. */
const nameOf = b => b.card_no ? `Card ${b.card_no}` : b.order_no;
const dow = iso => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday:"short" });

/* THE PRODUCTION PLAN BOARD — work centres down, days across, one block per
 * job per stage. The engine proposes; a block the planner drags is LOCKED and
 * every re-plan flows the rest round it (shared/engine.js, shared/plan-board.js).
 *
 *   grey     where the engine put it          blue + padlock  locked by a planner
 *   red      the job misses its promise       amber day       line over capacity
 *
 * Dragging is one way in; selecting a block and typing a date is the other —
 * the same check runs for both, and a drop that cannot stand is refused with
 * its reason rather than quietly put somewhere else.
 *
 * `setPlanOverride` is absent for anyone but the Production Planner and the
 * administrator: the board is then read-only, and the server refuses the edit
 * in any case.
 */
export default function PlanBoard({ state, caps, setPlanOverride = null, onReplan = null, planWith = null, onApplySheet = null }){
  const origin = INPUTS.origin;
  /* The board is drawn from the capacities the plan was BUILT from. */
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

  const [from, setFrom] = useState(null);
  const [selected, setSelected] = useState(null);     // block id
  const [dragging, setDragging] = useState(null);     // block being dragged
  const [refusal, setRefusal] = useState("");
  const [effects, setEffects] = useState(null);
  const [note, setNote] = useState("");
  const [form, setForm] = useState({ date:"", work_center:"", days:"" });
  const before = useRef(null);
  const canEdit = !!setPlanOverride;

  /* THE KNOCK-ON EFFECT, computed rather than described: the plan as it was
     when the block was dropped, against the plan the engine then produced. */
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

  if(!span) return <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center text-slate-500 text-sm mb-4">
    Nothing is on the board yet — a job appears here once a job order is raised for it.</div>;

  const first = from == null ? Math.min(Math.max(today, span.first), span.last) : from;
  const days = Array.from({ length:WINDOW }, (_, i) => first + i);
  const last = first + WINDOW - 1;
  const locked = rows.reduce((n, r) => n + r.blocks.filter(b => b.locked).length, 0);
  const valid = dragging ? new Set(dropTargets(units.get(dragging.unit_key) || {}, dragging.stage, wcs, INPUTS.articles)) : null;

  function apply(block, override, text){
    before.current = state;
    setRefusal(""); setEffects(null); setNote(text);
    setPlanOverride(block.order_no, override, block.unit_key);
  }
  function move(block, date, work_center){
    const out = checkMove(state, { unit_key:block.unit_key, stage:block.stage, date, work_center }, ctx);
    if(!out.ok){ setRefusal(out.reason); setEffects(null); setNote(""); return; }
    apply(block, out.override, `${nameOf(block)} ${block.stage} locked to start ${nice(out.start_date)}`
      + (work_center && work_center !== block.work_center ? ` on ${wcs[work_center].name}` : "") + ".");
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

  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mb-4" data-noprint>
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <div>
        <div className="text-sm font-semibold text-slate-700">Production plan board</div>
        <div className="text-xs text-slate-500">
          {canEdit ? "Drag a block to another day or machine, or select it to move, resize or lock it. A block you move is locked; a re-plan never moves it."
                   : "Read-only — only the Production Planner or an administrator can move, lock or re-plan."}</div>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <button onClick={() => setFrom(Math.max(span.first - 2, first - 7))} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-300 bg-white">← Earlier</button>
        <button onClick={() => setFrom(null)} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-300 bg-white">Today</button>
        <button onClick={() => setFrom(first + 7)} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-300 bg-white">Later →</button>
        {canEdit && <button onClick={async () => { setRefusal(""); setEffects(null); if(onReplan) await onReplan();
            setNote(`Re-planned. ${locked} locked block${locked === 1 ? "" : "s"} kept where ${locked === 1 ? "it is" : "they are"}; everything else was planned round ${locked === 1 ? "it" : "them"}.`); }}
          className="text-xs font-semibold px-3 py-1 rounded-lg bg-indigo-700 text-white">Re-plan</button>}
      </div>
    </div>

    {/* The same plan as a workbook: out, edited in Excel, and back in. */}
    <PlanSheet state={state} wcs={wcs} planWith={planWith} onApply={onApplySheet} />

    {refusal && <div role="alert" className="mb-2 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
      Not moved. {refusal}</div>}
    {note && !refusal && <div role="status" className="mb-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{note}
      {effects && (effects.length
        ? <ul className="mt-1 space-y-0.5">{effects.map(e => <li key={e.unit_key} className="mono" style={{ color:e.sla === "breach" ? "#be123c" : undefined }}>
            {e.card_no ? `Card ${e.card_no} · ` : ""}{e.order_no} — dispatch {nice(e.from)} → {nice(e.to)} ({e.moved_days > 0 ? "+" : ""}{e.moved_days} day{Math.abs(e.moved_days) === 1 ? "" : "s"})
            {e.sla === "breach" ? ` · misses its promise by ${e.days_late} day${e.days_late === 1 ? "" : "s"}` : ""}</li>)}</ul>
        : <span className="text-slate-500"> No dispatch date changed.</span>)}</div>}

    {picked && <BlockPanel block={picked} unit={units.get(picked.unit_key)} wcs={wcs} form={form} setForm={setForm} canEdit={canEdit}
      targets={dropTargets(units.get(picked.unit_key) || {}, picked.stage, wcs, INPUTS.articles)}
      onMove={() => move(picked, form.date, form.work_center)} onDays={() => setDays(picked)}
      onLock={() => apply(picked, lockAsIs(units.get(picked.unit_key), picked.stage), `${nameOf(picked)} ${picked.stage} locked where it is.`)}
      onUnlock={() => apply(picked, unlockStage(units.get(picked.unit_key), picked.stage), `${nameOf(picked)} ${picked.stage} handed back to the planner.`)}
      onClose={() => setSelected(null)} />}

    <div className="overflow-x-auto rounded-xl border border-slate-200" role="grid" aria-label="Production plan board">
      <div style={{ minWidth:NAME_W + WINDOW * DAY_W }}>
        <div className="flex bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
          <div style={{ width:NAME_W, flex:"none", position:"sticky", left:0, zIndex:3 }} className="px-2 py-1.5 bg-slate-50 font-semibold uppercase tracking-wide">Work centre</div>
          {days.map(d => { const iso = fromDay(d, origin); return <div key={d} style={{ width:DAY_W, flex:"none",
              background:off(d) ? "#f1f5f9" : d === today ? "#eef2ff" : undefined }} className="px-1 py-1 border-l border-slate-200 text-center">
            <div className="mono font-semibold" style={{ color:d === today ? "#3730a3" : "#334155" }}>{nice(iso)}</div>
            <div>{dow(iso)}{off(d) ? " · closed" : ""}</div></div>; })}
        </div>
        {rows.map(row => {
          const shown = row.blocks.filter(b => b.end >= first && b.start <= last);
          const lanes = layLanes(shown);
          const height = Math.max(1, lanes.count) * LANE_H + 8;
          const greyed = valid && !valid.has(row.work_center);
          const overBy = Object.fromEntries(row.over_days.map(o => [o.day, o.over]));
          return <div key={row.work_center} className="flex border-b border-slate-100" role="row" aria-label={row.name}
            style={{ opacity:greyed ? 0.35 : 1 }}>
            <div style={{ width:NAME_W, flex:"none", position:"sticky", left:0, zIndex:2 }} className="px-2 py-1.5 bg-white border-r border-slate-200">
              <div className="text-xs font-semibold text-slate-700">{row.name}</div>
              <div className="text-[10px] text-slate-400 mono">{fmt(row.capacity_per_day)}/day{row.exclusive ? " · one mould" : ""}</div>
            </div>
            <div style={{ position:"relative", width:WINDOW * DAY_W, height, flex:"none" }}>
              {days.map((d, i) => <div key={d} role="gridcell" aria-label={`${row.name} ${fromDay(d, origin)}`}
                onDragOver={e => { if(dragging && !greyed && !off(d)) e.preventDefault(); }}
                onDrop={e => { e.preventDefault(); if(dragging){ move(dragging, fromDay(d, origin), row.work_center); setDragging(null); } }}
                style={{ position:"absolute", left:i * DAY_W, top:0, width:DAY_W, height,
                  background:overBy[d] ? "#fffbeb" : off(d) ? "#f8fafc" : undefined }}
                className="border-l border-slate-100">
                {overBy[d] && <div className="absolute bottom-0 right-1 text-[10px] mono font-semibold" style={{ color:"#b45309" }}
                  title="Booked past this line's daily capacity">+{fmt(overBy[d])} over</div>}
              </div>)}
              {shown.map(b => {
                const s = Math.max(b.start, first), e = Math.min(b.end, last);
                const isPicked = selected === b.id;
                return <button key={b.id} type="button" draggable={canEdit}
                  onDragStart={ev => { setDragging(b); setRefusal(""); try{ ev.dataTransfer.setData("text/plain", b.id); ev.dataTransfer.effectAllowed = "move"; }catch(_){ } }}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => setSelected(isPicked ? null : b.id)}
                  aria-label={`${b.card_no ? `Card ${b.card_no}` : b.order_no} ${b.stage}, ${fmt(b.pairs)} pairs, ${b.start_date} to ${b.end_date}${b.locked ? ", locked" : ""}`}
                  title={`${b.card_no ? `Card ${b.card_no} · ` : ""}${b.order_no} · ${b.party} · ${b.article}\n${b.stage} · ${fmt(b.pairs)} pairs · ${nice(b.start_date)} – ${nice(b.end_date)}`
                    + Object.entries(b.days).map(([d, n]) => `\n${nice(fromDay(Number(d), origin))}: ${fmt(Math.round(n))}`).join("")}
                  style={{ position:"absolute", left:(s - first) * DAY_W + 2, top:4 + lanes.of.get(b.id) * LANE_H,
                    width:(e - s + 1) * DAY_W - 4, height:LANE_H - 6, textAlign:"left", overflow:"hidden", zIndex:1,
                    cursor:canEdit ? "grab" : "pointer", borderRadius:8, padding:"2px 6px",
                    background:b.locked ? "#dbeafe" : "#f1f5f9", color:b.locked ? "#1e3a8a" : "#334155",
                    border:b.late || b.precedence_broken ? "2px solid #e11d48" : isPicked ? "2px solid #4338ca" : `1px solid ${b.locked ? "#93c5fd" : "#cbd5e1"}` }}>
                  <div className="text-[11px] font-semibold mono whitespace-nowrap">
                    {b.locked ? "🔒 " : ""}{b.card_no ? `JC ${b.card_no}` : b.order_no} · {fmt(b.pairs)} pr{b.start < first ? " ←" : ""}{b.end > last ? " →" : ""}</div>
                  <div className="text-[10px] whitespace-nowrap opacity-80">{b.party} · {b.article}</div>
                  {b.precedence_broken && <div className="text-[10px] font-semibold whitespace-nowrap" style={{ color:"#be123c" }}>precedence broken</div>}
                </button>;
              })}
            </div>
          </div>;
        })}
      </div>
    </div>
    <div className="mt-2 flex gap-3 flex-wrap text-[11px] text-slate-500">
      <Key bg="#f1f5f9" border="#cbd5e1" label="planned by the engine" />
      <Key bg="#dbeafe" border="#93c5fd" label="🔒 locked by a planner" />
      <Key bg="#fff" border="#e11d48" label="job misses its promise, or a lock out of stage order" />
      <Key bg="#fffbeb" border="#fcd34d" label="line over its daily capacity" />
      <span>A block larger than one day's capacity runs over consecutive working days; on a moulding machine nothing else runs between them.</span>
    </div>
  </div>;
}

function Key({ bg, border, label }){
  return <span className="inline-flex items-center gap-1">
    <span style={{ width:14, height:10, background:bg, border:`1px solid ${border}`, borderRadius:2, display:"inline-block" }} />{label}</span>;
}

/* Blocks that overlap in time on one line are stacked, never drawn on top of
   each other: a pooled line legitimately runs several jobs on one day. */
function layLanes(blocks){
  const ends = [], of = new Map();
  for(const b of [...blocks].sort((a, z) => a.start - z.start || a.id.localeCompare(z.id))){
    let lane = ends.findIndex(end => end < b.start);
    if(lane < 0){ lane = ends.length; ends.push(b.end); } else ends[lane] = b.end;
    of.set(b.id, lane);
  }
  return { of, count:ends.length };
}

function BlockPanel({ block, unit, wcs, form, setForm, canEdit, targets, onMove, onDays, onLock, onUnlock, onClose }){
  const input = "text-sm border border-slate-300 rounded-lg px-2 py-1 bg-white";
  const warnings = ((unit && unit.plan_warnings) || []).filter(w => w.stage === block.stage);
  return <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3" role="region" aria-label="Selected block">
    <div className="flex items-start gap-3 flex-wrap">
      <div className="text-xs text-slate-700">
        <div className="font-semibold text-slate-800">{block.locked ? "🔒 " : ""}{block.card_no ? `Card ${block.card_no} · ` : ""}{block.order_no} — {block.stage}</div>
        <div>{block.party} · {block.article} · <b className="mono">{fmt(block.pairs)}</b> pairs on {(wcs[block.work_center] || {}).name || block.work_center}</div>
        <div className="mono text-slate-500">{Object.entries(block.days).map(([d, n]) => `${nice(fromDay(Number(d), INPUTS.origin))}: ${fmt(Math.round(n))}`).join(" · ")}</div>
      </div>
      <button onClick={onClose} className="ml-auto text-xs font-semibold text-slate-500 hover:underline">Close</button>
    </div>
    {warnings.map((w, i) => <div key={i} className="mt-1 text-xs" style={{ color:w.kind === "precedence_broken" || w.kind === "locked_clash" ? "#be123c" : "#92400e" }}>{w.message}</div>)}
    {canEdit && <div className="mt-2 flex items-end gap-3 flex-wrap">
      <label className="text-xs text-slate-600">Start on
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date:e.target.value })} aria-label="Start this block on" className={`${input} block mt-0.5`} /></label>
      {targets.length > 1 && <label className="text-xs text-slate-600">Machine
        <select value={form.work_center} onChange={e => setForm({ ...form, work_center:e.target.value })} aria-label="Run this block on" className={`${input} block mt-0.5`}>
          {targets.map(code => <option key={code} value={code}>{wcs[code].name}</option>)}</select></label>}
      <button onClick={onMove} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-700 text-white">Move and lock</button>
      <label className="text-xs text-slate-600">Run in days
        <input type="number" min="1" value={form.days} onChange={e => setForm({ ...form, days:e.target.value })} placeholder="auto"
          aria-label="Run this block in days" className={`${input} block mt-0.5 w-20`} /></label>
      <button onClick={onDays} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Set days</button>
      {block.locked
        ? <button onClick={onUnlock} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Unlock</button>
        : <button onClick={onLock} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Lock as-is</button>}
    </div>}
  </div>;
}
