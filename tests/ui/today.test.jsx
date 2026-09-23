import { beforeAll, afterAll, expect, it } from "vitest";
import { todayIso } from "../../src/lib/today.js";

/* The factory is in India. toISOString() is UTC, so before 05:30 IST it names
   YESTERDAY — which dated a job card, a repair movement and the daily input
   screen a day early. */
const original = process.env.TZ;
beforeAll(() => { process.env.TZ = "Asia/Kolkata"; });
afterAll(() => { process.env.TZ = original; });

it("reads the date on the factory's clock, not in UTC", () => {
  const fiveAm = new Date("2026-09-22T05:00:00+05:30");
  expect(fiveAm.toISOString().slice(0,10)).toBe("2026-09-21");   // the trap
  expect(todayIso(fiveAm)).toBe("2026-09-22");                   // the fix
});

it("is the same date through the working day", () => {
  expect(todayIso(new Date("2026-09-22T09:30:00+05:30"))).toBe("2026-09-22");
  expect(todayIso(new Date("2026-09-22T23:59:00+05:30"))).toBe("2026-09-22");
});

it("answers blank for something that is not a date", () => {
  expect(todayIso(new Date("not a date"))).toBe("");
});
