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
    byOrder[o.order_no] = { order:o, ordered, dispatched:{}, cartons:{}, events:[],
                            closed:false, closed_on:null };
  }

  for(const d of dispatches || []){
    const rec = byOrder[d.order_no];
    if(!rec) continue;
    for(const [combo, v] of Object.entries(d.dispatched || {}))
      rec.dispatched[combo] = (rec.dispatched[combo] || 0) + Number(v || 0);
    /* Cartons are COUNTED on the packing list and stored per dispatch. They
       are tracked separately from pairs because they answer a different
       question — how many boxes went on the lorry — and because a dispatch
       recorded without a packing list has pairs but no carton count, which
       must read as "not counted" rather than as zero. */
    for(const [combo, v] of Object.entries(d.cartons || {}))
      rec.cartons[combo] = (rec.cartons[combo] || 0) + Number(v || 0);
    rec.events.push({ id:d.id, kind:d.kind || "partial",
      on:String(d.dispatched_on || "").slice(0,10),
      pairs:Object.values(d.dispatched || {}).reduce((a,v)=>a+Number(v||0),0),
      cartons:Object.keys(d.cartons || {}).length
        ? Object.values(d.cartons).reduce((a,v)=>a+Number(v||0),0) : null,
      has_packing_list: !!d.packing_list });
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
               cartons: rec.cartons[combo] == null ? null : rec.cartons[combo],
               pending: rec.closed ? 0 : outstanding,
               shortfall: rec.closed ? Math.max(0, outstanding) : 0,
               outstanding,
               ppc: ppc ?? null,
               pending_cartons: ppc ? outstanding / ppc : null };
    });
    rec.events.sort((a,z) => String(z.on).localeCompare(String(a.on)) || Number(z.id||0)-Number(a.id||0));
    rec.dispatch_count = rec.events.length;
    rec.last_dispatched_on = rec.events.length ? rec.events[0].on : null;
    /* null, not 0, when nothing was ever counted: an order dispatched without
       a packing list has not been packed into "zero cartons". */
    rec.total_cartons = Object.keys(rec.cartons).length
      ? Object.values(rec.cartons).reduce((a,v) => a + Number(v||0), 0) : null;
    rec.total_ordered    = rec.rows.reduce((a,r) => a + r.ordered, 0);
    rec.total_dispatched = rec.rows.reduce((a,r) => a + r.dispatched, 0);
    const balance = rec.total_ordered - rec.total_dispatched;
    rec.total_pending = rec.closed ? 0 : balance;
    rec.shortfall     = rec.closed ? Math.max(0, balance) : 0;
    /* A closed order with nothing short really is complete, but saying only
       "complete" hides that it was closed deliberately rather than shipped
       out naturally. */
    rec.status = rec.closed        ? (rec.shortfall > 0 ? "closed short" : "closed complete")
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
