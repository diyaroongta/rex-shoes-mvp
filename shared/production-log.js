/* Daily shop-floor actuals.
 *
 * Kept pure because the browser uses this to explain a bad row before Save,
 * and the API runs the same checks before anything reaches Postgres. A daily
 * log is an EVENT: corrections void the old event instead of editing history.
 */

export const DOWNTIME_REASONS = [
  "Machine breakdown",
  "Material shortage",
  "Labour shortage",
  "Power failure",
  "Changeover / mould change",
  "Quality issue",
  "Planned maintenance",
  "Other",
];

const isoDate = value => {
  const text = String(value || "").slice(0, 10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y,m,d] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(y,m-1,d));
  return parsed.getUTCFullYear()===y && parsed.getUTCMonth()===m-1 && parsed.getUTCDate()===d
    ? text : null;
};

const whole = value => {
  if(value === "" || value == null) return 0;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
};

const shortText = (value, max) => String(value || "").trim().slice(0, max);

export function validateProductionLog(input = {}, options = {}){
  const problems = [];
  const production_on = isoDate(input.production_on);
  const shift = shortText(input.shift, 20).toUpperCase();
  const work_center = shortText(input.work_center, 80).toUpperCase();
  const order_no = shortText(input.order_no, 80);
  const article = shortText(input.article, 160);
  const stage = shortText(input.stage, 80).toUpperCase();
  const good_pairs = whole(input.good_pairs);
  const rejected_pairs = whole(input.rejected_pairs);
  const downtime_minutes = whole(input.downtime_minutes);
  const downtime_reason = shortText(input.downtime_reason, 160);
  const supervisor = shortText(input.supervisor, 80);
  const note = shortText(input.note, 500);

  if(!production_on) problems.push("Enter a real production date.");
  if(production_on && options.today && production_on > options.today)
    problems.push("Actual production cannot be recorded for a future date.");
  if(!shift) problems.push("Choose a shift.");
  if(!work_center) problems.push("Choose a machine or work centre.");
  if(!order_no) problems.push("Choose the order or job number worked on.");
  if(!article) problems.push("The order must identify an article.");
  if(!stage) problems.push("Choose the production stage.");
  if(good_pairs == null) problems.push("Good pairs must be a whole number of zero or more.");
  if(rejected_pairs == null) problems.push("Rejected pairs must be a whole number of zero or more.");
  if(downtime_minutes == null) problems.push("Downtime must be a whole number of minutes.");
  if(downtime_minutes != null && downtime_minutes > 24 * 60)
    problems.push("Downtime cannot exceed 24 hours on one row.");
  if(downtime_minutes > 0 && !downtime_reason)
    problems.push("Choose a reason for the downtime.");
  if(good_pairs === 0 && rejected_pairs === 0 && downtime_minutes === 0)
    problems.push("Enter output, rejected pairs, or downtime. A completely empty result is not a production event.");

  return {
    ok: problems.length === 0,
    problems,
    value: {
      production_on, shift, work_center, order_no, article, stage,
      good_pairs: good_pairs == null ? 0 : good_pairs,
      rejected_pairs: rejected_pairs == null ? 0 : rejected_pairs,
      downtime_minutes: downtime_minutes == null ? 0 : downtime_minutes,
      downtime_reason, supervisor, note,
    },
  };
}

export function productionSummary(logs = [], today){
  const active = (logs || []).filter(row => !row.voided_at);
  const rows = today ? active.filter(row => isoDate(row.production_on) === today) : active;
  const centres = {};
  for(const row of rows){
    const code = String(row.work_center || "Unknown");
    const rec = centres[code] || (centres[code] = {
      work_center: code, stage: row.stage || "", good_pairs:0,
      rejected_pairs:0, downtime_minutes:0, entries:0,
    });
    rec.good_pairs += Number(row.good_pairs) || 0;
    rec.rejected_pairs += Number(row.rejected_pairs) || 0;
    rec.downtime_minutes += Number(row.downtime_minutes) || 0;
    rec.entries += 1;
  }
  const total = key => rows.reduce((sum,row)=>sum+(Number(row[key])||0),0);
  const good = total("good_pairs"), rejected = total("rejected_pairs");
  return {
    entries: rows.length,
    good_pairs: good,
    rejected_pairs: rejected,
    downtime_minutes: total("downtime_minutes"),
    rejection_pct: good + rejected ? 100 * rejected / (good + rejected) : 0,
    centres: Object.values(centres).sort((a,b)=>b.good_pairs-a.good_pairs || a.work_center.localeCompare(b.work_center)),
  };
}

