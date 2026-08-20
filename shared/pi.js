/* Proforma Invoice — computation only. Pure: no imports, no I/O, no DOM.
   The same module runs in the browser, in a serverless function, and in tests,
   so what you see on screen is exactly what the tests verify. */

/* Size roll. Positions 0-7 are the kids run, printed with an "s" suffix
   (6s..13s); positions 8-12 are the adult run 1..5. "B" combos are the adult
   repeat of the same numerals, 6..12, printed without a suffix. This is why a
   PI can show both "8s" and "8" as separate lines. */
export const ROLL_KY = ["6","7","8","9","10","11","12","13","1","2","3","4","5","5.5"];
export const ROLL_B  = ["6","7","8","9","10","11","12","13"];

export function comboSizes(combo){
  if(!combo) return [];
  let c = String(combo).toUpperCase().trim();
  // A trailing "S" marks the small/kids run of an otherwise ordinary range
  // (7X10S == 7X10). Without stripping it the range explodes to nothing.
  if(/[0-9]S$/.test(c)) c = c.slice(0,-1);
  if(c.endsWith("B")){
    const [a,b] = c.slice(0,-1).split("X");
    const i = ROLL_B.indexOf(a), j = ROLL_B.indexOf(b);
    if(i < 0 || j < 0) return [];
    return ROLL_B.slice(i, Math.max(i,j)+1);            // adult: no suffix
  }
  const [a,b] = c.split("X");
  const i = ROLL_KY.indexOf(a), j = ROLL_KY.indexOf(b);
  if(i < 0 || j < 0) return [];
  return ROLL_KY.slice(i, Math.max(i,j)+1)
                .map((s,k) => (i+k) <= 7 ? s+"s" : s);   // kids run gets "s"
}

/* Split a combo's total pairs across its sizes. Remainder goes to the earliest
   sizes, which is how 750 across 4 sizes becomes 188/188/187/187. */
export function splitQty(total, n){
  const t = Math.max(0, Math.round(Number(total) || 0));
  if(n <= 0) return [];
  const base = Math.floor(t / n), rem = t - base * n;
  return Array.from({length:n}, (_,i) => base + (i < rem ? 1 : 0));
}

export const DEFAULT_TERMS = {
  discount_pct: 40,
  deductions: [                       // applied in order, each on the running balance
    { label: "F.O.R.",        pct: 2     },
    { label: "Cash Discount", pct: 3     },
    { label: "GST Dis",       pct: 4.760 },
  ],
  gst_pct: 5,
  gst_label: "GST",
  payment_split_pct: 50,
  dispatch_timeline: "45 days",
};

/* Build every line of a PI from an order.
   order  : { order_no, order_date, party, article_code, lines:[{combo, qty, sizes?}] }
   article: reference-data entry (sole_type etc.)
   mrp    : { combo: mrp } for this article
   Per-size quantities are used verbatim when the order carries them (a PI that
   was read in); otherwise the combo total is split across its sizes. */
export function buildLines(order, mrp = {}, terms = DEFAULT_TERMS){
  const discount = Number(terms.discount_pct) || 0;
  const out = [], missing = [];

  for(const line of (order.lines || [])){
    const sizes = Array.isArray(line.size_order) && line.size_order.length
      ? line.size_order.map(String)
      : comboSizes(line.combo);
    if(!sizes.length){ missing.push({ combo: line.combo, why: "unknown size range" }); continue; }

    const m = mrp[line.combo];
    if(m == null) missing.push({ combo: line.combo, why: "no MRP on file" });

    const qtys = line.sizes
      ? sizes.map(s => Math.max(0, Math.round(Number(line.sizes[s]) || 0)))
      : splitQty(line.qty, sizes.length);

    sizes.forEach((size, i) => {
      const qty = qtys[i] || 0;
      if(!qty) return;
      const mrpVal = m == null ? null : Number(m);
      const rate   = mrpVal == null ? null : Math.round(mrpVal * (1 - discount/100));
      out.push({
        combo: line.combo, size, qty,
        mrp: mrpVal, discount_pct: discount, rate,
        amount: rate == null ? null : qty * rate,
      });
    });
  }
  return { lines: out, missing };
}

