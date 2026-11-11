/* The plan as a spreadsheet: download it, change it, upload it, and the plan
 * follows the sheet.
 *
 * What these lock down: the download is whole pairs that add up; the upload
 * reads dates DAY FIRST; only what the planner changed is locked; a job is
 * applied whole or not at all; and — the point of the whole thing — after an
 * upload the plan says exactly what the sheet said.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { compute, dayIndex, fromDay, normalizeOverride } from "../shared/engine.js";
import { planRows, sheetRows, helpRows, sheetDate, parsePlanSheet, planFromSheet, settle, COLUMNS } from "../shared/plan-sheet.js";
import { checkMove, unlockStage, mergeOverrides } from "../shared/plan-board.js";
import { INPUTS } from "../shared/inputs.js";

const { articles, materials, workcenters: wcs, origin } = INPUTS;
const ctx = { wcs, articles, origin };
const plan = (orders, overrides = {}) => compute(orders, articles, materials, wcs, origin, { overrides });

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const order = (no, article, qty, combo) => ({ order_no:no, order_date:"2026-07-06", article_code:article, priority:2,
  party:`Party ${no}`, lines:[{ combo:combo || articles[article].combo_order[0], qty }] });
const A = order("JO1", "REX GOLA (V)", 1500);
const B = order("JO2", "SMART BOY (L) BLACK", 1200);
const E = order("JO4", "JILL", 800);
const stageOf = (state, no, stage) => state.units.find(u => u.unit_key === no).stages.find(s => s.stage === stage);
const later = (iso, n) => fromDay(dayIndex(iso, origin) + n, origin);
const isSunday = iso => new Date(iso + "T00:00:00Z").getUTCDay() === 0;
const nextOpen = iso => { let d = iso; while(isSunday(d)) d = later(d, 1); return d; };
/* What the browser does: the sheet out, the planner's edit, the sheet back in. */
const download = state => sheetRows(planRows(state, wcs, origin));
const upload = (aoa, state, baselineAoa, opts = {}) => {
  const up = parsePlanSheet(aoa), base = baselineAoa ? parsePlanSheet(baselineAoa) : { rows:null };
  return { parsed:up, ...planFromSheet(up.rows, base.rows, state, { ...ctx, ...opts }) };
};
const COL = Object.fromEntries(COLUMNS.map((c, i) => [c.replace(/ \(.*/, ""), i]));
const rowsOf = (aoa, ref) => aoa.filter(r => r[COL.Ref] === ref);
const apply = (orders, result, existing = {}) => plan(orders, { ...existing, ...Object.fromEntries(result.overrides.map(o => [o.unit_key, o.override])) });

console.log("\nA — the download");
test("one row per job, per stage, per day — whole pairs that add up to the job", () => {
  const state = plan([A, B]);
  const rows = planRows(state, wcs, origin);
  const mould = rows.filter(r => r.ref === "JO1::MOLDING");
  assert.equal(mould.length, 2, "1,500 pairs on a 1,200-a-day machine run two days");
  assert.equal(mould.reduce((a, r) => a + r.pairs, 0), 1500);
  assert.ok(rows.every(r => Number.isInteger(r.pairs) && r.pairs > 0));
  for(const stage of ["CUTTING", "STITCHING", "PACKING"])
    assert.equal(rows.filter(r => r.ref === `JO1::${stage}`).reduce((a, r) => a + r.pairs, 0), 1500, stage);
  assert.deepEqual(rows.map(r => r.date), [...rows.map(r => r.date)].sort(), "rows run in date order");
});
test("an evenly forced run is written as whole pairs, not thirds", () => {
  const state = plan([order("JO9", "REX GOLA (V)", 1000)], { JO9:{ days:{ CUTTING:3 } } });
  const cut = planRows(state, wcs, origin).filter(r => r.ref === "JO9::CUTTING").map(r => r.pairs);
  assert.deepEqual(cut, [334, 333, 333]);
});
test("the sheet names the work centre, the article and the day in words", () => {
  const aoa = download(plan([A]));
  assert.deepEqual(aoa[0], COLUMNS);
  const first = aoa[1];
  assert.equal(first[COL["Work centre"]], "Cutting hall");
  assert.equal(first[COL.Article], "REX GOLA (V)");
  assert.equal(first[COL.Day], "Mon");
  assert.equal(first[COL.Ref], "JO1::CUTTING");
  assert.ok(helpRows(wcs).some(r => r[0] === "PVC rotary" && r[1] === "MOLDING"));
});

console.log("\nB — dates, day first");
test("reads the ways a planner writes a date, and never month-first", () => {
  assert.equal(sheetDate("2026-11-17"), "2026-11-17");
  assert.equal(sheetDate("17/11/2026"), "2026-11-17");
  assert.equal(sheetDate("02/11/2026"), "2026-11-02", "the second of November, not the eleventh of February");
  assert.equal(sheetDate("2-11-26"), "2026-11-02");
  assert.equal(sheetDate("17.11.2026"), "2026-11-17");
  /* What Excel stores once a date has been typed into a cell. */
  assert.equal(sheetDate(Date.UTC(2026, 10, 17) / 86400000 + 25569), "2026-11-17");
  assert.equal(sheetDate(new Date(2026, 10, 17)), "2026-11-17");
  for(const bad of ["31/02/2026", "soon", "", null, 12, "13/13/2026"]) assert.equal(sheetDate(bad), null, String(bad));
});

console.log("\nC — reading the sheet back");
test("a sheet uploaded exactly as it was downloaded changes nothing", () => {
  const state = plan([A, B]);
  const aoa = download(state);
  const out = upload(aoa, state, aoa);
  assert.deepEqual(out.parsed.problems, []);
  assert.deepEqual(out.changes, []);
  assert.deepEqual(out.overrides, []);
  assert.equal(out.unchanged, 14);
});
test("the heading row is found under a title, and a row that cannot be read is named", () => {
  const aoa = [["WEEKLY PLANNING"], [], ...download(plan([A]))];
  aoa.push(["2026-08-01", "", "", "Cutting hall", "", "", "", "", "", 10, "", ""]);          // no Ref
  aoa.push(["soon", "", "", "Cutting hall", "", "", "", "", "", 10, "", "JO1::CUTTING"]);    // no date
  aoa.push(["2026-08-01", "", "", "Cutting hall", "", "", "", "", "", "ten", "", "JO1::CUTTING"]);
  aoa.push([]);
  const { rows, problems } = parsePlanSheet(aoa);
  assert.equal(rows.length, download(plan([A])).length - 1);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /Row \d+: no Ref/);
  assert.match(problems[1], /"soon" is not a date/);
  assert.match(problems[2], /Pairs must be a whole number/);
});
test("a workbook that is not the downloaded plan is refused, with what to do", () => {
  const { rows, problems } = parsePlanSheet([["WEEK 1", "CUTTING", "STITCHING"], ["02/11", "MON", "GOLA PLUS", 1200]]);
  assert.deepEqual(rows, []);
  assert.match(problems[0], /does not look like a plan downloaded from Factory OS/);
  assert.match(parsePlanSheet([["Date", "Ref"]]).problems.join(" "), /"Work centre" column is missing/);
});

