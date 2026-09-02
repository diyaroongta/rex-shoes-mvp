/* The fabricator master: who work can be sent to.
 *
 * One list holds the factory's own stitching lines and outside job workers,
 * separated only by a Type. That is the whole point of the design — the job
 * work issue screen then has ONE dropdown for "who is doing this", whether the
 * answer is Line 2 or a fabricator in the next town. Two separate lists would
 * mean two dropdowns and two ways to get the same question wrong.
 *
 * What each type actually requires differs, though, and the differences are
 * real rather than cosmetic:
 *
 *   internal_line   no rate, no contact, nothing payable — it is the factory's
 *                   own line, and money never changes hands
 *   external        a rate and a contact are mandatory: work leaves the
 *                   premises and an invoice comes back
 *   sample          a flat charge rather than a per-piece rate, a short
 *                   turnaround, and payment is optional
 *
 * Pure: the server enforces these and the browser uses them to decide which
 * fields to show, so the two cannot drift apart.
 */

export const TYPES = ["internal_line", "external", "sample"];

export const TYPE_LABEL = {
  internal_line: "Internal line",
  external:      "External fabricator",
  sample:        "Sample fabricator",
};

export const TYPE_HELP = {
  internal_line: "One of the factory's own stitching lines. No rate and nothing payable.",
  external:      "An outside job worker. Rate per piece and a contact are required; work is payable.",
  sample:        "Sample work only, kept apart from bulk. Flat charge, short turnaround.",
};

/* Field requirements per type, read by both the validator and the form so a
   field is never demanded in one place and hidden in the other. */
export const RULES = {
  internal_line: { rate:"none",  contact:"optional", payable:"never",    tat:"required" },
  external:      { rate:"per_piece", contact:"required", payable:"always", tat:"required" },
  sample:        { rate:"flat",  contact:"required", payable:"optional", tat:"required" },
};

const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* Whether money is involved. Derived from the type rather than trusted from
   the caller, except for samples where it genuinely is a choice — an internal
   line marked payable would put the factory's own work into the payables. */
export function payableFor(type, asked){
  const rule = (RULES[type] || {}).payable;
  if(rule === "never")  return false;
  if(rule === "always") return true;
  return !!asked;
}

/* Returns { ok, value, problems }. Problems are written for the person filling
   the form in, not for a log. */
export function validateFabricator(input = {}){
  const problems = [];
  const name = clean(input.name);
  const type = clean(input.type).toLowerCase();

  if(!name) problems.push("Name is required");
  if(name.length > 80) problems.push("Name must be 80 characters or fewer");
  if(!TYPES.includes(type)) problems.push(`Type must be one of: ${TYPES.join(", ")}`);

  const rules = RULES[type] || {};
  const rate = num(input.rate);
  const tat = num(input.tat_days);

  if(rules.rate === "none"){
    /* Not an error — a rate typed against a line is a misunderstanding worth
       correcting quietly, and dropping it silently would hide that. */
    if(rate) problems.push("An internal line has no rate — work on it is not paid for");
  }else if(rules.rate === "per_piece"){
    if(rate == null || rate <= 0) problems.push("Rate per piece is required for an external fabricator");
  }else if(rules.rate === "flat"){
    if(rate == null || rate <= 0) problems.push("A sample fabricator needs a flat sample charge");
  }
  if(rate != null && rate < 0) problems.push("Rate cannot be negative");
  if(rate != null && rate > 100000) problems.push("That rate looks wrong — check it");

  if(tat == null || tat <= 0) problems.push("Turnaround time in days is required");
  else if(!Number.isInteger(tat)) problems.push("Turnaround time must be a whole number of days");
  else if(tat > 365) problems.push("Turnaround time must be 365 days or fewer");

  if(rules.contact === "required" && !clean(input.contact_person) && !clean(input.contact_phone))
    problems.push("A contact person or phone number is required — work is leaving the factory");

  const phone = clean(input.contact_phone);
  if(phone && !/^[0-9+][0-9 ()+-]{5,}$/.test(phone))
    problems.push("That phone number does not look like a phone number");

  return {
    ok: problems.length === 0,
    problems,
    value: {
      name, type,
      rate: rules.rate === "none" ? 0 : (rate ?? 0),
      tat_days: tat ?? 0,
      contact_person: clean(input.contact_person) || null,
      contact_phone: phone || null,
      payable: payableFor(type, input.payable),
      active: input.active === undefined ? true : !!input.active,
      note: clean(input.note).slice(0, 300) || null,
    },
  };
}

/* The four internal lines, offered on first run so nobody has to type them.
   Their turnaround is left at 1 day as a stated PLACEHOLDER rather than a
   guess dressed up as fact — the real figure comes from the factory. */
export const DEFAULT_LINES = [1,2,3,4].map(n => ({
  name: `Line ${n}`, type: "internal_line", rate: 0, tat_days: 1,
  payable: false, active: true, note: "Turnaround is a placeholder — confirm with the factory",
}));

/* Who can be offered for a piece of work. Inactive fabricators stay in the
   list — their past job cards must still make sense — but cannot take new
   work, and samples are kept out of bulk issuing. */
export function selectableFor(fabricators, purpose = "bulk"){
  return (fabricators || []).filter(f => {
    if(!f.active) return false;
    return purpose === "sample" ? f.type === "sample" : f.type !== "sample";
  });
}

/* What a completed job costs. Internal lines are free by construction, so this
   answers 0 rather than being skipped by the caller and forgotten. */
export function jobCost(fabricator, pieces){
  const f = fabricator || {};
  if(!payableFor(f.type, f.payable)) return { payable:false, amount:0 };
  const n = Math.max(0, Math.round(num(pieces) ?? 0));
  const rate = num(f.rate) ?? 0;
  /* A sample charge is flat: it is for the making, not per piece. */
  const amount = (RULES[f.type] || {}).rate === "flat" ? rate : rate * n;
  return { payable:true, amount: Math.round(amount * 100) / 100, pieces:n, rate };
}
