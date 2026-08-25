import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  expect(screen.getByText("Articles read from this file: CUSTOM")).toBeInTheDocument();
  const save=screen.getByRole("button",{name:"Validate and save all"});
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  expect(save).toBeEnabled();
  await userEvent.click(save);
  await waitFor(()=>expect(apiMocks.uploadBom).toHaveBeenCalledWith(expect.objectContaining({confirm_replace:true})));
  expect(onChanged).toHaveBeenCalled();
});

it("downloads the supported template and discards a master preview without saving",async()=>{
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["Article Code","Sole Type","Size Range","Stage","Material","UOM","Rate per Pair"],
    ["NEW","EVA","1X2","CUTTING","Mesh","MTR",0.5],
  ]),"BOM");
  const bytes=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  const file=new File([bytes],"new.xlsx");Object.defineProperty(file,"arrayBuffer",{value:async()=>bytes});
  const {container}=render(<DataTab/>);
  expect(screen.getByRole("link",{name:"Download upload template"})).toHaveAttribute("href","/Factory_OS_Reference_Upload_Template.xlsx");
  fireEvent.change(container.querySelectorAll('input[type="file"]')[0],{target:{files:[file]}});
  expect(await screen.findByText("Articles read from this file: NEW")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"Discard"}));
  expect(screen.queryByText("Articles read from this file: NEW")).not.toBeInTheDocument();
  expect(apiMocks.uploadBom).not.toHaveBeenCalled();
});

it("reports duplicate catalogue rows before any database request",async()=>{
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["Article Code","Sole Type","Size Range","Stage","Material","UOM","Rate per Pair"],
    ["NEW","EVA","1X2","CUTTING","Mesh","MTR",0.5],
  ]),"BOM");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["Article Code","Description","Default Price","Sole Type"],
    ["NEW","First",500,"EVA"],["NEW","Second",600,"EVA"],
  ]),"Catalogue");
  const bytes=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  const file=new File([bytes],"duplicate.xlsx");Object.defineProperty(file,"arrayBuffer",{value:async()=>bytes});
  const {container}=render(<DataTab/>);
  fireEvent.change(container.querySelectorAll('input[type="file"]')[0],{target:{files:[file]}});
  expect(await screen.findByText(/duplicate Catalogue row for NEW.*add Size Range/)).toBeInTheDocument();
  expect(apiMocks.uploadBom).not.toHaveBeenCalled();
});

it("loads and can discard the legacy one-article BOM format",async()=>{
  apiMocks.uploadBom.mockResolvedValueOnce({article:"NEW",replaced:false,combos:1,rates:2,new_materials:[],articles_total:2,materials_total:2});
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["ARTICLE","NEW"],["SIZE RANGE","1X2"],[1,"Upper","Mesh","MTR",null,null,0.5],
  ]),"BOM");
  const bytes=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  const file=new File([bytes],"legacy.xlsx");Object.defineProperty(file,"arrayBuffer",{value:async()=>bytes});
  const {container}=render(<DataTab/>);const input=container.querySelectorAll('input[type="file"]')[1];
  fireEvent.change(input,{target:{files:[file]}});
  expect(await screen.findByRole("button",{name:"Load NEW into reference data"})).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"Discard"}));
  expect(screen.queryByRole("button",{name:"Load NEW into reference data"})).not.toBeInTheDocument();
  fireEvent.change(input,{target:{files:[file]}});
  await userEvent.click(await screen.findByRole("button",{name:"Load NEW into reference data"}));
  await waitFor(()=>expect(apiMocks.uploadBom).toHaveBeenCalledWith(expect.objectContaining({parsed:expect.objectContaining({article:"NEW"})})));
});

it("saves MRP and stock buttons with their exact API formats",async()=>{
  apiMocks.patchReference.mockResolvedValue({ok:true});
  const {container}=render(<DataTab/>);
  const mrpSection=screen.getByText("MRP by size range").parentElement;
  fireEvent.change(mrpSection.querySelector('input[type="number"]'),{target:{value:"650"}});
  await userEvent.click(within(mrpSection).getByRole("button",{name:"Save MRP"}));
  await waitFor(()=>expect(apiMocks.patchReference).toHaveBeenCalledWith({mrp:{CUSTOM:{"1X2":650}}}));
  const stockSection=screen.getByText("Stock still to fill (1)").parentElement;
  fireEvent.change(stockSection.querySelector('input[type="number"]'),{target:{value:"75"}});
  await userEvent.click(within(stockSection).getByRole("button",{name:"Save stock figures"}));
  await waitFor(()=>expect(apiMocks.patchReference).toHaveBeenCalledWith({stock:{"OLD||MTR":75}}));
});

it("requires a second click before restoring a reference revision",async()=>{
  apiMocks.referenceHistory.mockResolvedValueOnce([{revision_id:7,change_type:"master-upload",article_code:null,created_at:"2026-08-24T10:00:00Z"}]);
  apiMocks.restoreReference.mockResolvedValueOnce({undid:"master-upload",article_code:null,articles_total:1,materials_total:1});
  render(<DataTab/>);
  await userEvent.click(await screen.findByRole("button",{name:"Restore this point"}));
  expect(screen.getByText(/Anything saved since then is undone/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"Cancel"}));
  expect(screen.queryByText(/Anything saved since then is undone/)).not.toBeInTheDocument();
  expect(apiMocks.restoreReference).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button",{name:"Restore this point"}));
  await userEvent.click(screen.getByRole("button",{name:"Restore"}));
  await waitFor(()=>expect(apiMocks.restoreReference).toHaveBeenCalledWith(7));
});
