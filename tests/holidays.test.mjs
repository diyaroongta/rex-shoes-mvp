/* The factory calendar seed and its validation. */
import assert from "node:assert/strict";
import { DEFAULT_HOLIDAYS, normalizeCalendar, isOffDay, holidayName } from "../shared/holidays.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}
console.log("\nWorking calendar");
test("Sunday is off by default, Monday is not", () => {
  assert.equal(isOffDay("2026-10-04"), true);   // Sunday
  assert.equal(isOffDay("2026-10-05"), false);
});
test("the gazetted holidays are seeded with real dates", () => {
  assert.equal(holidayName("2026-11-08"), "Diwali");
  assert.equal(holidayName("2026-10-20"), "Dussehra");
  assert.equal(isOffDay("2026-10-02"), true, "Gandhi Jayanti");
  assert.ok(DEFAULT_HOLIDAYS.every(h => /^\d{4}-\d{2}-\d{2}$/.test(h.date)));
});
test("a bad date is refused, a duplicate collapses, the list is sorted", () => {
  const { calendar, problems } = normalizeCalendar({ weekly_off:[0], holidays:[{ date:"2026-13-01" }, "2026-12-25", { date:"2026-01-26", name:"R" }, "2026-12-25"] });
  assert.equal(problems.length, 1);
  assert.deepEqual(calendar.holidays.map(h => h.date), ["2026-01-26","2026-12-25"]);
});
test("a seven-day closure is refused", () => {
  assert.ok(normalizeCalendar({ weekly_off:[0,1,2,3,4,5,6] }).problems.length);
});
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
