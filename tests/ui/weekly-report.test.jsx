import { beforeAll, afterAll, expect, it } from "vitest";

/* THE FACTORY IS IN INDIA. These two helpers decide which six days the weekly
   production plan covers, and they were formatting local dates through
   toISOString() — which in IST hands back the previous day. Written and tested
   west of Greenwich the bug is invisible; run on the factory's own clock, the
   week started on Sunday and every row was filed a day early.

   The test pins the timezone rather than trusting the machine's. */
const original = process.env.TZ;
beforeAll(() => { process.env.TZ = "Asia/Kolkata"; });
afterAll(() => { process.env.TZ = original; });

it("starts the week on Monday on the factory's own clock", async () => {
  const { mondayOf, plusDays } = await import("../../src/ProductionInputTab.jsx");
  expect(new Date("2026-09-22T00:00:00").getDay()).toBe(2);   // a Tuesday
  expect(mondayOf("2026-09-22")).toBe("2026-09-21");
  expect(mondayOf("2026-09-21")).toBe("2026-09-21");          // a Monday is its own
  expect(mondayOf("2026-09-27")).toBe("2026-09-21");          // Sunday belongs to the week before
});

it("runs Monday to Saturday, six days, with no day lost to the timezone", async () => {
  const { plusDays } = await import("../../src/ProductionInputTab.jsx");
  const week = Array.from({ length: 6 }, (_, i) => plusDays("2026-09-21", i));
  expect(week).toEqual(["2026-09-21","2026-09-22","2026-09-23","2026-09-24","2026-09-25","2026-09-26"]);
  expect(new Date(`${week[5]}T00:00:00`).getDay()).toBe(6);   // Saturday
});

it("answers blank for a date it cannot read, rather than NaN", async () => {
  const { mondayOf, plusDays } = await import("../../src/ProductionInputTab.jsx");
  expect(mondayOf("")).toBe("");
  expect(mondayOf("not a date")).toBe("");
  expect(plusDays("not a date", 3)).toBe("");
});
