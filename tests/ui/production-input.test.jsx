import React from "react";
import * as XLSX from "xlsx";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({ importRows:vi.fn(), voidEntry:vi.fn() }));
vi.mock("../../src/lib/client.js",()=>({
  importProductionLogs:mocks.importRows,
  voidProductionLog:mocks.voidEntry,
}));

import ProductionInputTab from "../../src/ProductionInputTab.jsx";
import { REF } from "../../src/lib/refdata.js";

const localToday=()=>{
  const d=new Date(),p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
};

describe("Daily production spreadsheet upload",()=>{
  it("previews a complete sheet and imports all rows together",async()=>{
    const user=userEvent.setup();
    const changed=vi.fn().mockResolvedValue();
    mocks.importRows.mockResolvedValue({imported:1});
    const workCenter=Object.keys(REF.workcenters)[0];
    const sheet=XLSX.utils.aoa_to_sheet([
      ["Production Date","Shift","Work Centre Code","Order No","Good Pairs",
       "Rejected Pairs","Downtime Minutes","Downtime Reason","Supervisor","Remarks"],
      [localToday(),"A",workCenter,"JO2043",820,14,30,"Changeover / mould change","R. Kumar","Black compound arrived late"],
    ]);
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,"Daily production");
    const bytes=XLSX.write(book,{type:"array",bookType:"xlsx"});
    const file=new File([bytes],"daily-production.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});

    render(<ProductionInputTab
      orders={[{order_no:"JO2043",article_code:"SPIKE",party:"Alpha"}]}
      logs={[]} onChanged={changed}/>);
    await user.upload(screen.getByLabelText("Daily production spreadsheet"),file);
    expect(await screen.findByText("Check before importing")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Import 1 row"}));

    await waitFor(()=>expect(mocks.importRows).toHaveBeenCalledOnce());
    expect(mocks.importRows.mock.calls[0][0][0]).toMatchObject({
      order_no:"JO2043",article:"SPIKE",work_center:workCenter,
      good_pairs:820,rejected_pairs:14,downtime_minutes:30,
    });
    expect(changed).toHaveBeenCalledOnce();
  });
});
