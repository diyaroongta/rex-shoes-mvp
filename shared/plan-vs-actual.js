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
