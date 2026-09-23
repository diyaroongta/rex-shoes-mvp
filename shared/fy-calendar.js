/* THE FACTORY'S OWN CALENDAR — financial-year weeks.
 *
 * Production is talked about in weeks ("what went out in W32?") and reported
 * against a financial year that starts on 1 APRIL, so a date has to be able to
 * say which FY week it falls in, and a week has to be able to say which dates
 * it covers. Both directions are needed: the plan reads forwards (this order
 * dispatches in W14) and the report reads backwards (W14 ran from the 6th to
 * the 12th).
 *
 * TWO CHOICES ARE MADE HERE, AND THEY ARE THE FACTORY'S TO CHANGE:
 *
 *   The week starts on MONDAY. The factory's own weekly plan sheet is laid out
 *   MON to SAT, so Monday is where their week begins and Sunday is the day
 *   off. `weekStartsOn` changes it without touching anything else.
 *
 *   WEEK 1 IS THE WEEK CONTAINING 1 APRIL, counted from that week's Monday —
 *   so a year beginning mid-week does not produce a stub week 1 of two days.
 *   The alternative (week 1 = 1-7 April, whatever the weekday) is what a
 *   spreadsheet does with a fill-down, and it puts a different Monday at the
 *   head of every year.
 *
 * Pure: no clock. Every function is given its date.
 */

const DAY = 86400000;
const pad = n => String(n).padStart(2, "0");

/* Dates are handled as UTC midnight so that adding days never lands on a
   daylight-saving seam, and are formatted back without ever going through
   toISOString() on a local-midnight value — that is the trap that dates an
   order to the day before it was placed. */
function utc(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if(!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
const fmt = t => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/* The financial year a date belongs to: 1 April 2026 to 31 March 2027 is
   "2026-27", written the way the factory writes it. */
export function fyOf(iso, opts = {}){
  const t = utc(iso);
  if(t == null) return null;
  const startMonth = opts.startMonth == null ? 4 : opts.startMonth;   // April
  const d = new Date(t);
  const year = d.getUTCMonth() + 1 >= startMonth ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return { year, label: `${year}-${pad((year + 1) % 100)}`,
           start: fmt(Date.UTC(year, startMonth - 1, 1)),
           end: fmt(Date.UTC(year + 1, startMonth - 1, 1) - DAY) };
}

/* The Monday (by default) on or before a date. */
export function weekStart(iso, opts = {}){
  const t = utc(iso);
  if(t == null) return null;
  const startsOn = opts.weekStartsOn == null ? 1 : opts.weekStartsOn;   // 1 = Monday
  const dow = new Date(t).getUTCDay();
  return fmt(t - (((dow - startsOn) + 7) % 7) * DAY);
}

/* A WEEK IS NEVER SPLIT BETWEEN TWO YEARS. 1 April 2026 is a Wednesday, so
   the week that contains it starts on Monday 30 March — and those two March
   days report in the NEW year's week 1, because the alternative is a week
   whose figures land in two annual reports. It follows that a date can answer
   the two questions differently: 30 March 2026 is in FY2025-26 BY DATE and in
   W01 of FY2026-27 BY WEEK. Both are true; `fyOf` answers the first and this
   answers the second. */
function fyYearOfWeek(startT, opts){
  const endT = startT + 6 * DAY;
  const startMonth = opts.startMonth == null ? 4 : opts.startMonth;
  const firstOfNext = Date.UTC(new Date(endT).getUTCFullYear(), startMonth - 1, 1);
  if(firstOfNext >= startT && firstOfNext <= endT) return new Date(endT).getUTCFullYear();
  return fyOf(fmt(startT), opts).year;
}

/* Which FY week a date falls in, and the days that week covers. */
export function fyWeek(iso, opts = {}){
  const t = utc(iso);
  if(t == null) return null;
  const start = utc(weekStart(iso, opts));
  const fy = fyOf(`${fyYearOfWeek(start, opts)}-${pad(opts.startMonth == null ? 4 : opts.startMonth)}-01`, opts);
  const firstWeek = utc(weekStart(fy.start, opts));
  const week = Math.floor((start - firstWeek) / (7 * DAY)) + 1;
  const workingDays = opts.workingDays == null ? 6 : opts.workingDays;   // Mon-Sat
  return {
    fy: fy.label, fy_year: fy.year, week,
    start: fmt(start), end: fmt(start + 6 * DAY),
    /* The last day anything is MADE in that week, which is not the same as the
       last day of the week — the factory's own sheet runs Monday to Saturday. */
    working_end: fmt(start + (workingDays - 1) * DAY),
    label: `FY${fy.label} W${pad(week)}`,
    short_label: `W${pad(week)}`,
  };
}

/* The reverse: what dates were week 14? */
export function weekRange(fyYear, week, opts = {}){
  const first = utc(weekStart(`${fyYear}-${pad(opts.startMonth == null ? 4 : opts.startMonth)}-01`, opts));
  if(first == null || !(week >= 1)) return null;
  const start = first + (week - 1) * 7 * DAY;
  return fyWeek(fmt(start), opts);
}

/* Every week of a financial year, for a report that lists them down the page.
   A year is 52 or 53 weeks depending on where its Mondays fall; both are
   returned as they come out rather than being forced to 52. */
export function weeksInFy(fyYear, opts = {}){
  const month = pad(opts.startMonth == null ? 4 : opts.startMonth);
  const out = [];
  let cursor = utc(weekStart(`${fyYear}-${month}-01`, opts));
  /* It ends where the NEXT year's week 1 begins, which is the same rule
     applied at the other end — not on 31 March, which would cut a week in
     half and leave its Saturday in one year and its Sunday in another. */
  const stop = utc(weekStart(`${fyYear + 1}-${month}-01`, opts));
  while(cursor < stop){
    out.push(fyWeek(fmt(cursor), opts));
    cursor += 7 * DAY;
  }
  return out;
}

/* The weeks between two dates, inclusive — what a date range covers on a
   weekly report. */
export function weeksBetween(fromIso, toIso, opts = {}){
  const from = utc(weekStart(fromIso, opts)), to = utc(toIso);
  if(from == null || to == null || to < from) return [];
  const out = [];
  for(let c = from; c <= to; c += 7 * DAY) out.push(fyWeek(fmt(c), opts));
  return out;
}

/* Group anything that carries a date into FY weeks, newest week last. Used by
   the weekly report and by any "per week" figure on a dashboard. */
export function byWeek(rows, dateOf, opts = {}){
  const weeks = new Map();
  for(const row of rows || []){
    const w = fyWeek(dateOf(row), opts);
    if(!w) continue;
    const g = weeks.get(w.label) || { ...w, rows: [] };
    g.rows.push(row);
    weeks.set(w.label, g);
  }
  return [...weeks.values()].sort((a, z) => a.start < z.start ? -1 : a.start > z.start ? 1 : 0);
}
