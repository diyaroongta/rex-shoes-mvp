// @vitest-environment node
/* STOCK FIRST, AGAINST A REAL POSTGRES. The mocked suite proves what the
   handlers decide; only a real server proves the statements run — the locks,
   the INSERT ... SELECT that releases an order's stock, the to_jsonb reads of
   columns an older database may not have. This walks the worked example end to
   end: opening stock, a new order that stops at the stock check, the decision,
   the job cards it allows, an upper issue, a dispatch from the shelf, its undo,
   and a cancellation.

   Runs only when TEST_DATABASE_URL points at a LOCAL, throwaway database, the
   same rule as tests/api/postgres.test.js (which says how to start one):

     TEST_DATABASE_URL=postgres://fos@localhost:55432/fos_test npm run test:pg
*/
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

const URL_ = process.env.TEST_DATABASE_URL || "";
const local = /^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_);
const run = local ? describe : describe.skip;

let pg, client, handlers = {}, AUTH;
const response = () => ({ statusCode:200, body:null,
  status(c){ this.statusCode=c; return this; }, json(b){ this.body=b; return this; }, setHeader(){} });
async function call(name, method, url, body){
  const u = new URL("http://x" + url);
  const res = response();
  /* Vercel puts the [order_no] path segment into the query. */
  const query = { ...Object.fromEntries(u.searchParams),
    ...(name === "order" ? { order_no:decodeURIComponent(u.pathname.split("/").pop()) } : {}) };
  await handlers[name]({ method, url, query, body, headers:AUTH }, res);
  return res;
}
const ART = "REX GOLA (V)";
const PLAN = "/api/dispatches?resource=stock_plan";
const sku = async (store, size) => {
  const r = await call("dispatches", "GET", PLAN);
  return r.body.register[store].find(x => x.article === ART && String(x.size) === String(size)) || { on_hand:0, reserved:0, free:0, orders:[] };
};

