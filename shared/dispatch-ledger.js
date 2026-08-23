/* Ordered versus dispatched, per order and per size range. Pure: the dispatch
   screen renders this, and nothing about the arithmetic lives in the component.

   The one rule that is easy to get wrong: closing an order short is an
   ACCEPTANCE that the balance is never coming. Once any dispatch against an
   order carries `closes_order`, the outstanding balance stops being pending and
   becomes a recorded shortfall. An order that still shows a pending balance
   after being closed keeps appearing as work to do and can be dispatched
   against again — which is what happened before this module existed. */

const sum = obj => Object.values(obj || {}).reduce((a,b) => a + (Number(b) || 0), 0);

export function buildLedger(orders = [], dispatches = [], pairsPerCarton = () => null){
  const byOrder = {};
  for(const o of orders){
    const ordered = {};
    for(const l of (o.lines || [])) ordered[l.combo] = (ordered[l.combo] || 0) + Number(l.qty || 0);
    byOrder[o.order_no] = { order:o, ordered, dispatched:{}, closed:false, closed_on:null };
  }

  for(const d of dispatches || []){
    const rec = byOrder[d.order_no];
    if(!rec) continue;
    for(const [combo, v] of Object.entries(d.dispatched || {}))
      rec.dispatched[combo] = (rec.dispatched[combo] || 0) + Number(v || 0);
    if(d.closes_order){
      rec.closed = true;
      const on = String(d.dispatched_on || "").slice(0,10);
      if(on && (!rec.closed_on || on > rec.closed_on)) rec.closed_on = on;
    }
  }

  for(const rec of Object.values(byOrder)){
    const article = rec.order.article_code || rec.order.article;
    rec.rows = Object.keys(rec.ordered).map(combo => {
      const ord = rec.ordered[combo], disp = rec.dispatched[combo] || 0;
      const outstanding = ord - disp;
      const ppc = pairsPerCarton(article, combo);
      return { combo, ordered:ord, dispatched:disp,
               pending: rec.closed ? 0 : outstanding,
               shortfall: rec.closed ? Math.max(0, outstanding) : 0,
               outstanding,
               ppc: ppc ?? null,
               pending_cartons: ppc ? outstanding / ppc : null };
    });
    rec.total_ordered    = rec.rows.reduce((a,r) => a + r.ordered, 0);
    rec.total_dispatched = rec.rows.reduce((a,r) => a + r.dispatched, 0);
    const balance = rec.total_ordered - rec.total_dispatched;
    rec.total_pending = rec.closed ? 0 : balance;
    rec.shortfall     = rec.closed ? Math.max(0, balance) : 0;
    rec.status = rec.closed        ? (rec.shortfall > 0 ? "closed short" : "complete")
               : rec.total_dispatched === 0 ? "not started"
               : balance <= 0      ? "complete"
               : "partial";
  }
  return byOrder;
}

export function ledgerTotals(ledger){
  return Object.values(ledger).reduce((a,r) => ({
    ordered:    a.ordered    + r.total_ordered,
    dispatched: a.dispatched + r.total_dispatched,
    pending:    a.pending    + r.total_pending,
    shortfall:  a.shortfall  + r.shortfall,
  }), { ordered:0, dispatched:0, pending:0, shortfall:0 });
}
