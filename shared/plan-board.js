/* THE PRODUCTION PLAN BOARD — the engine proposes, the planner decides.
 *
 * Rows are work centres, columns are days, and a block is one job at one
 * stage. Dragging a block LOCKS it: the stage's start day is written into the
 * job's plan override (`at: {STAGE: date}`) and from then on every re-plan
 * books that block first and flows the unlocked work around it
 * (shared/engine.js). Nothing else is stored — the board is always the engine's
 * own answer, recomputed from the overrides, so machine load, procurement
 * timing and every dispatch date move with it.
 *
 * This module is the board's rule book, kept out of the component so it can be
 * tested: what the blocks are, whether a drop is allowed, what an allowed drop
 * writes, and what it did to the dispatch dates.
 *
 *   REFUSED on the drop      stage order broken; a locked block of another
 *                            article in the way on a moulding machine; a
 *                            machine that cannot make the article; a closed day
 *   ALLOWED, and shown       a pooled line over capacity (amber); a dispatch
 *                            date pushed past its target (red)
 *
 * Pure: no database, no clock.
 */
import { dayIndex, fromDay, workCalendar, normalizeOverride, workCentresInOrder } from "./engine.js";

const isBlock = st => st && !st.instant && !st.transit && st.work_center && !st.complete;
const pairsOf = st => Object.values(st.alloc || {}).reduce((a, n) => a + n, 0);
const label = u => u.card_no ? `card ${u.card_no} (${u.order_no})` : u.order_no;

/* Every block on the board, grouped by work centre in the order a shoe passes
   through them. `days` is the per-day split, so a block that exceeds a day's
   capacity is seen running over consecutive days. */
export function boardRows(state, wcs){
  const rows = workCentresInOrder(wcs).map(code => ({ work_center:code, name:(wcs[code] || {}).name || code,
    stage:(wcs[code] || {}).stage, exclusive:!!(wcs[code] || {}).exclusive,
    capacity_per_day:(wcs[code] || {}).capacity_per_day, blocks:[], load:{}, over_days:[] }));
  const byCode = new Map(rows.map(r => [r.work_center, r]));
  const forced = (state && state.forced_load) || {};
  for(const u of (state && state.units) || []){
    for(const st of u.stages || []){
      if(!isBlock(st) || !byCode.has(st.work_center)) continue;
      const days = Object.fromEntries(Object.entries(st.alloc || {}).filter(([, n]) => n > 1e-9));
      if(!Object.keys(days).length) continue;
      byCode.get(st.work_center).blocks.push({
        id:`${u.unit_key}::${st.stage}`, unit_key:u.unit_key, order_no:u.order_no, card_no:u.card_no || null,
        party:u.party, article:u.article, stage:st.stage, work_center:st.work_center,
        start:st.start, end:st.end, start_date:st.start_date, end_date:st.end_date,
        pairs:Math.round(pairsOf(st)), days, working_days:Object.keys(days).length,
        locked:!!st.locked, from_sheet:!!st.from_sheet, precedence_broken:!!st.precedence_broken,
        /* Late is the JOB's dispatch against its promise, not this one stage. */
        late:u.sla === "breach", at_risk:u.sla === "at_risk",
        over:Object.keys(days).some(d => (forced[st.work_center] || {})[d]),
      });
    }
  }
  for(const r of rows){
    r.load = { ...(((state && state.daily_load) || {})[r.work_center] || {}) };
    r.over_days = Object.entries(r.load).filter(([, n]) => n > r.capacity_per_day + 1e-6)
      .map(([d, n]) => ({ day:Number(d), over:Math.round(n - r.capacity_per_day) }));
    r.blocks.sort((a, z) => a.start - z.start || a.unit_key.localeCompare(z.unit_key));
  }
  return rows;
}

/* The first and last day the board has to show. */
export function boardSpan(rows){
  let first = Infinity, last = -Infinity;
  for(const r of rows) for(const b of r.blocks){ first = Math.min(first, b.start); last = Math.max(last, b.end); }
  return Number.isFinite(first) ? { first, last } : null;
}

/* Can this article be made on this machine? A moulding machine is built for
   one sole type: PVC moves between the PVC machines, EVA stays on EVA, PU on
   PU. A work centre with no sole type (cutting, stitching, packing) takes
   anything of its own stage. */
export function machineFits(unit, stage, target, wcs, articles){
  const wc = (wcs || {})[target];
  if(!wc) return { ok:false, reason:`"${target}" is not a work centre.` };
  if(wc.stage !== stage)
    return { ok:false, reason:`This is a ${stage} block, and ${wc.name || target} is a ${wc.stage} line.` };
  const sole = ((articles || {})[unit.article_code || unit.article] || {}).sole_type || unit.sole_type;
  if(wc.sole_type && sole && wc.sole_type !== sole)
    return { ok:false, reason:`${unit.article} is a ${sole} article and cannot run on ${wc.name || target}.` };
  return { ok:true };
}

/* Every work centre a block may be dropped on — the rest are greyed out
   while dragging. */