console.log("\nD — what an edit does");
test("moving a day locks that job's stage on the new day, and nothing else", () => {
  const state = plan([A, B]);
  const aoa = download(state);
  const [row] = rowsOf(aoa, "JO1::PACKING");
  const to = nextOpen(later(row[COL.Date], 3));
  row[COL.Date] = to;
  const out = upload(aoa, state, download(state));
  assert.equal(out.changes.length, 1);
  assert.deepEqual([out.changes[0].unit_key, out.changes[0].stage, out.changes[0].to.days], ["JO1", "PACKING", { [to]:1500 }]);
  assert.deepEqual(out.overrides, [{ order_no:"JO1", unit_key:"JO1", override:{ at:{ PACKING:to }, daily:{ PACKING:{ [to]:1500 } } } }]);
  const after = apply([A, B], out);
  const st = stageOf(after, "JO1", "PACKING");
  assert.equal(st.start_date, to);
  assert.equal(st.locked, true);
  assert.equal(st.from_sheet, true);
  /* The stage behind it follows; the other job is untouched. */
  assert.ok(stageOf(after, "JO1", "DISPATCH").start > st.end);
  assert.equal(stageOf(after, "JO2", "PACKING").start_date, stageOf(state, "JO2", "PACKING").start_date);
  assert.deepEqual(after.schedule_problems, []);
});
test("the plan then says exactly what the sheet said", () => {
  const state = plan([A, B]);
  const aoa = download(state);
  /* 1,500 pairs of moulding, written by hand as 500 a day over three days. */
  const mould = rowsOf(aoa, "JO1::MOLDING");
  const start = nextOpen(later(mould[0][COL.Date], 7));
  const days = [start, nextOpen(later(start, 1)), nextOpen(later(nextOpen(later(start, 1)), 1))];
  const edited = aoa.filter(r => r[COL.Ref] !== "JO1::MOLDING");
  for(const d of days){ const r = [...mould[0]]; r[COL.Date] = d; r[COL.Pairs] = 500; edited.push(r); }
  const out = upload(edited, state, aoa);
  assert.equal(out.changes.length, 1);
  const after = apply([A, B], out);
  const back = planRows(after, wcs, origin).filter(r => r.ref === "JO1::MOLDING").map(r => [r.date, r.pairs, r.locked]);
  assert.deepEqual(back, days.map(d => [d, 500, true]));
});
test("a job the planner did not touch is left to the automatic planner", () => {
  const state = plan([A, B]);
  const aoa = download(state);
  rowsOf(aoa, "JO1::PACKING")[0][COL.Date] = nextOpen(later(rowsOf(aoa, "JO1::PACKING")[0][COL.Date], 2));
  const out = upload(aoa, state, download(state));
  assert.ok(out.overrides.every(o => o.unit_key === "JO1"));
  assert.equal(out.unchanged, 13);
});
test("changing the work centre moves the job to that machine", () => {
  const state = plan([A]);
  const aoa = download(state);
  for(const r of rowsOf(aoa, "JO1::MOLDING")) r[COL["Work centre"]] = "pvc VERTICAL";      // however it is typed
  const out = upload(aoa, state, download(state));
  assert.deepEqual(out.skipped, []);
  assert.equal(out.overrides[0].override.machine.MOLDING, "MOLDING_PVC_VERTICAL");
  assert.equal(stageOf(apply([A], out), "JO1", "MOLDING").work_center, "MOLDING_PVC_VERTICAL");
});
test("a Sunday written on the sheet is worked, and said", () => {
  const state = plan([A]);
  const aoa = download(state);
  const [row] = rowsOf(aoa, "JO1::PACKING");
  let sunday = later(row[COL.Date], 1); while(!isSunday(sunday)) sunday = later(sunday, 1);
  row[COL.Date] = sunday;
  const out = upload(aoa, state, download(state));
  assert.match(out.changes[0].notes.join(" "), /when the factory is normally closed/);
  const after = apply([A], out);
  assert.equal(stageOf(after, "JO1", "PACKING").start_date, sunday);
  assert.ok(after.plan_warnings.some(w => w.kind === "off_day_worked"));
  assert.equal(after.daily_load.PACKING[dayIndex(sunday, origin)], 1500);
});
test("pairs that do not add up are carried out and noted, not refused", () => {
  const state = plan([A]);
  const short = download(state);
  rowsOf(short, "JO1::PACKING")[0][COL.Pairs] = 1000;
  const a = upload(short, state, download(state));
  assert.match(a.changes[0].notes[0], /1000 of its 1500 pairs are planned; the other 500 will follow/);
  const afterShort = apply([A], a);
  assert.equal(Object.values(stageOf(afterShort, "JO1", "PACKING").alloc).reduce((x, n) => x + n, 0), 1500);
  assert.ok(afterShort.plan_warnings.some(w => w.kind === "sheet_short"));

  const over = download(state);
  rowsOf(over, "JO1::PACKING")[0][COL.Pairs] = 1800;
  const b = upload(over, state, download(state));
  assert.match(b.changes[0].notes[0], /extra 300 will not be booked/);
  const afterOver = apply([A], b);
  assert.equal(Object.values(stageOf(afterOver, "JO1", "PACKING").alloc).reduce((x, n) => x + n, 0), 1500);
  assert.ok(afterOver.plan_warnings.some(w => w.kind === "sheet_over"));
});

