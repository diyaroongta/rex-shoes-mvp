import React from "react";
import * as XLSX from "xlsx";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({list:vi.fn(),create:vi.fn(),createBulk:vi.fn(),receive:vi.fn(),cancel:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>({
  listPurchaseOrders:mocks.list,createPurchaseOrder:mocks.create,
  createPurchaseOrders:mocks.createBulk,
  receivePurchaseOrder:mocks.receive,cancelPurchaseOrder:mocks.cancel,
}));
import PurchaseOrders from "../../src/PurchaseOrders.jsx";

const material={material_key:"MESH||MTR",name:"MESH",uom:"MTR",shortfall:100,rate:12};
const order={po_no:"PO-2026-000001",supplier:"ABC Materials",po_date:"2026-09-30",expected_on:"2026-10-05",
  status:"open",additional_information:"Deliver before noon",
  lines:[{material_key:"MESH||MTR",name:"MESH",uom:"MTR",ordered_qty:100,rate:12}],receipts:[]};

beforeEach(()=>{vi.clearAllMocks();mocks.list.mockResolvedValue([]);mocks.create.mockResolvedValue(order);
  mocks.createBulk.mockResolvedValue({purchase_orders:[order]});
  mocks.receive.mockResolvedValue({...order,status:"partial"});mocks.cancel.mockResolvedValue({status:"cancelled"});});

describe("purchase-order UI",()=>{
  /* The manual PO form duplicated the prefilled Excel route and was removed. */
  it("has no Manual backup route — POs come from the prefilled template",async()=>{
    render(<PurchaseOrders materials={[material]}/>);
    expect(await screen.findByRole("button",{name:"Upload PO Excel"})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Manual backup"})).toBeNull();
  });

  it("tracks outstanding, pending and received POs",async()=>{
    const done={...order,po_no:"PO-2026-000002",receipts:[{received_on:"2026-10-01",lines:[{material_key:"MESH||MTR",quantity:100}]}]};
    mocks.list.mockResolvedValue([order,done]);const user=userEvent.setup();
    render(<PurchaseOrders materials={[material]}/>);
    await user.click(await screen.findByRole("button",{name:"PO register"}));
    expect(await screen.findByText("Outstanding POs")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/Pending to arrive/})).toHaveTextContent("₹1,200");  // 100 MTR × ₹12 still to arrive
    expect(screen.getByText("PO-2026-000001")).toBeInTheDocument();
    expect(screen.queryByText("PO-2026-000002")).toBeNull();                 // received: not outstanding
    await user.click(screen.getByRole("button",{name:/Received in full/}));
    expect(screen.getByText("PO-2026-000002")).toBeInTheDocument();
  });

  it("checks an uploaded workbook and creates its PO groups together",async()=>{
    const user=userEvent.setup();render(<PurchaseOrders materials={[material]} allMaterials={[material]}/>);
    const sheet=XLSX.utils.aoa_to_sheet([
      ["PO GROUP","SUPPLIER","PO DATE","EXPECTED DELIVERY","ADDITIONAL INFORMATION","MATERIAL KEY","MATERIAL NAME","UOM","ORDER QUANTITY","RATE"],
      ["PO-1","ABC Materials","2026-09-30","2026-10-05","Deliver before noon","MESH||MTR","MESH","MTR",100,12],
    ]);
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,"Purchase Orders");
    const bytes=XLSX.write(workbook,{type:"array",bookType:"xlsx"});
    const file=new File([bytes],"po-upload.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    await user.upload(screen.getByLabelText("Upload purchase order Excel"),file);
    expect(await screen.findByText(/1 PO group · 1 material line/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Create 1 purchase order"}));
    await waitFor(()=>expect(mocks.createBulk).toHaveBeenCalledTimes(1));
    expect(mocks.createBulk.mock.calls[0][0][0]).toMatchObject({supplier:"ABC Materials",
      po_date:"2026-09-30",additional_information:"Deliver before noon",
      lines:[{material_key:"MESH||MTR",ordered_qty:100,rate:12}]});
  });

  it("records a partial receipt and updates stock through the same action",async()=>{
    mocks.list.mockResolvedValue([order]);const changed=vi.fn();const user=userEvent.setup();
    render(<PurchaseOrders materials={[material]} onStockChanged={changed}/>);
    await user.click(await screen.findByRole("button",{name:"PO register"}));
    await user.click(await screen.findByRole("button",{name:"Receive"}));
    await user.type(screen.getByLabelText("MESH received quantity"),"40");
    await user.type(screen.getByLabelText("Receipt note"),"GRN 9");
    await user.click(screen.getByRole("button",{name:"Save receipt & update stock"}));
    await waitFor(()=>expect(mocks.receive).toHaveBeenCalledWith("PO-2026-000001",expect.any(String),
      [{material_key:"MESH||MTR",quantity:40}],"GRN 9"));
    expect(changed).toHaveBeenCalled();
  });
});
