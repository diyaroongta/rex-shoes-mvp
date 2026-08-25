import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source="/Users/diyaroongta/Downloads/Factory_OS_Reference_Upload_Template_MERGED (1).xlsx";
const output="/Users/diyaroongta/Downloads/factory-os/outputs/thunder-upload-fix/Factory_OS_THUNDER_Corrected_Upload.xlsx";
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(source));

const start=wb.worksheets.getItem("START HERE");
start.getRange("C7").values=[["One row per BOM size range or individual size: how many pairs fit in its carton."]];
start.getRange("C8").values=[["One row per article and size range: MRP, description and machine. Repeat the exact Article Code for every range."]];
start.getRange("C28").values=[["The upload tabs contain only your data. Examples must stay outside BOM, Packing and Catalogue."]];

const bom=wb.worksheets.getItem("BOM");
bom.getRange("A2").values=[["One row per material, per size range, per stage. Rates are quantities consumed by one pair."]];
bom.getRange("G5:G56").format.numberFormat="0.000000";
bom.getRange("G5:G56").format.horizontalAlignment="right";

const packing=wb.worksheets.getItem("Packing");
packing.getRange("A2").values=[["Rows may be BOM size ranges (7X10) or individual sizes (7, 8, 9). Whole numbers only."]];

const catalogue=wb.worksheets.getItem("Catalogue");
try{catalogue.unmergeCells("A1:E1");}catch(_){ }
try{catalogue.unmergeCells("A2:E2");}catch(_){ }
catalogue.mergeCells("A1:G1");
catalogue.mergeCells("A2:G2");
catalogue.getRange("A1").values=[["Catalogue — MRP by size range"]];
catalogue.getRange("A2").values=[["Repeat THUNDER exactly. Put 7X10 and 11X1 in Size Range; do not create THUNDER 1."]];
catalogue.getRange("A4:G6").clear({applyTo:"all"});
catalogue.getRange("A4:G6").values=[
  ["Article Code","Size Range","Description","MRP per Pair","Sole Type","PVC Machine","Photo File Name"],
  ["THUNDER","7X10",null,899,"EVA",null,null],
  ["THUNDER","11X1",null,949,"EVA",null,null],
];
catalogue.getRange("A4:G4").format={
  fill:"#0F2233",font:{bold:true,color:"#FFFFFF",size:11},
  verticalAlignment:"center",horizontalAlignment:"center",wrapText:true,
  borders:{preset:"all",style:"thin",color:"#E4E9F0"},
};
catalogue.getRange("A5:G6").format={
  font:{color:"#0F2233",size:11},verticalAlignment:"center",
  borders:{preset:"all",style:"thin",color:"#E4E9F0"},
};
catalogue.getRange("D5:D6").format.numberFormat='"₹"#,##0';
catalogue.getRange("E5:E6").dataValidation={rule:{type:"list",values:["EVA","PVC","PU","STUCK-ON"]}};
catalogue.getRange("F5:F6").dataValidation={rule:{type:"list",values:["","ROTARY","VERTICAL"]}};
catalogue.getRange("A1:A6").format.columnWidth=24;
catalogue.getRange("B1:B6").format.columnWidth=16;
catalogue.getRange("C1:C6").format.columnWidth=34;
catalogue.getRange("D1:D6").format.columnWidth=17;
catalogue.getRange("E1:G6").format.columnWidth=18;

const exported=await SpreadsheetFile.exportXlsx(wb);
await exported.save(output);

for(const [sheetName,range] of [["START HERE","A1:C29"],["BOM","A1:G56"],["Packing","A1:C14"],["Catalogue","A1:G6"],["Already loaded","A1:E20"]]){
  const image=await wb.render({sheetName,range,scale:1,format:"png"});
  await fs.writeFile(`/Users/diyaroongta/Downloads/factory-os/outputs/thunder-upload-fix/${sheetName.replaceAll(" ","_")}.png`,new Uint8Array(await image.arrayBuffer()));
}
console.log((await wb.inspect({kind:"sheet,region",maxChars:12000,tableMaxRows:60,tableMaxCols:8})).ndjson);
console.log((await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},summary:"formula error scan"})).ndjson);
console.log(output);
