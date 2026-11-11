import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const dbMocks=vi.hoisted(()=>({q:vi.fn(),connect:vi.fn()}));
vi.mock("../../api/_lib/db.js",()=>({
  q:dbMocks.q,
  db:()=>({connect:dbMocks.connect}),
}));

import dispatchHandler from "../../api/dispatches.js";
import ordersHandler from "../../api/orders/index.js";
import orderHandler from "../../api/orders/[order_no].js";
import { COOKIE, signSession } from "../../api/_lib/auth.js";

/* STOCK FIRST, at the server. Mocked SQL cannot prove a statement runs — that
   is tests/api/postgres.test.js — but it does prove what the handlers DECIDE:
   who may reserve stock, that a decision is re-checked against fresh figures,
   that the same pairs are never promised twice, and that an order waiting on a
   decision cannot be put on a job card. */
process.env.AUTH_SECRET = "test-only-secret-of-at-least-32-characters";
const as = role => ({ cookie: `${COOKIE}=${signSession({ username:"tester", role })}` });
const response = () => ({statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});

const ART = "REX GOLA (V)";
const ORDER = { order_no:"JO5001", article_code:ART, party:"Belgaum Traders", pi:{ upper_colour:"Black" },
  lines:[{ combo:"8X10B", qty:300, sizes:{ "8":100, "9":100, "10":100 } }], stock_status:"awaiting", stock_allocation:null };

/* One router for q and for a transaction's client: the store ledgers, the
   reservation ledger and the order, answered by what the SQL reads. Every
   statement is recorded so a test can say what was written. */
function database({ order = ORDER, reservations = [], finished = [{ article:ART, size:"8", qty:60, kind:"opening" }],
                    uppers = [{ kind:"in", article:ART, colour:"BLACK", size:"9", qty:40, mts:true, status:"approved" }],
                    jobs = [], locks = [] } = {}){
  const log = [];
  const run = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    log.push({ text, params });
    if(text.startsWith("select article, size, qty, kind, order_no from finished_stock")) return { rows:finished };
    if(text.includes("from job_work") && text.startsWith("select id, article, order_no")) return { rows:jobs };
    if(text.startsWith("select kind, article, colour, size, qty, order_no, mts")) return { rows:uppers };
    if(text.includes("from stock_reservations order by id")) return { rows:reservations };
    if(text.includes("from stock_party_locks")) return { rows:locks };
    if(text.startsWith("select o.order_no from orders o")) return { rows:[{ order_no:order.order_no }] };
    if(text.includes("from reference_data")) return { rows:[] };              // falls back to the seed
    if(text.includes("from orders where order_no = $1")) return { rows:[order] };
    if(text.includes("from orders where order_no=$1")) return { rows:[order] };
    if(text.includes("from fabricators")) return { rows:[{ name:"Rex Internal", type:"internal_line", rate:0, payable:false, active:true }] };
    if(text.startsWith("insert into dispatches")) return { rows:[{ id:77, order_no:order.order_no, dispatched:JSON.parse(params[1]) }] };
    return { rows:[], rowCount:0 };
  };
  const client = { query:vi.fn(run), release:vi.fn() };
  dbMocks.q.mockImplementation(run);
  dbMocks.connect.mockResolvedValue(client);
  const wrote = table => log.filter(l => l.text.startsWith(`insert into ${table}`));
  return { log, client, wrote };
}

beforeEach(()=>vi.resetAllMocks());

