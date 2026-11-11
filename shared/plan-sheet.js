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
import { boardRows, boardSpan, weeklySheets, machineFits, cleanOverride } from "./plan-board.js";

export const PLAN_SHEET = "Plan";
export const SNAPSHOT_SHEET = "As downloaded";
export const HELP_SHEET = "How to edit";
export const WEEK_SHEET = "Week view";
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
    ["HOW TO EDIT THE PLAN"],
    ["Edit the sheet called \"Plan\", then upload this workbook on Production -> Production plan."],
    [],
    ["One row is one job, at one stage, on one day."],
    ["To move work to another day", "change the Date (2026-11-17 or 17/11/2026)."],
    ["To run it on another machine or line", "change the Work centre to one from the list below, of the same stage."],
    ["To make more or fewer pairs that day", "change the Pairs."],
    ["To split work over more days", "copy the row, give the copy another Date, and share the Pairs between them."],
    ["To take a day away", "delete that row and add its Pairs to another day of the same job and stage."],
    ["A Sunday or a holiday", "may be given as the Date: the line is then planned to work that day."],
    [],
    ["Do NOT change the Ref column. It is how a row is matched to its job card and stage."],
    ["Day, Job card, Order, Party, Article, Sizes and Locked are there to read by. Changing them changes nothing."],
    ["The sheet \"As downloaded\" is the plan as it was when this file was made. Leave it alone: it is how the upload tells what you changed."],
    ["The sheet \"Week view\" is the same plan laid out week by week, to read and print. It is not read back."],
    ["Only the jobs you change are locked. Everything else is still planned automatically, around them."],
    [],
    ["WORK CENTRES", "Stage", "Pairs a day"],
    ...workCentresInOrder(wcs).map(code => [(wcs[code] || {}).name || code, (wcs[code] || {}).stage, (wcs[code] || {}).capacity_per_day]),
  ];
}

/* THE SAME PLAN, LAID OUT THE WAY THE FACTORY LAYS ITS OWN: a block per week,
   a row a day, a column a work centre, and in each cell the jobs running there
   with that day's pairs. For reading and printing only — it is never read
   back, because a cell of free text cannot be tied to a job card. */
export function weekViewRows(state, wcs, origin){
  const rows = boardRows(state, wcs).filter(r => r.blocks.length);
  const span = boardSpan(rows);
  if(!span) return [["Nothing is on the plan yet."]];
  const out = [["WEEKLY PRODUCTION PLAN — to read and print. To change the plan, edit the \"Plan\" sheet, not this one."]];
  const job = ({ block:b, pairs }) => `${b.card_no ? `JC ${b.card_no}` : b.order_no} · ${b.article} · ${Math.round(pairs)}${b.locked ? " (locked)" : ""}`;
  for(const week of weeklySheets(rows, span.first, span.last, origin)){
    if(!week.any) continue;
    out.push([], [`WEEK OF ${week.from} TO ${week.to}`],
      ["Date", "Day", ...rows.map(r => `${r.name} (${r.capacity_per_day} a day)`)]);
    for(const d of week.days)
      out.push([d.date, dowOf(d.date), ...rows.map(r => ((d.cells[r.work_center] || {}).jobs || []).map(job).join("\n"))]);
    out.push(["Week total", "", ...rows.map(r => week.totals[r.work_center] ? Math.round(week.totals[r.work_center]) : "")]);
  }
  return out;
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
  if(at < 0) return { rows, problems:["This does not look like a plan downloaded from Factory OS: no row carries both a \"Date\" and a \"Ref\" heading. "
    + "Download the plan from Production -> Production plan, edit that file, and upload it."] };
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
    if(!block){
      orphans.push(`${g.ref.replace("::", " · ")} (row ${g.lines[0]}) is not on the plan any more — it is finished, cancelled, or its card was deleted. Its rows were ignored.`);
      continue;
    }
    const unit = units.get(block.unit_key);
    const rows = `row${g.lines.length === 1 ? "" : "s"} ${g.lines.slice(0, 4).join(", ")}${g.lines.length > 4 ? "…" : ""}`;
    if(g.centres.size > 1){ fail(unit.unit_key, `${block.stage} is put on ${[...g.centres].join(" and ")} (${rows}). One job runs a stage on one work centre.`); continue; }
    const named = [...g.centres][0];
    const code = byName.get(named.toLowerCase());
    if(!code){ fail(unit.unit_key, `"${named}" (${rows}) is not a work centre. Use a name from the "How to edit" sheet.`); continue; }
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
