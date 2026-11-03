// @vitest-environment node
/* AGAINST A REAL POSTGRES — the class of fault the mocked tests cannot see.
   Mocked handlers assert the SQL text; only a real server says whether it
   accepts the values. Two such faults reached the factory as a bare "Server
   error": a job order whose issue date Postgres could not read (the save
   failed every time it was retried), and a party-terms refresh that cast an
   order's stored discount to numeric and died on "40%".

   Runs only when TEST_DATABASE_URL points at a LOCAL, throwaway database —
   it applies db/schema.sql and writes rows. It refuses anything else, so it
   cannot be aimed at Neon by accident. To run it:

     initdb -D /tmp/fos-pg -U fos --auth=trust
     pg_ctl -D /tmp/fos-pg -o "-p 55432 -k ''" start
     createdb -h localhost -p 55432 -U fos fos_test
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
  await handlers[name]({ method, url, query:Object.fromEntries(u.searchParams), body, headers:AUTH }, res);
  return res;
}

run("against a real Postgres", () => {
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
      dispatches:"../../api/dispatches.js", orders:"../../api/orders/index.js",
      order:"../../api/orders/[order_no].js", parties:"../../api/parties.js",
      reference:"../../api/reference.js", settings:"../../api/settings.js", pis:"../../api/pis.js",
      catalogue:"../../api/catalogue.js" }))
      handlers[name] = (await import(path)).default;
  }, 60000);
  afterAll(async () => {
    if(client) await client.end();
    const { db } = await import("../../api/_lib/db.js");
    await db().end();
  });

  let orderNo;
  it("creates an Order Book row and a fabricator to issue against", async () => {
    await client.query(`insert into fabricators (name, type, rate, payable, active)
                        values ('Rex Internal','internal_line',0,false,true) on conflict do nothing`);
    const r = await call("orders", "POST", "/api/orders", { orders:[{ order_date:"2026-11-01",
      article_code:"REX GOLA PLUS", priority:1, party:"Test Party",
      lines:[{ combo:"7X10", qty:96, sizes:{ "7s":24, "8s":24, "9s":24, "10s":24 } }, { combo:"2X5", qty:720 }] }] });
    expect(r.statusCode).toBe(201);
    orderNo = r.body[0].order_no;
  });

  const issue = (extra) => call("dispatches", "POST", "/api/dispatches?resource=job_work", {
    resource:"job_work", fabricator:"Rex Internal", article:"REX GOLA PLUS", qty:24, stage:"STITCHING",
    order_no:orderNo, card:{ lines:[{ combo:"2X5", qty:24 }] }, ...extra });

  it("issues a job order", async () => {
    const r = await issue({ issued_on:"2026-11-02" });
    expect(r.statusCode).toBe(201);
    expect(r.body.qty).toBe(24);
  });

  it("refuses an issue date Postgres cannot read, by name, instead of a 500", async () => {
    const r = await issue({ issued_on:"2026-13-40" });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toMatch(/2026-13-40.*not a real date/);
  });

  it("refuses 02/11/2026 rather than saving it as 11 February", async () => {
    const r = await issue({ issued_on:"02/11/2026" });
    expect(r.statusCode).toBe(400);
    const { rows } = await client.query("select count(*)::int n from job_work where issued_on = '2026-02-11'");
    expect(rows[0].n).toBe(0);
  });

  it("refuses a quantity past the integer column instead of a 500", async () => {
    const r = await issue({ qty:3e9, card:undefined, order_no:undefined });
    expect(r.statusCode).toBe(400);
  });

  it("previews a party-terms refresh when an order's discount is not a number", async () => {
    await client.query(`insert into parties (name, discount_pct) values ('Pct Party', 35)`);
    await client.query(`insert into orders (order_no, order_date, article_code, priority, party, lines, pi)
      values ('JO9001','2026-11-01','REX GOLA (V)',1,'Pct Party','[]','{"discount_pct":"40%"}')`);
    const r = await call("parties", "POST", "/api/parties", { name:"Pct Party", preview:true });
    expect(r.statusCode).toBe(200);
    expect(r.body.changing).toBe(1);
  });

  it("refuses impossible dates on finished stock and the upper store", async () => {
    const fin = await call("dispatches", "POST", "/api/dispatches?resource=finished_stock",
      { resource:"finished_stock", moves:[{ article:"REX GOLA PLUS", size:"8s", kind:"opening", qty:10, moved_on:"2026-02-30" }] });
    expect(fin.statusCode).toBe(400);
    expect(fin.body.error).toMatch(/2026-02-30/);
    const up = await call("dispatches", "POST", "/api/dispatches?resource=upper_store",
      { resource:"upper_store", moves:[{ kind:"in", article:"REX GOLA PLUS", size:"8s", qty:10, moved_on:"2026-02-30",
        source_type:"line", source:"Rex Internal", mts:true }] });
    expect(up.statusCode).toBe(400);
    expect(up.body.error).toMatch(/2026-02-30/);
  });

  it("books a job card's stock issue without copying the catalogue photos into history", async () => {
    const img = "data:image/jpeg;base64," + "A".repeat(200000);
    await client.query(`insert into catalogue (article_code, image) values ('REX GOLA PLUS', $1)`, [img]);
    const ref = (await call("reference", "GET", "/api/reference")).body;
    const key = Object.keys(ref.materials)[0];
    const r = await call("reference", "PATCH", "/api/reference", { stock_meta:{ [key]:{ issue:5 } } });
    expect(r.statusCode).toBe(200);
    const { rows } = await client.query(
      "select length(value::text) len, value ? 'catalogue' has_catalogue from reference_data_history order by revision_id desc limit 1");
    expect(rows[0].has_catalogue).toBe(false);
    expect(rows[0].len).toBeLessThan(img.length);
  });

  it("answers every list the app loads at start-up with 200", async () => {
    for(const [name, url] of [
      ["orders", "/api/orders"], ["settings", "/api/settings"], ["parties", "/api/parties"],
      ["parties", "/api/parties?resource=fabricators"], ["pis", "/api/pis"], ["reference", "/api/reference"],
      ["reference", "/api/reference?history=1"], ["catalogue", "/api/catalogue"],
      ["dispatches", "/api/dispatches?include_hidden=1"], ["dispatches", "/api/dispatches?resource=job_work&archived=1"],
      ["dispatches", "/api/dispatches?resource=production_actuals"], ["dispatches", "/api/dispatches?resource=finished_stock"],
      ["dispatches", "/api/dispatches?resource=job_card_docs"], ["dispatches", "/api/dispatches?resource=repairs"],
      ["dispatches", "/api/dispatches?resource=upper_store"], ["reference", "/api/reference?resource=purchase_orders"],
    ]){
      const r = await call(name, "GET", url);
      expect([url, r.statusCode]).toEqual([url, 200]);
    }
  });
});
