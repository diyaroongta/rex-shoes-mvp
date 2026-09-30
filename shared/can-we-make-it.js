/* CAN WE MAKE THIS, WITH WHAT IS IN THE STORE?
 *
 * Asked at the moment a PI is being raised, and again when a job order is cut
 * against one — the two points where somebody is still free to change their
 * mind. Until now the answer only existed AFTER the order was saved, on the
 * procurement screen, which is one commitment too late.
 *
 * WHAT IT DOES NOT CLAIM. The factory has no finished-goods stock in this
 * system: nothing records made shoes sitting in the warehouse. So this cannot
 * say "there are already 200 pairs of this article on the shelf". It answers
 * the question the data CAN answer — whether the MATERIALS for these pairs are
 * in the store — and says so in those words. Answering the finished-goods
 * question would mean inventing a figure nobody recorded.
 *
 * Stock is the register's own balance (opening + received − issued), the same
 * figure the store screen prints and procurement nets against, so this screen
 * cannot disagree with those.
 *
 * NOT A RESERVATION. It is a snapshot against free stock, and it deliberately
 * ignores what other live orders have already claimed — netting this draft
 * into the queue would need the order to exist, which is the thing that has
 * not happened yet. It says "as things stand", and the procurement screen
 * remains the sequenced answer.
 */
import { materialTotals } from "./bom-components.js";
import { withStockBalances } from "./stock.js";

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round4 = n => Math.round(n * 1e4) / 1e4;

export function materialCheck(lines, article, materials = {}, stockMeta = {}){
  const need = materialTotals(lines || [], article || {});
  const have = withStockBalances(materials, stockMeta);
  const rows = Object.entries(need).map(([key, required]) => {
    const m = have[key] || {};
    /* A material the BOM names but the master does not hold is NOT "0 in
       stock" — it is unknown, and the two must not print alike. */
    const known = !!have[key];
    const available = known ? num(m.stock) : null;
    const shortfall = known ? Math.max(0, round4(required - available)) : null;
    return { key, name: m.name || key.split("||")[0], uom: m.uom || key.split("||")[1] || "",
             required: round4(required), available, shortfall, known };
  }).sort((a, b) => (b.shortfall || 0) - (a.shortfall || 0) || a.name.localeCompare(b.name));

  const short = rows.filter(r => r.known && r.shortfall > 0);
  const unknown = rows.filter(r => !r.known);
  return {
    rows, materials: rows.length,
    short_count: short.length, unknown_count: unknown.length,
    short, unknown,
    /* `false` means something is genuinely short. A BOM with no rates at all
       produces no rows, and that is NOT "we can make it" — it is "nothing is
       costed", which the caller must be able to tell apart. */
    costed: rows.length > 0,
    can_make: rows.length > 0 && short.length === 0 && unknown.length === 0,
  };
}
