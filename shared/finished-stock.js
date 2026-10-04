/* FINISHED GOODS — pairs that are made, boxed and not owed to anyone.
 *
 * Two roads lead into finished stock, and both are recorded rather than
 * guessed:
 *
 *   1. A job card raised FOR STOCK (no order number) comes back. That has always
 *      been derived from the card receipts — shared/finished-goods.js.
 *   2. A MOVEMENT is recorded in the `finished_stock` ledger:
 *        opening     the count already on the shelf when the system started
 *        received    pairs put into stock by hand (a count, a return)
 *        from_order  an MTS order "moved to stock" from the Dispatch Book
 *        issued      pairs taken OUT of stock for a customer (negative)
 *        adjust      a physical count correcting the book (either sign)
 *
 * The ledger is an EVENT LOG for the same reason repair is: a wrong entry is
 * deleted and re-entered, and the balance is always the sum of what happened.
 * A stored counter would drift the first time a movement was corrected.
 *
 * Pure: no database, no clock.
 */
import { finishedGoods } from "./finished-goods.js";

export const MOVE_KINDS = {
  opening:    { label:"Opening stock",          sign: 1 },
  received:   { label:"Received into stock",    sign: 1 },
  from_order: { label:"Moved in from MTS order", sign: 1 },
  issued:     { label:"Issued out of stock",    sign:-1 },
  adjust:     { label:"Count adjustment",       sign: 0 },  // signed as entered
};

const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

/* Validate movements coming from the screen or an upload. Returns
   {rows, problems}; the server refuses on any problem. */
export function validateMoves(input = []){
  const problems = [], rows = [];
  for(const [i, m] of (Array.isArray(input) ? input : []).entries()){
    const at = `Row ${i + 1}`;
    const article = String(m && m.article || "").trim();
    const size = String(m && m.size || "").trim();
    const kind = String(m && m.kind || "").trim();
    let qty = int(m && m.qty);
    if(!article){ problems.push(`${at}: article is required`); continue; }
    if(!size){ problems.push(`${at}: size is required — finished stock is counted per size`); continue; }
    if(!MOVE_KINDS[kind]){ problems.push(`${at}: kind must be one of ${Object.keys(MOVE_KINDS).join(", ")}`); continue; }
    if(!qty){ problems.push(`${at}: quantity must be a whole number other than 0`); continue; }
    const sign = MOVE_KINDS[kind].sign;
    /* The sign follows the KIND, so "issued 40" can never add 40 by accident. */
    if(sign) qty = sign * Math.abs(qty);
    const moved_on = String(m.moved_on || "").slice(0, 10);
    if(moved_on && !/^\d{4}-\d{2}-\d{2}$/.test(moved_on)){ problems.push(`${at}: date must be YYYY-MM-DD`); continue; }
    rows.push({ article, size, kind, qty,
      order_no: String(m.order_no || "").trim() || null,
      note: String(m.note || "").trim().slice(0, 300) || null,
      moved_on: moved_on || null });
  }
  if(!rows.length && !problems.length) problems.push("No movements to record");
  return { rows, problems };
}

/* On hand, per article and per size, from BOTH roads. */
export function finishedStock(moves = [], jobs = []){
  const byArticle = new Map();
  const row = article => {
    if(!byArticle.has(article))
      byArticle.set(article, { article, sizes:{}, total:0, from_cards:0, from_moves:0,
                               sizes_unknown:0, negative:[] });
    return byArticle.get(article);
  };
  for(const m of moves || []){
    const r = row(String(m.article || "").trim() || "—");
    const q = int(m.qty);
    r.sizes[m.size] = (r.sizes[m.size] || 0) + q;
    r.from_moves += q;
  }
  for(const a of finishedGoods(jobs).articles){
    const r = row(a.article);
    for(const [size, q] of Object.entries(a.sizes)) r.sizes[size] = (r.sizes[size] || 0) + q;
    r.from_cards += a.pairs;
    r.sizes_unknown += a.sizes_unknown;
  }
  const articles = [...byArticle.values()].map(r => {
    const size_list = Object.entries(r.sizes).filter(([, q]) => q !== 0)
      .map(([size, pairs]) => ({ size, pairs }));
    /* Below zero is a BOOKKEEPING fault — more issued than ever came in — and
       is reported, never quietly floored. */
    const negative = size_list.filter(s => s.pairs < 0).map(s => s.size);
    const total = size_list.reduce((a, s) => a + s.pairs, 0) + r.sizes_unknown;
    return { ...r, size_list, negative, total };
  }).filter(r => r.total !== 0 || r.negative.length)
    .sort((a, z) => z.total - a.total || a.article.localeCompare(z.article));
  return { articles, total_pairs: articles.reduce((a, r) => a + r.total, 0) };
}

