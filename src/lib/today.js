/* TODAY, ON THE FACTORY'S CLOCK.
 *
 * `new Date().toISOString().slice(0,10)` is the UTC date, and the factory is
 * in India. Between midnight and 05:30 IST that string is YESTERDAY — so a job
 * card written at 5am was dated the day before (and, now that the plan
 * schedules from the card's date, released a day early), a repair movement was
 * logged against yesterday, and the daily input screen opened on the wrong
 * day's plan.
 *
 * Every screen asks here instead. The date argument makes it testable without
 * a clock.
 */
export function todayIso(now = new Date()){
  const d = now instanceof Date ? now : new Date(now);
  if(isNaN(d)) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