run("stock first, against a real Postgres", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.PGSSL = "disable";
    process.env.AUTH_SECRET = "test-only-secret-of-at-least-32-characters";
    pg = (await import("pg")).default;
    client = new pg.Client(URL_);
    await client.connect();
    await client.query("drop schema public cascade; create schema public;");
    await client.query(fs.readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"));
    const { COOKIE, signSession } = await import("../../api/_lib/auth.js");
    AUTH = { cookie:`${COOKIE}=${signSession({ username:"tester", role:"admin" })}` };
    for(const [name, path] of Object.entries({
      dispatches:"../../api/dispatches.js", orders:"../../api/orders/index.js", order:"../../api/orders/[order_no].js" }))
      handlers[name] = (await import(path)).default;
  }, 60000);
  afterAll(async () => {
    if(client) await client.end();
    const { db } = await import("../../api/_lib/db.js");
    await db().end();
  });

  const newOrder = (sizes, extra = {}) => call("orders", "POST", "/api/orders", { orders:[{ order_date:"2026-11-01",
    article_code:ART, priority:2, party:"Belgaum Traders", pi:{ upper_colour:"Black" },
    lines:[{ combo:"8X10B", qty:Object.values(sizes).reduce((a, n) => a + n, 0), sizes }], ...extra }] });
  const card = (orderNo, sizes, extra = {}) => {
    const qty = Object.values(sizes).reduce((a, n) => a + n, 0);
    return call("dispatches", "POST", "/api/dispatches?resource=job_work", { resource:"job_work", fabricator:"Rex Internal",
      article:ART, qty, stage:"STITCHING", order_no:orderNo, issued_on:"2026-11-02",
      card:{ lines:[{ combo:"8X10B", qty, sizes }], ...extra } });
  };

  let quiet, orderNo, second;
  it("an order nothing on the shelf matches goes straight through — no needless click", async () => {
    const r = await newOrder({ "8":10 });
    expect(r.statusCode).toBe(201);
    expect(r.body[0].stock_status).toBe("decided");
    expect(r.body[0].stock_allocation).toMatchObject({ mode:"none" });
    quiet = r.body[0].order_no;
  });

  it("opening stock is entered: 60 pairs of size 8 in finished goods, 40 size-9 uppers", async () => {
    const fg = await call("dispatches", "POST", "/api/dispatches?resource=finished_stock",
      { resource:"finished_stock", moves:[{ article:ART, size:"8", kind:"opening", qty:60, moved_on:"2026-11-01" }] });
    expect(fg.statusCode).toBe(201);
    const up = await call("dispatches", "POST", "/api/dispatches?resource=upper_store",
      { resource:"upper_store", moves:[{ kind:"in", article:ART, colour:"Black", size:"9", qty:40, moved_on:"2026-11-01",
        source_type:"line", source:"Rex Internal", mts:true }] });
    expect(up.statusCode).toBe(201);
    expect(await sku("FG", "8")).toMatchObject({ on_hand:60, reserved:0, free:60 });
    expect(await sku("UPPER", "9")).toMatchObject({ on_hand:40, reserved:0, free:40 });
  });

  it("finished goods cannot be issued below zero", async () => {
    const r = await call("dispatches", "POST", "/api/dispatches?resource=finished_stock",
      { resource:"finished_stock", moves:[{ article:ART, size:"8", kind:"issued", qty:61, order_no:quiet, moved_on:"2026-11-01" }] });
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toMatch(/60 pair\(s\) can be taken/);
  });

  it("a matching order stops at the stock check, and is listed with its ready pairs", async () => {
    const r = await newOrder({ "8":100, "9":100, "10":100 });
    expect(r.statusCode).toBe(201);
    expect(r.body[0].stock_status).toBe("awaiting");
    orderNo = r.body[0].order_no;
    const list = (await call("orders", "GET", "/api/orders")).body.find(o => o.order_no === orderNo);
    expect(list.stock_status).toBe("awaiting");
    const plan = await call("dispatches", "GET", PLAN);
    expect(plan.body.awaiting).toEqual([expect.objectContaining({ order_no:orderNo, ready_pairs:100, sizes_with_stock:2, sizes:3 })]);
  });

  it("looking at the stock check writes nothing", async () => {
    const before = (await client.query("select xmin::text x from orders where order_no = $1", [orderNo])).rows[0].x;
    const n = (await client.query("select count(*)::int n from stock_reservations")).rows[0].n;
    const check = await call("dispatches", "GET", `${PLAN}&order_no=${orderNo}`);
    expect(check.statusCode).toBe(200);
    expect(check.body.totals).toEqual({ ordered:300, fg:60, upper:40, produce:200 });
    await call("dispatches", "GET", PLAN);
    expect((await client.query("select xmin::text x from orders where order_no = $1", [orderNo])).rows[0].x).toBe(before);
    expect((await client.query("select count(*)::int n from stock_reservations")).rows[0].n).toBe(n);
  });

  it("no job card until the decision is made", async () => {
    const r = await card(orderNo, { "8":100, "9":100, "10":100 });
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toMatch(/waiting for its stock decision/);
  });

  it("using the stock reserves 60 FG and 40 uppers for the order", async () => {
    const check = (await call("dispatches", "GET", `${PLAN}&order_no=${orderNo}`)).body;
    const r = await call("dispatches", "POST", PLAN, { resource:"stock_plan", action:"decide", order_no:orderNo, sizes:check.suggestion });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ stock_status:"decided", reserved_fg:60, reserved_upper:40 });
    expect(await sku("FG", "8")).toMatchObject({ on_hand:60, reserved:60, free:0, orders:[{ order_no:orderNo, pairs:60 }] });
    expect(await sku("UPPER", "9")).toMatchObject({ on_hand:40, reserved:40, free:0 });
    const row = (await call("orders", "GET", "/api/orders")).body.find(o => o.order_no === orderNo);
    expect(row.stock_allocation).toMatchObject({ mode:"use", sizes:{ "8":{ fg:60 }, "9":{ upper:{ "9":40 } } } });
  });

  it("the same stock is never promised twice", async () => {
    const r = await newOrder({ "8":50 }, { party:"Second Party" });
    second = r.body[0].order_no;
    /* Nothing is FREE any more, so the second order has nothing to decide... */
    expect(r.body[0].stock_status).toBe("decided");
    /* ...and asking for the reserved pairs anyway is refused with fresh figures. */
    const grab = await call("dispatches", "POST", PLAN, { resource:"stock_plan", action:"decide", order_no:second, sizes:{ "8":{ fg:50 } } });
    expect(grab.statusCode).toBe(409);
    expect(grab.body.stale).toBe(true);
    expect((await sku("FG", "8")).reserved).toBe(60);
  });

  it("job cards are raised for the balance only: 200 in full, 40 from moulding", async () => {
    const tooMuch = await card(orderNo, { "8":100, "9":100, "10":100 });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.body.error).toMatch(/size 8: only 40 pair\(s\) are left to make through the full routing/);
    const mouldTooMuch = await card(orderNo, { "9":41 }, { start_stage:"MOLDING" });
    expect(mouldTooMuch.statusCode).toBe(409);
    const full = await card(orderNo, { "8":40, "9":60, "10":100 });
    expect(full.statusCode).toBe(201);
    const mould = await card(orderNo, { "9":40 }, { start_stage:"MOLDING" });
    expect(mould.statusCode).toBe(201);
    expect(mould.body.card.start_stage).toBe("MOLDING");
    const more = await card(orderNo, { "10":1 });
    expect(more.statusCode).toBe(409);
  });

  it("reserved uppers go to their own order's moulding and to nobody else's", async () => {
    const out = (order_no, qty) => call("dispatches", "POST", "/api/dispatches?resource=upper_store",
      { resource:"upper_store", moves:[{ kind:"out", article:ART, colour:"Black", size:"9", qty, order_no,
        destination:"MOULDING", moved_on:"2026-11-03" }] });
    const other = await out(second, 5);
    expect(other.statusCode).toBe(400);
    expect(other.body.error).toMatch(new RegExp(`reserved for ${orderNo}`));
    const mine = await out(orderNo, 25);
    expect(mine.statusCode).toBe(201);
    expect(await sku("UPPER", "9")).toMatchObject({ on_hand:15, reserved:15, free:0 });
    const { rows } = await client.query("select kind, qty from stock_reservations where order_no = $1 and store = 'UPPER' order by id", [orderNo]);
    expect(rows).toEqual([{ kind:"reserve", qty:40 }, { kind:"issue", qty:-25 }]);
  });

  it("a block locked on a job card is still locked after the orders are read again", async () => {
    const before = (await call("orders", "GET", "/api/orders")).body.find(o => o.order_no === orderNo);
    const unit = `${orderNo}#JC1`;
    const r = await call("order", "PATCH", `/api/orders/${orderNo}`, { plan_override:{ units:{ [unit]:{ at:{ STITCHING:"2026-11-17" } } } } });
    expect(r.body.error).toBeUndefined();
    const after = (await call("orders", "GET", "/api/orders")).body.find(o => o.order_no === orderNo);
    expect(after.plan_override.units[unit].at).toEqual({ STITCHING:"2026-11-17" });
    /* A schedule change is not a commercial one: the stock decision is untouched. */
    expect(after.stock_allocation).toEqual(before.stock_allocation);
    await call("order", "PATCH", `/api/orders/${orderNo}`, { plan_override:{} });
  });

  let dispatchId;
  it("the dispatch slip is reminded of the reserved finished goods, and ships them from stock", async () => {
    const check = (await call("dispatches", "GET", `${PLAN}&order_no=${orderNo}`)).body;
    expect(check.prefill).toMatchObject({ reserved:[{ size:"8", pairs:60 }], reserved_pairs:60 });
    const tooMany = await call("dispatches", "POST", "/api/dispatches", { order_no:orderNo, dispatched:{ "8X10B":40 }, from_stock:{ "8":60 } });
    expect(tooMany.statusCode).toBe(400);
    const r = await call("dispatches", "POST", "/api/dispatches", { order_no:orderNo, dispatched:{ "8X10B":60 }, from_stock:{ "8":60 }, dispatched_on:"2026-11-04" });
    expect(r.statusCode).toBe(201);
    expect(r.body.shipped_from_stock).toBe(60);
    dispatchId = r.body.id;
    expect(await sku("FG", "8")).toMatchObject({ on_hand:0, reserved:0 });
    const listed = (await call("dispatches", "GET", "/api/dispatches")).body.find(d => d.id === dispatchId);
    expect(listed.from_stock).toEqual({ sizes:{ "8":60 }, combos:{ "8X10B":60 } });
    const after = (await call("dispatches", "GET", `${PLAN}&order_no=${orderNo}`)).body;
    expect(after.prefill.reserved_pairs).toBe(0);
  });

  it("undoing that dispatch puts the pairs back on the shelf, reserved for the order again", async () => {
    const r = await call("dispatches", "DELETE", `/api/dispatches?id=${dispatchId}`);
    expect(r.statusCode).toBe(200);
    expect(await sku("FG", "8")).toMatchObject({ on_hand:60, reserved:60, free:0 });
  });

  it("reducing a size releases the stock tied to pairs that no longer exist", async () => {
    const before = (await call("orders", "GET", "/api/orders")).body.find(o => o.order_no === orderNo);
    /* Size 8 goes from 100 to 90: 40 are on a card, so 50 is the most FG can cover. */
    const r = await call("order", "PATCH", `/api/orders/${orderNo}`, { expected_version:before.version,
      lines:[{ combo:"8X10B", qty:290, sizes:{ "8":90, "9":100, "10":100 } }] });
    expect(r.body.error).toBeUndefined();
    expect(r.statusCode).toBe(200);
    expect(r.body.stock_allocation.sizes["8"].fg).toBe(60);
    const smaller = await call("order", "PATCH", `/api/orders/${orderNo}`, { expected_version:r.body.version,
      lines:[{ combo:"8X10B", qty:250, sizes:{ "8":50, "9":100, "10":100 } }] });
    expect(smaller.statusCode).toBe(200);
    expect(smaller.body.stock_allocation.sizes["8"].fg).toBe(50);
    expect(await sku("FG", "8")).toMatchObject({ on_hand:60, reserved:50, free:10 });
  });

  it("stock can be kept for one party and is then not free to anyone else", async () => {
    const lock = await call("dispatches", "POST", PLAN, { resource:"stock_plan", action:"lock",
      lock:{ store:"FG", article:ART, size:"8", party:"St. Mary School", qty:10 } });
    expect(lock.statusCode).toBe(200);
    expect(await sku("FG", "8")).toMatchObject({ on_hand:60, reserved:50, locked:10, free:0 });
    const other = await call("dispatches", "POST", PLAN, { resource:"stock_plan", action:"decide", order_no:second, sizes:{ "8":{ fg:10 } } });
    expect(other.statusCode).toBe(409);
    const off = await call("dispatches", "POST", PLAN, { resource:"stock_plan", action:"lock",
      lock:{ store:"FG", article:ART, size:"8", party:"St. Mary School", qty:0 } });
    expect(off.body.removed).toBe(true);
    expect((await sku("FG", "8")).free).toBe(10);
  });

  it("cancelling the order returns everything it held to free stock", async () => {
    const r = await call("order", "DELETE", `/api/orders/${orderNo}?cascade=1&confirm_dispatched=1`);
    expect(r.body.error).toBeUndefined();
    expect(r.statusCode).toBe(200);
    expect(await sku("FG", "8")).toMatchObject({ on_hand:60, reserved:0, free:60 });
    expect(await sku("UPPER", "9")).toMatchObject({ on_hand:15, reserved:0, free:15 });
    /* Append-only: the history is all still there, and it sums to nothing held. */
    const { rows } = await client.query("select coalesce(sum(qty),0)::int held, count(*)::int n from stock_reservations where order_no = $1", [orderNo]);
    expect(rows[0].held).toBe(0);
    expect(rows[0].n).toBeGreaterThan(4);
  });

  it("closing an order short frees what it had reserved", async () => {
    const made = (await newOrder({ "8":30 }, { party:"Short Party" })).body[0];
    expect(made.stock_status).toBe("awaiting");
    const d = await call("dispatches", "POST", PLAN, { resource:"stock_plan", action:"decide", order_no:made.order_no, sizes:{ "8":{ fg:30 } } });
    expect(d.statusCode).toBe(200);
    expect((await sku("FG", "8")).reserved).toBe(30);
    const close = await call("dispatches", "POST", "/api/dispatches", { order_no:made.order_no, dispatched:{}, closes_order:true,
      kind:"shortage", note:"customer withdrew the order" });
    expect(close.statusCode).toBe(201);
    expect(await sku("FG", "8")).toMatchObject({ on_hand:60, reserved:0, free:60 });
  });
});
