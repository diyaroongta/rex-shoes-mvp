import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks=vi.hoisted(()=>({q:vi.fn(),connect:vi.fn()}));
vi.mock("../../api/_lib/db.js",()=>({ q:dbMocks.q, db:()=>({connect:dbMocks.connect}) }));

import referenceHandler from "../../api/reference.js";
import { COOKIE, signSession } from "../../api/_lib/auth.js";
import { can } from "../../shared/permissions.js";

/* The Raw Material Store: the day register (received / issued, by date) and
   the items it is kept against. The SQL is mocked here — these assert what
   the handlers book and refuse; the statements themselves follow the
   material-issues pattern that tests/api/postgres.test.js runs for real. */
process.env.AUTH_SECRET = "test-only-secret-of-at-least-32-characters";
const as = role => ({ cookie:`${COOKIE}=${signSession({ username:"keeper", role })}` });
const response = () => ({ statusCode:200, body:null, status(c){ this.statusCode=c; return this; }, json(b){ this.body=b; return this; } });
beforeEach(()=>vi.resetAllMocks());

const PU = "PU CHEMICAL 6100DTF||KGS";
const reference = () => ({ articles:{}, materials:{ [PU]:{ name:"PU CHEMICAL 6100DTF", uom:"KGS", stock:52 } },
  stock_meta:{ [PU]:{ opening:52, rec:0, issue:0, min_stock:104, sku:"CH-001" } } });

function lockedClient({ ref = reference(), row = null } = {}){
  const client = { query: vi.fn(async (sql, params = []) => {
    const t = String(sql);
    if(t.includes("from reference_data where id = 1 for update")) return { rows:[{ value:ref }] };
    if(t.includes("insert into store_movements")) return { rows:JSON.parse(params[4]).map((l, i) => ({ id:500 + i, ...l,
      type:params[0], moved_on:params[1], note:params[2], moved_by:params[3] })) };
    if(t.includes("from store_movements where id")) return { rows:row ? [row] : [] };
    return { rows:[] };
  }), release: vi.fn() };
  dbMocks.connect.mockResolvedValue(client);
  return client;
}
const stored = client => JSON.parse(client.query.mock.calls.find(([s]) => String(s).includes("insert into reference_data (id"))[1][0]);
const said = (client, text) => client.query.mock.calls.some(([s]) => String(s).includes(text));
const URL = "/api/reference?resource=store_register";

