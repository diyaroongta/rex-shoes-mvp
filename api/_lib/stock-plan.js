/* STOCK FIRST — the server side of shared/stock-plan.js.
 *
 * Served from /api/dispatches?resource=stock_plan, for the twelve-function
 * reason job work and the upper store are: this helper lives under _lib/,
 * which Vercel does not count as a function.
 *
 *   GET                      the register (on hand / reserved / free per SKU),
 *                            party locks, and the orders awaiting a decision
 *   GET  &order_no=X         the stock check for one order, and what its
 *                            dispatch slip should be reminded of
 *   POST action:"decide"     use the selected stock, or ignore it
 *   POST action:"lock"       keep stock for one party (qty 0 removes the lock)
 *
 * EVERY WRITE TAKES ONE LOCK FIRST and reads the figures again inside it.
 * "Free" is on hand less reserved, so two planners reaching for the last 40
 * pairs would otherwise both be told there were 40. The second one is refused
 * and handed the numbers as they now stand.
 *
 * The reservation ledger is APPEND-ONLY: nothing here updates or deletes a
 * row. A correction is another row.
 */
import { q, db } from "./db.js";
import { fail } from "./http.js";
import { INPUTS } from "../../shared/inputs.js";
import { stockBalance, stockCheck, planReservations, reconcileAllocation, withOrdered, validateLock,
         validateReservationRow, dispatchFromStock, checkWithdrawals, issueRowsFor, orderColour,
         dispatchPrefill, grantedFor, stockRegister, splitLines, awaitingDecision,
         outstandingFor } from "../../shared/stock-plan.js";
import { cardedBySize, releaseBalance, UPPER_START_STAGE } from "../../shared/production-units.js";

/* Created on first use, like the purchase-order and material-issue tables, so
   the feature does not wait on somebody running schema.sql against the live
   database. Mirrored in db/schema.sql. */
const DDL = `
  alter table orders add column if not exists stock_status text;
  alter table orders add column if not exists stock_allocation jsonb;
  alter table dispatches add column if not exists from_stock jsonb;
  create table if not exists stock_reservations (
    id          bigserial primary key,
    store       text        not null check (store in ('FG','UPPER')),
    article     text        not null,
    colour      text        not null default '',
    size        text        not null,
    for_size    text        not null,
    qty         integer     not null check (qty <> 0),
    kind        text        not null check (kind in ('reserve','release','issue','dispatch')),
    order_no    text        not null,
    party       text,
    job_card_no text,
    dispatch_id integer,
    reason      text,
    created_by  text,
    created_at  timestamptz not null default now()
  );
  create index if not exists stock_reservations_order_idx on stock_reservations (order_no);
  create index if not exists stock_reservations_sku_idx on stock_reservations (store, article, colour, size);
  create table if not exists stock_party_locks (
    store      text        not null check (store in ('FG','UPPER')),
    article    text        not null,
    colour     text        not null default '',
    size       text        not null,
    party      text        not null,
    qty        integer     not null check (qty > 0),
    created_by text,
    created_at timestamptz not null default now(),
    primary key (store, article, colour, size, party)
  )`;
let ensured = false;
export async function ensureStockPlan(client){
  if(ensured) return;
  await (client ? client.query(DDL) : q(DDL));
  ensured = true;
}

const runner = client => client ? (sql, args) => client.query(sql, args) : q;
const rowsOf = async (run, sql, args) => ((await run(sql, args)) || {}).rows || [];

async function referenceArticles(run){
  const rows = await rowsOf(run, "select value from reference_data where id = 1");
  const ref = rows.length && rows[0].value && rows[0].value.articles ? rows[0].value : INPUTS;
  return ref.articles || {};
}

/* Everything the balance is worked out from, read in one place. With `lock`,
   the transaction-scoped advisory lock is taken FIRST, so every writer of a
   reservation — a decision, a dispatch from stock, an upper issue — queues
   behind the one before it and sees its rows. */