describe("who may decide stock and edit the schedule",()=>{
  it("refuses a stock decision from anyone but the planner and the administrator",async()=>{
    for(const role of ["dispatch","sales","store","procurement","owner","viewer"]){
      database();
      const res=response();
      await dispatchHandler({headers:as(role),method:"POST",url:"/api/dispatches?resource=stock_plan",
        query:{resource:"stock_plan"},body:{resource:"stock_plan",action:"decide",order_no:"JO5001",ignore:true}},res);
      expect(res.statusCode,role).toBe(403);
      expect(dbMocks.connect,role).not.toHaveBeenCalled();
    }
  });
  it("refuses it even when the resource is smuggled in the body alone",async()=>{
    database();
    const res=response();
    await dispatchHandler({headers:as("dispatch"),method:"POST",url:"/api/dispatches",query:{},
      body:{resource:"stock_plan",action:"lock",lock:{store:"FG",article:ART,size:"8",party:"X",qty:5}}},res);
    expect(res.statusCode).toBe(403);
  });
  it("refuses a schedule edit and a re-plan from a user without the planner or admin role",async()=>{
    for(const role of ["sales","dispatch","viewer","store"]){
      database();
      const res=response();
      await orderHandler({headers:as(role),method:"PATCH",url:"/api/orders/JO5001",query:{order_no:"JO5001"},
        body:{plan_override:{at:{MOLDING:"2026-08-03"}}}},res);
      expect(res.statusCode,role).toBe(403);
      expect(res.body.error,role).toMatch(/Production Planner or an administrator/);
    }
  });
  it("lets the planner lock a block, and stores the lock",async()=>{
    const db=database();
    db.client.query.mockImplementation(async (sql,params=[])=>{
      const text=String(sql);
      if(text.includes("update orders set")) return {rows:[{...ORDER,order_date:"2026-07-06",priority:2,plan_override:JSON.parse(params[0]),version:2}]};
      return {rows:[]};
    });
    dbMocks.q.mockImplementation(async sql=>String(sql).includes("from orders")
      ? {rows:[{...ORDER,order_date:"2026-07-06",priority:2,plan_override:{},version:1}]} : {rows:[]});
    const res=response();
    await orderHandler({headers:as("planner"),method:"PATCH",url:"/api/orders/JO5001",query:{order_no:"JO5001"},
      body:{plan_override:{at:{MOLDING:"2026-08-03"}}}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body.plan_override.at).toEqual({MOLDING:"2026-08-03"});
  });
});

describe("a lock made on a job card is stored",()=>{
  /* Found in the browser: a block dragged on the board showed its padlock and
     was back where it started after a reload. The plan runs JOB CARDS, whose
     overrides live under `units[<unit key>]`, and the endpoint normalised the
     blob with a function that keeps the order's own four fields and drops every
     other key. Every card-level Adjust had been stored as an empty override. */
  const patch=async body=>{
    const db=database();
    db.client.query.mockImplementation(async (sql,params=[])=>String(sql).includes("update orders set")
      ? {rows:[{...ORDER,order_date:"2026-07-06",priority:2,plan_override:JSON.parse(params[0]),version:2}]} : {rows:[]});
    dbMocks.q.mockImplementation(async sql=>String(sql).includes("from orders")
      ? {rows:[{...ORDER,order_date:"2026-07-06",priority:2,plan_override:{},version:1}]} : {rows:[]});
    const res=response();
    await orderHandler({headers:as("planner"),method:"PATCH",url:"/api/orders/JO5001",query:{order_no:"JO5001"},body},res);
    return res;
  };
  it("keeps each card's override, normalised",async()=>{
    const res=await patch({plan_override:{units:{
      "JO5001#JC7":{at:{STITCHING:"2026-08-03"},machine:{MOLDING:"MOLDING_PVC_VERTICAL"},junk:1},
      "JO5001#JC8":{days:{CUTTING:"2"}}}}});
    expect(res.statusCode).toBe(200);
    expect(res.body.plan_override.units).toEqual({
      "JO5001#JC7":{seq:null,start_on:null,machine:{MOLDING:"MOLDING_PVC_VERTICAL"},days:{},at:{STITCHING:"2026-08-03"}},
      "JO5001#JC8":{seq:null,start_on:null,machine:{},days:{CUTTING:2}}});
  });
  it("keeps the day-by-day plan an uploaded sheet writes for a card",async()=>{
    const res=await patch({plan_override:{units:{"JO5001#JC7":{at:{PACKING:"2026-08-10"},
      daily:{PACKING:{"2026-08-10":700,"2026-08-11":800,"next week":5},CUTTING:{}}}}}});
    expect(res.statusCode).toBe(200);
    expect(res.body.plan_override.units["JO5001#JC7"]).toEqual({seq:null,start_on:null,machine:{},days:{},
      at:{PACKING:"2026-08-10"},daily:{PACKING:{"2026-08-10":700,"2026-08-11":800}}});
  });
  it("drops a card whose override is empty, so a card handed back leaves no trace",async()=>{
    const res=await patch({plan_override:{units:{"JO5001#JC7":{},"JO5001#JC8":{at:{CUTTING:"not a date"}}}}});
    expect(res.statusCode).toBe(200);
    expect(res.body.plan_override).toEqual({seq:null,start_on:null,machine:{},days:{}});
  });
  it("refuses a card pinned to a machine that does not exist",async()=>{
    const res=await patch({plan_override:{units:{"JO5001#JC7":{machine:{MOLDING:"MOLDING_NOWHERE"}}}}});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/MOLDING_NOWHERE.*not a work centre/);
  });
});

