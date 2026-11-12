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

  /* THE DATABASE FILLED UP. Listing PIs rewrote every PI's snapshot, every
     order save (even a schedule Adjust) rewrote every PI again, and each PI
     carried the uploaded photo once per order. Neon's size limit was reached
     and every save then failed with "could not extend file". */
  it("never writes the PI master by looking, or by a schedule Adjust", async () => {
    const photo = "data:image/jpeg;base64," + "B".repeat(50000);
    const made = await call("orders", "POST", "/api/orders", { orders:[{ order_date:"2026-11-01",
      article_code:"REX GOLA (V)", priority:1, party:"PI Party",
      lines:[{ combo:"8X10", qty:72 }], pi:{ pi_no:"PI/T1", attachment:photo } }] });
    expect(made.statusCode).toBe(201);
    const no = made.body[0].order_no;
    const version = async () => (await client.query("select xmin::text x, length(snapshot::text) len from proforma_invoices where pi_no='PI/T1'")).rows[0];
    const first = await version();
    expect(first.len).toBeLessThan(photo.length);          // the photo is not copied in

    expect((await call("pis", "GET", "/api/pis")).statusCode).toBe(200);
    expect((await version()).x).toBe(first.x);            // looking writes nothing

    const adjust = await call("order", "PATCH", `/api/orders/${no}?order_no=${no}`, { plan_override:{ start_on:"2026-11-10" } });
    expect(adjust.statusCode).toBe(200);
    expect((await version()).x).toBe(first.x);            // an Adjust is not a PI change

    const { rows:[{ n }] } = await client.query("select count(*)::int n from proforma_invoice_revisions where pi_no='PI/T1'");
    const edit = await call("order", "PATCH", `/api/orders/${no}?order_no=${no}`, { pi:{ remarks:"rush" } });
    expect(edit.statusCode).toBe(200);
    expect((await version()).x).not.toBe(first.x);        // a real edit still reaches the PI
    const { rows:revs } = await client.query("select length(snapshot::text) len from proforma_invoice_revisions where pi_no='PI/T1'");
    expect(revs.length).toBe(n + 1);
    expect(revs.every(r => r.len < photo.length)).toBe(true);
  });

  /* MATERIAL ISSUES. The register kept one running Issued total that the
     BROWSER sent, so it could not say which job took a material and two cards
     raised at once overwrote each other. These run the real SQL: an
     INSERT ... SELECT from jsonb_to_recordset is exactly the kind of statement
     a mocked query cannot vouch for. */
  describe("material issues against a job card", () => {
    const URL = "/api/reference?resource=material_issues";
    const meta = async key => (await call("reference", "GET", "/api/reference")).body.stock_meta?.[key] || {};
    const history = async () => (await client.query("select count(*)::int n from reference_data_history")).rows[0].n;
    let jobId, released, onDemandKey, firstKey, spikeOrder;

    it("raising a job card releases its by-job-order materials, on the server, one row each", async () => {
      const made = await call("orders", "POST", "/api/orders", { orders:[{ order_date:"2026-11-01",
        article_code:"SPIKE", priority:1, party:"Issue Party", lines:[{ combo:"2X5", qty:240 }] }] });
      expect(made.statusCode).toBe(201);
      spikeOrder = made.body[0].order_no;
      const ref = (await call("reference", "GET", "/api/reference")).body;
      const rates = ref.articles.SPIKE.combos["2X5"].rates;
      /* A BOM line at rate 0 has nothing to issue, so it is not a release. */
      const sum = {};
      for(const stage of Object.values(rates)) for(const [k, v] of Object.entries(stage)) sum[k] = (sum[k] || 0) + Number(v);
      const keys = Object.keys(sum).filter(k => sum[k] > 0);
      [firstKey, onDemandKey] = keys;
      /* One material is the store's to hand over when asked. */
      const set = await call("reference", "PATCH", "/api/reference", { stock_meta:{ [onDemandKey]:{ issue_mode:"on_demand" } } });
      expect(set.statusCode).toBe(200);
      const before = await history();

      const r = await call("dispatches", "POST", "/api/dispatches?resource=job_work", {
        resource:"job_work", fabricator:"Rex Internal", article:"SPIKE", qty:100, stage:"STITCHING",
        order_no:spikeOrder, issued_on:"2026-11-03", card:{ lines:[{ combo:"2X5", qty:100 }] } });
      expect(r.statusCode).toBe(201);
      jobId = Number(r.body.id);
      expect(r.body.material_release).toMatchObject({ ok:true, released:keys.length - 1, on_demand:1 });

      const list = await call("reference", "GET", `${URL}&job_id=${jobId}`);
      expect(list.statusCode).toBe(200);
      released = list.body;
      expect(released).toHaveLength(keys.length - 1);
      expect(released.every(m => m.basis === "job_order" && m.type === "issue" && m.moved_on === "2026-11-03")).toBe(true);
      expect(released.some(m => m.material_key === onDemandKey)).toBe(false);
      expect(released[0]).toMatchObject({ fabricator:"Rex Internal", article:"SPIKE", order_no:spikeOrder });

      /* Hand-checked against the BOM: rate x 100 pairs, on the register. */
      const total = Object.values(rates).reduce((n, stage) => n + (Number(stage[firstKey]) || 0), 0);
      const row = released.find(m => m.material_key === firstKey);
      expect(row.qty).toBeCloseTo(total * 100, 4);
      expect((await meta(firstKey)).issue).toBeCloseTo(total * 100, 4);
      expect((await meta(onDemandKey)).issue).toBeUndefined();
      /* The store's most frequent write must not copy the reference document. */
      expect(await history()).toBe(before);
    });

    it("the keeper issues an on-demand material, and more than the BOM is warned, not refused", async () => {
      const r = await call("reference", "POST", URL, { resource:"material_issues", job_id:jobId, type:"issue",
        moved_on:"2026-11-04", note:"asked for by the line", lines:[{ material_key:onDemandKey, qty:999999, name:"invented", uom:"XX" }] });
      expect(r.statusCode).toBe(201);
      expect(r.body.movements).toHaveLength(1);
      const ref = (await call("reference", "GET", "/api/reference")).body;
      expect(r.body.movements[0]).toMatchObject({ basis:"on_demand", type:"issue", qty:999999, moved_on:"2026-11-04",
        name:ref.materials[onDemandKey].name, uom:ref.materials[onDemandKey].uom, moved_by:"tester" });
      expect(r.body.warnings.join(" ")).toMatch(/against a BOM requirement of/);
      expect(r.body.warnings.join(" ")).toMatch(/the register shows/);
      expect((await meta(onDemandKey)).issue).toBe(999999);
    });

    it("a return is bounded by what the card holds, and takes the figure off Issued", async () => {
      const over = await call("reference", "POST", URL, { resource:"material_issues", job_id:jobId, type:"return",
        moved_on:"2026-11-05", lines:[{ material_key:onDemandKey, qty:1000000 }] });
      expect(over.statusCode).toBe(400);
      expect(over.body.error).toMatch(/only 999999 .* is out against job card/);
      const back = await call("reference", "POST", URL, { resource:"material_issues", job_id:jobId, type:"return",
        moved_on:"2026-11-05", lines:[{ material_key:onDemandKey, qty:999990 }] });
      expect(back.statusCode).toBe(201);
      expect((await meta(onDemandKey)).issue).toBe(9);
    });

    it("refuses a bad date and an unknown job card by name, not as a 500", async () => {
      const bad = await call("reference", "POST", URL, { resource:"material_issues", job_id:jobId,
        moved_on:"2026-13-40", lines:[{ material_key:onDemandKey, qty:1 }] });
      expect(bad.statusCode).toBe(400);
      expect(bad.body.error).toMatch(/real date/);
      const none = await call("reference", "POST", URL, { resource:"material_issues", job_id:987654,
        moved_on:"2026-11-05", lines:[{ material_key:onDemandKey, qty:1 }] });
      expect(none.statusCode).toBe(404);
    });

    it("an issue with a return against it cannot be undone until the return is", async () => {
      const rows = (await call("reference", "GET", `${URL}&job_id=${jobId}`)).body.filter(m => m.basis === "on_demand");
      const issued = rows.find(m => m.type === "issue"), returned = rows.find(m => m.type === "return");
      const blocked = await call("reference", "DELETE", `${URL}&id=${issued.id}`);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.body.error).toMatch(/Undo the return first/);
      expect((await call("reference", "DELETE", `${URL}&id=${returned.id}`)).statusCode).toBe(200);
      expect((await meta(onDemandKey)).issue).toBe(999999);
      const twice = await call("reference", "DELETE", `${URL}&id=${returned.id}`);
      expect(twice.statusCode).toBe(404);
      expect(twice.body.error).toMatch(/already have been undone/);
    });

    it("a job card with hand entries cannot be deleted; without them its release goes back with it", async () => {
      const del = () => call("dispatches", "DELETE", `/api/dispatches?resource=job_work&id=${jobId}&mode=delete`);
      const refused = await del();
      expect(refused.statusCode).toBe(409);
      expect(refused.body.error).toMatch(/1 material issue was recorded by hand/);
      const byHand = (await call("reference", "GET", `${URL}&job_id=${jobId}`)).body.find(m => m.basis === "on_demand");
      expect((await call("reference", "DELETE", `${URL}&id=${byHand.id}`)).statusCode).toBe(200);
      expect((await meta(onDemandKey)).issue).toBe(0);

      const gone = await del();
      expect(gone.statusCode).toBe(200);
      expect(gone.body.note).toMatch(new RegExp(`${released.length} materials went back on the stock register`));
      expect((await meta(firstKey)).issue).toBe(0);
      expect((await call("reference", "GET", `${URL}&job_id=${jobId}`)).body).toEqual([]);
    });

    it("two cards raised at the same moment both land on the register", async () => {
      const raise = () => call("dispatches", "POST", "/api/dispatches?resource=job_work", {
        resource:"job_work", fabricator:"Rex Internal", article:"SPIKE", qty:50, stage:"STITCHING",
        order_no:spikeOrder, issued_on:"2026-11-06", card:{ lines:[{ combo:"2X5", qty:50 }] } });
      const [a, z] = await Promise.all([raise(), raise()]);
      expect([a.statusCode, z.statusCode]).toEqual([201, 201]);
      expect([a.body.material_release.ok, z.body.material_release.ok]).toEqual([true, true]);
      const ref = (await call("reference", "GET", "/api/reference")).body;
      const total = Object.values(ref.articles.SPIKE.combos["2X5"].rates)
        .reduce((n, stage) => n + (Number(stage[firstKey]) || 0), 0);
      expect(ref.stock_meta[firstKey].issue).toBeCloseTo(total * 100, 4);
    });
  });

  /* The Raw Material Store: items loaded from the stock sheet in one go, and
     the day register booking onto the locked register — the jsonb insert,
     the date cast and the month query, on a real server. */
  describe("the raw material store", () => {
    const URL = "/api/reference?resource=store_register";
    const KEY = "1231 BLACK 5C||PAIR";
    const meta = async key => (await call("reference", "GET", "/api/reference")).body.stock_meta[key];
    it("adds the sheet's items, then receives and issues by date, and the month answers both", async () => {
      const add = await call("reference", "PATCH", "/api/reference", { new_materials:[
        { name:"1231 BLACK", size:"5C", uom:"PAIR", category:"SOLE", opening:40, min:100, rate:48.5, sku:"SO-1231-5C" }] });
      expect(add.statusCode).toBe(201);
      const rec = await call("reference", "POST", URL, { resource:"store_register", type:"rec", moved_on:"2026-10-01",
        note:"bill 44", lines:[{ material_key:KEY, qty:100 }] });
      expect(rec.statusCode).toBe(201);
      const iss = await call("reference", "POST", URL, { resource:"store_register", type:"issue", moved_on:"2026-11-02",
        lines:[{ material_key:KEY, qty:80 }] });
      expect(iss.statusCode).toBe(201);
      expect(iss.body.entries[0]).toMatchObject({ material_key:KEY, type:"issue", qty:80, moved_on:"2026-11-02" });
      expect(iss.body.reorder[0]).toMatchObject({ balance:60, min:100, order_qty:40 });
      expect(await meta(KEY)).toMatchObject({ opening:40, rec:100, issue:80 });

      const oct = await call("reference", "GET", `${URL}&month=2026-10`);
      expect(oct.statusCode).toBe(200);
      expect(oct.body.movements.filter(m => m.material_key === KEY).map(m => [m.type, m.qty, m.moved_on]))
        .toEqual([["rec", 100, "2026-10-01"], ["issue", 80, "2026-11-02"]]);
      const nov = await call("reference", "GET", `${URL}&month=2026-11`);
      expect(nov.body.entries.map(e => e.moved_on)).toEqual(["2026-11-02"]);

      expect((await call("reference", "DELETE", `${URL}&id=${iss.body.entries[0].id}`)).statusCode).toBe(200);
      expect((await meta(KEY)).issue).toBe(0);
      const twice = await call("reference", "DELETE", `${URL}&id=${iss.body.entries[0].id}`);
      expect(twice.statusCode).toBe(404);
    });
    it("refuses a second item with the same item code", async () => {
      const dup = await call("reference", "PATCH", "/api/reference", { new_material:{ name:"1231 BLACK", size:"6C", uom:"PAIR", sku:"so-1231-5c" } });
      expect(dup.statusCode).toBe(409);
      expect(dup.body.error).toMatch(/already used by 1231 BLACK 5C/);
    });
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
      ["reference", "/api/reference?resource=material_issues"],
      ["reference", "/api/reference?resource=store_register&month=2026-11"],
    ]){
      const r = await call(name, "GET", url);
      expect([url, r.statusCode]).toEqual([url, 200]);
    }
  });
});
