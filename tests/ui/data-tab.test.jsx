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

it("shows before-versus-after and blocks complete replacement until confirmed",async()=>{
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
  expect(await screen.findByText("Review changes before saving")).toBeInTheDocument();
  expect(screen.getByText("Will update")).toBeInTheDocument();
  expect(screen.getByText(/No database rows will be deleted/)).toBeInTheDocument();
  await userEvent.click(screen.getByText("Review details"));
  expect(screen.getByText("Current BOM")).toBeInTheDocument();
  expect(screen.getByText("Uploaded BOM")).toBeInTheDocument();
  expect(screen.getByText("Result after save")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Save 1 article"})).toBeEnabled();
  await userEvent.click(screen.getByText("Advanced: replace a complete existing BOM"));
  await userEvent.click(screen.getByRole("radio",{name:/Replace the complete BOM/}));
  const save=screen.getByRole("button",{name:"Replace CUSTOM BOM and save"});
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox",{name:/I approve replacing the complete BOM/}));
  expect(save).toBeEnabled();
  await userEvent.click(save);
  await waitFor(()=>expect(apiMocks.uploadBom).toHaveBeenCalledWith(expect.objectContaining({
    bom_mode:"replace",confirm_replace:true,
  })));
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
  fireEvent.change(container.querySelector('input[type="file"]'),{target:{files:[file]}});
  expect(await screen.findByText("Will add")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"Cancel"}));
  expect(screen.queryByText("Will add")).not.toBeInTheDocument();
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
  fireEvent.change(container.querySelector('input[type="file"]'),{target:{files:[file]}});
  expect(await screen.findByText(/Catalogue row 3: description conflicts with the earlier NEW row/)).toBeInTheDocument();
  expect(apiMocks.uploadBom).not.toHaveBeenCalled();
});

it("uses one uploader and explains that legacy marker workbooks are not the article master",async()=>{
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["ARTICLE","NEW"],["SIZE RANGE","1X2"],[1,"Upper","Mesh","MTR",null,null,0.5],
  ]),"BOM");
  const bytes=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  const file=new File([bytes],"legacy.xlsx");Object.defineProperty(file,"arrayBuffer",{value:async()=>bytes});
  const {container}=render(<DataTab/>);
  expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
  fireEvent.change(container.querySelector('input[type="file"]'),{target:{files:[file]}});
  expect(await screen.findByText(/No data rows found/)).toBeInTheDocument();
  expect(screen.queryByText(/No ARTICLE row found/)).not.toBeInTheDocument();
  expect(apiMocks.uploadBom).not.toHaveBeenCalled();
});

it("previews a standard article master through the single upload control",async()=>{
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["Article Code","Sole Type","Size Range","Stage","Material","UOM","Rate per Pair"],
    ["THUNDER","EVA","1X2","CUTTING","Mesh","MTR",0.5],
  ]),"BOM Master");
  const bytes=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  const file=new File([bytes],"article-master.xlsx");Object.defineProperty(file,"arrayBuffer",{value:async()=>bytes});
  const {container}=render(<DataTab/>);
  fireEvent.change(container.querySelector('input[type="file"]'),{target:{files:[file]}});
  expect(await screen.findByText("THUNDER")).toBeInTheDocument();
  expect(screen.queryByText(/No ARTICLE row found/)).not.toBeInTheDocument();
});

it("allows optional MRP edits in the preview and has no stock editor",async()=>{
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["Article Code","Sole Type","Size Range","Stage","Material","UOM","Rate per Pair"],
    ["NEW","EVA","1X2","CUTTING","Mesh","MTR",0.5],
  ]),"BOM");
  const bytes=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  const file=new File([bytes],"new.xlsx");Object.defineProperty(file,"arrayBuffer",{value:async()=>bytes});
  const {container}=render(<DataTab/>);
  fireEvent.change(container.querySelector('input[type="file"]'),{target:{files:[file]}});
  const mrp=await screen.findByLabelText("1X2");
  fireEvent.change(mrp,{target:{value:"650"}});
  await userEvent.click(screen.getByRole("button",{name:"Save 1 article"}));
  await waitFor(()=>expect(apiMocks.uploadBom).toHaveBeenCalledWith(expect.objectContaining({
    batch:expect.objectContaining({mrp:{NEW:{"1X2":650}}}),bom_mode:"merge",
  })));
  expect(screen.queryByText(/Stock still to fill/)).not.toBeInTheDocument();
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
