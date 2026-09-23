/* WHAT THE FLOOR SAID IT MADE, in the shape the planner can use.
 *
 * The daily input screen records one row per day, work centre, stage and job
 * card: the pairs actually achieved. The planner needs the same facts rolled
 * up per CARD and STAGE — how many pairs are done, and the last day anything
 * was recorded — so it can plan the balance instead of the whole stage again.
 *
 * Two rules, and both matter:
 *
 *   ACHIEVED IS CUMULATIVE. Three entries of 200 against one card's cutting
 *   are 600 pairs cut, not the last 200.
 *
 *   A RECORDED DAY IS IN THE PAST. Whatever is left of that stage is planned
 *   from the day AFTER the last entry, because the balance cannot be made
 *   again yesterday.
 *
 * Pure: no database, no clock.
 */

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const iso = v => {
  if(v == null || v === "") return null;
  if(v instanceof Date) return isNaN(v) ? null
    : `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,"0")}-${String(v.getDate()).padStart(2,"0")}`;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0,10) : null;
};

/* {unit key: {STAGE: {done, on, entries}}} — exactly what schedule() reads. */
export function progressFrom(actuals = []){
  const out = {};
  for(const row of actuals || []){
    const unit = String(row.unit_key || row.order_no || "").trim();
    const stage = String(row.stage || "").trim().toUpperCase();
    const on = iso(row.production_on);
    if(!unit || !stage) continue;
    const pairs = Math.max(0, Math.round(num(row.actual_pairs)));
    const bucket = (out[unit] = out[unit] || {});
    const cur = bucket[stage] || { done: 0, on: null, entries: 0 };
    cur.done += pairs;
    cur.entries += 1;
    /* The LAST day anything was recorded against this stage. */
    if(on && (cur.on == null || on > cur.on)) cur.on = on;
    bucket[stage] = cur;
  }
  return out;
}

/* One card's own progress, for a screen that wants to say "600 of 1,000 cut". */
export function unitProgress(progress, unitKey, stage){
  const bucket = (progress || {})[unitKey] || {};
  if(stage) return bucket[String(stage).toUpperCase()] || { done: 0, on: null, entries: 0 };
  return bucket;
}

/* Pairs still to make on a stage, given what the card carries. Never negative:
   over-recording is a keying error, not negative work. */
export function remainingOn(progress, unitKey, stage, qty){
  const done = unitProgress(progress, unitKey, stage).done;
  return Math.max(0, Math.round(num(qty) - done));
}
