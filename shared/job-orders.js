import { takeFromSizes } from "./pi-split.js";

/* Job Orders are the factory allocation view of the live Order Book. A row is
   waiting while any of its ordered pairs have not yet been put on an issued
   job card. The commercial PI is deliberately not consulted here: once an
   order is in the Order Book, that book is the source of production work. */

const qty = value => Math.max(0, Math.round(Number(value) || 0));

export function jobOrderBalance(order, jobs = []){
  const lines = (order?.lines || []).map(line => ({
    combo: line.combo,
    label: line.label || line.combo,
    ordered: qty(line.qty),
    issued: 0,
    ordered_sizes: line.sizes && typeof line.sizes === "object" ? { ...line.sizes } : null,
    issued_sizes: {},
    size_order: Array.isArray(line.size_order) ? line.size_order : Object.keys(line.sizes || {}),
  }));
  const byCombo = new Map(lines.map(line => [line.combo, line]));
  let legacy = 0;

  for(const job of jobs || []){
    if(String(job?.order_no || "") !== String(order?.order_no || "")) continue;
    const cardLines = Array.isArray(job?.card?.lines) ? job.card.lines : [];
    let described = 0;
    for(const cardLine of cardLines){
      const line = byCombo.get(cardLine.combo);
      if(!line) continue;
      const n = qty(cardLine.qty);
      line.issued += n;
      described += n;
      for(const [size, amount] of Object.entries(cardLine.sizes || {}))
        line.issued_sizes[size] = (line.issued_sizes[size] || 0) + qty(amount);
    }
    legacy += Math.max(0, qty(job.qty) - described);
  }

  /* Old job-work rows predate the card snapshot. Count them, but consume the
     Order Book lines in their printed order rather than pretending we know an
     exact size split that was never recorded. */
  for(const line of lines){
    if(legacy <= 0) break;
    const room = Math.max(0, line.ordered - line.issued);
    const used = Math.min(room, legacy);
    line.issued += used;
    legacy -= used;
  }

  for(const line of lines){
    line.issued = Math.min(line.ordered, line.issued);
    line.remaining = Math.max(0, line.ordered - line.issued);
    if(line.ordered_sizes){
      const knownLeft = Object.fromEntries(Object.entries(line.ordered_sizes).map(([size, amount]) =>
        [size, Math.max(0, qty(amount) - qty(line.issued_sizes[size]))]));
      const knownIssued = Object.values(line.issued_sizes).reduce((a,n)=>a+qty(n),0);
      const unlocated = Math.max(0, line.issued - knownIssued);
      line.remaining_sizes = takeFromSizes(knownLeft, unlocated).left;
    }
  }

  const ordered = lines.reduce((a,line)=>a+line.ordered,0);
  const issued = lines.reduce((a,line)=>a+line.issued,0);
  return { order, lines, ordered, issued, remaining:Math.max(0,ordered-issued), fully_issued:issued>=ordered };
}

export function jobOrderQueue(orders = [], jobs = []){
  return orders.map(order => jobOrderBalance(order, jobs));
}
