/* Quotations: a priced offer, before there is an order.
 *
 * A quotation is the PI's arithmetic without any of the PI's consequences. It
 * is priced by `shared/pi.js` — the same MRP-less-discount rate and the same
 * deduction ladder, in the same order — because a customer who accepts a quote
 * and then receives an invoice for a different figure has been quoted wrongly.
 * What it does NOT do is release anything: no order, no PI number, no material
 * demand and no machine capacity, until somebody converts it.
 *
 * NUMBERING is its own series (QT/1, QT/2 …), never the PI series. A quotation
 * that borrowed a PI number would consume a number the PI ledger expects to
 * issue, and half the quotations a factory raises never become invoices.
 *
 * STATUS is a one-way street with one exception: a quotation can always be
 * lost, and a converted one is finished. Reopening a converted quotation would
 * let one offer become two invoices.
 *
 * Pure: no database, no clock.
 */
import { buildMultiPI, DEFAULT_TERMS } from "./pi.js";

const clean = v => String(v == null ? "" : v).trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export const QUOTE_PREFIX = "QT";
export const quoteNo = n => `${QUOTE_PREFIX}/${Math.max(1, Math.round(num(n)))}`;

export const STATUSES = ["draft", "sent", "accepted", "lost", "converted"];
export const STATUS_LABEL = {
  draft: "Draft", sent: "Sent to customer", accepted: "Accepted",
  lost: "Not taken", converted: "Converted to PI",
};
const NEXT = {
  draft:     ["sent", "accepted", "lost"],
  sent:      ["accepted", "lost"],
  accepted:  ["converted", "lost"],
  lost:      ["draft"],
  converted: [],
};
export const canMoveTo = (from, to) => (NEXT[clean(from) || "draft"] || []).includes(to);

/* What a quotation is worth. `items` are the PI's own item shape, so a
   quotation and the invoice it becomes are priced by one code path. */
export function priceQuotation(quotation = {}, terms = DEFAULT_TERMS){
  const t = { ...DEFAULT_TERMS, ...(terms || {}),
    ...(quotation.discount_pct == null ? {} : { discount_pct: num(quotation.discount_pct) }) };
  return buildMultiPI(quotation.items || [], t);
}

/* A quotation is refusable BEFORE it goes to a customer, which is the one
   place refusing is cheap. Every problem is collected rather than stopping at
   the first, the way the PI screen collects its warnings. */
export function validateQuotation(quotation = {}, opts = {}){
  const problems = [];
  if(!clean(quotation.party)) problems.push("A quotation is made out to a customer — name one.");

  const items = Array.isArray(quotation.items) ? quotation.items : [];
  if(!items.length) problems.push("Add at least one article.");

  const priced = priceQuotation(quotation, opts.terms);
  /* A PI line carries `qty` — the pairs of that size. */
  const pairs = priced.lines.reduce((a, l) => a + num(l.qty), 0);
  if(items.length && !priced.lines.length)
    problems.push("No line prices to anything — a line with no size range or no packing rate makes no pairs, and is left off the quotation entirely.");
  else if(items.length && pairs <= 0)
    problems.push("Every line is zero pairs. Enter the quantities being quoted.");

  /* A line with no MRP prices at zero. That is a QUOTED PRICE of nothing,
     which is worse on an offer than on an invoice — the customer keeps it. */
  for(const m of priced.missing || [])
    problems.push(`${m.article || "An article"}: no MRP for ${m.combo || "a size range"}${m.size ? ` (${m.size})` : ""} — it would be quoted at zero.`);

  return { ok: problems.length === 0, problems, totals: priced.totals, pairs };
}

/* Converting: the quotation's own items, handed to the PI flow unchanged.
 * Nothing is priced again here — the figures the customer accepted are the
 * figures the invoice is raised from — and the quotation is NOT altered; the
 * caller records the PI number against it when the invoice is actually filed,
 * so a conversion that fails leaves an offer that can still be converted. */
export function toPiDraft(quotation = {}){
  return {
    party: clean(quotation.party),
    city: clean(quotation.city),
    discount_pct: quotation.discount_pct == null ? null : num(quotation.discount_pct),
    items: (quotation.items || []).map(item => ({ ...item })),
    from_quotation: clean(quotation.quote_no) || null,
  };
}

/* Still open, and how old. A quotation with no validity is open indefinitely —
   "no expiry" and "expires today" are different claims, so one is never read
   as the other. */
export function quotationAge(quotation = {}, today){
  const from = clean(quotation.quote_date).slice(0, 10);
  const day = clean(today).slice(0, 10);
  if(!from || !day) return { days: null, expired: false, expires_on: null };
  const days = Math.round((Date.parse(day) - Date.parse(from)) / 86400000);
  const valid = num(quotation.valid_days);
  if(!valid) return { days, expired: false, expires_on: null };
  const expires = new Date(Date.parse(from) + valid * 86400000).toISOString().slice(0, 10);
  return { days, expires_on: expires, expired: day > expires };
}

export function quotationSummary(quotations = [], today){
  const out = { total: 0, open: 0, accepted: 0, converted: 0, lost: 0, expired: 0, value: 0 };
  for(const quote of quotations){
    out.total += 1;
    const status = clean(quote.status) || "draft";
    if(status === "accepted") out.accepted += 1;
    if(status === "converted") out.converted += 1;
    if(status === "lost") out.lost += 1;
    if(status === "draft" || status === "sent") out.open += 1;
    if(quotationAge(quote, today).expired && (status === "draft" || status === "sent")) out.expired += 1;
    /* Only what is still live counts towards the value in front of the
       factory: a lost quotation is not pipeline. */
    if(status !== "lost" && status !== "converted") out.value += num(quote.total);
  }
  return out;
}
