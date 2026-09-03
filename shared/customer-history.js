/* What a customer has been given before.
 *
 * "Which variant of a shoe had been given to that customer" is not answerable
 * from the article code alone: JACK LACE BLACK-BLUE and JACK LACE WHITE-RED
 * are the same SHOE and different VARIANTS, and the question is usually asked
 * one level up ("have they had Jack before, and in what?") before it is asked
 * one level down ("which Jack exactly?"). So history is returned as families
 * with their variants nested, using the same family rule as the product codes.
 *
 * Reads orders as they come off the database OR as the engine returns them:
 * a raw row carries `lines`, a computed one carries `qty`, and both are
 * accepted so this can be used either side of compute().
 *
 * Pure — no database, no clock, no framework.
 */
import { familyOf } from "./product-codes.js";

const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

/* Two spellings of one customer are one customer. The factory writes "JTSM"
   and "jtsm " on different slips, and a history that splits them answers the
   question wrongly in the most misleading way available — by showing LESS
   than was actually supplied. */
export const partyKey = party => clean(party).toLowerCase();

/* Pairs on an order, whichever shape it arrived in. */
export function pairsOf(order){
  if(order && order.qty != null && !isNaN(Number(order.qty))) return Number(order.qty);
  let total = 0;
  for(const line of (order && order.lines) || []){
    if(line && line.qty != null && !isNaN(Number(line.qty))) total += Number(line.qty);
    else for(const v of Object.values((line || {}).sizes || {})) total += Number(v) || 0;
  }
  return total;
}

const articleOf = o => clean(o.article_code || o.article);

/* Postgres hands `order_date` back as a Date OBJECT, not a string, and
   String(date).slice(0,10) is "Wed Aug 20" — which sorts alphabetically, so
   the most-recent customer came out wrong and every first/last supplied date
   was nonsense. Dates are normalised to YYYY-MM-DD, and read in LOCAL time:
   toISOString() on a date-only value stored at local midnight can roll back a
   day, which would date an order to the day before it was placed. */
export function isoDate(value){
  if(value == null || value === "") return "";
  if(value instanceof Date)
    return isNaN(value) ? "" : local(value);
  const s = clean(value);
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? "" : local(d);
}
const local = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

const dateOf = o => isoDate((o || {}).order_date);

/* The words that make this variant this variant, as the factory would say
   them: the closure and the two colours off the PI. Blank ones are dropped
   rather than shown as "—", because an empty field is not a distinguishing
   feature and printing one implies the article master knows something it
   does not. */
export function variantNote(order){
  const pi = (order || {}).pi || {};
  const bits = [];
  const vl = clean(pi.vl || order.vl);
  const sole = clean(pi.sole_colour || order.sole_colour);
  const upper = clean(pi.upper_colour || order.upper_colour);
  if(vl) bits.push(vl.toUpperCase() === "V" ? "Velcro" : vl.toUpperCase() === "L" ? "Lace" : vl);
  if(upper) bits.push(`upper ${upper}`);
  if(sole) bits.push(`sole ${sole}`);
  return bits.join(" · ");
}

/* Every customer on the book, most recently ordered first — the list a filter
   is built from. Counts are over the orders PASSED IN, so a caller that hides
   completed orders gets counts that agree with what is on screen. */
export function customerSummaries(orders = []){
  const by = new Map();
  for(const o of orders){
    const party = clean(o.party);
    if(!party) continue;
    const key = partyKey(party);
    const row = by.get(key) || { key, party, orders: 0, pairs: 0, last_date: "", articles: new Set() };
    row.orders += 1;
    row.pairs += pairsOf(o);
    const d = dateOf(o);
    /* The display name follows the most recent spelling — the factory's latest
       is the one they will recognise. Compared BEFORE last_date moves, or every
       order would look like the newest one. */
    if(!row.last_date || d >= row.last_date) row.party = party;
    if(d > row.last_date) row.last_date = d;
    const art = articleOf(o);
    if(art) row.articles.add(art);
    by.set(key, row);
  }
  return [...by.values()]
    .map(r => ({ ...r, articles: r.articles.size }))
    .sort((a, z) => (z.last_date || "").localeCompare(a.last_date || "") || a.party.localeCompare(z.party));
}

/* One customer's history: what shoes, in what variants, how many and when.
   `orders` should be EVERY order for that customer including completed ones —
   the whole point is what has already been supplied. */
export function historyFor(orders = [], party = ""){
  const key = partyKey(party);
  const mine = orders.filter(o => partyKey(o.party) === key && articleOf(o));

  const families = new Map();
  for(const o of mine){
    const article = articleOf(o);
    const family = familyOf(article) || article;
    const fam = families.get(family)
      || { family, pairs: 0, orders: 0, variants: new Map() };
    fam.pairs += pairsOf(o);
    fam.orders += 1;

    /* A variant is the ARTICLE plus what the PI recorded about it — the same
       article bought once in velcro and once in lace is two variants, and
       collapsing them would answer the question this exists for wrongly. */
    const note = variantNote(o);
    const vKey = `${article}||${note}`;
    const v = fam.variants.get(vKey)
      || { article, note, pairs: 0, orders: [], first_date: "", last_date: "" };
    v.pairs += pairsOf(o);
    v.orders.push({ order_no: clean(o.order_no), date: dateOf(o), pairs: pairsOf(o) });
    const d = dateOf(o);
    if(d && (!v.first_date || d < v.first_date)) v.first_date = d;
    if(d && d > v.last_date) v.last_date = d;
    fam.variants.set(vKey, v);
    families.set(family, fam);
  }

  const out = [...families.values()].map(f => ({
    ...f,
    variants: [...f.variants.values()]
      .map(v => ({ ...v, orders: v.orders.sort((a, z) => (z.date || "").localeCompare(a.date || "")) }))
      .sort((a, z) => z.pairs - a.pairs || a.article.localeCompare(z.article)),
  })).sort((a, z) => z.pairs - a.pairs || a.family.localeCompare(z.family));

  return {
    party: clean((mine.find(o => clean(o.party)) || {}).party) || clean(party),
    orders: mine.length,
    pairs: mine.reduce((a, o) => a + pairsOf(o), 0),
    families: out,
  };
}

/* Has this customer had this exact article before? The question the clerk
   actually asks while keying a repeat order. Returns null when they have not,
   so the caller can say "first time" rather than showing an empty panel. */
export function priorSupply(orders = [], party = "", article = ""){
  const wanted = clean(article);
  if(!wanted) return null;
  const history = historyFor(orders, party);
  for(const fam of history.families)
    for(const v of fam.variants)
      if(v.article === wanted) return v;
  return null;
}
