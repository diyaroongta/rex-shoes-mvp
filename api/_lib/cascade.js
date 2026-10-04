/* CANCELLING AN ORDER CANCELS EVERYTHING RAISED AGAINST IT.
 *
 * Removing an order used to set `orders.active=false` and nothing else. Its job
 * cards stayed OPEN — still in the Job Orders Database, still in the
 * fabricator's "with fabricator" bucket, still asking to be received — its
 * production entries kept counting in plan-vs-achievement, its repair moves
 * stayed on the bench, and its packing reports stayed in the Dispatch Book.
 * Deleting a PI was worse: it hard-deleted the orders, which a recorded
 * production entry (foreign key) refused outright, and left the job cards
 * orphaned with no order at all.
 *
 * One routine now does the whole chain, inside the caller's transaction:
 *
 *   job cards          CANCELLED: archived, closed, marked `cancelled` — never
 *                      deleted, because a challan number already printed must
 *                      stay resolvable. Photos of the card are kept.
 *   production entries deleted (they were feedback for a plan that is gone)
 *   repair movements   deleted
 *   packing reports    UNDONE: moved to dispatches_removed (recoverable), and
 *                      any finished stock they moved in comes back out
 *   stock issued to it returned to finished stock (the issue is deleted)
 *   the order          archived (active=false), or deleted when `hard`
 *
 * Packing reports are goods that really left, so the caller must confirm them
 * explicitly (`confirmDispatched`); without it the impact is returned and
 * nothing is written. Lives under api/_lib, which Vercel does not deploy as a
 * function — the project is at its twelve-function limit.
 */

export async function orderImpact(client, orderNos){
  const nos = [...new Set((orderNos || []).map(String))];
  if(!nos.length) return { orders:[], job_cards_open:0, job_cards_closed:0, job_cards:[],
    production_rows:0, repair_moves:0, dispatches:0, dispatched_pairs:0, finished_moves:0 };
  const one = async (sql) => (await client.query(sql, [nos])).rows;
  const jobs = await one(`select id, status, card from job_work where order_no = any($1::text[]) and not coalesce(cancelled,false)`);
  const [prod] = await one(`select count(*)::int as n from production_actuals where order_no = any($1::text[])`);
  const [rep] = await one(`select count(*)::int as n from repairs where order_no = any($1::text[])`);
  const disp = await one(`select id, dispatched from dispatches where order_no = any($1::text[])`);
  const [fin] = await one(`select count(*)::int as n from finished_stock where order_no = any($1::text[])`);
  return {
    orders: nos,
    job_cards_open: jobs.filter(j => j.status !== "closed").length,
    job_cards_closed: jobs.filter(j => j.status === "closed").length,
    job_cards: jobs.map(j => (j.card && j.card.card_no) || `#${j.id}`),
    production_rows: Number(prod && prod.n) || 0,
    repair_moves: Number(rep && rep.n) || 0,
    dispatches: disp.length,
    dispatched_pairs: disp.reduce((a, d) => a + Object.values(d.dispatched || {}).reduce((x, v) => x + (Number(v) || 0), 0), 0),
    finished_moves: Number(fin && fin.n) || 0,
  };
}

export async function cascadeCancel(client, orderNos, { confirmDispatched = false, hard = false, user = null } = {}){
  const nos = [...new Set((orderNos || []).map(String))];
  const impact = await orderImpact(client, nos);
  if(impact.dispatches && !confirmDispatched)
    return { refused:true, impact,
      message:`${impact.dispatches} packing report${impact.dispatches===1?"":"s"} (${impact.dispatched_pairs} pairs) `
        + `were recorded against ${nos.join(", ")}. Those goods left the factory — confirm to undo them as well.` };
  if(!nos.length) return { impact };

  const note = `Cancelled with order${user ? ` by ${user}` : ""}`;
  await client.query(
    `update job_work set cancelled=true, archived=true, status='closed',
            note = case when coalesce(note,'')='' then $2 else note || ' · ' || $2 end,
            updated_at=now()
      where order_no = any($1::text[]) and not coalesce(cancelled,false)`, [nos, note]);
  await client.query("delete from production_actuals where order_no = any($1::text[])", [nos]);
  await client.query("delete from repairs where order_no = any($1::text[])", [nos]);

  await client.query(`create table if not exists dispatches_removed (
    id integer primary key, order_no text not null, dispatched jsonb not null,
    cartons jsonb, kind text, note text, dispatched_on date,
    closes_order boolean not null default false,
    removed_at timestamptz not null default now())`);
  await client.query(
    `insert into dispatches_removed (id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order)
     select id, order_no, dispatched, coalesce(cartons,'{}'::jsonb), kind, note, dispatched_on, closes_order
       from dispatches where order_no = any($1::text[])
     on conflict (id) do nothing`, [nos]);
  /* Stock an MTS dispatch moved in, and stock issued OUT to this order, both
     unwind: the first leaves the shelf, the second returns to it. */
  await client.query("delete from finished_stock where order_no = any($1::text[])", [nos]);
  await client.query("delete from dispatches where order_no = any($1::text[])", [nos]);

  if(hard) await client.query("delete from orders where order_no = any($1::text[])", [nos]);
  else await client.query(
    `update orders set active=false, version=version+1, updated_at=now(),
            pi = pi || jsonb_build_object('production_status','cancelled')
      where order_no = any($1::text[])`, [nos]);
  return { impact };
}