console.log("\nE — what a sheet may not do");
test("a stage put before the one ahead of it stops that whole job, and says why", () => {
  const state = plan([A, B]);
  const aoa = download(state);
  const cutting = rowsOf(aoa, "JO1::CUTTING")[0][COL.Date];
  for(const r of rowsOf(aoa, "JO1::STITCHING")) r[COL.Date] = cutting;
  /* A perfectly good change to the same job, in the same sheet... */
  rowsOf(aoa, "JO1::DISPATCH")[0][COL.Date] = nextOpen(later(rowsOf(aoa, "JO1::DISPATCH")[0][COL.Date], 5));
  /* ...and one to another job. */
  rowsOf(aoa, "JO2::PACKING")[0][COL.Date] = nextOpen(later(rowsOf(aoa, "JO2::PACKING")[0][COL.Date], 2));
  const out = upload(aoa, state, download(state));
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].unit_key, "JO1");
  assert.match(out.skipped[0].reasons[0], /STITCHING starts on .* but PREPARATION runs until/);
  /* A job is applied whole or not at all. */
  assert.deepEqual(out.overrides.map(o => o.unit_key), ["JO2"]);
});
test("a machine that cannot make the article, or that does not exist, stops the job", () => {
  const state = plan([A]);
  const wrong = download(state);
  for(const r of rowsOf(wrong, "JO1::MOLDING")) r[COL["Work centre"]] = "EVA molding";
  assert.match(upload(wrong, state, download(state)).skipped[0].reasons[0], /PVC article and cannot run on EVA molding/);
  const unknown = download(state);
  rowsOf(unknown, "JO1::CUTTING")[0][COL["Work centre"]] = "Line 9";
  assert.match(upload(unknown, state, download(state)).skipped[0].reasons[0], /"Line 9" .* is not a work centre/);
  const two = download(state);
  rowsOf(two, "JO1::MOLDING")[0][COL["Work centre"]] = "PVC vertical";
  assert.match(upload(two, state, download(state)).skipped[0].reasons[0], /One job runs a stage on one work centre/);
});
test("two articles written onto one moulding machine over the same days are both stopped", () => {
  const state = plan([A, B]);
  const aoa = download(state);
  const a = rowsOf(aoa, "JO1::MOLDING"), b = rowsOf(aoa, "JO2::MOLDING");
  assert.equal(a[0][COL["Work centre"]], b[0][COL["Work centre"]], "the fixture must share a machine");
  /* JO2's moulding dragged onto JO1's days — after its own upper QC, so only the machine is wrong. */
  const day = nextOpen(later(a[0][COL.Date], 0));
  const qcEnd = stageOf(state, "JO2", "UPPER_QC").end_date;
  const edited = aoa.filter(r => r[COL.Ref] !== "JO2::MOLDING" && r[COL.Ref] !== "JO1::MOLDING");
  const shared = nextOpen(later(qcEnd > day ? qcEnd : day, 1));
  for(const src of [a[0], b[0]]){ const r = [...src]; r[COL.Date] = shared; r[COL.Pairs] = src === a[0] ? 1500 : 1200; edited.push(r); }
  const out = upload(edited, state, aoa);
  const reasons = out.skipped.flatMap(s => s.reasons).join(" ");
  assert.match(reasons, /One machine carries one mould at a time/);
  assert.deepEqual(out.skipped.map(s => s.unit_key).sort(), ["JO1", "JO2"]);
});
test("rows for a job that has left the plan are ignored, and said", () => {
  const state = plan([A]);
  const aoa = download(plan([A, E]));
  const out = upload(aoa, state, aoa);
  assert.equal(out.ignored.length, 7);
  assert.match(out.ignored[0], /JO4 · CUTTING .* is not on the plan any more/);
  assert.deepEqual(out.changes, []);
});
test("a stage given no pairs at all is refused rather than quietly dropped", () => {
  const state = plan([A]);
  const aoa = download(state);
  rowsOf(aoa, "JO1::PACKING")[0][COL.Pairs] = 0;
  assert.match(upload(aoa, state, download(state)).skipped[0].reasons[0], /PACKING has no pairs on any day/);
});

