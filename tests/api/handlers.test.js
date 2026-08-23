import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks=vi.hoisted(()=>({q:vi.fn(),connect:vi.fn()}));
vi.mock("../../api/_lib/db.js",()=>({
  q:dbMocks.q,
  db:()=>({connect:dbMocks.connect}),
}));

import settingsHandler from "../../api/settings.js";
import dispatchHandler from "../../api/dispatches.js";
import ordersHandler from "../../api/orders/index.js";
import orderHandler from "../../api/orders/[order_no].js";
import partiesHandler from "../../api/parties.js";
import catalogueHandler from "../../api/catalogue.js";
import referenceHandler from "../../api/reference.js";
import pisHandler from "../../api/pis.js";

function response(){
  return {statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
}

beforeEach(()=>vi.clearAllMocks());

describe("database API contracts",()=>{
  it("preserves untouched settings when one capacity changes",async()=>{
    const previous={capacities:{CUTTING:91,PREPARATION:77},sla_targets:{CUTTING:12},pi_config:{company_name:"REX"}};
    dbMocks.q.mockResolvedValueOnce({rows:[{value:previous}]})
      .mockResolvedValueOnce({rows:[]});
    const res=response();
    await settingsHandler({method:"PUT",url:"/api/settings",body:{capacities:{CUTTING:100}}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body.capacities).toMatchObject({CUTTING:100,PREPARATION:77});
    expect(res.body.sla_targets.CUTTING).toBe(12);
    expect(res.body.pi_config.company_name).toBe("REX");
  });

  it("rejects an over-dispatch before writing it",async()=>{
    dbMocks.q.mockResolvedValueOnce({rows:[{order_no:"JO1",article_code:"SPIKE",lines:[{combo:"7X10S",qty:100}]}]})
      .mockResolvedValueOnce({rows:[{dispatched:{"7X10S":80}}]});
    const res=response();
    await dispatchHandler({method:"POST",url:"/api/dispatches",body:{order_no:"JO1",dispatched:{"7X10S":30}}},res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/only 20 pairs remain/);
    expect(dbMocks.q).toHaveBeenCalledTimes(2);
  });

  it("accepts an article present in live reference data even when absent from the seed",async()=>{
    const live={articles:{CUSTOM:{combos:{"1X2":{rates:{CUTTING:{MAT:1}}}},combo_order:["1X2"]}}};
    dbMocks.q.mockResolvedValueOnce({rows:[{value:live}]}).mockResolvedValue({rows:[]});
    const client={query:vi.fn(async sql=>{
      if(String(sql).includes("insert into orders")) return {rows:[{order_no:"JO3000",order_date:"2026-08-22",article_code:"CUSTOM",priority:2,party:"Buyer",lines:[{combo:"1X2",qty:12}],pi:{}}]};
      return {rows:[]};
    }),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await ordersHandler({method:"POST",url:"/api/orders",body:{orders:[{order_date:"2026-08-22",article_code:"CUSTOM",priority:2,party:"Buyer",lines:[{combo:"1X2",qty:12}]}]}},res);
    expect(res.statusCode).toBe(201);
    expect(res.body[0].article_code).toBe("CUSTOM");
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("rejects order lines whose exact sizes do not add up to the planning quantity",async()=>{
    const live={articles:{CUSTOM:{combos:{"1X2":{rates:{CUTTING:{MAT:1}}}},combo_order:["1X2"]}}};
    dbMocks.q.mockResolvedValueOnce({rows:[{value:live}]});
    const res=response();
    await ordersHandler({method:"POST",url:"/api/orders",body:{orders:[{
      order_date:"2026-08-22",article_code:"CUSTOM",priority:2,party:"Buyer",
      lines:[{combo:"1X2",qty:12,sizes:{"1":5,"2":5}}],
    }]}},res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/total 10, not 12/);
    expect(dbMocks.connect).not.toHaveBeenCalled();
  });

  it("preserves exact-size ordering metadata when editing a saved order",async()=>{
    const current={order_no:"JO1",order_date:"2026-08-22",article_code:"CUSTOM",priority:2,party:"Buyer",lines:[],pi:{pi_no:"PI1"}};
    const live={articles:{CUSTOM:{combos:{"1X2":{}},combo_order:["1X2"]}}};
    dbMocks.q.mockImplementation(async sql=>{
      const text=String(sql);
      if(text.includes("from orders where order_no")) return {rows:[current]};
      if(text.includes("reference_data")) return {rows:[{value:live}]};
      if(text.startsWith("update orders")) return {rows:[{...current,lines:[{combo:"1X2",qty:12,sizes:{"1":12},size_order:["1","2"],ppc:12}]}]};
      return {rows:[]};
    });
    const res=response();
    await orderHandler({method:"PATCH",url:"/api/orders/JO1",query:{order_no:"JO1"},body:{lines:[{
      combo:"1X2",qty:12,sizes:{"1":12},size_order:["1","2"],ppc:12,
    }]}},res);
    expect(res.statusCode).toBe(200);
    const updateCall=dbMocks.q.mock.calls.find(([sql])=>String(sql).startsWith("update orders"));
    expect(updateCall[1][0]).toContain('"size_order":["1","2"]');
    expect(updateCall[1][0]).toContain('"ppc":12');
  });

  it("validates party deductions before any database write",async()=>{
    const res=response();
    await partiesHandler({method:"PUT",url:"/api/parties",body:{name:"Buyer",deductions:[{label:"",pct:200}]}},res);
    expect(res.statusCode).toBe(400);
    expect(dbMocks.q).not.toHaveBeenCalled();
  });

  // A cleared box used to arrive as "" and be stored as 0%, which prices every
  // future PI for that customer at full MRP with nothing said.
  it("refuses a blank commercial term rather than storing it as zero",async()=>{
    const res=response();
    await partiesHandler({method:"PUT",url:"/api/parties",body:{name:"Buyer",discount_pct:""}},res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/discount_pct cannot be blank/);
    expect(dbMocks.q).not.toHaveBeenCalled();
  });

  it("still applies the default when a term is simply not sent",async()=>{
    dbMocks.q.mockResolvedValueOnce({rows:[{name:"Buyer"}]});
    const res=response();
    await partiesHandler({method:"PUT",url:"/api/parties",body:{name:"Buyer"}},res);
    expect(res.statusCode).toBe(200);
    expect(dbMocks.q.mock.calls[0][1][2]).toBe(40);
  });

  /* Re-pricing already-issued PIs is a revision, not a refresh. It must be an
     explicit call, it must preview without writing, and it must not damage the
     rest of the pi blob when it does write. */
  it("previews a party re-price without touching any order",async()=>{
    dbMocks.q.mockResolvedValueOnce({rows:[{discount_pct:"35",deductions:[{label:"F.O.R.",pct:2}],
      gst_pct:"5",payment_split_pct:"50",dispatch_timeline:"45 days"}]})
      .mockResolvedValueOnce({rows:[{order_no:"JO1",pi_no:"PI7",discount_pct:"40"},
                                    {order_no:"JO2",pi_no:"PI7",discount_pct:"35"}]});
    const res=response();
    await partiesHandler({method:"POST",url:"/api/parties",body:{name:"Buyer",preview:true}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body.orders).toBe(2);
    expect(res.body.changing).toBe(1);          // only JO1 was issued at a different discount
    expect(res.body.pis).toEqual(["PI7"]);
    expect(dbMocks.q.mock.calls.some(([sql])=>String(sql).startsWith("update orders"))).toBe(false);
  });

  it("merges new terms into the pi blob instead of replacing it",async()=>{
    dbMocks.q.mockImplementation(async sql=>{
      const text=String(sql);
      if(text.includes("from parties where name")) return {rows:[{discount_pct:"35",deductions:[],
        gst_pct:"5",payment_split_pct:"50",dispatch_timeline:"45 days"}]};
      if(text.includes("from orders where party")) return {rows:[{order_no:"JO1",pi_no:"PI7",discount_pct:"40"}]};
      if(text.startsWith("update orders")) return {rowCount:1,rows:[]};
      return {rows:[],rowCount:0};
    });
    const res=response();
    await partiesHandler({method:"POST",url:"/api/parties",body:{name:"Buyer"}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body.updated).toBe(1);
    const [sql,params]=dbMocks.q.mock.calls.find(([s])=>String(s).startsWith("update orders"));
    // `||` merges at the top level, so pi_no / remarks / attachment survive.
    expect(sql).toMatch(/pi = coalesce\(pi,'\{\}'::jsonb\) \|\| \$2::jsonb/);
    const written=JSON.parse(params[1]);
    expect(written.discount_pct).toBe(35);
    expect(written.terms.gst_pct).toBe(5);
    expect(written).not.toHaveProperty("pi_no");
  });

  it("refuses to re-price a party that does not exist",async()=>{
    dbMocks.q.mockResolvedValueOnce({rows:[]});
    const res=response();
    await partiesHandler({method:"POST",url:"/api/parties",body:{name:"Nobody"}},res);
    expect(res.statusCode).toBe(404);
  });

  it("rejects invalid catalogue prices before writing",async()=>{
    const res=response();
    await catalogueHandler({method:"PUT",url:"/api/catalogue",body:{article_code:"SPIKE",price:-1}},res);
    expect(res.statusCode).toBe(400);
    expect(dbMocks.q).not.toHaveBeenCalled();
  });

  it("stores validated packing edits in shared reference data",async()=>{
    const ref={articles:{CUSTOM:{combo_order:["1X2"],combos:{"1X2":{}}}},materials:{},packing:{}};
    dbMocks.q.mockResolvedValueOnce({rows:[{value:ref}]}).mockResolvedValueOnce({rows:[]});
    const res=response();
    await referenceHandler({method:"PATCH",url:"/api/reference",body:{packing:{CUSTOM:{"1X2":12}}}},res);
    expect(res.statusCode).toBe(200);
    const saved=JSON.parse(dbMocks.q.mock.calls[1][1][0]);
    expect(saved.packing.CUSTOM["1X2"]).toBe(12);
  });

  it("links a historical PI snapshot into the live order queue once",async()=>{
    const ref={articles:{CUSTOM:{combo_order:["1X2"],combos:{"1X2":{}}}}};
    const snapshot={orders:[{order_no:"JO77",order_date:"2026-08-22",article_code:"CUSTOM",priority:2,party:"Buyer",lines:[{combo:"1X2",qty:12}],pi:{pi_no:"PI77"}}]};
    dbMocks.q.mockImplementation(async sql=>{
      const text=String(sql);
      if(text.includes("select snapshot from proforma_invoices")) return {rows:[{snapshot}]};
      if(text.includes("reference_data")) return {rows:[{value:ref}]};
      if(text.includes("select order_no, coalesce")) return {rows:[]};
      return {rows:[]};
    });
    const client={query:vi.fn(async sql=>String(sql).includes("returning order_no")?{rows:[{order_no:"JO77"}]}:{rows:[]}),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await pisHandler({method:"POST",url:"/api/pis",body:{pi_no:"PI77"}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body.restored).toEqual(["JO77"]);
    expect(client.query).toHaveBeenCalledWith("commit");
  });
});