describe("the stock decision",()=>{
  it("the order list carries the stock status and allocation the planner needs",async()=>{
    dbMocks.q.mockResolvedValue({rows:[{...ORDER,order_date:"2026-07-06",priority:2,plan_override:{},version:1,
      stock_status:"decided",stock_allocation:{mode:"use",sizes:{"8":{fg:60,upper:{}}}}}]});
    const res=response();
    await ordersHandler({headers:as("planner"),method:"GET",url:"/api/orders",query:{}},res);
    expect(res.body[0].stock_status).toBe("decided");
    expect(res.body[0].stock_allocation.sizes["8"].fg).toBe(60);
    /* Read through to_jsonb, so a database without the columns still lists orders. */
    expect(String(dbMocks.q.mock.calls[0][0])).toMatch(/to_jsonb\(orders\) ->> 'stock_status'/);
  });
  it("the stock check offers finished goods first, then uppers",async()=>{
    database();
    const res=response();
    await dispatchHandler({headers:as("planner"),method:"GET",url:"/api/dispatches?resource=stock_plan&order_no=JO5001",
      query:{resource:"stock_plan",order_no:"JO5001"}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body.totals).toEqual({ordered:300,fg:60,upper:40,produce:200});
    expect(res.body.rows.map(r=>[r.size,r.use_fg,r.use_upper_total])).toEqual([["8",60,0],["9",0,40],["10",0,0]]);
  });
  it("using the stock reserves it for the order in one transaction and marks the order decided",async()=>{
    const db=database();
    const res=response();
    await dispatchHandler({headers:as("planner"),method:"POST",url:"/api/dispatches?resource=stock_plan",
      query:{resource:"stock_plan"},body:{resource:"stock_plan",action:"decide",order_no:"JO5001",
        sizes:{"8":{fg:60},"9":{upper:{"9":40}}}}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({stock_status:"decided",reserved_fg:60,reserved_upper:40});
    const rows=db.wrote("stock_reservations").map(l=>({store:l.params[0],size:l.params[3],qty:l.params[5],kind:l.params[6],order:l.params[7]}));
    expect(rows).toEqual([{store:"FG",size:"8",qty:60,kind:"reserve",order:"JO5001"},
                          {store:"UPPER",size:"9",qty:40,kind:"reserve",order:"JO5001"}]);
    const texts=db.log.map(l=>l.text);
    /* The lock is taken BEFORE the figures are read, and the write is committed. */
    expect(texts.findIndex(t=>t.includes("pg_advisory_xact_lock"))).toBeLessThan(texts.findIndex(t=>t.startsWith("select article, size, qty, kind, order_no from finished_stock")));
    expect(texts).toContain("begin"); expect(texts).toContain("commit");
    const update=db.log.find(l=>l.text.startsWith("update orders set stock_status = 'decided'"));
    expect(JSON.parse(update.params[1])).toMatchObject({mode:"use",decided_by:"tester",ordered:{"8":100,"9":100,"10":100}});
  });
  it("ignoring the stock reserves nothing and still decides the order",async()=>{
    const db=database();
    const res=response();
    await dispatchHandler({headers:as("admin"),method:"POST",url:"/api/dispatches?resource=stock_plan",
      query:{resource:"stock_plan"},body:{resource:"stock_plan",action:"decide",order_no:"JO5001",ignore:true}},res);
    expect(res.statusCode).toBe(200);
    expect(db.wrote("stock_reservations")).toHaveLength(0);
    expect(res.body.stock_allocation.mode).toBe("ignore");
  });
  it("a second decision on stock somebody else just took is refused with fresh figures",async()=>{
    const db=database({reservations:[{store:"FG",article:ART,colour:"",size:"8",for_size:"8",qty:60,kind:"reserve",order_no:"JO4999",party:"Other"}]});
    const res=response();
    await dispatchHandler({headers:as("planner"),method:"POST",url:"/api/dispatches?resource=stock_plan",
      query:{resource:"stock_plan"},body:{resource:"stock_plan",action:"decide",order_no:"JO5001",sizes:{"8":{fg:60}}}},res);
    expect(res.statusCode).toBe(409);
    expect(res.body.stale).toBe(true);
    expect(res.body.error).toMatch(/stock changed while this was open/);
    expect(res.body.check.rows[0].fg_free).toBe(0);
    expect(db.wrote("stock_reservations")).toHaveLength(0);
    expect(db.log.map(l=>l.text)).toContain("rollback");
  });
  it("party-locked stock cannot be reserved for another party's order",async()=>{
    const db=database({locks:[{store:"FG",article:ART,colour:"",size:"8",party:"St. Mary School",qty:60}]});
    const res=response();
    await dispatchHandler({headers:as("planner"),method:"POST",url:"/api/dispatches?resource=stock_plan",
      query:{resource:"stock_plan"},body:{resource:"stock_plan",action:"decide",order_no:"JO5001",sizes:{"8":{fg:10}}}},res);
    expect(res.statusCode).toBe(409);
    expect(db.wrote("stock_reservations")).toHaveLength(0);
  });
  it("a lock needs stock to lock, and names its party",async()=>{
    database();
    const none=response();
    await dispatchHandler({headers:as("planner"),method:"POST",url:"/api/dispatches?resource=stock_plan",
      query:{resource:"stock_plan"},body:{resource:"stock_plan",action:"lock",lock:{store:"FG",article:ART,size:"12",party:"School",qty:5}}},none);
    expect(none.statusCode).toBe(409);
    const bad=response();
    await dispatchHandler({headers:as("planner"),method:"POST",url:"/api/dispatches?resource=stock_plan",
      query:{resource:"stock_plan"},body:{resource:"stock_plan",action:"lock",lock:{store:"FG",article:ART,size:"8",party:"",qty:5}}},bad);
    expect(bad.statusCode).toBe(400);
    const db=database();
    const ok=response();
    await dispatchHandler({headers:as("planner"),method:"POST",url:"/api/dispatches?resource=stock_plan",
      query:{resource:"stock_plan"},body:{resource:"stock_plan",action:"lock",lock:{store:"FG",article:ART,size:"8",party:"School",qty:20}}},ok);
    expect(ok.statusCode).toBe(200);
    expect(db.wrote("stock_party_locks")).toHaveLength(1);
  });
});

describe("what the decision gates",()=>{
  const card={lines:[{combo:"8X10B",qty:300,sizes:{"8":100,"9":100,"10":100}}]};
  const issue=body=>({headers:as("admin"),method:"POST",url:"/api/dispatches?resource=job_work",query:{resource:"job_work"},
    body:{resource:"job_work",fabricator:"Rex Internal",article:ART,qty:300,stage:"STITCHING",order_no:"JO5001",card,...body}});
  it("no job card can be raised while the order waits for its stock decision",async()=>{
    database();
    const res=response();
    await dispatchHandler(issue({}),res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/waiting for its stock decision/);
  });
  it("once stock is used, a card cannot carry the pairs that come from finished goods",async()=>{
    database({order:{...ORDER,stock_status:"decided",stock_allocation:{mode:"use",sizes:{"8":{fg:60,upper:{}},"9":{fg:0,upper:{"9":40}}}}}});
    const res=response();
    await dispatchHandler(issue({}),res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/size 8: only 40 pair\(s\) are left to make through the full routing/);
  });
  it("a card starting at moulding carries only pairs whose uppers are reserved",async()=>{
    database({order:{...ORDER,stock_status:"decided",stock_allocation:{mode:"use",sizes:{"9":{fg:0,upper:{"9":40}}}}}});
    const res=response();
    await dispatchHandler(issue({qty:50,card:{start_stage:"MOLDING",lines:[{combo:"8X10B",qty:50,sizes:{"9":50}}]}}),res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/only 40 pair\(s\) have uppers reserved/);
  });
  it("a dispatch from finished goods issues the stock and clears the reservation in one transaction",async()=>{
    const db=database({order:{...ORDER,stock_status:"decided",stock_allocation:{mode:"use",sizes:{"8":{fg:60,upper:{}}}}},
      reservations:[{store:"FG",article:ART,colour:"",size:"8",for_size:"8",qty:60,kind:"reserve",order_no:"JO5001",party:"Belgaum Traders"}]});
    const res=response();
    await dispatchHandler({headers:as("dispatch"),method:"POST",url:"/api/dispatches",query:{},
      body:{order_no:"JO5001",dispatched:{"8X10B":60},from_stock:{"8":60}}},res);
    expect(res.statusCode).toBe(201);
    expect(res.body.shipped_from_stock).toBe(60);
    expect(res.body.from_stock).toEqual({sizes:{"8":60},combos:{"8X10B":60}});
    const issued=db.wrote("finished_stock");
    expect(issued).toHaveLength(1);
    expect(issued[0].params.slice(0,5)).toEqual([ART,"8",-60,"JO5001",77]);
    const cleared=db.wrote("stock_reservations");
    expect(cleared.map(l=>[l.params[5],l.params[6],l.params[10]])).toEqual([[-60,"dispatch",77]]);
    expect(db.log.map(l=>l.text)).toContain("commit");
  });
  it("a dispatch cannot ship another order's reserved pairs out of finished goods",async()=>{
    const db=database({order:{...ORDER,stock_status:"decided",stock_allocation:{mode:"ignore",sizes:{}}},
      reservations:[{store:"FG",article:ART,colour:"",size:"8",for_size:"8",qty:60,kind:"reserve",order_no:"JO4999",party:"Other"}]});
    const res=response();
    await dispatchHandler({headers:as("dispatch"),method:"POST",url:"/api/dispatches",query:{},
      body:{order_no:"JO5001",dispatched:{"8X10B":20},from_stock:{"8":20}}},res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/only 0 are available to this order/);
    expect(db.wrote("dispatches")).toHaveLength(0);
  });
  it("closing an order short releases whatever it still had reserved",async()=>{
    const db=database({order:{...ORDER,stock_status:"decided"}});
    const res=response();
    await dispatchHandler({headers:as("dispatch"),method:"POST",url:"/api/dispatches",query:{},
      body:{order_no:"JO5001",dispatched:{"8X10B":10},closes_order:true,kind:"shortage",note:"customer cancelled the rest"}},res);
    expect(res.statusCode).toBe(201);
    const release=db.wrote("stock_reservations").find(l=>l.text.includes("'release'"));
    expect(release.params[0]).toEqual(["JO5001"]);
    expect(release.params[1]).toMatch(/closed short/);
  });
});

describe("the schema and the code agree",()=>{
  /* From the project root: under jsdom `import.meta.url` is not a file URL. */
  const at=rel=>path.resolve(process.cwd(),rel);
  const schema=fs.readFileSync(at("db/schema.sql"),"utf8");
  const lib=fs.readFileSync(at("api/_lib/stock-plan.js"),"utf8");
  const columnsOf=(sql,table)=>{
    const m=new RegExp(`create table if not exists ${table} \\(([\\s\\S]*?)\\n\\s*\\)`).exec(sql);
    return m ? m[1].split("\n").map(l=>l.trim().split(/\s+/)[0]).filter(w=>/^[a-z_]+$/.test(w)&&w!=="primary") : [];
  };
  it("every column the code writes to the new tables exists in schema.sql",()=>{
    for(const table of ["stock_reservations","stock_party_locks"]){
      const have=new Set(columnsOf(schema,table));
      expect(have.size,table).toBeGreaterThan(0);
      for(const m of lib.matchAll(new RegExp(`insert into ${table} \\(([^)]*)\\)`,"g")))
        for(const col of m[1].split(",").map(c=>c.trim())) expect(have.has(col),`${table}.${col}`).toBe(true);
    }
    for(const col of ["stock_status","stock_allocation"])
      expect(schema).toMatch(new RegExp(`alter table orders add column if not exists ${col} `));
    expect(schema).toMatch(/alter table dispatches add column if not exists from_stock jsonb/);
  });
  it("the tables created on first use are the tables in schema.sql",()=>{
    for(const table of ["stock_reservations","stock_party_locks"])
      expect(columnsOf(lib,table)).toEqual(columnsOf(schema,table));
  });
  it("the reservation ledger is append-only: nothing updates or deletes it",()=>{
    const all=fs.readdirSync(at("api"),{recursive:true}).filter(f=>String(f).endsWith(".js"))
      .map(f=>fs.readFileSync(path.join(at("api"),String(f)),"utf8")).join("\n");
    expect(all).not.toMatch(/update\s+stock_reservations/i);
    expect(all).not.toMatch(/delete\s+from\s+stock_reservations/i);
  });
});
