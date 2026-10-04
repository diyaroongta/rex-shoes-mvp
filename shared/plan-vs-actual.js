/* Planned against achieved, over time — the analysis, not the single day.
 *
 * THE RULE THIS MODULE EXISTS FOR: a row nobody reported is NOT a row that
 * achieved zero. The MIS already refuses to call a forecast an actual; the
 * same honesty is needed one level down, because summing unreported rows as
 * zeros makes a factory that simply has not filled the sheet in look like a
 * factory that stopped working. So every bucket carries three figures:
 *
 *   planned            what the plan asked for, reported or not
 *   planned_reported   the planned pairs of the rows that WERE reported
 *   actual             what those reported rows achieved
 *
 * and the percentage is actual against planned_reported — like for like. What
 * is missing is stated as coverage rather than folded into the result.
 *
 * Pure: no database, no clock. The day is whatever the rows carry.
 */
import { withProductionActuals } from "./production-actuals.js";
import { fyWeek } from "./fy-calendar.js";

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round1 = n => Math.round(n * 10) / 10;

function blank(extra){
  return { planned:0, planned_reported:0, actual:0, rows:0, reported_rows:0, ...extra };
}
function add(bucket, row){
  bucket.planned += num(row.planned_pairs);
  bucket.rows += 1;
  if(row.actual_pairs != null){
    bucket.planned_reported += num(row.planned_pairs);
    bucket.actual += num(row.actual_pairs);
    bucket.reported_rows += 1;
  }
}
function close(bucket){
  return { ...bucket,
    variance: bucket.actual - bucket.planned_reported,
    /* Against the reported rows only. Null, not zero, when nothing has been
       reported: "no figure" and "achieved nothing" are different claims. */
    pct: bucket.planned_reported ? round1(100 * bucket.actual / bucket.planned_reported) : null,
    coverage: bucket.rows ? round1(100 * bucket.reported_rows / bucket.rows) : null,
    unreported_planned: bucket.planned - bucket.planned_reported,
  };
}

function group(rows, keyOf, extraOf){
  const out = new Map();
  for(const row of rows){
    const key = keyOf(row);
    if(key == null || key === "") continue;
    const bucket = out.get(key) || out.set(key, blank(extraOf ? extraOf(row, key) : { key })).get(key);
    add(bucket, row);
  }
  return [...out.values()].map(close);
}

export function planVsActual(planned, actuals, opts = {}){
  const rows = withProductionActuals(planned || [], actuals || []);

  const days = group(rows, r => r.production_on, (r, key) => ({ key, date: key }))
    .sort((a, z) => a.date.localeCompare(z.date));

  const weeks = group(rows, r => {
    const w = fyWeek(r.production_on, opts);
    return w ? w.label : "";
  }, (r, key) => {
    /* fyWeek already carries the week's own dates, so nothing recomputes them
       — weekRange takes the fy YEAR, and handing it the "2026-27" label
       silently returned a week two years out. */
    const w = fyWeek(r.production_on, opts) || {};
    return { key, fy: w.fy, fy_year: w.fy_year, week: w.week, label: w.label,
             short_label: w.short_label, from: w.start, to: w.end };
  }).sort((a, z) => String(a.from).localeCompare(String(z.from)));

  const stages = group(rows, r => r.stage, (r, key) => ({ key, stage: key }))
    .sort((a, z) => z.planned - a.planned);
  const work_centres = group(rows, r => r.work_center, (r, key) => ({ key, work_center: key }))
    .sort((a, z) => z.planned - a.planned);

  const totals = close(rows.reduce((b, r) => (add(b, r), b), blank({ key:"all" })));

  return { days, weeks, stages, work_centres, totals,
           /* Nothing reported at all is worth saying once, loudly, rather than
              rendering a board of empty percentages. */
           reported: totals.reported_rows > 0 };
}

/* The worst days first — where the plan and the floor disagreed most, counting
   only days somebody actually reported. */
export function biggestGaps(analysis, limit = 5){
  return (analysis.days || [])
    .filter(d => d.reported_rows > 0)
    .sort((a, z) => a.variance - z.variance)
    .slice(0, limit);
}

/* PLAN ADHERENCE % — did the floor make what the plan asked, WHEN it asked?
 *
 * Achievement (above) lets a good day cover a bad one: 600 against 500 on
 * Monday and 400 against 500 on Tuesday reads 100%. Adherence does not. Each
 * plan row counts only up to what it planned — min(achieved, planned) — so
 * over-making one job never hides under-making another:
 *
 *   adherence      Σ min(achieved, planned) / Σ planned, over REPORTED past rows
 *   adherence_all  the same over EVERY past row, an unreported row counting 0 —
 *                  the strict figure, shown beside coverage so neither misleads
 *
 * Only days up to `asOf` count: tomorrow's plan cannot have been missed yet.
 * The planned figure of a recorded row is the one it was SAVED with, i.e. the
 * plan as it stood that day, not the plan after the floor's entry moved it.
 */
export function planAdherence(planned, actuals, asOf, opts = {}){
  const rows = withProductionActuals(planned || [], actuals || [])
    .filter(r => r.production_on && r.production_on <= asOf && num(r.planned_pairs) > 0);
  const blankA = extra => ({ planned:0, planned_reported:0, met:0, met_reported:0, actual:0, rows:0, reported_rows:0, ...extra });
  const addA = (b, r) => {
    const p = num(r.planned_pairs);
    b.planned += p; b.rows += 1;
    if(r.actual_pairs != null){
      const a = num(r.actual_pairs), m = Math.min(a, p);
      b.planned_reported += p; b.met_reported += m; b.met += m; b.actual += a; b.reported_rows += 1;
    }
  };
  const closeA = b => ({ ...b,
    adherence: b.planned_reported ? round1(100 * b.met_reported / b.planned_reported) : null,
    adherence_all: b.planned ? round1(100 * b.met / b.planned) : null,
    coverage: b.rows ? round1(100 * b.reported_rows / b.rows) : null,
    shortfall: b.planned_reported - b.met_reported });
  const groupA = (keyOf, extraOf) => {
    const out = new Map();
    for(const r of rows){
      const k = keyOf(r); if(!k) continue;
      if(!out.has(k)) out.set(k, blankA(extraOf(r, k)));
      addA(out.get(k), r);
    }
    return [...out.values()].map(closeA);
  };
  const weeks = groupA(r => (fyWeek(r.production_on, opts) || {}).label, r => {
    const w = fyWeek(r.production_on, opts) || {};
    return { key:w.label, label:w.label, short_label:w.short_label, from:w.start, to:w.end };
  }).sort((a, z) => String(a.from).localeCompare(String(z.from)));
  const stages = groupA(r => r.stage, (r, k) => ({ key:k, stage:k })).sort((a, z) => z.planned - a.planned);
  const work_centres = groupA(r => r.work_center, (r, k) => ({ key:k, work_center:k })).sort((a, z) => z.planned - a.planned);
  const totals = closeA(rows.reduce((b, r) => (addA(b, r), b), blankA({ key:"all" })));
  return { as_of:asOf, weeks, stages, work_centres, totals, reported: totals.reported_rows > 0 };
}
