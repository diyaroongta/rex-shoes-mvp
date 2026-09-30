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
  it("generates a PO from a shortfall and keeps Additional information",async()=>{
    const user=userEvent.setup();render(<PurchaseOrders materials={[material]}/>);
    await user.click(await screen.findByRole("button",{name:"Manual backup"}));
    await user.type(screen.getByLabelText("Supplier"),"ABC Materials");
    await user.type(screen.getByLabelText("Additional information"),"Deliver before noon");
    await user.click(screen.getByLabelText("Add MESH to PO"));
    await user.click(screen.getByRole("button",{name:"Generate purchase order"}));
    await waitFor(()=>expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({supplier:"ABC Materials",
      additional_information:"Deliver before noon",
      lines:[{material_key:"MESH||MTR",ordered_qty:100,rate:12}]});
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
