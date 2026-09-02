/* The Packing List — the factory's own dispatch document.
 *
 * Pure: given the lines a packer actually counted, it works out the carton
 * numbers, the totals and what does not add up. No database, no clock.
 *
 * The shape comes from the client's existing sheet, and two things about it
 * matter more than they look:
 *
 * 1. CARTONS ARE COUNTED, NEVER DERIVED. The old dispatch screen divided pairs
 *    by the packing rate and showed "2.67 cartons", which is not a thing that
 *    can be put on a lorry. Sizes inside one range do not pack alike either —
 *    SPIKE's 11X1 packs 12s/13s at 24 and size 1 at 18 — so a derived figure is
 *    wrong as often as it is right. The packer enters the count.
 *
 * 2. ONE LINE CAN HOLD SEVERAL SIZES. A part carton is made up of whatever is
 *    left: the sample sheet has size 8 (10 pairs) and size 9 (16 pairs) sharing
 *    a single carton, numbered 5/49. So a line is {sizes:[...], cartons:n}, and
 *    n is not a function of the sizes.
 *
 * C/N NUMBERS are derived, because they are numbering rather than quantity: the
 * cartons of each line take the next numbers in sequence, so line 4 with two
 * cartons following four already used prints "6-7/49".
 */

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* The sheet has TWO levels, and conflating them gets the S.NO column wrong.
 *
 *   S.NO      one article + closure + colour. It spans however many size rows
 *             that combination needs — the sample sheet's S.NO 1 covers sizes
 *             8, 9 and 10.
 *   carton    one or more size rows packed into the same box(es), and the unit
 *   group     the C/N numbers actually follow. S.NO 1 holds THREE carton
 *             groups of one carton each (1/49, 2/49, 3/49); S.NO 3 holds ONE
 *             group of two sizes sharing a single box (5/49).
 *
 * So a line is {article, closure, colour, groups:[{sizes, cartons}]}. A line
 * given a flat {sizes, cartons} is read as a single group, which is the common
 * case and keeps simple entry simple.
 */
export function buildPackingList(input = {}){
  const rows = Array.isArray(input.lines) ? input.lines : [];
  const problems = [];

  let used = 0;                       // cartons numbered so far
  const lines = rows.map((line, i) => {
    const sno = i + 1;
    const rawGroups = Array.isArray(line.groups) && line.groups.length
      ? line.groups
      : [{ sizes: line.sizes, cartons: line.cartons }];

    const groups = rawGroups.map(g => {
      const sizes = (Array.isArray(g.sizes) ? g.sizes : [])
        .map(s => ({ size: String(s.size ?? "").trim(), pairs: Math.round(num(s.pairs)) }))
        .filter(s => s.size !== "" || s.pairs);
      const pairs = sizes.reduce((a, s) => a + s.pairs, 0);
      const cartons = Math.max(0, Math.round(num(g.cartons)));

      /* Numbered from the running total, so inserting or removing anything
         renumbers what follows exactly as re-writing the sheet would. */
      const from = used + 1;
      const to = used + cartons;
      used = to;

      for(const s of sizes){
        if(!s.size) problems.push(`Line ${sno}: a size is blank`);
        if(s.pairs <= 0) problems.push(`Line ${sno}: size ${s.size||"?"} has no pairs`);
      }
      if(!sizes.length) problems.push(`Line ${sno}: no sizes entered`);
      if(pairs > 0 && cartons === 0) problems.push(`Line ${sno}: ${pairs} pairs but no cartons counted`);
      if(cartons > 0 && pairs === 0) problems.push(`Line ${sno}: ${cartons} carton(s) but no pairs`);

      return { sizes, pairs, cartons,
               cn_from: cartons ? from : null, cn_to: cartons ? to : null };
    });

    return {
      sno,
      article: String(line.article || "").trim(),
      closure: String(line.closure || "").trim(),      // Velcro / Lace
      colour: String(line.colour || "").trim(),
      groups,
      rows: groups.reduce((a, g) => a + Math.max(1, g.sizes.length), 0),
      pairs: groups.reduce((a, g) => a + g.pairs, 0),
      cartons: groups.reduce((a, g) => a + g.cartons, 0),
    };
  });

  const total_pairs = lines.reduce((a, l) => a + l.pairs, 0);
  const total_cartons = lines.reduce((a, l) => a + l.cartons, 0);

  /* The sheet states its own dispatch quantity and carton count in the header.
     Checking the entered lines against those is the only thing that catches a
     whole line being missed — every remaining line still looks reasonable on
     its own, which is exactly how the 14-carton slip lost five of them. */
  const stated_pairs = input.dispatch_pairs == null ? null : Math.round(num(input.dispatch_pairs));
  const stated_cartons = input.dispatch_cartons == null ? null : Math.round(num(input.dispatch_cartons));
  if(stated_pairs != null && total_pairs !== stated_pairs)
    problems.push(`The lines add up to ${total_pairs} pairs but the header says ${stated_pairs}`);
  if(stated_cartons != null && total_cartons !== stated_cartons)
    problems.push(`The lines add up to ${total_cartons} cartons but the header says ${stated_cartons}`);

  return {
    customer: String(input.customer || "").trim(),
    order_no: String(input.order_no || "").trim(),
    order_qty: input.order_qty == null || input.order_qty === "" ? null : Math.round(num(input.order_qty)),
    date: input.date || null,
    lines, total_pairs, total_cartons,
    stated_pairs, stated_cartons,
    problems,
    ok: problems.length === 0,
  };
}

/* "1/49", or "6-7/49" when a line fills more than one carton. Blank when a line
   has no cartons yet, rather than a misleading "0/49". */
export function cartonNumbers(group, totalCartons){
  if(!group || !group.cn_from || !group.cn_to) return "";
  const span = group.cn_from === group.cn_to ? `${group.cn_from}` : `${group.cn_from}-${group.cn_to}`;
  return `${span}/${totalCartons}`;
}

/* Seed a sheet from what the order already knows, so the packer types counts
   rather than re-keying the article, closure and colour on every line. Sizes
   come from the ranges being sent, one line per range, and the carton count is
   deliberately left at 0 — it is the one number that must be counted. */
export function draftFromOrder(order, sizesForCombo, dispatched = {}){
  const pi = (order && order.pi) || {};
  const lines = [];
  for(const [combo, pairs] of Object.entries(dispatched)){
    const total = Math.round(num(pairs));
    if(total <= 0) continue;
    const sizes = (sizesForCombo(combo) || []).map(size => ({ size, pairs: 0 }));
    lines.push({
      article: order.article_code || "",
      closure: pi.vl || "",
      colour: pi.upper_colour || pi.sole_colour || "",
      combo, combo_pairs: total,
      /* One group per size by default — the common case is a size filling its
         own cartons. Sizes are merged into one group when they share a box. */
      groups: (sizes.length ? sizes : [{ size:"", pairs: 0 }])
        .map(s => ({ sizes:[s], cartons: 0 })),
    });
  }
  return {
    customer: (order && order.party) || "",
    order_no: (order && order.order_no) || "",
    order_qty: null,
    date: null,
    lines,
  };
}
