/* THE PLAN AS A SPREADSHEET — download it, change it, upload it.
 *
 * The factory plans on a sheet: which article runs on which line or machine
 * on which day, and how many pairs. So the production plan can be taken OUT as
 * a workbook, edited there, and brought back, and the plan then follows it.
 *
 * ONE ROW IS ONE JOB, AT ONE STAGE, ON ONE DAY:
 *
 *   Date | Day | Stage | Work centre | Job card | Order | Party | Article | Sizes | Pairs | Locked | Ref
 *
 * and the planner may do four things to it:
 *
 *   change the DATE          the work moves to that day
 *   change the WORK CENTRE   it runs on another machine or line of that stage
 *   change the PAIRS         more or fewer that day
 *   add or delete a ROW      split the work over more days, or fewer
 *
 * `Ref` is what ties a row back to its job and stage. It is the one column
 * that must not be changed: the factory's own sheet names an article and a
 * party, and two live cards for "GOLA PLUS · MTS" cannot be told apart by
 * that — a row matched to the wrong card would silently re-plan somebody
 * else's work. A row with no Ref is refused, by number, rather than guessed at.
 *
 * WHAT COMES BACK BECOMES LOCKS. A job/stage whose rows were changed is
 * written into that job's plan override as `daily: {STAGE: {date: pairs}}`
 * (shared/engine.js books it first and plans everything else round it). A
 * job/stage the planner did not touch is left to the automatic planner —
 * unless they ask for the whole sheet to be locked.
 *
 * "Changed" is judged against the sheet AS IT WAS DOWNLOADED, which travels
 * inside the workbook, not against the live plan: the plan moves on between
 * the download and the upload, and comparing with the live plan would read
 * every block that moved by itself as an edit somebody made.
 *
 * Pure: no file reading, no clock. The component turns a workbook into arrays
 * and back; everything that decides anything is here.
 */
import { dayIndex, fromDay, workCalendar, normalizeOverride, workCentresInOrder } from "./engine.js";
import { boardRows, machineFits, cleanOverride } from "./plan-board.js";

