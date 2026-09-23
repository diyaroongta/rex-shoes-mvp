/* The stock sheet's arithmetic, in one place.
 *
 * The register has always read  STOCK = OPENING + RECEIVED - ISSUED, with the
 * movements kept in `stock_meta` and the opening figure on the material. The
 * PLANNER, though, netted against `material.stock` — the OPENING figure — so
 * every receipt the store entered and every issue booked against a job card
 * was invisible to procurement. The buying list answered a question about last
 * month's cupboard. `withStockBalances` is what closes that: the same sum the
 * register prints is the figure the netting nets against.
 *
 * A job card is the other half. What it takes out of the store is the BOM's
 * material total for the pairs on the card — the SAME figure the card's own
 * issue list prints, because both come from `materialTotals`. Nothing new is
 * computed here and nothing is invented for a material the BOM is silent on.
 *
 * Pure: no database, no clock.
 */
import { materialTotals } from "./bom-components.js";

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round4 = n => Math.round(n * 10000) / 10000;
const nameOf = key => String(key || "").split("||")[0];
const uomOf  = key => String(key || "").split("||")[1] || "";

/* What is actually on the shelf for one material. `opening` falls back to the
   material's own figure, which is what an untouched material carries. */
export function balanceOf(material = {}, meta = {}){
  const opening = meta.opening == null ? num(material.stock) : num(meta.opening);
  return round4(opening + num(meta.rec) - num(meta.issue));
}

/* The materials map with every `stock` replaced by that balance. A NEW object:
   the reference data the rest of the app holds is never mutated. */
export function withStockBalances(materials = {}, stockMeta = {}){
  const out = {};
  for(const [key, material] of Object.entries(materials || {}))
    out[key] = { ...material, stock: balanceOf(material, (stockMeta || {})[key] || {}) };
  return out;
}

/* What issuing this job card takes out of the store, material by material.
   Components are a breakdown of their material, never extra demand, so this is
   the material view — the same one procurement and the store work from. */
export function jobCardIssueRows(lines, article){
  return Object.entries(materialTotals(lines || [], article || {}))
    .filter(([, qty]) => num(qty) > 0)
    .map(([key, qty]) => ({ key, name: nameOf(key), uom: uomOf(key), qty: round4(num(qty)) }));
}

/* The stock_meta patch that books those issues. CUMULATIVE: `issue` is a
   running total on the register, so a card adds to it and never replaces it —
   overwriting would erase every issue booked before this one. */
export function issuePatch(rows, stockMeta = {}){
  const patch = {};
  for(const row of rows || []){
    if(!row || !row.key || num(row.qty) <= 0) continue;
    const before = num(((stockMeta || {})[row.key] || {}).issue);
    patch[row.key] = { issue: round4(before + num(row.qty)) };
  }
  return patch;
}

/* A job card raised against an Order Book row is a CUSTOMER card; one raised
   with no order behind it is made for STOCK. They take the same material out
   of the store, and what comes back belongs in different places, so the
   difference is stated rather than assumed. */
export const jobCardKind = job => (job && String(job.order_no || "").trim()) ? "customer" : "stock";
