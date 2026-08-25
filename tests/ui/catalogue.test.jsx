import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMocks=vi.hoisted(()=>({getCatalogue:vi.fn(),putCatalogue:vi.fn(),patchReference:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>apiMocks);
vi.mock("../../src/lib/refdata.js",()=>({
  REF:{articles:{CUSTOM:{sole_type:"EVA",combo_order:["1X2"],combos:{"1X2":{}}}},mrp:{}},
  reload:vi.fn(async()=>{}),
}));
vi.mock("../../shared/catalogue-seed.js",()=>({articlePhoto:()=>null}));

import CatalogueTab from "../../src/CatalogueTab.jsx";

beforeEach(()=>{
  vi.clearAllMocks();
  apiMocks.getCatalogue.mockResolvedValue({});
  apiMocks.putCatalogue.mockResolvedValue({article_code:"THUNDER 27",created_without_bom:true,missing_bom:true});
});

it("adds a catalogue-only article, warns about its missing BOM and opens the master upload",async()=>{
  const onChanged=vi.fn(),onAddBom=vi.fn();
  render(<CatalogueTab onChanged={onChanged} onAddBom={onAddBom}/>);
  await userEvent.click(screen.getByRole("button",{name:"Add new catalogue item"}));
  await userEvent.type(screen.getByLabelText("Article code or name"),"Thunder 27");
  await userEvent.type(screen.getByLabelText("Description"),"New model");
  await userEvent.type(screen.getByLabelText("Optional default price"),"799");
  await userEvent.selectOptions(screen.getAllByLabelText("Sole process")[0],"PVC");
  await userEvent.click(screen.getByRole("button",{name:"Add to catalogue"}));

  await waitFor(()=>expect(apiMocks.putCatalogue).toHaveBeenCalledWith({
    article_code:"Thunder 27",description:"New model",price:"799",sole_type:"PVC",create_catalogue_only:true,
  }));
  expect(await screen.findByText(/THUNDER 27 has catalogue details but no BOM/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"Add its BOM now"}));
  expect(onAddBom).toHaveBeenCalledWith("THUNDER 27");
  expect(onChanged).toHaveBeenCalled();
});