export async function loadStock(client, { lock = false, upperMoves = null } = {}){
  const run = runner(client);
  if(lock) await run("select pg_advisory_xact_lock(hashtext('factory-os:stock-plan'))");
  const [finishedMoves, jobs, uppers, reservations, locks, live] = [
    await rowsOf(run, "select article, size, qty, kind, order_no from finished_stock"),
    await rowsOf(run, `select id, article, order_no, qty, received, status, card,
                              coalesce(cancelled,false) as cancelled from job_work`),
    upperMoves || await rowsOf(run, `select kind, article, colour, size, qty, order_no, mts, rework, status,
                              source_type, source, destination, damaged_at, rack, moved_on from upper_store`),
    await rowsOf(run, `select store, article, colour, size, for_size, qty, kind, order_no, party, dispatch_id
                         from stock_reservations order by id`),
    await rowsOf(run, "select store, article, colour, size, party, qty from stock_party_locks"),
    /* Still in work: active, and not closed at dispatch. An order that is
       finished no longer holds the uppers that were stitched for it. */
    await rowsOf(run, `select o.order_no from orders o where o.active
                          and not exists (select 1 from dispatches d where d.order_no = o.order_no and d.closes_order)`),
  ];
  const stock = { finishedMoves, jobs:jobs.filter(j => !j.cancelled), upperMoves:uppers,
    reservations:reservations.map(r => ({ ...r, qty:Number(r.qty) })),
    locks:locks.map(l => ({ ...l, qty:Number(l.qty) })),
    liveOrders:new Set(live.map(r => String(r.order_no))) };
  return { ...stock, balance:stockBalance(stock) };
}