export const dropTargets = (unit, stage, wcs, articles) =>
  Object.keys(wcs || {}).filter(code => machineFits(unit, stage, code, wcs, articles).ok);

const workingSpan = (from, n, off) => {
  const out = [];
  for(let d = from; out.length < n && d <= from + 800; d++) if(!off(d)) out.push(d);
  return out;
};

/* IS THIS DROP ALLOWED, AND WHAT DOES IT WRITE?
   `move` is { unit_key, stage, date, work_center? }. Answers
   { ok:false, reason } or { ok:true, override, start, end } where `override`
   is the job's whole new plan override. Nothing is fixed up silently: a drop
   that cannot stand is refused with the reason, in words the planner can act
   on. */
export function checkMove(state, move, { wcs, articles, origin, calendar } = {}){
  const unit = ((state && state.units) || []).find(u => u.unit_key === move.unit_key);
  if(!unit) return { ok:false, reason:"That job is no longer on the plan. Reload the board." };
  const idx = (unit.stages || []).findIndex(s => s.stage === move.stage);
  const st = idx >= 0 ? unit.stages[idx] : null;
  if(!st || st.instant || st.transit) return { ok:false, reason:`${label(unit)} has no ${move.stage} block to move.` };
  if(st.complete) return { ok:false, reason:`${move.stage} of ${label(unit)} is already finished on the floor.` };
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(move.date || ""))) return { ok:false, reason:"Drop the block on a day." };

  const target = move.work_center || st.work_center;
  const fits = machineFits(unit, st.stage, target, wcs, articles);
  if(!fits.ok) return fits;

  const { off } = workCalendar(calendar || (state && state.calendar) || null, origin);
  const day = dayIndex(move.date, origin);
  if(off(day)) return { ok:false, reason:`The factory is closed on ${move.date}. Drop the block on a working day.` };

  /* STAGE ORDER. Moulding cannot start before upper QC has finished, whoever
     drags it. The stage ahead may itself be unlocked — it is still where it
     is, and this block cannot go in front of it. */
  let prev = null;
  for(let i = idx - 1; i >= 0 && !prev; i--) if(!unit.stages[i].instant) prev = unit.stages[i];
  if(prev && day <= prev.end)
    return { ok:false, reason:`${st.stage} of ${label(unit)} cannot start on ${move.date}: `
      + `${prev.stage === "TRANSIT_IN" ? "the uppers are not back from outside stitching" : `${prev.stage} does not finish`} `
      + `until ${fromDay(prev.end, origin)}.` };

  const ov = normalizeOverride(unit.override);
  const wc = wcs[target];
  const pairs = pairsOf(st);
  const n = ov.days[st.stage] || Math.max(1, Math.ceil(pairs / wc.capacity_per_day - 1e-9));
  const span = workingSpan(day, n, off);
  const start = span[0], end = span[span.length - 1];

  /* MACHINE CLASH. A moulding machine runs one article at a time. Unlocked
     work in the way is simply re-planned after this block; a LOCKED block is
     not ours to push, so the drop is refused and the block in the way named. */
  if(wc.exclusive){
    for(const other of state.units || []){
      if(other.unit_key === unit.unit_key || other.article === unit.article) continue;
      const hit = (other.stages || []).find(s => s.locked && s.work_center === target && s.start <= end && start <= s.end);
      if(hit) return { ok:false, blocked_by:other.unit_key,
        reason:`${wc.name || target} is locked for ${label(other)} from ${fromDay(hit.start, origin)} to ${fromDay(hit.end, origin)}. `
          + `Unlock that block first, or drop this one clear of it.` };
    }
  }

  const machine = { ...ov.machine };
  if(target !== st.work_center) machine[st.stage] = target;
  /* A block that came from a planning sheet carries a day-by-day split. Moving
     it by hand moves the whole block, so that split no longer describes it. */
  const daily = { ...(ov.daily || {}) };
  delete daily[st.stage];
  return { ok:true, start, end, start_date:fromDay(start, origin), end_date:fromDay(end, origin),
    override:cleanOverride({ ...ov, machine, daily, at:{ ...(ov.at || {}), [st.stage]:move.date } }) };
}

/* Freeze a block exactly where the engine put it, without moving it. */
export function lockAsIs(unit, stage){
  const st = (unit.stages || []).find(s => s.stage === stage);
  if(!isBlock(st)) return null;
  const ov = normalizeOverride(unit.override);
  return cleanOverride({ ...ov, at:{ ...(ov.at || {}), [stage]:st.start_date } });
}

/* Hand a block back to the engine: its day, and the machine a drag put it on.
   A duration set in Adjust is a separate decision and is left alone. */
export function unlockStage(unit, stage){
  const ov = normalizeOverride(unit.override);
  const at = { ...(ov.at || {}) }, machine = { ...ov.machine }, daily = { ...(ov.daily || {}) };
  delete at[stage]; delete machine[stage]; delete daily[stage];
  return cleanOverride({ ...ov, at, machine, daily });
}

