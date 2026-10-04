/* ADDING A SIZE RANGE TO AN ARTICLE — e.g. big 11 and big 12 on GOLA PLUS.
 *
 * An order can only carry a size that some range of its article covers; a size
 * outside every range is refused at the PI ("not inside that range"), so a
 * customer asking for big 11/12 of an article whose big run stops at 10 cannot
 * be invoiced, planned or bought for. Until now the only way to add a range
 * was to re-upload the whole BOM workbook.
 *
 * WHAT IT WILL NOT INVENT. A new range needs material rates, a pack quantity
 * and an MRP. The rates may be COPIED from an existing range of the same
 * article — an explicit choice the person makes and the range remembers
 * (`rates_copied_from`), because big 11–12 consume more than big 6–10 and the
 * BOM should be corrected when the real figures arrive. Pack quantity and MRP
 * are taken only as typed; blank stays blank (and the PI says so).
 *
 * Pure: returns problems, or a function that applies the change to a ref.
 */
import { comboSizes } from "./pi.js";

export function planAddRange(ref, input = {}){
  const problems = [];
  const article = String(input.article || "").trim();
  const combo = String(input.combo || "").trim().toUpperCase().replace(/\s+/g, "");
  const art = ((ref && ref.articles) || {})[article];
  if(!art) problems.push(`Unknown article: ${article || "(none)"}`);
  if(!/^[0-9.]+X[0-9.]+(B|S)?$/.test(combo)) problems.push(`"${combo}" is not a size range — write it like 11X12B (big 11 to 12) or 7X10`);
  const sizes = Array.isArray(input.size_order) && input.size_order.length
    ? input.size_order.map(s => String(s).trim()).filter(Boolean) : comboSizes(combo);
  if(!sizes.length) problems.push(`${combo} covers no sizes on the size roll`);
  if(art && art.combos && art.combos[combo]) problems.push(`${article} already has ${combo}`);
  const from = String(input.copy_from || "").trim();
  if(art && from && !(art.combos || {})[from]) problems.push(`${article} has no range ${from} to copy the BOM from`);
  const pack = input.packing == null || input.packing === "" ? null : Number(input.packing);
  if(pack != null && (!Number.isInteger(pack) || pack <= 0)) problems.push("Pairs per carton must be a whole number above 0, or left blank");
  const mrp = input.mrp == null || input.mrp === "" ? null : Number(input.mrp);
  if(mrp != null && (!Number.isFinite(mrp) || mrp <= 0)) problems.push("MRP must be above 0, or left blank");
  if(problems.length) return { problems };

  const source = from ? art.combos[from] : null;
  const clone = v => JSON.parse(JSON.stringify(v || {}));
  const warnings = [];
  if(!source) warnings.push(`${combo} has no BOM rates — it will order no material until its BOM is uploaded`);
  else warnings.push(`Rates copied from ${from}. Correct them when the real BOM for ${combo} is known.`);
  if(pack == null) warnings.push(`No pairs-per-carton for ${combo} — cartons cannot be priced until it is set`);
  if(mrp == null) warnings.push(`No MRP for ${combo} — the PI will price it at nothing until it is set`);

  const apply = target => {
    const a = target.articles[article];
    a.combos = a.combos || {};
    a.combos[combo] = { stitching_combo: combo, rates: source ? clone(source.rates) : {},
      ...(source && source.components ? { components: clone(source.components) } : {}),
      size_order: sizes, ...(from ? { rates_copied_from: from } : {}) };
    const order = a.combo_order || Object.keys(a.combos).filter(c => c !== combo);
    a.combo_order = [...order.filter(c => c !== combo), combo];
    if(pack != null){ target.packing = target.packing || {}; (target.packing[article] = target.packing[article] || {})[combo] = pack; }
    if(mrp != null){ target.mrp = target.mrp || {}; (target.mrp[article] = target.mrp[article] || {})[combo] = mrp; }
    return target;
  };
  return { problems: [], article, combo, sizes, copied_from: from || null, warnings, apply };
}