async function insertReservations(client, rows, user, extra = {}){
  const run = runner(client);
  let n = 0;
  for(const raw of rows || []){
    const r = validateReservationRow({ ...raw, ...extra });
    if(!r) continue;
    await run(
      `insert into stock_reservations (store, article, colour, size, for_size, qty, kind, order_no, party,
                                       job_card_no, dispatch_id, reason, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [r.store, r.article, r.colour, r.size, r.for_size, r.qty, r.kind, r.order_no, r.party,
       r.job_card_no, r.dispatch_id, r.reason, user || null]);
    n++;
  }
  return n;
}

/* Everything the named orders still hold goes back to free stock, in one
   statement: a `release` row for each SKU with a positive balance. Used when
   an order is cancelled or closed short. Safe to call for an order that holds
   nothing. */
export async function releaseAllFor(client, orderNos, reason, user){
  const nos = [...new Set((orderNos || []).map(String))];
  if(!nos.length) return 0;
  await ensureStockPlan(client);
  const out = await runner(client)(
    `insert into stock_reservations (store, article, colour, size, for_size, qty, kind, order_no, party, reason, created_by)
     select store, article, colour, size, for_size, -sum(qty)::int, 'release', order_no, max(party), $2, $3
       from stock_reservations where order_no = any($1::text[])
      group by store, article, colour, size, for_size, order_no
     having sum(qty) > 0`, [nos, reason || "Released", user || null]);
  return (out && out.rowCount) || 0;
}

const STOCK_FIELDS = `to_jsonb(orders) ->> 'stock_status' as stock_status,
                      to_jsonb(orders) -> 'stock_allocation' as stock_allocation`;
const orderCols = `order_no, article_code, party, lines, pi, ${STOCK_FIELDS}`;

/* A NEW ORDER STOPS AT THE STOCK CHECK — but only if there is something to
   decide. An order nothing on the shelf matches goes straight through as
   decided, with nothing reserved: no needless click. Called inside the
   transaction that creates the orders; returns what was stamped on each. */
export async function stampNewOrders(client, orders){
  const out = {};
  if(!(orders || []).length) return out;
  await ensureStockPlan(client);
  const stock = await loadStock(client);
  const articles = await referenceArticles(runner(client));
  for(const o of orders){
    const check = stockCheck(o, stock.balance, { colour:orderColour(o, articles[o.article_code]) });
    const status = check.any ? "awaiting" : "decided";
    const allocation = check.any ? null : { mode:"none", auto:true };
    await client.query("update orders set stock_status = $2, stock_allocation = $3 where order_no = $1",
      [o.order_no, status, allocation ? JSON.stringify(allocation) : null]);
    out[o.order_no] = { stock_status:status, stock_allocation:allocation };
  }
  return out;
}

/* The same, for orders that reach the book by number — a PI released into
   production. Inside a savepoint: an order must never fail to be created over
   a stock check; on a failure it is left as every order was before this
   existed, with no status and nothing held back. */
export async function stampOrdersByNo(client, orderNos){
  const nos = [...new Set((orderNos || []).map(String))];
  if(!nos.length) return {};
  try{
    await client.query("savepoint stock_check");
    const { rows } = await client.query(
      `select ${orderCols} from orders where order_no = any($1::text[]) and active`, [nos]);
    const out = await stampNewOrders(client, rows || []);
    await client.query("release savepoint stock_check");
    return out;
  }catch(e){
    console.error("stock check failed for released orders", e);
    await client.query("rollback to savepoint stock_check");
    return {};
  }
}

/* AN ORDER EDITED AFTER ITS STOCK WAS DECIDED. Called inside the edit's own
   transaction when the lines or the article changed. A size reduced or removed
   releases its excess; a changed article releases everything; pairs added go
   back through the stock check — the order waits again only if there is free
   stock that could cover them. Returns the fields to send back, or null when
   the order has no stock decision to keep honest. */
export async function reconcileOrderStock(client, before, after, user){
  const allocation = before.stock_allocation;
  const had = allocation && allocation.mode === "use";
  if(!had && !before.stock_status) return null;
  await ensureStockPlan(client);
  const stock = await loadStock(client, { lock:true });
  const articles = await referenceArticles(runner(client));
  const colour = orderColour(after, articles[after.article_code]);
  let next = allocation || null, status = before.stock_status;

  if(before.article_code !== after.article_code){
    await releaseAllFor(client, [after.order_no], "Order changed to another article", user);
    next = null;
    status = stockCheck(after, stock.balance, { colour }).any ? "awaiting" : "decided";
    if(status === "decided") next = { mode:"none", auto:true };
  }else if(had){
    const fix = reconcileAllocation(after, allocation, stock.reservations);
    if(fix.changed){
      const plan = planReservations(after, { sizes:fix.allocation.sizes }, stock.balance, stock.reservations,
        { colour, reason:"Order quantity reduced" });
      await insertReservations(client, plan.rows.filter(r => r.kind === "release"), user);
    }
    next = { ...fix.allocation, mode:Object.keys(fix.allocation.sizes).length ? "use" : (allocation.mode === "use" ? "ignore" : allocation.mode) };
    if(fix.grew){
      const check = stockCheck(after, stock.balance, { colour, current:next.sizes });
      const more = check.rows.some(r => r.use_fg > r.held_fg
        || r.use_upper_total > Object.values(r.held_upper).reduce((a, n) => a + Number(n || 0), 0));
      if(more) status = "awaiting";
    }
  }else if(allocation && allocation.ordered){
    /* Decided with nothing reserved (ignored, or nothing matched): only an
       increase can reopen the question. */
    const fix = reconcileAllocation(after, allocation, stock.reservations);
    if(fix.grew && stockCheck(after, stock.balance, { colour }).any) status = "awaiting";
    next = { ...allocation, ordered:fix.allocation.ordered };
  }
  await client.query("update orders set stock_status = $2, stock_allocation = $3 where order_no = $1",
    [after.order_no, status || null, next ? JSON.stringify(next) : null]);
  return { stock_status:status || null, stock_allocation:next };
}

/* RAISING A JOB CARD. Refused while the order is still waiting for its stock
   decision — until then nobody knows how many pairs are to be made. A card
   that starts at moulding may carry only pairs whose uppers are reserved; a
   full-routing card only the rest. Returns {error, status} or {production},
   the order as it is to be PRODUCED (less what finished goods cover), which
   is what the caller's balance must be worked out from. */
export async function jobCardStockGate(orderNo, card, prior, remake = false){
  let rows;
  try{ rows = await rowsOf(q, `select ${orderCols} from orders where order_no = $1 and active`, [orderNo]); }
  catch(e){ return {}; }
  const order = rows[0];
  if(!order || (!order.stock_status && !order.stock_allocation)) return {};
  if(awaitingDecision(order))
    return { status:409, error:`${orderNo} is waiting for its stock decision. Open it in the Order Book and choose `
      + `"Use selected stock" or "Ignore stock" first — until then it is not known how many pairs have to be made.` };
  const live = (prior || []).filter(j => !j.cancelled);
  const release = releaseBalance(order, live);
  /* A remake re-issues pairs written off short; the handler's own remake cap
     is what bounds it, not the sizes still unissued. */
  if(remake) return { production:{ ...release.balance.order }, release };
  const fromUppers = String((card && card.start_stage) || "").toUpperCase() === UPPER_START_STAGE;
  const room = {};
  for(const line of fromUppers ? release.from_uppers : release.full)
    for(const [size, n] of Object.entries(line.sizes || {})) room[String(size).toLowerCase()] = (room[String(size).toLowerCase()] || 0) + n;
  const pool = fromUppers ? release.from_upper_pairs : release.full_pairs;
  let total = 0;
  for(const line of (card && card.lines) || []){
    total += Math.max(0, Math.round(Number(line.qty) || 0));
    for(const [size, n] of Object.entries(line.sizes || {})){
      const want = Math.max(0, Math.round(Number(n) || 0));
      const have = room[String(size).toLowerCase()] || 0;
      if(want > have)
        return { status:409, error: fromUppers
          ? `${orderNo} size ${size}: only ${have} pair(s) have uppers reserved in the upper store, so a card starting at moulding cannot carry ${want}.`
          : `${orderNo} size ${size}: only ${have} pair(s) are left to make through the full routing`
            + (release.from_upper_pairs ? ` — ${release.from_upper_pairs} more start at moulding, from upper stock, on their own card.` : ".") };
    }
  }
  if(total > pool)
    return { status:409, error: fromUppers
      ? `${orderNo} has ${pool} pair(s) to start at moulding from upper stock, and ${total} were put on this card.`
      : `${orderNo} has ${pool} pair(s) left to make through the full routing, and ${total} were put on this card.` };
  return { production:{ ...release.balance.order }, release };
}

/* A DISPATCH THAT SHIPS PAIRS OUT OF FINISHED GOODS. One transaction: the
   dispatch row, the finished-stock issues, and the reservation rows that clear
   what the order held. Called by the dispatch handler in place of its plain
   insert; `insert` is that handler's own statement, so the dispatch row is
   written exactly as it always is. */
export async function dispatchWithStock(res, { order, clean, fromStock, insertSql, insertArgs, dispatchedOn, closes, user }){
  const client = await db().connect();
  try{
    await client.query("begin");
    await ensureStockPlan(client);
    const stock = await loadStock(client, { lock:true });
    /* Read again here for the PARTY: stock locked to a party is offered to
       that party's orders only, and the caller's row does not carry it. */
    const full = await rowsOf(runner(client), `select ${orderCols} from orders where order_no = $1`, [order.order_no]);
    order = { ...order, ...(full[0] || {}) };
    const plan = dispatchFromStock(order, fromStock, stock.reservations, stock.balance);
    if(!plan.ok){ await client.query("rollback"); return fail(res, 400, plan.problems.slice(0, 5).join("; ")); }
    /* The pairs from stock are part of THIS dispatch, range by range. */
    const combos = {};
    for(const line of splitLines(order.lines, fromStock).taken) combos[line.combo] = (combos[line.combo] || 0) + line.qty;
    for(const [combo, n] of Object.entries(combos))
      if(n > (clean[combo] || 0)){
        await client.query("rollback");
        return fail(res, 400, `${combo}: ${n} pairs were marked as coming from finished goods, but this dispatch ships ${clean[combo] || 0} of that range.`);
      }
    const { rows } = await client.query(insertSql, insertArgs);
    const id = rows[0].id;
    const sizes = Object.fromEntries(plan.issues.map(m => [m.size, -m.qty]));
    await client.query("update dispatches set from_stock = $2 where id = $1", [id, JSON.stringify({ sizes, combos })]);
    for(const m of plan.issues)
      await client.query(
        `insert into finished_stock (article, size, qty, kind, order_no, dispatch_id, note, moved_on, created_by)
         values ($1,$2,$3,'issued',$4,$5,$6, coalesce($7::date, current_date), $8)`,
        [m.article, m.size, m.qty, m.order_no, id, "Dispatched from finished goods", dispatchedOn || null, user || null]);
    await insertReservations(client, plan.rows, user, { dispatch_id:id });
    if(closes) await releaseAllFor(client, [order.order_no], "Order closed short at dispatch", user);
    await client.query("commit");
    return res.status(201).json({ ...rows[0], from_stock:{ sizes, combos }, shipped_from_stock:plan.pairs });
  }catch(e){ try{ await client.query("rollback"); }catch(_){ } throw e; }
  finally{ client.release(); }
}

/* A dispatch that was undone gives back what it took: the finished-stock
   issues are deleted with it (by the caller, by dispatch_id), and its
   `dispatch` rows are NEGATED — a row of the same kind with the opposite sign.
   Not re-reserved: a fresh `reserve` row would leave the order reading as
   having been granted the pairs twice and having consumed them once, and a
   later edit could then never release them. The negating row carries no
   dispatch_id, so it cannot itself be undone. */
export async function restoreDispatchReservations(client, dispatchId, user){
  await ensureStockPlan(client);
  return runner(client)(
    `insert into stock_reservations (store, article, colour, size, for_size, qty, kind, order_no, party, reason, created_by)
     select store, article, colour, size, for_size, -qty, 'dispatch', order_no, party, 'Dispatch undone', $2
       from stock_reservations where dispatch_id = $1 and kind = 'dispatch' and qty < 0`, [dispatchId, user || null]);
}

/* THE UPPER STORE'S OWN WRITES, checked against reservations. Called inside
   the store's locked transaction with the rows it is about to insert. An issue
   may not take uppers another order has reserved; an issue to the order that
   holds them clears its reservation by as much. */
export async function upperWithdrawalGuard(client, rows, existing, user){
  const outs = (rows || []).filter(m => m.kind === "out" && (!m.status || m.status === "approved"));
  if(!outs.length) return { record:async () => 0 };
  await ensureStockPlan(client);
  const stock = await loadStock(client, { lock:true, upperMoves:existing });
  if(!stock.reservations.length) return { record:async () => 0 };
  const problems = checkWithdrawals(outs.map(m => ({ store:"UPPER", article:m.article, colour:m.colour,
    size:m.size, qty:m.qty, order_no:m.order_no })), stock.balance);
  if(problems.length) return { error:problems.slice(0, 5).join("; ") };
  return { record:() => insertReservations(client, issueRowsFor(outs, stock.reservations), user) };
}

/* The finished-goods ledger's own writes: pairs issued out may not take what
   another order has reserved, and the shelf can never go below zero. Pairs
   issued to the order that holds them clear its reservation by as much. */
export async function finishedWithdrawalGuard(client, moves, user){
  const outs = (moves || []).filter(m => Number(m.qty) < 0 && (m.kind === "issued" || m.kind === "adjust"));
  if(!outs.length) return { record:async () => 0 };
  await ensureStockPlan(client);
  const stock = await loadStock(client, { lock:true });
  const problems = checkWithdrawals(outs.map(m => ({ store:"FG", article:m.article, colour:"", size:m.size,
    qty:-Number(m.qty), order_no:m.order_no })), stock.balance);
  if(problems.length) return { error:problems.slice(0, 5).join("; ")
    + " — enter the opening count first if the shelf has more than the book." };
  return { record:() => insertReservations(client, issueRowsFor(outs.filter(m => m.kind === "issued"), stock.reservations, "FG"), user) };
}

/* What one order's stock check says, with everything the screen needs. */
function checkFor(order, stock, articles, dispatched = {}){
  const colour = orderColour(order, articles[order.article_code]);
  const current = grantedFor(stock.reservations, order.order_no);
  const check = stockCheck(order, stock.balance, { colour, current });
  /* A range that has shipped in full needs no reminder about stock. */
  const shipped = {};
  for(const line of order.lines || []){
    const ordered = (order.lines || []).filter(l => l.combo === line.combo).reduce((a, l) => a + Number(l.qty || 0), 0);
    if((dispatched[line.combo] || 0) >= ordered)
      for(const [size, n] of Object.entries(line.sizes || {})) shipped[size] = (shipped[size] || 0) + Number(n || 0);
  }
  return { ...check, stock_status:order.stock_status || null, stock_allocation:order.stock_allocation || null,
    outstanding:outstandingFor(stock.reservations, order.order_no),
    prefill:dispatchPrefill(order, stock.reservations, stock.balance, shipped) };
}

export async function stockPlan(req, res){
  const who = (req.user || {}).username || null;
  await ensureStockPlan();

  if(req.method === "GET"){
    const stock = await loadStock(null);
    const articles = await referenceArticles(q);
    const orderNo = String((req.query || {}).order_no || "").trim();
    if(orderNo){
      const rows = await rowsOf(q, `select ${orderCols} from orders where order_no = $1 and active`, [orderNo]);
      if(!rows.length) return fail(res, 404, `no such order: ${orderNo}`);
      const sent = {};
      for(const d of await rowsOf(q, "select dispatched from dispatches where order_no = $1", [orderNo]))
        for(const [combo, n] of Object.entries(d.dispatched || {})) sent[combo] = (sent[combo] || 0) + Number(n || 0);
      return res.status(200).json(checkFor(rows[0], stock, articles, sent));
    }
    const waiting = await rowsOf(q,
      `select ${orderCols} from orders where active and to_jsonb(orders) ->> 'stock_status' = 'awaiting' order by order_no`);
    return res.status(200).json({
      register:{ FG:stockRegister(stock.balance, "FG"), UPPER:stockRegister(stock.balance, "UPPER") },
      fg_sizes_unknown:stock.balance.fg_sizes_unknown,
      locks:stock.locks,
      /* Orders that hold finished goods still to go out: the Dispatch Book's reminder list. */
      reserved_fg:Object.values(stock.reservations.filter(r => r.store === "FG").reduce((acc, r) => {
        const row = acc[r.order_no] || (acc[r.order_no] = { order_no:r.order_no, pairs:0 });
        row.pairs += r.qty; return acc; }, {})).filter(r => r.pairs > 0),
      awaiting:waiting.map(o => {
        const c = checkFor(o, stock, articles);
        return { order_no:o.order_no, party:o.party, article_code:o.article_code, ordered:c.totals.ordered,
          ready_pairs:c.ready_pairs, sizes_with_stock:c.sizes_with_stock, sizes:c.rows.length };
      }),
    });
  }

  if(req.method === "POST"){
    const b = req.body || {};

    if(b.action === "lock"){
      const { lock, problems } = validateLock(b.lock || b);
      if(problems.length) return fail(res, 400, problems.join("; "));
      if(lock.qty === 0){
        await q(`delete from stock_party_locks where store = $1 and article = $2 and colour = $3
                    and lower(size) = lower($4) and lower(party) = lower($5)`,
          [lock.store, lock.article, lock.colour, lock.size, lock.party]);
        return res.status(200).json({ ...lock, removed:true });
      }
      const stock = await loadStock(null);
      const row = stock.balance.get(lock.store, lock.article, lock.colour, lock.size);
      if(!row || row.on_hand <= 0)
        return fail(res, 409, `There is no ${lock.article} size ${lock.size} in that store to keep for ${lock.party}.`);
      await q(
        `insert into stock_party_locks (store, article, colour, size, party, qty, created_by)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (store, article, colour, size, party)
         do update set qty = excluded.qty, created_by = excluded.created_by, created_at = now()`,
        [lock.store, lock.article, lock.colour, lock.size, lock.party, lock.qty, who]);
      return res.status(200).json(lock);
    }

    if(b.action === "decide"){
      const orderNo = String(b.order_no || "").trim();
      if(!orderNo) return fail(res, 400, "order_no is required");
      const client = await db().connect();
      try{
        await client.query("begin");
        const { rows } = await client.query(
          `select ${orderCols} from orders where order_no = $1 and active for update`, [orderNo]);
        if(!rows.length){ await client.query("rollback"); return fail(res, 404, `no such order: ${orderNo}`); }
        const order = rows[0];
        /* Fresh figures, inside the lock: somebody may have taken the stock
           since the panel was opened. */
        const stock = await loadStock(client, { lock:true });
        const articles = await referenceArticles(runner(client));
        const colour = orderColour(order, articles[order.article_code]);
        const mine = stock.jobs.filter(j => String(j.order_no || "") === orderNo);
        const plan = planReservations(order, b.ignore ? { ignore:true } : { sizes:b.sizes || (b.allocation || {}).sizes },
          stock.balance, stock.reservations, { colour, onCards:cardedBySize(mine, false) });
        if(!plan.ok){
          await client.query("rollback");
          return res.status(409).json({ error:(plan.stale ? "The stock changed while this was open — please review. " : "")
            + plan.problems.slice(0, 5).join("; "), stale:plan.stale, check:checkFor(order, stock, articles) });
        }
        await insertReservations(client, plan.rows, who);
        const allocation = { ...withOrdered(plan.allocation, order), decided_by:who, decided_at:new Date().toISOString() };
        await client.query(
          "update orders set stock_status = 'decided', stock_allocation = $2, version = version + 1, updated_at = now() where order_no = $1",
          [orderNo, JSON.stringify(allocation)]);
        await client.query("commit");
        const reserved = plan.rows.filter(r => r.kind === "reserve");
        return res.status(200).json({ order_no:orderNo, stock_status:"decided", stock_allocation:allocation,
          reserved_fg:reserved.filter(r => r.store === "FG").reduce((a, r) => a + r.qty, 0),
          reserved_upper:reserved.filter(r => r.store === "UPPER").reduce((a, r) => a + r.qty, 0),
          released:plan.rows.filter(r => r.kind === "release").reduce((a, r) => a - r.qty, 0) });
      }catch(e){ try{ await client.query("rollback"); }catch(_){ } throw e; }
      finally{ client.release(); }
    }
    return fail(res, 400, `unknown action: ${b.action || "(none)"} — use decide or lock`);
  }
  return fail(res, 405, `${req.method} not allowed`);
}
