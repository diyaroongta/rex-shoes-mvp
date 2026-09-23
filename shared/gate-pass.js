/* THE GATE PASS SLIP — what security checks as the lorry leaves.
 *
 * Taken from the factory's own book (SR. No 15941). Columns, in their order:
 *
 *   SR.NO · ARTICLE NAME · SIZE · COLOUR · ORDER NO · TOTAL ORDER ·
 *   CARTON · MRP · STD. PAC. · PAIRS
 *
 * ONE ARITHMETIC RULE GOVERNS THE WHOLE SHEET:
 *
 *        PAIRS = CARTON x STD. PAC.
 *
 * and it holds on every row of their slip — 1 carton at 10 to a pack is 10
 * pairs, 2 cartons at 18 is 36. It also holds on a MIXED carton, because for
 * a mixed box the factory writes what that ONE box actually holds in the
 * STD. PAC. column: their row 4 is one carton of sizes 2x5 carrying 2 pairs of
 * size 2, 5 of size 3 and 10 of size 5, so its std. pac. reads 17 and its
 * pairs read 17.
 *
 * A MIXED CARTON SPANS SEVERAL SIZE ROWS. On their slip rows 6, 7 and 8 share
 * a single "1" written down the carton column: three sizes, one box. So the
 * carton count belongs to the GROUP and is printed once, and the sizes inside
 * it are listed under it. Repeating the count on every row would treble the
 * cartons at the gate.
 *
 * WHAT IS DERIVED AND WHAT IS COUNTED. The packer counts CARTONS — that has
 * not changed. What is derived is PAIRS, from the pack quantity, which is the
 * factory's own arithmetic. Where the pack quantity is not known, pairs are
 * NOT invented: the row reports what it is missing.
 *
 * Pure: no database, no clock.
 */

const int = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
const numOrNull = v => {
  if(v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = v => String(v == null ? "" : v).trim();

/* The rule, in one place. Null when the pack quantity is unknown — a gate pass
   with a blank tells the gate to check; one with a zero tells it there are no
   shoes in the box. */
export function pairsFromCartons(cartons, stdPack){
  const c = numOrNull(cartons), p = numOrNull(stdPack);
  if(c == null || p == null) return null;
  return Math.round(c * p);
}

/* What one carton group holds, and how the slip writes it.
   `sizes` with more than one entry is a MIXED carton: its std. pac. is its own
   contents, not the article's pack quantity. */
export function describeGroup(group = {}, opts = {}){
  const packFor = opts.packFor || (() => null);
  const sizes = (group.sizes || [])
    .map(s => ({ size: text(s.size), pairs: int(s.pairs) }))
    .filter(s => s.size || s.pairs);
  const cartons = Math.max(0, int(group.cartons));
  const mixed = sizes.length > 1;
  const counted = sizes.reduce((a, s) => a + s.pairs, 0);

  /* A full carton of one size packs at the article's own rate; a mixed box
     packs at whatever was put in it. */
  let stdPack = numOrNull(group.std_pack);
  if(stdPack == null){
    if(mixed) stdPack = cartons > 0 ? counted / cartons : counted;
    else stdPack = numOrNull(packFor(sizes[0] ? sizes[0].size : "", group));
  }
  const derived = pairsFromCartons(cartons, stdPack);

  /* The counted figure wins where there is one — the packing list is what the
     packer actually filled — and a disagreement with the pack quantity is
     REPORTED rather than silently resolved either way. */
  const pairs = counted > 0 ? counted : (derived == null ? 0 : derived);
  const mismatch = counted > 0 && derived != null && derived !== counted;

  return {
    sizes, cartons, mixed,
    size_label: mixed ? sizes.map(s => s.size).join(", ") : (sizes[0] ? sizes[0].size : ""),
    /* "2x2, 3x5, 5x10" — what the factory writes beside a mixed carton. */
    contents: mixed ? sizes.map(s => `${s.size} x ${s.pairs}`).join(", ") : "",
    std_pack: stdPack == null ? null : Math.round(stdPack * 100) / 100,
    pairs,
    pairs_derived: derived,
    counted_pairs: counted,
    /* Nothing was invented: say which figure is missing. */
    pack_unknown: stdPack == null,
    mismatch,
  };
}

/* One printed row per SIZE — the gate counts pairs by size — with the carton
   count written once against the group's first size, exactly as their slip
   writes a single "1" down three rows. */
export function gatePassRows(built, opts = {}){
  const mrpFor = opts.mrpFor || (() => null);
  const rows = [];
  let sno = 0;
  for(const line of (built && built.lines) || []){
    for(const group of line.groups || []){
      const g = describeGroup(group, opts);
      sno += 1;
      const first = {
        sno, article: line.article, closure: line.closure, colour: line.colour,
        size: g.mixed ? g.size_label : (g.sizes[0] ? g.sizes[0].size : ""),
        contents: g.contents,
        cartons: g.cartons,
        carton_numbers: group.cn_from
          ? (group.cn_from === group.cn_to ? `${group.cn_from}` : `${group.cn_from}-${group.cn_to}`)
          : null,
        mixed: g.mixed,
        std_pack: g.std_pack,
        mrp: numOrNull(mrpFor(g.sizes[0] ? g.sizes[0].size : "", line)),
        pairs: g.pairs,
        pack_unknown: g.pack_unknown,
        mismatch: g.mismatch,
        /* The sizes inside a mixed box, printed under its one carton count. */
        breakdown: g.mixed ? g.sizes : [],
      };
      rows.push(first);
    }
  }
  return rows;
}

export function buildGatePass(input = {}){
  const built = input.packing_list || { lines: [], total_pairs: 0, total_cartons: 0 };
  const rows = gatePassRows(built, input);
  const problems = [];

  const total_pairs = rows.reduce((a, r) => a + r.pairs, 0);
  const total_cartons = rows.reduce((a, r) => a + r.cartons, 0);

  if(built.total_pairs != null && total_pairs !== built.total_pairs)
    problems.push(`The gate pass adds up to ${total_pairs} pairs and the packing list says ${built.total_pairs}`);
  if(built.total_cartons != null && total_cartons !== built.total_cartons)
    problems.push(`The gate pass adds up to ${total_cartons} cartons and the packing list says ${built.total_cartons}`);
  for(const r of rows.filter(r => r.mismatch))
    problems.push(`Row ${r.sno}: ${r.cartons} carton(s) at ${r.std_pack} a pack is `
      + `${pairsFromCartons(r.cartons, r.std_pack)} pairs, but ${r.pairs} were counted`);

  return {
    serial_no: text(input.serial_no),
    party: text(input.party || built.customer),
    city: text(input.city),
    transporter: text(input.transporter),
    date: input.date || built.date || null,
    order_no: text(input.order_no || built.order_no),
    order_qty: input.order_qty == null ? null : int(input.order_qty),
    rows, total_pairs, total_cartons,
    mixed_cartons: rows.filter(r => r.mixed).reduce((a, r) => a + r.cartons, 0),
    missing_mrp: rows.filter(r => r.mrp == null).length,
    missing_pack: rows.filter(r => r.pack_unknown).length,
    problems,
    ok: problems.length === 0,
  };
}
