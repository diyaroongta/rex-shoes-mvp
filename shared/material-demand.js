/* WHAT NO LONGER NEEDS RAW MATERIAL.
 *
 * Procurement multiplied the BOM by the FULL quantity of every live order. An
 * order stays live in the Order Book after it ships (so its history can be
 * read), so a fully dispatched order kept asking for rexine and soles it would
 * never use, and a job card that had come back and been CLOSED kept its
 * material on the buying list. The factory's rule: once the card is done, its
 * procurement goes away.
 *
 * This works out, per plan unit (job card or unreleased balance) and per size
 * range, the pairs that need NO further material:
 *
 *   1. a CLOSED job card                → all of it (closed short included —
 *                                         the shortfall is written off, and a
 *                                         remake is a new card with its own need)
 *   2. an open card with pairs received → those pairs
 *   3. pairs DISPATCHED on the order    → taken off its units in plan order,
 *                                         after what 1–2 already covered, so a
 *                                         pair is never subtracted twice
 *   4. an order CLOSED in dispatch      → everything left on it
 *
 * Returns {unit_key: {combo: pairs}}; compute() takes it as opts.materialDone
 * and nets only what is left. Pure.
 */
const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

/* Spread `n` pairs across lines in proportion to their quantity, never more
   than a line holds; the remainder goes to the earliest lines. */
function spreadOver(lines, n){
  const have = lines.map(l => int(l.qty));
  const total = have.reduce((a, b) => a + b, 0);
  const want = Math.min(int(n), total);
  if(!want) return lines.map(() => 0);
  const base = have.map(h => Math.floor(h * want / total));
  let short = want - base.reduce((a, b) => a + b, 0);
  for(let i = 0; i < base.length && short > 0; i++) if(base[i] < have[i]){ base[i]++; short--; }
  return base;
}

export function materialDone(units = [], jobs = [], dispatches = []){
  const done = {};
  const add = (key, combo, n) => { if(n > 0) (done[key] = done[key] || {})[combo] = ((done[key] || {})[combo] || 0) + n; };
  const left = (u, combo) => {
    const line = (u.lines || []).filter(l => l.combo === combo).reduce((a, l) => a + int(l.qty), 0);
    return Math.max(0, line - ((done[u.unit_key] || {})[combo] || 0));
  };
  const jobById = new Map((jobs || []).map(j => [String(j.id), j]));

  /* 1–2: the job cards themselves. */
  for(const u of units || []){
    if(u.unit_kind !== "job") continue;
    const job = jobById.get(String(u.job_id));
    if(!job) continue;
    const lines = (u.lines || []).filter(l => int(l.qty) > 0);
    const qty = lines.reduce((a, l) => a + int(l.qty), 0);
    const finished = String(job.status || "") === "closed" ? qty : Math.min(qty, int(job.received));
    spreadOver(lines, finished).forEach((n, i) => add(u.unit_key, lines[i].combo, n));
  }

  /* 3–4: what the Dispatch Book says left the factory. */
  const sent = {}, closed = new Set();
  for(const d of dispatches || []){
    const no = String(d.order_no || "");
    for(const [combo, v] of Object.entries(d.dispatched || {})) (sent[no] = sent[no] || {})[combo] = ((sent[no] || {})[combo] || 0) + int(v);
    if(d.closes_order) closed.add(no);
  }
  const byOrder = new Map();
  for(const u of units || []){
    const no = String(u.source_order_no || u.order_no || "");
    if(!byOrder.has(no)) byOrder.set(no, []);
    byOrder.get(no).push(u);
  }
  for(const [no, list] of byOrder){
    /* Cards before the unreleased balance: shipped pairs were made on a card. */
    const ordered = [...list].sort((a, z) => (a.unit_kind === "balance") - (z.unit_kind === "balance"));
    if(closed.has(no)){
      for(const u of ordered) for(const l of u.lines || []) add(u.unit_key, l.combo, left(u, l.combo));
      continue;
    }
    for(const [combo, pairs] of Object.entries(sent[no] || {})){
      /* Pairs already counted as finished on a card are the same pairs that
         shipped — only the excess is new. */
      const already = ordered.reduce((a, u) => a + ((done[u.unit_key] || {})[combo] || 0), 0);
      let extra = Math.max(0, pairs - already);
      for(const u of ordered){
        if(!extra) break;
        const take = Math.min(extra, left(u, combo));
        add(u.unit_key, combo, take); extra -= take;
      }
    }
  }
  return done;
}