export const PLAN_SHEET = "Plan";
export const SNAPSHOT_SHEET = "As downloaded";
export const HELP_SHEET = "How to use";
export const COLUMNS = ["Date", "Day", "Stage", "Work centre", "Job card", "Order", "Party", "Article",
                        "Sizes", "Pairs", "Locked", "Ref (do not change)"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const refOf = (unitKey, stage) => `${unitKey}::${stage}`;
const dowOf = iso => DOW[new Date(iso + "T00:00:00Z").getUTCDay()];

/* A block's pairs per day as WHOLE numbers that still add up to the block.
   The engine spreads a forced run evenly — 1,000 pairs over three days is
   333.33 a day — and a sheet of fractions is one nobody can plan from. */
function wholeDays(days){
  const keys = Object.keys(days).map(Number).sort((a, z) => a - z);
  const total = Math.round(keys.reduce((a, d) => a + days[d], 0));
  const base = keys.map(d => Math.floor(days[d] + 1e-9));
  let short = total - base.reduce((a, n) => a + n, 0);
  const byRemainder = keys.map((d, i) => [days[d] - base[i], i]).sort((a, z) => z[0] - a[0] || a[1] - z[1]);
  for(const [, i] of byRemainder){ if(short <= 0) break; base[i]++; short--; }
  return keys.map((d, i) => [d, base[i]]).filter(([, n]) => n > 0);
}

/* THE DOWNLOAD: every block of the plan, one row per day it runs. */
export function planRows(state, wcs, origin){
  const units = new Map(((state && state.units) || []).map(u => [u.unit_key, u]));
  const order = workCentresInOrder(wcs);
  const rows = [];
  for(const row of boardRows(state, wcs)){
    for(const b of row.blocks){
      const unit = units.get(b.unit_key) || {};
      const sizes = [...new Set((unit.lines || []).map(l => clean(l.label || l.combo)).filter(Boolean))].join(", ");
      for(const [d, pairs] of wholeDays(b.days)){
        const date = fromDay(d, origin);
        rows.push({ date, day:dowOf(date), stage:b.stage, work_center:b.work_center, work_centre:row.name,
          card_no:b.card_no || "", order_no:b.order_no, party:b.party || "", article:b.article || "", sizes,
          pairs, locked:b.locked, ref:refOf(b.unit_key, b.stage) });
      }
    }
  }
  return rows.sort((a, z) => a.date.localeCompare(z.date) || order.indexOf(a.work_center) - order.indexOf(z.work_center)
    || String(a.card_no || a.order_no).localeCompare(String(z.card_no || z.order_no), undefined, { numeric:true }));
}

/* Rows as a worksheet: an array of arrays, header first. */
export const sheetRows = rows => [COLUMNS, ...(rows || []).map(r => [r.date, r.day, r.stage, r.work_centre, r.card_no,
  r.order_no, r.party, r.article, r.sizes, r.pairs, r.locked ? "yes" : "", r.ref])];

export function helpRows(wcs){
  return [
    ["HOW TO USE THIS WORKBOOK"],
    [],
    ["1", "Open the \"Weekly plan\" sheet. It is the plan week by week: a row a day, a pair of columns a machine or line."],
    ["2", "Change it the way the plan has changed:"],
    ["", "•  More or fewer pairs that day — type over the PAIRS."],
    ["", "•  Another day — cut the JOB and its PAIRS and paste them under that day."],
    ["", "•  Another machine or line of the same stage — paste them under that machine's columns."],
    ["", "•  Over more days — put the job on each day (pick it from the list in the JOB cell, or type its card number, e.g. JC 95) and share the pairs."],
    ["", "•  A Sunday or a holiday — put the job on that day; the line is then planned to work it."],
    ["3", "Save, and upload the file on Production plan. You are shown what changed before anything is saved."],
    [],
    ["Good to know"],
    ["", "A JOB cell must START with the job card number. The article and party after it are there to read by."],
    ["", "Every job is listed on the \"Job cards\" sheet, with its order, party, sizes and dispatch date."],
    ["", "Only the jobs you change are fixed where you put them. Everything else is still planned automatically, around them."],
    ["", "Totals are worked out by the sheet. There is no need to keep them in step by hand."],
    [],
    ["MACHINES AND LINES", "Stage", "Pairs a day"],
    ...workCentresInOrder(wcs).map(code => [(wcs[code] || {}).name || code, (wcs[code] || {}).stage, (wcs[code] || {}).capacity_per_day]),
  ];
}

/* ================= THE FACTORY'S OWN WEEKLY SHEET =================
 *
 * The first download was a list — one row per job, stage and day, with a
 * `Ref` column that must not be touched. It was easy for a program to read
 * and nothing a planner could plan on: the client's verdict was "very machine
 * written… not editable". The factory already HAS a planning sheet, and this
 * is that sheet:
 *
 *   WEEK 1         |      CUTTING      |     STITCHING     |  MOULDING …
 *   09 – 15 Nov    |   Cutting hall    |  Stitching lines  |  PVC rotary …
 *   DATE  | DAY    |   JOB   |  PAIRS  |   JOB   |  PAIRS  |  JOB | PAIRS
 *   09/11 | MON    | JC 95 … |  1,200  | JC 91 … |   800   |
 *                  | JC 96 … |    600  |         |         |
 *   …
 *   WEEK 1 TOTAL   |         |  9,400  |         |  4,800  |
 *
 * A block per week, a band of rows per day, and for every machine or line a
 * JOB beside its PAIRS. The planner types over the pairs, or cuts a job and
 * its pairs and pastes them under another day or another machine. Nothing
 * else on the sheet has to be kept right.
 *
 * WHAT TIES A CELL TO ITS JOB is the card number the JOB cell starts with
 * ("JC 95 · GOLA PLUS …") — which is also what the floor calls the job. The
 * column says the work centre, and so the stage; the band says the day. The
 * old `Ref` is rebuilt from those three, so everything downstream of the
 * reading (what changed, what is refused, what is locked) is the code that was
 * already there. The plan AS DOWNLOADED still travels in the workbook, now on
 * a hidden sheet.
 */
/* A stage's band and its machines' headings, as [band, heading] colours —
   Excel's own light tints. The screen and the workbook take them from here,
   so the sheet a planner downloads looks like the one they were looking at. */
export const STAGE_TINTS = [["BDD7EE", "DDEBF7"], ["C6E0B4", "E2EFDA"], ["FFE699", "FFF2CC"], ["F8CBAD", "FCE4D6"],
                            ["D9C3E8", "EDE2F5"], ["B7DEE8", "DAEEF3"], ["D9D9D9", "EDEDED"], ["FFD3B6", "FFE9DB"]];
export const WEEKLY_SHEET = "Weekly plan";
export const JOBS_SHEET = "Job cards";
const DOW_UP = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = iso => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

export const colName = c => { let s = ""; for(let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const addr = (r, c) => `${colName(c)}${r + 1}`;

/* WHAT A JOB IS CALLED ON THE SHEET: its card number, or its order number
   while it has no card. Two jobs that would read alike carry the order too —
   a name that fits two jobs is how a row re-plans somebody else's work. */
export function jobLabels(state, wcs){
  const first = new Map();
  for(const b of boardRows(state, wcs).flatMap(r => r.blocks)) if(!first.has(b.unit_key)) first.set(b.unit_key, b);
  const short = b => b.card_no ? `JC ${b.card_no}` : String(b.order_no);
  const count = {};
  for(const b of first.values()) count[short(b)] = (count[short(b)] || 0) + 1;
  const labels = new Map(), used = new Set();
  for(const [key, b] of first){
    let name = short(b);
    if(count[name] > 1) name = b.card_no ? `JC ${b.card_no} (${b.order_no})` : key;
    if(used.has(name)) name = key;
    used.add(name); labels.set(key, name);
  }
  return labels;
}
const jobKey = v => clean(v).toUpperCase().replace(/^(JOB\s*CARD|JC|CARD)(?![A-Z])[\s.:#№\-]*/, "").replace(/\s+/g, "");

/* Every spelling a planner may give a job, to the job it means — and to null
   where a spelling fits more than one, so it is asked about instead of guessed. */
function jobIndex(state, wcs){
  const index = new Map();
  const put = (k, unit) => { if(k) index.set(k, index.has(k) && index.get(k) !== unit ? null : unit); };
  const labels = jobLabels(state, wcs);
  const blocks = new Map();
  for(const b of boardRows(state, wcs).flatMap(r => r.blocks)) if(!blocks.has(b.unit_key)) blocks.set(b.unit_key, b);
  for(const [key, name] of labels){
    const b = blocks.get(key);
    put(jobKey(name), key); put(jobKey(key), key);
    if(b.card_no) put(jobKey(`JC ${b.card_no}`), key);
    put(jobKey(b.order_no), key);
  }
  return index;
}
function matchJob(text, index){
  const head = clean(String(text == null ? "" : text).split(/[\n·|]/)[0]);
  const token = (/^(?:JOB\s*CARD|JC|CARD)?[\s.:#№\-]*([A-Z0-9][A-Z0-9\/_#\-]*)/i.exec(head) || [])[1];
  for(const t of [head, token]){
    const k = t && jobKey(t);
    if(k && index.has(k)) return index.get(k) || { ambiguous:true };
  }
  return null;
}

/* The jobs on the plan, as the list a planner looks a card up in. `pick` is
   the text a JOB cell is filled with. */
export function jobList(state, wcs){
  const units = new Map(((state && state.units) || []).map(u => [u.unit_key, u]));
  return [...jobLabels(state, wcs)].map(([key, name]) => {
    const u = units.get(key) || {};
    const sizes = [...new Set((u.lines || []).map(l => clean(l.label || l.combo)).filter(Boolean))].join(", ");
    return { unit_key:key, name, pick:`${name} · ${u.article || ""}${u.party ? ` · ${u.party}` : ""}`,
      order_no:u.order_no || "", party:u.party || "", article:u.article || "", sizes,
      pairs:Math.round(u.qty || 0), dispatch:u.dispatch_date || "", late:u.sla === "breach" };
  }).sort((a, z) => a.name.localeCompare(z.name, undefined, { numeric:true }));
}

/* THE SHEET, as a description any spreadsheet writer can draw: rows of cells
   carrying a value and a ROLE (title, week, stage, centre, head, date, day,
   job, pairs, total), the merges, and where a week ends. Styling is the
   component's business; what is on the sheet, and where, is decided here so
   it can be tested and so the reader below can never drift from the writer.

     opts.spare   empty rows left under each day for work moved onto it
     opts.min     the fewest rows a working day gets                        */
export function weeklyLayout(state, wcs, origin, { calendar = null, spare = 2, min = 4 } = {}){
  const rows = planRows(state, wcs, origin);
  if(!rows.length) return null;
  const centres = boardRows(state, wcs);
  const labels = jobLabels(state, wcs);
  const { off } = workCalendar(calendar || (state && state.calendar) || null, origin);
  const cells = new Map();                      // "date|work centre" -> rows
  for(const r of rows){
    const k = `${r.date}|${r.work_center}`;
    if(!cells.has(k)) cells.set(k, []);
    cells.get(k).push(r);
  }
  const weekday = d => new Date(fromDay(d, origin) + "T00:00:00Z").getUTCDay();
  const mondayOf = d => d - ((weekday(d) + 6) % 7);
  const firstDay = dayIndex(rows[0].date, origin);
  const lastDay = Math.max(...rows.map(r => dayIndex(r.date, origin)));
  const width = 2 + centres.length * 2;
  const out = [], merges = [], breaks = [];
  const put = (cellsOf, extra = {}) => { out.push({ cells:cellsOf, ...extra }); return out.length - 1; };

  put({ 0:{ v:"WEEKLY PRODUCTION PLAN", s:"title" } });
  merges.push([0, 0, 0, width - 1]);
  put({ 0:{ v:"Type over the PAIRS, or cut a JOB with its PAIRS and paste them under another day or another machine. "
    + "Then upload this file on Production plan. Every job is listed on the \"Job cards\" sheet.", s:"hint" } });
  merges.push([1, 0, 1, width - 1]);
  put({});

  /* One more week than the plan needs, so work can be pushed LATER too. */
  let n = 0;
  for(let monday = mondayOf(firstDay); monday <= lastDay + 7; monday += 7){
    n++;
    const band = {}, names = {}, head = { 0:{ v:"DATE", s:"head" }, 1:{ v:"DAY", s:"head" } };
    band[0] = { v:`WEEK ${n}\n${dayMonth(fromDay(monday, origin))} – ${dayMonth(fromDay(monday + 6, origin))}`, s:"week" };
    let stage = null, tone = -1;
    const tones = [];
    centres.forEach((c, i) => {
      const col = 2 + i * 2;
      if(c.stage !== stage){ stage = c.stage; tone++; band[col] = { v:stage.replace(/_/g, " "), s:"stage", tone }; }
      else band[col] = { v:"", s:"stage", tone };
      band[col + 1] = { v:"", s:"stage", tone };
      tones.push(tone);
      names[col] = { v:`${c.name}\n${Number(c.capacity_per_day || 0).toLocaleString("en-IN")} pairs a day`, s:"centre", tone };
      names[col + 1] = { v:"", s:"centre", tone };
      head[col] = { v:"JOB", s:"head" }; head[col + 1] = { v:"PAIRS", s:"head" };
    });
    const bandRow = put(band, { kind:"band" });
    const nameRow = put(names, { kind:"centres" });
    merges.push([bandRow, 0, nameRow, 1]);
    /* A stage's heading runs across every machine of that stage. */
    for(let i = 0; i < centres.length;){
      let j = i;
      while(j + 1 < centres.length && centres[j + 1].stage === centres[i].stage) j++;
      merges.push([bandRow, 2 + i * 2, bandRow, 3 + j * 2]);
      i = j + 1;
    }
    centres.forEach((c, i) => merges.push([nameRow, 2 + i * 2, nameRow, 3 + i * 2]));
    put(head, { kind:"head" });

    const firstData = out.length;
    const weekTotals = centres.map(() => 0);
    for(let d = monday; d < monday + 7; d++){
      const date = fromDay(d, origin), closed = off(d);
      const lists = centres.map(c => cells.get(`${date}|${c.work_center}`) || []);
      const busiest = Math.max(0, ...lists.map(l => l.length));
      const depth = closed ? Math.max(2, busiest + 1) : Math.max(min, busiest + spare);
      const top = out.length;
      for(let k = 0; k < depth; k++){
        const row = { 0:{ v:k ? "" : date, s:"date", off:closed }, 1:{ v:k ? "" : DOW_UP[weekday(d)], s:"day", off:closed } };
        centres.forEach((c, i) => {
          const r = lists[i][k], col = 2 + i * 2;
          row[col] = { v:r ? `${labels.get(r.ref.split("::")[0])} · ${r.article}\n${[r.sizes, r.party].filter(Boolean).join(" · ")}` : "",
            s:"job", off:closed, tone:tones[i], locked:!!(r && r.locked) };
          row[col + 1] = { v:r ? r.pairs : "", s:"pairs", off:closed, tone:tones[i] };
          if(r) weekTotals[i] += r.pairs;
        });
        put(row, { kind:"day", date, last:k === depth - 1 });
      }
      merges.push([top, 0, top + depth - 1, 0], [top, 1, top + depth - 1, 1]);
    }
    const lastData = out.length - 1;
    const total = { 0:{ v:`WEEK ${n} TOTAL`, s:"total" }, 1:{ v:"", s:"total" } };
    centres.forEach((c, i) => {
      const col = 2 + i * 2;
      total[col] = { v:"", s:"total" };
      total[col + 1] = { f:`SUM(${addr(firstData, col + 1)}:${addr(lastData, col + 1)})`, v:weekTotals[i], s:"total" };
    });
    const totalRow = put(total, { kind:"total" });
    merges.push([totalRow, 0, totalRow, 1]);
    breaks.push(put({}));
  }
  return { rows:out, merges, breaks, width, centres:centres.map(c => ({ work_center:c.work_center, name:c.name })),
    cols:[{ width:8 }, { width:6 }, ...centres.flatMap(() => [{ width:30 }, { width:9 }])], weeks:n };
}

/* The layout as bare values, the way a spreadsheet reader hands a sheet back. */
export const layoutValues = layout => (layout ? layout.rows : []).map(r => {
  const line = Array.from({ length:layout.width }, () => "");
  for(const [c, cell] of Object.entries(r.cells)) line[c] = cell.v == null ? "" : cell.v;
  return line;
});

/* Is this worksheet the weekly plan? Judged by its headings, never by its
   name — a planner renames a sheet "Week 46" without a second thought. */
export const looksWeekly = aoa => (Array.isArray(aoa) ? aoa : []).some(r => Array.isArray(r)
  && headerKey(r[0]) === "date" && r.some(c => headerKey(c) === "job") && r.some(c => headerKey(c) === "pairs"));

/* THE UPLOAD, read off the weekly sheet. Each JOB with pairs beside it becomes
   the same row the list sheet used to carry — date, work centre, pairs, ref —
   and whatever cannot be read is named by its CELL, the way a planner would
   look for it. Nothing is dropped without saying so, and nothing is guessed: a
   JOB cell that names no card on the plan stops the upload. */
export function parseWeeklySheet(aoa, state, wcs){
  const grid = Array.isArray(aoa) ? aoa : [], rows = [], problems = [];
  if(!looksWeekly(grid)) return { rows, problems:["This does not look like the weekly plan downloaded from Factory OS: no row is headed DATE with JOB and PAIRS beside it. "
    + "Download the plan from Production plan, change that file, and upload it."] };
  const index = jobIndex(state, wcs);
  /* A heading is the machine's NAME, exactly — its capacity is printed under
     it and is not part of the name. "Cutting M/C-4" is not the cutting hall. */
  const known = new Map(Object.keys(wcs || {}).flatMap(code => [[code.toLowerCase(), code], [clean((wcs[code] || {}).name).toLowerCase(), code]]));
  const centreOf = text => known.get(clean(String(text == null ? "" : text).split("\n")[0]).replace(/\s*[\d,]+\s*pairs a day.*$/i, "").toLowerCase()) || null;
  let cols = null, date = null;
  for(let i = 0; i < grid.length; i++){
    const r = grid[i] || [], first = clean(r[0]);
    if(headerKey(r[0]) === "date" && r.some(c => headerKey(c) === "job")){
      cols = []; date = null;
      const above = grid[i - 1] || [];
      r.forEach((c, j) => {
        if(headerKey(c) !== "job") return;
        const code = centreOf(above[j]);
        if(!code) problems.push(`Column ${colName(j)}: "${clean(above[j])}" (row ${i}) is not a machine or line Factory OS knows, so the jobs under it cannot be read.`);
        cols.push({ j, code });
      });
      continue;
    }
    if(!cols) continue;
    if(/\btotal\b/i.test(first) || /^week\b/i.test(first)){ cols = null; continue; }
    if(first){
      date = sheetDate(r[0]);
      if(!date) problems.push(`Row ${i + 1}: "${first}" is not a date, so the jobs under it cannot be placed on a day.`);
    }
    for(const { j, code } of cols){
      const job = clean(r[j]), raw = r[j + 1], typed = clean(raw);
      if(!job && !typed) continue;
      if(!date || !code) continue;                       // already reported, once, above
      if(!job){ problems.push(`Cell ${addr(i, j + 1)}: ${typed} pairs with no job beside them. Put the job card in ${addr(i, j)}, or clear the pairs.`); continue; }
      const unit = matchJob(r[j], index);
      if(!unit){ problems.push(`Cell ${addr(i, j)}: "${job.slice(0, 40)}" is not a job on the plan. Start the cell with the job card number — JC 95 — as it is listed on the "${JOBS_SHEET}" sheet.`); continue; }
      if(unit.ambiguous){ problems.push(`Cell ${addr(i, j)}: "${job.slice(0, 40)}" fits more than one job. Write it the way the "${JOBS_SHEET}" sheet lists it.`); continue; }
      const pairs = typed === "" ? 0 : Number(String(raw).replace(/,/g, ""));
      if(!Number.isInteger(pairs) || pairs < 0){ problems.push(`Cell ${addr(i, j + 1)}: pairs must be a whole number of 0 or more, not "${typed}".`); continue; }
      rows.push({ line:addr(i, j), date, work_centre:code, pairs, ref:refOf(unit, (wcs[code] || {}).stage) });
    }
  }
  return { rows, problems };
}

/* A date as the planner may have left it: 2026-11-17, 17/11/2026, 17-11-26,
   or the serial number Excel turns a typed date into. DAY FIRST, always — the
   factory writes 02/11 for the second of November, and reading that as the
   eleventh of February has already cost this project one bug. */
export function sheetDate(value){
  const real = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
      ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  };
  if(value instanceof Date && !isNaN(value)) return real(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if(typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000){
    const dt = new Date(Math.round((Math.floor(value) - 25569) * 86400000));
    return real(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = clean(value);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if(m) return real(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s);
  if(m) return real(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}

const headerKey = v => clean(v).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");

/* THE UPLOAD, read off the worksheet. Returns the rows it could read and, by
   row number, every row it could not — nothing is dropped without saying so. */
export function parsePlanSheet(aoa){
  const problems = [], rows = [];
  const grid = Array.isArray(aoa) ? aoa : [];
  const at = grid.findIndex(r => Array.isArray(r) && r.some(c => headerKey(c) === "ref") && r.some(c => headerKey(c) === "date"));
  if(at < 0) return { rows, problems:["This does not look like a plan downloaded from Factory OS. "
    + "Download the plan from Production plan, change that file, and upload it."] };
  const col = name => grid[at].findIndex(c => headerKey(c) === name);
  const c = { date:col("date"), wc:col("workcentre"), pairs:col("pairs"), ref:col("ref") };
  for(const [name, i] of Object.entries({ "Work centre":c.wc, "Pairs":c.pairs }))
    if(i < 0) problems.push(`The "${name}" column is missing from the sheet.`);
  if(problems.length) return { rows, problems };
  for(let i = at + 1; i < grid.length; i++){
    const r = grid[i] || [];
    if(!r.some(v => clean(v))) continue;
    const line = i + 1, ref = clean(r[c.ref]);
    if(!ref){ problems.push(`Row ${line}: no Ref, so the row cannot be matched to a job card. Copy an existing row of that job and change its Date and Pairs.`); continue; }
    const date = sheetDate(r[c.date]);
    if(!date){ problems.push(`Row ${line}: "${clean(r[c.date])}" is not a date. Write it as 2026-11-17 or 17/11/2026.`); continue; }
    const raw = r[c.pairs], pairs = Number(raw);
    if(clean(raw) === "" || !Number.isInteger(pairs) || pairs < 0){
      problems.push(`Row ${line}: Pairs must be a whole number of 0 or more, not "${clean(raw)}".`); continue; }
    rows.push({ line, date, work_centre:clean(r[c.wc]), pairs, ref });
  }
  return { rows, problems };
}

/* Rows gathered into what each job/stage is asked to do. */
function groupRows(rows){
  const groups = new Map();
  for(const r of rows || []){
    const g = groups.get(r.ref) || { ref:r.ref, centres:new Set(), days:{}, lines:[] };
    g.centres.add(clean(r.work_centre || r.work_center));
    if(r.pairs > 0) g.days[r.date] = (g.days[r.date] || 0) + r.pairs;
    if(r.line) g.lines.push(r.line);
    groups.set(r.ref, g);
  }
  return groups;
}
const sameDays = (a, z) => {
  const ka = Object.keys(a || {}).sort(), kz = Object.keys(z || {}).sort();
  return ka.length === kz.length && ka.every((k, i) => k === kz[i] && a[k] === z[k]);
};
const span = days => { const k = Object.keys(days).sort(); return k.length ? [k[0], k[k.length - 1]] : null; };
const total = days => Object.values(days || {}).reduce((a, n) => a + n, 0);

/* WHAT THE UPLOADED SHEET CHANGES, AND WHAT IT WRITES.
 *
 *   uploaded   rows of the edited "Plan" sheet (parsePlanSheet)
 *   baseline   rows of the "As downloaded" sheet, or null when it is missing —
 *              the live plan then stands in for it
 *   state      the live plan (compute())
 *
 * Returns
 *   changes    one per job/stage that will be locked, with what it was and
 *              what it becomes, and anything worth knowing about it
 *   skipped    jobs the sheet cannot be applied to, each with its reasons. A
 *              job is applied whole or not at all — never one stage of it.
 *   overrides  [{order_no, unit_key, override}] to save
 *
 * A stage that would start before the stage ahead of it has finished, two
 * articles on one moulding machine on the same days, a machine that cannot
 * make the article, a job that is no longer on the plan: each stops THAT job
 * and is said in words. Pairs that do not add up to the job, and work on a
 * closed day, are carried out and noted, exactly as the engine will do them.
 */
export function planFromSheet(uploaded, baseline, state, { wcs, articles, origin, calendar, lockAll = false } = {}){
  const units = new Map(((state && state.units) || []).map(u => [u.unit_key, u]));
  const blocks = new Map(boardRows(state, wcs).flatMap(r => r.blocks).map(b => [b.id, b]));
  const live = groupRows(planRows(state, wcs, origin));
  const base = baseline && baseline.length ? groupRows(baseline) : live;
  const up = groupRows(uploaded);
  const { off } = workCalendar(calendar || (state && state.calendar) || null, origin);
  const byName = new Map(Object.keys(wcs || {}).flatMap(code => [[code.toLowerCase(), code], [clean((wcs[code] || {}).name).toLowerCase(), code]]));
  const label = u => u.card_no ? `Card ${u.card_no} (${u.order_no})` : u.order_no;

  const bad = new Map();        // unit key -> reasons
  const fail = (key, reason) => { if(!bad.has(key)) bad.set(key, []); if(!bad.get(key).includes(reason)) bad.get(key).push(reason); };
  const orphans = [];
  const asked = new Map();      // ref -> { unit, block, work_center, days, changed, notes }

  for(const g of up.values()){
    const block = blocks.get(g.ref);
    /* A list sheet names its rows by number, the weekly sheet by cell. */
    const unitWord = typeof g.lines[0] === "string" ? "cell" : "row";
    const rows = `${unitWord}${g.lines.length === 1 ? "" : "s"} ${g.lines.slice(0, 4).join(", ")}${g.lines.length > 4 ? "…" : ""}`;
    if(!block){
      const [key, stage] = g.ref.split("::"), known = units.get(key);
      orphans.push(known
        ? `${label(known)} has no ${stage} left to plan (${rows}) — that stage is finished, or the card does not pass through it. Ignored.`
        : `${g.ref.replace("::", " · ")} (${rows}) is not on the plan any more — it is finished, cancelled, or its card was deleted. Ignored.`);
      continue;
    }
    const unit = units.get(block.unit_key);
    if(g.centres.size > 1){ fail(unit.unit_key, `${block.stage} is put on ${[...g.centres].join(" and ")} (${rows}). One job runs a stage on one work centre.`); continue; }
    const named = [...g.centres][0];
    const code = byName.get(named.toLowerCase());
    if(!code){ fail(unit.unit_key, `"${named}" (${rows}) is not a work centre. Use a name from the "${HELP_SHEET}" sheet.`); continue; }
    const fits = machineFits(unit, block.stage, code, wcs, articles);
    if(!fits.ok){ fail(unit.unit_key, `${fits.reason} (${rows})`); continue; }
    const was = base.get(g.ref) || live.get(g.ref);
    const wasCode = was ? byName.get([...was.centres][0].toLowerCase()) : block.work_center;
    const changed = code !== wasCode || !sameDays(g.days, was ? was.days : {});
    const notes = [];
    const planned = total(g.days);
    if(!planned){ fail(unit.unit_key, `${block.stage} has no pairs on any day (${rows}). Give it at least one day, or leave its rows as they were.`); continue; }
    if(planned < block.pairs) notes.push(`${planned} of its ${block.pairs} pairs are planned; the other ${block.pairs - planned} will follow on the next working days.`);
    if(planned > block.pairs) notes.push(`${planned} pairs are planned against ${block.pairs} left to make; the extra ${planned - block.pairs} will not be booked.`);
    const closed = Object.keys(g.days).filter(d => off(dayIndex(d, origin)));
    if(closed.length) notes.push(`Planned on ${closed.join(", ")}, when the factory is normally closed.`);
    const now = live.get(g.ref);
    if(changed && was && now && (byName.get([...now.centres][0].toLowerCase()) !== wasCode || !sameDays(now.days, was.days)))
      notes.push("The plan has moved since this sheet was downloaded; the sheet's figures will replace what is there now.");
    asked.set(g.ref, { unit, block, work_center:code, days:g.days, changed, notes });
  }

  /* STAGE ORDER, where the sheet FIXES a stage: it may not start before the
     stage ahead of it has finished — taking that stage from the sheet if the
     planner wrote it, and from the live plan if they left it alone. A stage
     the planner did NOT fix is not checked here: it is still the automatic
     planner's, and simply follows whatever was moved ahead of it. What that
     re-planning then does to the locks is checked by `settle`, against the
     engine's own answer rather than a guess at it. */
  for(const unit of units.values()){
    if(bad.has(unit.unit_key)) continue;
    let prev = null, gap = 0;
    for(const st of unit.stages || []){
      if(st.instant) continue;
      if(st.transit){ gap += st.end - st.start + 1; continue; }
      const a = asked.get(refOf(unit.unit_key, st.stage));
      const mine = a && (a.changed || lockAll);
      const days = mine ? a.days : (live.get(refOf(unit.unit_key, st.stage)) || { days:{} }).days;
      const s = span(days);
      if(!s){ gap = 0; continue; }
      if(prev && mine){
        const first = dayIndex(s[0], origin), lastBefore = dayIndex(prev.last, origin) + gap;
        if(first <= lastBefore)
          fail(unit.unit_key, `${st.stage} starts on ${s[0]}, but ${prev.stage} runs until ${prev.last}`
            + (gap ? ` and the uppers are ${gap} day${gap === 1 ? "" : "s"} coming back from outside stitching` : "")
            + `. A stage cannot start before the one ahead of it has finished.`);
      }
      prev = { stage:st.stage, last:s[1], mine }; gap = 0;
    }
  }

  /* ONE MOULD AT A TIME. Two different articles written onto one moulding
     machine over the same days is a mistake in the sheet, whoever is right. */
  const exclusive = [...asked.values()].filter(a => (wcs[a.work_center] || {}).exclusive && !bad.has(a.unit.unit_key));
  for(let i = 0; i < exclusive.length; i++) for(let j = i + 1; j < exclusive.length; j++){
    const a = exclusive[i], z = exclusive[j];
    if(a.work_center !== z.work_center || a.unit.article === z.unit.article) continue;
    if(!(a.changed || z.changed || lockAll)) continue;
    const sa = span(a.days), sz = span(z.days);
    if(sa[0] <= sz[1] && sz[0] <= sa[1]){
      const name = (wcs[a.work_center] || {}).name || a.work_center;
      for(const [x, y] of [[a, z], [z, a]])
        if(x.changed || lockAll) fail(x.unit.unit_key, `${name} would be running ${x.unit.article} and ${y.unit.article} `
          + `(${label(y.unit)}) over the same days, ${sa[0] > sz[0] ? sa[0] : sz[0]} to ${sa[1] < sz[1] ? sa[1] : sz[1]}. One machine carries one mould at a time.`);
    }
  }

  const changes = [], byUnit = new Map();
  for(const a of asked.values()){
    if(bad.has(a.unit.unit_key) || !(a.changed || lockAll)) continue;
    const before = live.get(a.block.id) || { days:{} };
    changes.push({ unit_key:a.unit.unit_key, order_no:a.unit.order_no, card_no:a.unit.card_no || null, party:a.unit.party,
      article:a.unit.article, stage:a.block.stage, changed:a.changed,
      from:{ work_center:a.block.work_center, name:(wcs[a.block.work_center] || {}).name || a.block.work_center, days:before.days },
      to:{ work_center:a.work_center, name:(wcs[a.work_center] || {}).name || a.work_center, days:a.days }, notes:a.notes });
    const ov = byUnit.get(a.unit.unit_key) || normalizeOverride(a.unit.override);
    const first = Object.keys(a.days).sort()[0];
    const machine = { ...ov.machine }, days = { ...ov.days };
    if(a.work_center !== a.block.work_center) machine[a.block.stage] = a.work_center;
    delete days[a.block.stage];              // the sheet's day-by-day split replaces a forced duration
    byUnit.set(a.unit.unit_key, { ...ov, machine, days, at:{ ...(ov.at || {}), [a.block.stage]:first },
      daily:{ ...(ov.daily || {}), [a.block.stage]:a.days } });
  }
  const stageRank = s => { const i = ["CUTTING", "PREPARATION", "STITCHING", "UPPER_QC", "MOLDING", "ASSEMBLY", "PACKING", "DISPATCH"].indexOf(s); return i < 0 ? 99 : i; };
  changes.sort((a, z) => String(a.card_no || a.order_no).localeCompare(String(z.card_no || z.order_no), undefined, { numeric:true })
    || stageRank(a.stage) - stageRank(z.stage));
  const untouched = [...asked.values()].filter(a => !bad.has(a.unit.unit_key) && !a.changed).length;
  return {
    changes,
    skipped:[...bad.entries()].map(([key, reasons]) => ({ unit_key:key, label:label(units.get(key)), reasons })),
    ignored:orphans,
    overrides:[...byUnit.entries()].map(([unit_key, ov]) => ({ order_no:units.get(unit_key).order_no, unit_key, override:cleanOverride(ov) })),
    unchanged:lockAll ? 0 : untouched,
    not_in_sheet:[...live.keys()].filter(ref => !up.has(ref)).length,
    used_baseline:!!(baseline && baseline.length),
  };
}

/* THE SHEET, CHECKED AGAINST THE PLANNER ITSELF.
   `planWith(overrides)` re-runs the real planner with the sheet's overrides
   laid over the live ones ({unit key: override}) and returns the plan that
   would result. A lock the engine reports as out of stage order, or as two
   locks on one moulding machine, takes its whole job out of what will be
   applied — with the engine's own words as the reason — and the plan is run
   again without it, until what is left is clean. Returns the result with
   `preview`: the plan exactly as it will stand once applied. */
export function settle(result, planWith){
  let overrides = [...result.overrides], changes = [...result.changes];
  const skipped = [...result.skipped];
  const label = u => u.card_no ? `Card ${u.card_no} (${u.order_no})` : u.order_no;
  let preview = null;
  for(let pass = 0; pass < 6; pass++){
    preview = planWith(Object.fromEntries(overrides.map(o => [o.unit_key, o.override])));
    const mine = new Set(overrides.map(o => o.unit_key));
    const broken = new Map();
    for(const w of (preview && preview.plan_warnings) || []){
      if(!mine.has(w.order_no) || (w.kind !== "precedence_broken" && w.kind !== "locked_clash")) continue;
      if(!broken.has(w.order_no)) broken.set(w.order_no, []);
      broken.get(w.order_no).push(w.message);
    }
    if(!broken.size) break;
    const units = new Map(((preview && preview.units) || []).map(u => [u.unit_key, u]));
    for(const [key, reasons] of broken)
      skipped.push({ unit_key:key, label:label(units.get(key) || { order_no:key }), reasons });
    overrides = overrides.filter(o => !broken.has(o.unit_key));
    changes = changes.filter(c => !broken.has(c.unit_key));
  }
  return { ...result, overrides, changes, skipped, preview };
}