/* "Is any of this already made?" — asked by the PI and the job order BEFORE a
   duplicate card is written. Sizes are matched as written on the order; a
   line ordered as a range is matched against the sizes of that range. */
export function stockForOrder(stock, article, lines = [], sizesForCombo = () => []){
  const row = ((stock && stock.articles) || []).find(r => r.article === String(article || "").trim());
  if(!row) return { article, any:false, covered:0, wanted:0, sizes:[] };
  const onHand = Object.fromEntries(row.size_list.filter(s => s.pairs > 0).map(s => [s.size, s.pairs]));
  const wanted = {};
  for(const l of lines || []){
    const exact = l && l.sizes && typeof l.sizes === "object" && Object.values(l.sizes).some(v => int(v) > 0);
    if(exact) for(const [s, q] of Object.entries(l.sizes)){ if(int(q) > 0) wanted[s] = (wanted[s] || 0) + int(q); }
    else for(const s of sizesForCombo(l.combo) || []) if(!(s in wanted)) wanted[s] = null;   // range: size unknown
  }
  const sizes = Object.entries(wanted).filter(([s]) => onHand[s] > 0).map(([size, want]) => ({
    size, on_hand: onHand[size], wanted: want,
    cover: want == null ? null : Math.min(want, onHand[size]),
  }));
  const covered = sizes.reduce((a, s) => a + (s.cover || 0), 0);
  const wantedTotal = Object.values(wanted).reduce((a, v) => a + (v || 0), 0);
  return { article, any: sizes.length > 0, covered, wanted: wantedTotal, sizes,
           sizes_unknown: row.sizes_unknown, total_on_hand: row.total };
}

/* MTO STOCK — pairs MADE for a customer order and not yet shipped.
   Packed is what the floor reported against PACKING (summed over every job
   card of the order); dispatched is the Dispatch Book. The difference is
   boxed shoes standing in the factory waiting for a lorry — the MTO stock the
   dispatch clerk ships from. Only orders whose nature is MTO are listed. */
export function mtoStock(orders = [], actuals = [], dispatches = []){
  const packed = {};
  for(const a of actuals || []){
    if(String(a.stage || "").toUpperCase() !== "PACKING") continue;
    const no = String(a.order_no || "");
    packed[no] = (packed[no] || 0) + Math.max(0, int(a.actual_pairs) - int(a.rejected_pairs));
  }
  const sent = {};
  for(const d of dispatches || [])
    sent[d.order_no] = (sent[d.order_no] || 0) + Object.values(d.dispatched || {}).reduce((x, v) => x + int(v), 0);
  const rows = (orders || [])
    .filter(o => /\bMTO\b/i.test(String((o.pi || {}).order_nature || "")))
    .map(o => {
      const ordered = (o.lines || []).reduce((a, l) => a + int(l.qty), 0);
      const p = Math.min(ordered, packed[o.order_no] || 0);
      const s_ = sent[o.order_no] || 0;
      return { order_no:o.order_no, party:o.party, article:o.article_code || o.article,
               ordered, packed:p, dispatched:s_, ready:Math.max(0, p - s_), to_make:Math.max(0, ordered - p) };
    })
    .sort((a, z) => z.ready - a.ready || a.order_no.localeCompare(z.order_no));
  return { rows, ready_pairs: rows.reduce((a, r) => a + r.ready, 0) };
}