/* The deduction ladder. Each step is rounded to whole rupees and applied to the
   running balance, not to the original subtotal — that sequencing is what makes
   the arithmetic reconcile. */
export function buildTotals(lines, terms = DEFAULT_TERMS){
  const priced    = lines.filter(l => l.amount != null);
  const unpriced  = lines.length - priced.length;
  const total_qty = lines.reduce((a,l) => a + l.qty, 0);
  const subtotal  = priced.reduce((a,l) => a + l.amount, 0);

  const steps = [];
  let running = subtotal;
  for(const d of (terms.deductions || [])){
    const amount = Math.round(running * (Number(d.pct)||0) / 100);
    running -= amount;
    steps.push({ kind:"less", label:d.label, pct:Number(d.pct)||0, amount, running });
  }
  const gst_pct = Number(terms.gst_pct) || 0;
  const gst = Math.round(running * gst_pct / 100);
  running += gst;
  steps.push({ kind:"add", label: terms.gst_label || "GST", pct:gst_pct, amount:gst, running });

  const split = Number(terms.payment_split_pct) || 50;
  const on_order = Math.round(running * split / 100);

  return {
    total_qty, subtotal, steps, total: running, unpriced_lines: unpriced,
    payment: { split_pct: split, on_order, on_dispatch: running - on_order },
  };
}

/* One PI can cover several articles. Each item carries its OWN mrp table, its
   own catalogue image and its own descriptive columns, because pricing an
   article against another article's MRP is silently wrong money. Lines keep an
   `item` index so the renderer can group rows and span each image over exactly
   the rows it belongs to. */
export function buildMultiPI(items = [], terms = DEFAULT_TERMS){
  const allLines = [], missing = [], groups = [];
  items.forEach((item, i) => {
    const built = buildLines({ lines: item.lines || [] }, item.mrp || {}, terms);
    built.lines.forEach(l => { l.item = i; l.article_code = item.article_code; });
    built.missing.forEach(m => missing.push({ ...m, article: item.article_code }));
    groups.push({
      index: i,
      article_code: item.article_code,
      article_label: item.article_label || item.article_code,
      vl: item.vl || "", sole_colour: item.sole_colour || "", upper_colour: item.upper_colour || "",
      order_nature: item.order_nature || "", printing: !!item.printing,
      source: item.source || "As per catalogue",
      image: item.image || null,
      lines: built.lines,
    });
    built.lines.forEach(l => allLines.push(l));
  });
  return { lines: allLines, groups, missing, totals: buildTotals(allLines, terms), terms };
}

export function buildPI(order, article, mrp = {}, terms = DEFAULT_TERMS){
  // Multi-article form: the order carries `items`, each with its own MRP+image.
  if(order && Array.isArray(order.items) && order.items.length)
    return buildMultiPI(order.items, terms);

  // Single-article form, kept so existing callers and tests are unaffected.
  const { lines, missing } = buildLines(order, mrp, terms);
  const groups = [{
    index: 0,
    article_code: order.article_code,
    article_label: order.article_label || order.article_code,
    vl: order.vl || "", sole_colour: order.sole_colour || "", upper_colour: order.upper_colour || "",
    order_nature: order.order_nature || "", printing: !!order.printing,
    source: order.catalogue_source || "As per catalogue",
    image: order.image || null,
    lines,
  }];
  lines.forEach(l => { l.item = 0; l.article_code = order.article_code; });
  return { lines, groups, missing, totals: buildTotals(lines, terms), terms };
}

/* Indian digit grouping: 2,266,970 -> 22,66,970 */
export function inr(n){
  if(n == null || isNaN(n)) return "0";
  const v = Math.round(n), s = String(Math.abs(v));
  if(s.length <= 3) return (v<0?"-":"") + s;
  return (v<0?"-":"") + s.slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + s.slice(-3);
}