test("the engine has the last word: a lock it reports as out of order takes its job out", () => {
  const state = plan([A, B]);
  const aoa = download(state);
  /* Cutting pushed three weeks later, and moulding FIXED where it already is:
     each is fine against the stage beside it in the sheet, and impossible together. */
  const cut = rowsOf(aoa, "JO1::CUTTING")[0];
  cut[COL.Date] = nextOpen(later(cut[COL.Date], 21));
  const mould = rowsOf(aoa, "JO1::MOLDING");
  mould[0][COL.Pairs] = mould[0][COL.Pairs] - 100; mould[1][COL.Pairs] = mould[1][COL.Pairs] + 100;
  rowsOf(aoa, "JO2::PACKING")[0][COL.Date] = nextOpen(later(rowsOf(aoa, "JO2::PACKING")[0][COL.Date], 2));
  const raw = upload(aoa, state, download(state));
  assert.deepEqual(raw.skipped, [], "nothing in the sheet alone gives it away");
  const planWith = extra => plan([A, B], extra);
  const out = settle(raw, planWith);
  assert.deepEqual(out.skipped.map(s => s.unit_key), ["JO1"]);
  assert.match(out.skipped[0].reasons.join(" "), /is locked to start .* but the stage before it does not finish until/);
  assert.deepEqual(out.overrides.map(o => o.unit_key), ["JO2"]);
  assert.deepEqual(out.changes.map(c => c.unit_key), ["JO2"]);
  /* What is left is clean, and the preview IS the plan that will be saved. */
  assert.ok(!out.preview.plan_warnings.some(w => w.kind === "precedence_broken"));
  assert.equal(stageOf(out.preview, "JO2", "PACKING").locked, true);
  assert.equal(stageOf(out.preview, "JO1", "CUTTING").locked, undefined);
});
test("a clean sheet settles in one pass and previews the plan it makes", () => {
  const state = plan([A]);
  const aoa = download(state);
  const to = nextOpen(later(rowsOf(aoa, "JO1::CUTTING")[0][COL.Date], 3));
  rowsOf(aoa, "JO1::CUTTING")[0][COL.Date] = to;
  const out = settle(upload(aoa, state, download(state)), extra => plan([A], extra));
  assert.deepEqual(out.skipped, []);
  assert.equal(stageOf(out.preview, "JO1", "CUTTING").start_date, to);
  assert.ok(out.preview.units[0].dispatch_day > state.units[0].dispatch_day, "everything behind it follows");
});