describe("the day register",()=>{
  it("books an issue onto the locked register, says MAKE ORDER, and takes no history snapshot",async()=>{
    const client = lockedClient();
    const res = response();
    await referenceHandler({ headers:as("store"), method:"POST", url:URL, query:{ resource:"store_register" },
      body:{ resource:"store_register", type:"issue", moved_on:"2026-11-02", note:"to pasting", lines:[{ material_key:PU, qty:50 }] } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.entries[0]).toMatchObject({ material_key:PU, name:"PU CHEMICAL 6100DTF", qty:50, type:"issue", moved_on:"2026-11-02", moved_by:"keeper" });
    expect(stored(client).stock_meta[PU].issue).toBe(50);
    expect(stored(client).materials[PU].stock).toBe(2);
    expect(res.body.reorder[0]).toMatchObject({ name:"PU CHEMICAL 6100DTF", balance:2, min:104, order_qty:102 });
    expect(said(client, "for update")).toBe(true);
    expect(said(client, "reference_data_history")).toBe(false);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("refuses an unreal date and writes nothing",async()=>{
    const client = lockedClient();
    const res = response();
    await referenceHandler({ headers:as("store"), method:"POST", url:URL, query:{ resource:"store_register" },
      body:{ resource:"store_register", type:"rec", moved_on:"2026-13-40", lines:[{ material_key:PU, qty:5 }] } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/real date/);
    expect(said(client, "insert into store_movements")).toBe(false);
    expect(client.query).toHaveBeenCalledWith("rollback");
  });

  it("undoing a receipt takes it back off the register",async()=>{
    const ref = reference(); ref.stock_meta[PU].rec = 100; ref.materials[PU].stock = 152;
    const client = lockedClient({ ref, row:{ id:7, material_key:PU, name:"PU CHEMICAL 6100DTF", uom:"KGS", type:"rec", qty:"100" } });
    const res = response();
    await referenceHandler({ headers:as("store"), method:"DELETE", url:`${URL}&id=7`, query:{ resource:"store_register", id:"7" }, body:{} }, res);
    expect(res.statusCode).toBe(200);
    expect(stored(client).materials[PU].stock).toBe(52);
    expect(said(client, "delete from store_movements")).toBe(true);
  });

  it("is the store's to write, and not the dispatch clerk's",()=>{
    expect(can("store", "POST", URL, { resource:"store_register" }).allowed).toBe(true);
    expect(can("dispatch", "POST", URL, { resource:"store_register" }).allowed).toBe(false);
  });
});

describe("items",()=>{
  function refClient(ref = reference()){
    dbMocks.q.mockResolvedValue({ rows:[{ value:ref }] });
    const client = { query: vi.fn(async sql => String(sql).includes("for update") ? { rows:[{ value:ref }] } : { rows:[] }), release:vi.fn() };
    dbMocks.connect.mockResolvedValue(client);
    return client;
  }
  const patch = (body, role = "store") => { const res = response();
    return referenceHandler({ headers:as(role), method:"PATCH", url:"/api/reference", query:{}, body }, res).then(() => res); };

  it("adds the stock sheet's items in ONE transaction and one snapshot, size folded into the name",async()=>{
    const client = refClient();
    const res = await patch({ new_materials:[
      { name:"1231 black", size:"5c", uom:"pair", category:"SOLE", rate:48.5 },
      { name:"1231 black", size:"6C", uom:"PAIR", category:"SOLE", rate:48.5, opening:20, min:10, sku:"so-1231-6c", terms:"30 days" } ] });
    expect(res.statusCode).toBe(201);
    expect(res.body.created).toBe(2);
    const ref = stored(client);
    expect(ref.materials["1231 BLACK 6C||PAIR"]).toMatchObject({ name:"1231 BLACK 6C", uom:"PAIR", stock:20 });
    expect(ref.stock_meta["1231 BLACK 6C||PAIR"]).toMatchObject({ category:"SOLE", size:"6C", sku:"SO-1231-6C", terms:"30 days", min_stock:10, rate:48.5 });
    expect(ref.stock_meta["1231 BLACK 5C||PAIR"]).toMatchObject({ size:"5C", opening:0 });
    expect(client.query.mock.calls.filter(([s]) => String(s).includes("reference_data_history")).length).toBe(1);
  });

  it("refuses an item code another item already has",async()=>{
    refClient();
    const res = await patch({ new_material:{ name:"HARDNER 1000 ARF", uom:"KGS", sku:"ch-001" } });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/Item code CH-001 is already used by PU CHEMICAL 6100DTF/);
  });

  it("refuses an item already on the register, naming it",async()=>{
    refClient();
    const res = await patch({ new_materials:[{ name:"PU CHEMICAL 6100DTF", uom:"KGS" }] });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/PU CHEMICAL 6100DTF\|\|KGS is already on the material list/);
  });

  it("sets an item code and terms on an existing item; the store may, the dispatch clerk may not",async()=>{
    const client = refClient();
    const res = await patch({ stock_meta:{ [PU]:{ sku:"ch-009", terms:"advance" } } });
    expect(res.statusCode).toBe(200);
    expect(stored(client).stock_meta[PU]).toMatchObject({ sku:"CH-009", terms:"advance" });
    expect(can("store", "PATCH", "/api/reference", { new_materials:[] }).allowed).toBe(true);
    expect(can("dispatch", "PATCH", "/api/reference", { new_materials:[] }).allowed).toBe(false);
  });
});
