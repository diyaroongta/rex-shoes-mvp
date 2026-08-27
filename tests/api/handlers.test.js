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
import piNumbersHandler from "../../api/pi-numbers.js";

function response(){
  return {statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
}

beforeEach(()=>vi.resetAllMocks());

describe("database API contracts",()=>{
  it("allocates collision-resistant PI numbers from a database sequence",async()=>{
    dbMocks.q.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{n:"42"}]});
    const res=response();
    await piNumbersHandler({method:"POST",url:"/api/pi-numbers",body:{}},res);
    expect(res.statusCode).toBe(201);
    expect(res.body.pi_no).toMatch(/^PI-\d{4}-000042$/);
    expect(String(dbMocks.q.mock.calls[1][0])).toContain("nextval('pi_no_seq')");
  });

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

  it("derives dispatch cartons from the order's snapshotted packing rate",async()=>{
    dbMocks.q.mockResolvedValueOnce({rows:[{order_no:"JO1",article_code:"SPIKE",lines:[{combo:"7X10S",qty:240,ppc:24}]}]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{id:1,order_no:"JO1",dispatched:{"7X10S":48},cartons:{"7X10S":2},kind:"partial",dispatched_on:"2026-08-25",closes_order:false}]});
    const res=response();
    await dispatchHandler({method:"POST",url:"/api/dispatches",body:{order_no:"JO1",dispatched:{"7X10S":48},cartons:{"7X10S":999},kind:"partial",dispatched_on:"2026-08-25"}},res);
    expect(res.statusCode).toBe(201);
    const insert=dbMocks.q.mock.calls.find(([sql])=>String(sql).includes("insert into dispatches"));
    expect(JSON.parse(insert[1][2])).toEqual({"7X10S":2});
  });

  it("rejects an impossible dispatch date before reading an order",async()=>{
    const res=response();
    await dispatchHandler({method:"POST",url:"/api/dispatches",body:{order_no:"JO1",dispatched:{A:1},dispatched_on:"2026-02-30"}},res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/real date/);
    expect(dbMocks.q).not.toHaveBeenCalled();
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
    const current={order_no:"JO1",order_date:"2026-08-22",article_code:"CUSTOM",priority:2,party:"Buyer",lines:[],pi:{pi_no:"PI1"},version:0};
    const live={articles:{CUSTOM:{combos:{"1X2":{}},combo_order:["1X2"]}}};
    dbMocks.q.mockImplementation(async sql=>{
      const text=String(sql);
      if(text.includes("from orders where order_no")) return {rows:[current]};
      if(text.includes("reference_data")) return {rows:[{value:live}]};
      return {rows:[]};
    });
    const client={query:vi.fn(async sql=>{
      if(String(sql).startsWith("update orders")) return {rows:[{...current,version:1,lines:[{combo:"1X2",qty:12,sizes:{"1":12},size_order:["1","2"],ppc:12}]}]};
      return {rows:[]};
    }),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await orderHandler({method:"PATCH",url:"/api/orders/JO1",query:{order_no:"JO1"},body:{lines:[{
      combo:"1X2",qty:12,sizes:{"1":12},size_order:["1","2"],ppc:12,
    }]}},res);
    expect(res.statusCode).toBe(200);
    const updateCall=client.query.mock.calls.find(([sql])=>String(sql).startsWith("update orders"));
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
      return {rows:[],rowCount:0};
    });
    const client={query:vi.fn(async sql=>String(sql).startsWith("update orders")?{rowCount:1,rows:[]}:{rows:[],rowCount:0}),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await partiesHandler({method:"POST",url:"/api/parties",body:{name:"Buyer"}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body.updated).toBe(1);
    const [sql,params]=client.query.mock.calls.find(([s])=>String(s).startsWith("update orders"));
    // `||` merges at the top level, so pi_no / remarks / attachment survive.
    expect(sql).toMatch(/pi = coalesce\(pi,'\{\}'::jsonb\) \|\| \$3::jsonb/);
    const written=JSON.parse(params[2]);
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

  it("stores catalogue edits only for a known article and records a revision",async()=>{
    const ref={articles:{CUSTOM:{combo_order:["1X2"],combos:{"1X2":{}}}}};
    const client={query:vi.fn(async sql=>String(sql).includes("select value from reference_data")?{rows:[{value:ref}]}:{rows:[]}),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await catalogueHandler({method:"PUT",url:"/api/catalogue",body:{article_code:" custom ",description:"Demo",price:500}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body.article_code).toBe("CUSTOM");
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("catalogue_history"))).toBe(true);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("can add a catalogue-only article and marks its missing BOM",async()=>{
    const ref={articles:{CUSTOM:{combo_order:["1X2"],combos:{"1X2":{}}}},materials:{}};
    const client={query:vi.fn(async sql=>{
      const text=String(sql);
      if(text.includes("select value from reference_data")) return {rows:[{value:ref}]};
      if(text.includes("select article_code, image, description, price from catalogue order")) return {rows:[]};
      return {rows:[]};
    }),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await catalogueHandler({method:"PUT",url:"/api/catalogue",body:{
      article_code:" thunder 27 ",description:"New model",price:799,sole_type:"PVC",create_catalogue_only:true,
    }},res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({article_code:"THUNDER 27",created_without_bom:true,missing_bom:true});
    const referenceWrite=client.query.mock.calls.find(([sql])=>String(sql).includes("insert into reference_data (id, value)"));
    const written=JSON.parse(referenceWrite[1][0]);
    expect(written.articles["THUNDER 27"]).toMatchObject({sole_type:"PVC",combo_order:[],combos:{}});
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("catalogue-only-add"))).toBe(true);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("stores validated packing edits in shared reference data",async()=>{
    const ref={articles:{CUSTOM:{combo_order:["1X2"],combos:{"1X2":{}}}},materials:{},packing:{}};
    const client={query:vi.fn(async sql=>{
      if(String(sql).includes("select value from reference_data")) return {rows:[{value:ref}]};
      return {rows:[]};
    }),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await referenceHandler({method:"PATCH",url:"/api/reference",body:{packing:{CUSTOM:{"1X2":12}}}},res);
    expect(res.statusCode).toBe(200);
    const saveCall=client.query.mock.calls.find(([sql])=>String(sql).includes("insert into reference_data (id, value)"));
    const saved=JSON.parse(saveCall[1][0]);
    expect(saved.packing.CUSTOM["1X2"]).toBe(12);
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("reference_data_history"))).toBe(true);
    const historyCall=client.query.mock.calls.find(([sql])=>String(sql).includes("insert into reference_data_history"));
    expect(JSON.parse(historyCall[1][2])).toMatchObject({reference:ref,catalogue:[]});
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("adds and clears individual-size packing overrides",async()=>{
    const ref={articles:{CUSTOM:{combo_order:["7X10"],combos:{"7X10":{}}}},materials:{},packing:{CUSTOM:{"7X10":48}},
      packing_singles_exact:{CUSTOM:{"7S":36}}};
    const client={query:vi.fn(async sql=>{
      if(String(sql).includes("select value from reference_data")) return {rows:[{value:ref}]};
      return {rows:[]};
    }),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await referenceHandler({method:"PATCH",url:"/api/reference",body:{packing_singles:{CUSTOM:{"7S":null,"8S":40}}}},res);
    expect(res.statusCode).toBe(200);
    const saveCall=client.query.mock.calls.find(([sql])=>String(sql).includes("insert into reference_data (id, value)"));
    const saved=JSON.parse(saveCall[1][0]);
    expect(saved.packing_singles_exact.CUSTOM["7S"]).toBeUndefined();
    expect(saved.packing_singles_exact.CUSTOM["8S"]).toBe(40);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("stores combo packing, individual-size packing and range MRPs in one master upload",async()=>{
    const ref={articles:{},materials:{},packing:{},mrp:{}};
    const client={query:vi.fn(async sql=>{
      if(String(sql).includes("select value from reference_data")) return {rows:[{value:ref}]};
      return {rows:[]};
    }),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await referenceHandler({method:"POST",url:"/api/reference",body:{batch:{
      boms:[{article:"THUNDER",soleType:"EVA",combo_order:["7X10","11X1"],
        materials:{"MAT||MTR":{name:"MAT",uom:"MTR"}},
        combos:{"7X10":{rates:{CUTTING:{"MAT||MTR":0.5}}},"11X1":{rates:{CUTTING:{"MAT||MTR":0.6}}}}}],
      packing:{THUNDER:{"7X10":24,"11X1":18}},
      packingSingles:{THUNDER:{"7X10::7S":24,"7X10::8S":24}},
      mrp:{THUNDER:{"7X10":899,"11X1":949,"7X10::7S":925}},
      individualSizes:{THUNDER:["7S","8S"]},
      catalogue:{THUNDER:{article_code:"THUNDER",description:"School shoe",price:null,sole_type:"EVA",molding_machine:null}},
    }}},res);
    expect(res.statusCode).toBe(200);
    const saveCall=client.query.mock.calls.find(([sql])=>String(sql).includes("insert into reference_data (id, value)"));
    const saved=JSON.parse(saveCall[1][0]);
    expect(saved.packing.THUNDER).toEqual({"7X10":24,"11X1":18});
    expect(saved.packing_singles_exact.THUNDER).toEqual({"7X10::7S":24,"7X10::8S":24});
    expect(saved.mrp.THUNDER).toEqual({"7X10":899,"11X1":949,"7X10::7S":925});
    expect(saved.articles.THUNDER.individual_sizes).toEqual(["7S","8S"]);
    expect(saved.articles.THUNDER.packing_source).toBe("SELF");
    expect(res.body.single_packing_articles).toEqual(["THUNDER"]);
    expect(res.body.mrp_articles).toEqual(["THUNDER"]);
  });

  it("requires explicit confirmation before replacing an existing BOM",async()=>{
    const ref={articles:{CUSTOM:{combo_order:["1X2"],combos:{"1X2":{}}}},materials:{},packing:{}};
    const client={query:vi.fn(async sql=>String(sql).includes("select value from reference_data")?{rows:[{value:ref}]}:{rows:[]}),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await referenceHandler({method:"POST",url:"/api/reference",body:{parsed:{
      article:" custom ",soleType:"EVA",combo_order:["1X2"],materials:{"MAT||MTR":{name:"MAT",uom:"MTR"}},
      combos:{"1X2":{rates:{CUTTING:{"MAT||MTR":1}}}},
    }}},res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/replace existing BOMs: CUSTOM/);
    expect(client.query).toHaveBeenCalledWith("rollback");
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("insert into reference_data (id, value)"))).toBe(false);
  });

  it("merges a partial BOM update without deleting omitted ranges or materials",async()=>{
    const ref={articles:{CUSTOM:{sole_type:"EVA",routing:["CUTTING","PACKING"],combo_order:["1X2","3X4"],combos:{
      "1X2":{rates:{CUTTING:{"OLD||MTR":1,"CHANGE||MTR":1}}},
      "3X4":{rates:{CUTTING:{"KEEP||MTR":2}}},
    }}},materials:{"OLD||MTR":{name:"OLD",uom:"MTR"},"CHANGE||MTR":{name:"CHANGE",uom:"MTR"},"KEEP||MTR":{name:"KEEP",uom:"MTR"}},packing:{}};
    const client={query:vi.fn(async sql=>{
      if(String(sql).includes("select value from reference_data")) return {rows:[{value:ref}]};
      return {rows:[]};
    }),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await referenceHandler({method:"POST",url:"/api/reference",body:{bom_mode:"merge",parsed:{
      article:"CUSTOM",soleType:"EVA",combo_order:["1X2"],
      materials:{"CHANGE||MTR":{name:"CHANGE",uom:"MTR"},"NEW||PCS":{name:"NEW",uom:"PCS"}},
      combos:{"1X2":{rates:{CUTTING:{"CHANGE||MTR":1.5,"NEW||PCS":1}}}},
    }}},res);
    expect(res.statusCode).toBe(200);
    const saveCall=client.query.mock.calls.find(([sql])=>String(sql).includes("insert into reference_data (id, value)"));
    const saved=JSON.parse(saveCall[1][0]);
    expect(saved.articles.CUSTOM.combo_order).toEqual(["1X2","3X4"]);
    expect(saved.articles.CUSTOM.combos["3X4"].rates.CUTTING["KEEP||MTR"]).toBe(2);
    expect(saved.articles.CUSTOM.combos["1X2"].rates.CUTTING).toMatchObject({
      "OLD||MTR":1,"CHANGE||MTR":1.5,"NEW||PCS":1,
    });
    expect(saved.articles.CUSTOM.routing).toEqual(["CUTTING","PACKING"]);
  });

  it("removes only the selected BOM item and records the change",async()=>{
    const ref={articles:{CUSTOM:{combo_order:["1X2"],combos:{"1X2":{rates:{CUTTING:{"WRONG||MTR":1,"KEEP||MTR":2}}}}}},materials:{},packing:{}};
    const client={query:vi.fn(async sql=>String(sql).includes("select value from reference_data")?{rows:[{value:ref}]}:{rows:[]}),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await referenceHandler({method:"PATCH",url:"/api/reference",body:{bom_remove:[{
      article:"CUSTOM",combo:"1X2",stage:"CUTTING",material:"WRONG||MTR",
    }]}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body.removed_bom_items).toBe(1);
    const saveCall=client.query.mock.calls.find(([sql])=>String(sql).includes("insert into reference_data (id, value)"));
    const saved=JSON.parse(saveCall[1][0]);
    expect(saved.articles.CUSTOM.combos["1X2"].rates.CUTTING).toEqual({"KEEP||MTR":2});
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("reference_data_history"))).toBe(true);
  });

  /* A snapshot nobody can restore is not a safety net. A wrong BOM upload
     replaces an article's rates outright, so the undo is the difference
     between a bad file costing a minute and costing a day of retyping. */
  it("lists reference revisions without shipping their payloads",async()=>{
    dbMocks.q.mockResolvedValueOnce({rows:[
      {revision_id:2,change_type:"master-upload",article_code:null,created_at:new Date("2026-08-23T10:00:00Z")},
      {revision_id:1,change_type:"bom-upload",article_code:"SPIKE",created_at:new Date("2026-08-22T09:00:00Z")},
    ]});
    const res=response();
    await referenceHandler({method:"GET",url:"/api/reference?history=1",query:{history:"1"}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].change_type).toBe("master-upload");
    expect(res.body[0]).not.toHaveProperty("value");   // the list is for choosing
  });

  it("restores a revision and records the restore so it can itself be undone",async()=>{
    const snapshot={articles:{SPIKE:{combos:{},combo_order:[]}},materials:{"M||MTR":{name:"M",uom:"MTR"}}};
    dbMocks.q.mockResolvedValueOnce({rows:[{value:snapshot,change_type:"bom-upload",article_code:"SPIKE",created_at:new Date()}]})
      .mockResolvedValueOnce({rows:[]});
    const client={query:vi.fn(async sql=>
      String(sql).includes("select value from reference_data") ? {rows:[{value:{articles:{OLD:{}}}}]} : {rows:[]}),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const res=response();
    await referenceHandler({method:"POST",url:"/api/reference",body:{restore_revision:1}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body.restored_revision).toBe(1);
    expect(res.body.articles_total).toBe(1);
    // The state being replaced is snapshotted BEFORE the restore overwrites it.
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("insert into reference_data_history"))).toBe(true);
    expect(client.query).toHaveBeenCalledWith("commit");
    const written=client.query.mock.calls.find(([sql])=>String(sql).includes("insert into reference_data"))[1];
    expect(JSON.parse(written[0]).articles.SPIKE).toBeDefined();
    expect(JSON.parse(written[0]).articles.OLD).toBeUndefined();  // replaced, not merged
  });

  it("blocks a reference restore that would invalidate a live order",async()=>{
    const snapshot={reference:{articles:{OTHER:{combos:{},combo_order:[]}},materials:{}},catalogue:[]};
    dbMocks.q.mockResolvedValueOnce({rows:[{value:snapshot,change_type:"master-upload",article_code:null,created_at:new Date()}]})
      .mockResolvedValueOnce({rows:[{order_no:"JO1",article_code:"SPIKE",lines:[{combo:"7X10S",qty:24}]}]});
    const res=response();
    await referenceHandler({method:"POST",url:"/api/reference",body:{restore_revision:3}},res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/JO1: article SPIKE would disappear/);
    expect(dbMocks.connect).not.toHaveBeenCalled();
  });

  /* The server must refuse a range-deleting upload on its own, not rely on the
     browser having ticked a box — the API is reachable without the UI. */
  it("refuses an upload that silently drops loaded size ranges",async()=>{
    const live={articles:{SPIKE:{sole_type:"EVA",combo_order:["7X10S","11X1"],
      combos:{"7X10S":{rates:{CUTTING:{"M||MTR":1}}},"11X1":{rates:{CUTTING:{"M||MTR":1}}}}}},materials:{}};
    const client={query:vi.fn(async sql=>
      String(sql).includes("select value from reference_data")?{rows:[{value:live}]}:{rows:[]}),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const body={batch:{boms:[{article:"SPIKE",soleType:"EVA",combo_order:["7X10S"],
      combos:{"7X10S":{rates:{CUTTING:{"M||MTR":1}}}},materials:{"M||MTR":{name:"M",uom:"MTR"}}}]},
      confirm_replace:true};
    const res=response();
    await referenceHandler({method:"POST",url:"/api/reference",body},res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/REMOVES size ranges/);
    expect(res.body.error).toMatch(/11X1/);          // names what goes
    expect(client.query).toHaveBeenCalledWith("rollback");
  });

  it("allows the same upload once the removal is explicitly confirmed",async()=>{
    const live={articles:{SPIKE:{sole_type:"EVA",combo_order:["7X10S","11X1"],
      combos:{"7X10S":{rates:{CUTTING:{"M||MTR":1}}},"11X1":{rates:{CUTTING:{"M||MTR":1}}}}}},materials:{}};
    const client={query:vi.fn(async sql=>
      String(sql).includes("select value from reference_data")?{rows:[{value:live}]}:{rows:[]}),release:vi.fn()};
    dbMocks.connect.mockResolvedValue(client);
    const body={batch:{boms:[{article:"SPIKE",soleType:"EVA",combo_order:["7X10S"],
      combos:{"7X10S":{rates:{CUTTING:{"M||MTR":1}}}},materials:{"M||MTR":{name:"M",uom:"MTR"}}}]},
      confirm_replace:true, confirm_remove_ranges:true};
    const res=response();
    await referenceHandler({method:"POST",url:"/api/reference",body},res);
    expect(res.statusCode).toBe(200);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("refuses to restore a revision that is not a reference document",async()=>{
    dbMocks.q.mockResolvedValueOnce({rows:[{value:{not:"a reference"},change_type:"x",article_code:null,created_at:new Date()}]});
    const res=response();
    await referenceHandler({method:"POST",url:"/api/reference",body:{restore_revision:9}},res);
    expect(res.statusCode).toBe(422);
    expect(dbMocks.connect).not.toHaveBeenCalled();
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
