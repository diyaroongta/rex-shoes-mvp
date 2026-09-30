import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("../../src/lib/client.js",()=>({ createOrders:vi.fn() }));
import BulkOrderTab from "../../src/BulkOrderTab.jsx";

/* THE DOWNLOADABLE TEMPLATE, UPLOADED AS-IS. Two faults on one screen:
   the Order Book layout reports its warnings as whole sentences, which the
   screen printed as an empty "Row :", and one order read "1 orders". */
it("shows an Order Book warning as its sentence, and counts in the singular", async () => {
  const headers=["PI NO","ORDER DATE","CUSTOMER NAME","CITY","ARTICLE NAME","COLOUR","SOLE COLOUR","CLOSURE (LACE/VELCRO)","DISPATCH TIMELINE","SOLE","CURRENT STATUS 2.0","PRINT",
    "5s","6s","7s","8s","9s","10s","11s","12s","13s","1","2","3","4","5","6","7","8","9","10","11","12","TOTAL"];
  const row=["PI/T-1","2026-09-30","Test buyer","Delhi","ARMOUR (LACE)","Black","Black","Lace","30 days","","","No",
    0,0,0,0,0,0,0,0,0,0,250,250,250,250,0,0,0,0,0,0,0,1000];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,row]),"Orders");
  const file=new File([XLSX.write(wb,{type:"array",bookType:"xlsx"})],"orders.xlsx");
  file.arrayBuffer ??= async()=>XLSX.write(wb,{type:"array",bookType:"xlsx"});

  const { container } = render(<BulkOrderTab />);
  const input=container.querySelector('input[type="file"]');
  Object.defineProperty(input,"files",{value:[file]});
  input.dispatchEvent(new Event("change",{bubbles:true}));

  expect(await screen.findByText(/1 order · 1,000 pairs · 1 row read/)).toBeInTheDocument();
  expect(screen.getByText(/inferred 2, 3, 4, 5 from the ascending/)).toBeInTheDocument();
  expect(screen.queryByText(/^Row\s*:/)).toBeNull();
  expect(screen.getByRole("button",{name:"Import 1 order"})).toBeInTheDocument();
});