console.log("\nF — the plan moved while the sheet was out");
test("blocks that moved by themselves are not read as edits", () => {
  const before = plan([A]);
  const aoa = download(before);                       // downloaded on Monday...
  const now = plan([A, { ...B, priority:1 }]);        // ...and a rush order went in ahead of it
  assert.notEqual(stageOf(now, "JO1", "CUTTING").start_date + stageOf(now, "JO1", "MOLDING").start_date,
                  stageOf(before, "JO1", "CUTTING").start_date + stageOf(before, "JO1", "MOLDING").start_date, "the fixture must move JO1");
  const out = upload(aoa, now, aoa);                  // uploaded untouched
  assert.deepEqual(out.changes, []);
  assert.equal(out.used_baseline, true);
});
test("an edit to a block that has since moved is applied, and the planner is told it moved", () => {
  const before = plan([A]);
  const base = download(before), aoa = download(before);
  const now = plan([A, { ...B, priority:1 }]);
  const to = nextOpen(later(rowsOf(aoa, "JO1::DISPATCH")[0][COL.Date], 20));
  rowsOf(aoa, "JO1::DISPATCH")[0][COL.Date] = to;
  const moved = stageOf(now, "JO1", "DISPATCH").start_date !== stageOf(before, "JO1", "DISPATCH").start_date;
  const out = upload(aoa, now, base);
  assert.equal(out.changes.length, 1);
  if(moved) assert.match(out.changes[0].notes.join(" "), /plan has moved since this sheet was downloaded/);
  assert.equal(stageOf(apply([A, { ...B, priority:1 }], out), "JO1", "DISPATCH").start_date, to);
});
test("with no record of the download, the live plan is what the sheet is compared with", () => {
  const state = plan([A]);
  const aoa = download(state);
  rowsOf(aoa, "JO1::PACKING")[0][COL.Date] = nextOpen(later(rowsOf(aoa, "JO1::PACKING")[0][COL.Date], 2));
  const out = upload(aoa, state, null);
  assert.equal(out.used_baseline, false);
  assert.equal(out.changes.length, 1);
});