/* An override with nothing in it is {}, which hands the job back whole. */
export function cleanOverride(ov){
  const n = normalizeOverride(ov), out = {};
  if(n.seq != null) out.seq = n.seq;
  if(n.start_on != null) out.start_on = n.start_on;
  if(Object.keys(n.machine).length) out.machine = n.machine;
  if(Object.keys(n.days).length) out.days = n.days;
  if(n.at) out.at = n.at;
  if(n.daily) out.daily = n.daily;
  return out;
}

/* THE KNOCK-ON EFFECT. Every job whose dispatch date moved between two plans,
   with how far it moved and whether it now misses its promise. */
export function moveEffects(before, after){
  const was = new Map(((before && before.units) || []).map(u => [u.unit_key, u]));
  const out = [];
  for(const u of (after && after.units) || []){
    const b = was.get(u.unit_key);
    if(!b || b.dispatch_day === u.dispatch_day) continue;
    const slip = Math.max(0, ...(u.stages || []).map(s => s.slip_days == null ? 0 : s.slip_days));
    out.push({ unit_key:u.unit_key, order_no:u.order_no, card_no:u.card_no || null, party:u.party,
      from:b.dispatch_date, to:u.dispatch_date, moved_days:u.dispatch_day - b.dispatch_day,
      sla:u.sla, now_late:u.sla === "breach" && b.sla !== "breach", days_late:u.sla === "breach" ? slip : 0 });
  }
  return out.sort((a, z) => (z.now_late - a.now_late) || z.moved_days - a.moved_days || a.unit_key.localeCompare(z.unit_key));
}

/* MANY OVERRIDES, ONE SAVE PER ORDER. `changes` is [{order_no, unit_key,
   override}] — an uploaded planning sheet. An order's override blob holds its
   own fields at the top and each job card's under `units[<unit key>]`, and is
   saved whole. So each order's blob is built ONCE here, with every one of its
   cards' changes in it: saving card by card from the same copy of the order
   would let the last card saved wipe the ones before it. An empty override
   removes that card's entry. Returns {order_no: blob} for the orders touched. */
export function mergeOverrides(orders, changes){
  const blobs = {};
  for(const c of changes || []){
    const cur = (orders || []).find(o => o.order_no === c.order_no);
    if(!cur) continue;
    const blob = blobs[c.order_no] || JSON.parse(JSON.stringify(cur.plan_override || {}));
    const has = !!(c.override && Object.keys(c.override).length);
    if(c.unit_key && c.unit_key !== c.order_no){
      const units = { ...(blob.units || {}) };
      if(has) units[c.unit_key] = c.override; else delete units[c.unit_key];
      if(Object.keys(units).length) blob.units = units; else delete blob.units;
      blobs[c.order_no] = blob;
    }else{
      blobs[c.order_no] = { ...(has ? c.override : {}), ...(blob.units ? { units:blob.units } : {}) };
    }
  }
  return blobs;
}

/* THE PLAN AS THE FACTORY WRITES IT: one sheet per week, a row per day, a
   column per work centre, and in each cell the jobs running there that day
   with that day's pairs. Built from the same blocks as everything else, so the
   table, the workbook and the engine cannot disagree.

     weeks   [{ monday, days:[{ day, cells:{work_centre: {jobs:[{block, pairs}], pairs}} }], totals }]

   `from`/`to` are day numbers; weeks run Monday to Sunday. */
export function weeklySheets(rows, from, to, origin){
  const weekday = d => new Date(fromDay(d, origin) + "T00:00:00Z").getUTCDay();
  const mondayOf = d => d - ((weekday(d) + 6) % 7);
  const cells = new Map();
  for(const row of rows || []) for(const block of row.blocks){
    for(const [d, pairs] of Object.entries(block.days)){
      const key = `${d}|${row.work_center}`;
      if(!cells.has(key)) cells.set(key, { jobs:[], pairs:0 });
      const c = cells.get(key);
      c.jobs.push({ block, pairs });
      c.pairs += pairs;
    }
  }
  const weeks = [];
  for(let monday = mondayOf(from); monday <= to; monday += 7){
    const days = [], totals = {};
    for(let d = monday; d < monday + 7; d++){
      const dayCells = {};
      for(const row of rows || []){
        const c = cells.get(`${d}|${row.work_center}`);
        if(!c) continue;
        c.jobs.sort((a, z) => a.block.unit_key.localeCompare(z.block.unit_key, undefined, { numeric:true }));
        dayCells[row.work_center] = c;
        totals[row.work_center] = (totals[row.work_center] || 0) + c.pairs;
      }
      days.push({ day:d, date:fromDay(d, origin), cells:dayCells, any:Object.keys(dayCells).length > 0 });
    }
    weeks.push({ monday, from:fromDay(monday, origin), to:fromDay(monday + 6, origin), days, totals,
                 any:days.some(x => x.any) });
  }
  return weeks;
}

/* Every lock on one job, handed back to the planner at once. */
export function unlockAll(unit){
  let ov = normalizeOverride(unit.override);
  const stages = new Set([...Object.keys(ov.at || {}), ...Object.keys(ov.daily || {})]);
  for(const stage of stages) ov = normalizeOverride(unlockStage({ ...unit, override:ov }, stage));
  return cleanOverride(ov);
}
