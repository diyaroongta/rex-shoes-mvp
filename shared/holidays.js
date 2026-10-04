/* The factory calendar: weekly off-day and holidays.
 *
 * SEEDED, NOT INVENTED. The default list is the Government of India's
 * gazetted holidays for Central Government offices (DoPT office memoranda for
 * 2026 and 2027). The factory's own calendar will differ — most factories shut
 * for more than one day at Diwali and Holi, and some work a gazetted holiday —
 * so it is a STARTING POINT that is edited on Machine load, and the edited list
 * is stored in settings (`calendar`) and wins over this seed entirely.
 *
 * Islamic holidays depend on the moon and are marked tentative by DoPT; they
 * carry `tentative: true` so the screen can say so.
 */
export const DEFAULT_HOLIDAYS = [
  { date:"2026-01-26", name:"Republic Day" },
  { date:"2026-03-04", name:"Holi" },
  { date:"2026-03-21", name:"Id-ul-Fitr", tentative:true },
  { date:"2026-03-26", name:"Ram Navami" },
  { date:"2026-03-31", name:"Mahavir Jayanti" },
  { date:"2026-04-03", name:"Good Friday" },
  { date:"2026-05-01", name:"Buddha Purnima" },
  { date:"2026-05-27", name:"Id-ul-Zuha (Bakrid)", tentative:true },
  { date:"2026-06-26", name:"Muharram", tentative:true },
  { date:"2026-08-15", name:"Independence Day" },
  { date:"2026-08-26", name:"Id-e-Milad", tentative:true },
  { date:"2026-09-04", name:"Janmashtami" },
  { date:"2026-10-02", name:"Gandhi Jayanti" },
  { date:"2026-10-20", name:"Dussehra" },
  { date:"2026-11-08", name:"Diwali" },
  { date:"2026-11-24", name:"Guru Nanak Jayanti" },
  { date:"2026-12-25", name:"Christmas" },
  { date:"2027-01-26", name:"Republic Day" },
  { date:"2027-03-10", name:"Id-ul-Fitr", tentative:true },
  { date:"2027-03-23", name:"Holi" },
  { date:"2027-03-26", name:"Good Friday" },
  { date:"2027-04-15", name:"Ram Navami" },
  { date:"2027-04-19", name:"Mahavir Jayanti" },
  { date:"2027-05-17", name:"Id-ul-Zuha (Bakrid)", tentative:true },
  { date:"2027-05-20", name:"Buddha Purnima" },
  { date:"2027-06-16", name:"Muharram", tentative:true },
  { date:"2027-08-15", name:"Independence Day" },
  { date:"2027-08-25", name:"Janmashtami" },
  { date:"2027-10-02", name:"Gandhi Jayanti" },
  { date:"2027-10-09", name:"Dussehra" },
  { date:"2027-10-29", name:"Diwali" },
  { date:"2027-11-14", name:"Guru Nanak Jayanti" },
  { date:"2027-12-25", name:"Christmas" },
];

export const DEFAULT_CALENDAR = { weekly_off:[0], holidays:DEFAULT_HOLIDAYS };

const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z"));

/* Clean a calendar coming from the screen or the database. Returns
   {calendar, problems}; the server refuses on any problem. */
export function normalizeCalendar(raw){
  const problems = [];
  const src = raw && typeof raw === "object" ? raw : {};
  const weekly = Array.isArray(src.weekly_off) ? src.weekly_off : [0];
  const weekly_off = [...new Set(weekly.map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort();
  if(weekly_off.length >= 7) problems.push("The factory cannot be shut every day of the week");
  const seen = new Set(), holidays = [];
  for(const [i, h] of (Array.isArray(src.holidays) ? src.holidays : []).entries()){
    const date = String(h && typeof h === "object" ? h.date : h || "").slice(0,10);
    const name = String(h && typeof h === "object" ? h.name || "" : "").trim().slice(0,80);
    if(!isIso(date)){ problems.push(`Holiday ${i+1}: "${date}" is not a date`); continue; }
    if(seen.has(date)) continue;
    seen.add(date);
    holidays.push({ date, name, ...(h && h.tentative ? { tentative:true } : {}) });
  }
  holidays.sort((a, z) => a.date.localeCompare(z.date));
  return { calendar:{ weekly_off, holidays }, problems };
}

/* Is this ISO date a working day? For screens (production input, gantt). */
export function isOffDay(iso, calendar = DEFAULT_CALENDAR){
  const d = new Date(String(iso).slice(0,10) + "T00:00:00Z");
  if(isNaN(d)) return false;
  const cal = calendar || DEFAULT_CALENDAR;
  if((cal.weekly_off || [0]).includes(d.getUTCDay())) return true;
  return (cal.holidays || []).some(h => (h.date || h) === String(iso).slice(0,10));
}
export function holidayName(iso, calendar = DEFAULT_CALENDAR){
  const h = ((calendar || DEFAULT_CALENDAR).holidays || []).find(x => (x.date || x) === String(iso).slice(0,10));
  return h ? (h.name || "Holiday") : null;
}