console.log("\nG — locking the whole sheet");
test("asked to, every block in the sheet is locked where the sheet has it", () => {
  const state = plan([A, B]);
  const aoa = download(state);
  const out = upload(aoa, state, aoa, { lockAll:true });
  assert.equal(out.changes.length, 14);
  assert.equal(out.unchanged, 0);
  const after = apply([A, B], out);
  assert.deepEqual(planRows(after, wcs, origin).map(r => [r.ref, r.date, r.pairs, r.work_center]),
                   planRows(state, wcs, origin).map(r => [r.ref, r.date, r.pairs, r.work_center]));
  assert.ok(after.units.every(u => u.stages.every(s => s.locked)));
  assert.deepEqual(after.schedule_problems, []);
});

console.log("\nH — a sheet-planned block on the board");
test("unlocking it hands the whole block back; dragging it moves the whole block", () => {
  const state = plan([A], { JO1:{ at:{ PACKING:"2026-08-10" }, daily:{ PACKING:{ "2026-08-10":700, "2026-08-11":800 } } } });
  assert.deepEqual(Object.values(stageOf(state, "JO1", "PACKING").alloc), [700, 800]);
  assert.deepEqual(unlockStage(state.units[0], "PACKING"), {});
  const move = checkMove(state, { unit_key:"JO1", stage:"PACKING", date:"2026-08-12" }, ctx);
  assert.deepEqual(move.override, { at:{ PACKING:"2026-08-12" } });
});
test("a sheet's days are kept through the override's own clean-up", () => {
  const n = normalizeOverride({ daily:{ PACKING:{ "2026-08-10":700, "soon":5, "2026-08-11":0 }, CUTTING:{} } });
  assert.deepEqual(n.daily, { PACKING:{ "2026-08-10":700 } });
  assert.equal(normalizeOverride({ daily:{ CUTTING:{} } }).daily, undefined);
});

console.log("\nI — saving");
test("two cards of one order are saved in one blob, neither wiping the other", () => {
  const orders = [{ order_no:"JO1", plan_override:{ seq:2, units:{ "JO1#JC7":{ days:{ CUTTING:2 } } } } }, { order_no:"JO2", plan_override:{} }];
  const blobs = mergeOverrides(orders, [
    { order_no:"JO1", unit_key:"JO1#JC8", override:{ at:{ PACKING:"2026-08-10" } } },
    { order_no:"JO1", unit_key:"JO1#JC9", override:{ at:{ MOLDING:"2026-08-05" } } },
    { order_no:"JO1", unit_key:"JO1#JC7", override:{} },                         // handed back: removed
    { order_no:"JO2", unit_key:"JO2", override:{ at:{ CUTTING:"2026-08-03" } } },
    { order_no:"JO9", unit_key:"JO9", override:{ at:{ CUTTING:"2026-08-03" } } }, // not an order we hold
  ]);
  assert.deepEqual(blobs, {
    JO1:{ seq:2, units:{ "JO1#JC8":{ at:{ PACKING:"2026-08-10" } }, "JO1#JC9":{ at:{ MOLDING:"2026-08-05" } } } },
    JO2:{ at:{ CUTTING:"2026-08-03" } } });
  /* The orders handed in are not altered. */
  assert.deepEqual(Object.keys(orders[0].plan_override.units), ["JO1#JC7"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
