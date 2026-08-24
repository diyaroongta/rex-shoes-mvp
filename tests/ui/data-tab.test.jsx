import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";

const apiMocks=vi.hoisted(()=>({uploadBom:vi.fn(),patchReference:vi.fn(),
  referenceHistory:vi.fn(),restoreReference:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>apiMocks);
vi.mock("../../src/lib/refdata.js",()=>({
  REF:{
    articles:{CUSTOM:{sole_type:"EVA",combo_order:["1X2"],combos:{"1X2":{rates:{CUTTING:{"OLD||MTR":1}}}}}},
    materials:{"OLD||MTR":{name:"OLD",uom:"MTR",stock:0}},packing:{},mrp:{},
  },
  reload:vi.fn(async()=>{}),
}));

import DataTab from "../../src/DataTab.jsx";

beforeEach(()=>{
  vi.clearAllMocks();
  apiMocks.uploadBom.mockResolvedValue({articles:["CUSTOM"],packing_articles:["CUSTOM"],catalogue_articles:["CUSTOM"]});
  apiMocks.referenceHistory.mockResolvedValue([]);
  apiMocks.restoreReference.mockResolvedValue({});
});

it("previews a master workbook and blocks an existing BOM replacement until confirmed",async()=>{
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["Article Code","Sole Type","Size Range","Stage","Component","Material","UOM","Rate per Pair"],
    [" custom ","EVA","1X2","CUTTING","Upper","Mesh","MTR",0.5],
  ]),"BOM");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["Article Code","Size Range","Pairs per Carton"],["CUSTOM","1X2",12],
  ]),"Packing");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["Article Code","Description","Default Price","Sole Type","PVC Machine","Photo File Name"],
    ["CUSTOM","Demo",500,"EVA","","custom.jpg"],
  ]),"Catalogue");
  const bytes=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  const file=new File([bytes],"master.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  Object.defineProperty(file,"arrayBuffer",{value:async()=>bytes});
  const onChanged=vi.fn();
  const {container}=render(<DataTab onChanged={onChanged}/>);
  const inputs=container.querySelectorAll('input[type="file"]');
  fireEvent.change(inputs[0],{target:{files:[file]}});
  expect(await screen.findByText("Ready to save")).toBeInTheDocument();
  const save=screen.getByRole("button",{name:"Validate and save all"});
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  expect(save).toBeEnabled();
  await userEvent.click(save);
  await waitFor(()=>expect(apiMocks.uploadBom).toHaveBeenCalledWith(expect.objectContaining({confirm_replace:true})));
  expect(onChanged).toHaveBeenCalled();
});
