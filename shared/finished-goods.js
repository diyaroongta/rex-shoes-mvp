/* SHOES MADE FOR STOCK, NOT FOR A CUSTOMER.
 *
 * A job card either belongs to an Order Book row or it does not, and the
 * difference is already in the data: `order_no` is set on a customer card and
 * null on one raised to build stock. What comes back on a CUSTOMER card is
 * owed to that customer and is tracked by the order; what comes back on a
 * STOCK card belongs to the factory and has, until now, been recorded nowhere.
 *
 * DERIVED, NOT STORED. Finished goods are the sum of what came back on stock
 * cards — the same rule repair follows, where the movements are kept and the
 * totals are worked out. A stored counter would drift the moment a receipt was
 * corrected; this cannot, because it is recomputed from the receipts.
 *
 * WHAT IT WILL NOT GUESS. `received` is a total, not a size breakdown: a card
 * for 300 pairs that has had 200 back does not say WHICH 200. So sizes are
 * reported only for a card that came back in FULL, where the card's own size
 * list is the answer. A part-received card counts its pairs against the
 * article and says its sizes are not yet known, rather than splitting 200
 * across the sizes and inventing a breakdown nobody recorded.
 *
 * This counts what was MADE. Nothing in this system yet records a sale out of
 * finished stock, so `on_hand` is what has been produced for stock, not what
 * is left after issuing any of it — and it says so rather than implying a
 * warehouse count.
 */

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isStockCard = job => !String(job && job.order_no || "").trim();

export function finishedGoods(jobs = []){
  const byArticle = new Map();
  let unknownSizePairs = 0;

  for(const job of jobs || []){
    if(!isStockCard(job)) continue;                 // a customer's pairs, not ours
    const made = Math.max(0, Math.round(num(job.received)));
    if(made <= 0) continue;
    const article = String(job.article || "").trim() || "—";
    if(!byArticle.has(article))
      byArticle.set(article, { article, pairs:0, sizes:{}, sizes_known:0,
                               cards:0, open_cards:0, sizes_unknown:0 });
    const row = byArticle.get(article);
    row.pairs += made;
    row.cards += 1;
    if(String(job.status || "") !== "closed") row.open_cards += 1;

    /* Only a card that came back in full can say which sizes it was. */
    const full = made >= Math.round(num(job.qty));
    const lines = (job.card && Array.isArray(job.card.lines)) ? job.card.lines : [];
    if(full && lines.length){
      for(const line of lines)
        for(const [size, pairs] of Object.entries(line.sizes || {}))
          row.sizes[size] = (row.sizes[size] || 0) + Math.max(0, Math.round(num(pairs)));
      row.sizes_known += made;
    }else{
      row.sizes_unknown += made;
      unknownSizePairs += made;
    }
  }

  const articles = [...byArticle.values()]
    .map(r => ({ ...r, size_list: Object.entries(r.sizes)
      .map(([size, pairs]) => ({ size, pairs }))
      .sort((a, b) => b.pairs - a.pairs) }))
    .sort((a, b) => b.pairs - a.pairs || a.article.localeCompare(b.article));

  return {
    articles,
    total_pairs: articles.reduce((n, r) => n + r.pairs, 0),
    /* Pairs that are real but whose sizes nobody recorded, said out loud so
       the size table is never read as the whole picture. */
    sizes_unknown_pairs: unknownSizePairs,
  };
}

/* What is on hand of ONE article, for the PI and job-order screens to ask
   before more of it is made. Null when the article has never been made for
   stock — "none recorded" and "none left" are different answers. */
export function onHandFor(jobs, article){
  const key = String(article || "").trim();
  if(!key) return null;
  const row = finishedGoods(jobs).articles.find(r => r.article === key);
  return row || null;
}
