/* Financial-year weeks. The factory reports on an April-to-March year and
   plans Monday to Saturday, so both of those have to be true of every figure
   this produces. */
import assert from "node:assert/strict";
import { fyOf, weekStart, fyWeek, weekRange, weeksInFy, weeksBetween, byWeek } from "../shared/fy-calendar.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

console.log("\nA — the year runs April to March");
test("a date in March belongs to the year that began the previous April", () => {
  assert.equal(fyOf("2026-09-22").label, "2026-27");
  assert.equal(fyOf("2027-03-31").label, "2026-27");
  assert.equal(fyOf("2027-04-01").label, "2027-28");
  assert.equal(fyOf("2026-03-31").label, "2025-26");
});
test("the year knows its own first and last day", () => {
  const fy = fyOf("2026-09-22");
  assert.equal(fy.start, "2026-04-01");
  assert.equal(fy.end, "2027-03-31");
});

console.log("\nB — weeks start on Monday");
test("the week of a Tuesday starts on the Monday before it", () => {
  assert.equal(weekStart("2026-09-22"), "2026-09-21");   // Tue -> Mon
  assert.equal(weekStart("2026-09-21"), "2026-09-21");   // Mon -> itself
  assert.equal(weekStart("2026-09-27"), "2026-09-21");   // Sun -> the Monday before
});
test("week 1 is the week containing 1 April, not a two-day stub", () => {
  /* 1 April 2026 is a Wednesday, so W01 runs from Monday 30 March. */
  const w = fyWeek("2026-04-01");
  assert.equal(w.week, 1);
  assert.equal(w.start, "2026-03-30");
  assert.equal(w.end, "2026-04-05");
  assert.equal(w.label, "FY2026-27 W01");
  /* A date can answer the two questions differently, and both answers are
     right: 30 March 2026 is in FY2025-26 BY DATE, and in week 1 of FY2026-27
     BY WEEK, because a week is never split between two annual reports. */
  assert.equal(fyOf("2026-03-30").label, "2025-26");
  assert.equal(fyWeek("2026-03-30").label, "FY2026-27 W01");
});
test("the working week ends on Saturday, the calendar week on Sunday", () => {
  const w = fyWeek("2026-09-22");
  assert.equal(w.start, "2026-09-21");
  assert.equal(w.working_end, "2026-09-26");   // Saturday
  assert.equal(w.end, "2026-09-27");           // Sunday
});
test("22 September 2026 is week 26 of FY2026-27", () => {
  const w = fyWeek("2026-09-22");
  assert.equal(w.week, 26);
  assert.equal(w.short_label, "W26");
});
test("a Sunday-start factory gets Sunday-start weeks, without anything else changing", () => {
  const w = fyWeek("2026-09-22", { weekStartsOn: 0 });
  assert.equal(w.start, "2026-09-20");
  assert.equal(w.end, "2026-09-26");
});

console.log("\nC — reading the calendar backwards");
test("a week number gives back its own dates", () => {
  const w = weekRange(2026, 26);
  assert.equal(w.start, "2026-09-21");
  assert.equal(w.week, 26);
  assert.equal(fyWeek(w.start).label, w.label);
});
test("a financial year is 52 or 53 weeks, whichever it actually is", () => {
  const weeks = weeksInFy(2026);
  assert.ok(weeks.length === 52 || weeks.length === 53, `got ${weeks.length}`);
  assert.equal(weeks[0].week, 1);
  assert.equal(weeks[0].start, "2026-03-30");
  assert.equal(weeks[weeks.length - 1].week, weeks.length);
  /* Every week belongs to this year and to no other, at both ends. */
  assert.ok(weeks.every(w => w.fy === "2026-27"), "a week leaked into another year");
  assert.equal(weeks[weeks.length - 1].end, "2027-03-28");
  assert.equal(fyWeek("2027-03-29").label, "FY2027-28 W01");
});
test("a date range lists the weeks it covers, inclusive", () => {
  const weeks = weeksBetween("2026-09-22", "2026-10-05");
  assert.deepEqual(weeks.map(w => w.short_label), ["W26","W27","W28"]);
});

console.log("\nD — grouping real rows");
test("rows are grouped into weeks in date order", () => {
  const rows = [{ on:"2026-09-28", pairs:100 }, { on:"2026-09-22", pairs:40 }, { on:"2026-09-26", pairs:60 }];
  const weeks = byWeek(rows, r => r.on);
  assert.deepEqual(weeks.map(w => [w.short_label, w.rows.length]), [["W26",2],["W27",1]]);
  assert.equal(weeks[0].rows.reduce((a,r)=>a+r.pairs,0), 100);
});
test("a row with no usable date is left out rather than dated today", () => {
  assert.deepEqual(byWeek([{ on:null }, { on:"" }, { on:"not a date" }], r => r.on), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
