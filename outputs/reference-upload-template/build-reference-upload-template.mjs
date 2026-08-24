import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir="/Users/diyaroongta/Downloads/factory-os/outputs/reference-upload-template";
const outputPath=`${outputDir}/Factory_OS_Reference_Upload_Template.xlsx`;
const publicPath="/Users/diyaroongta/Downloads/factory-os/public/Factory_OS_Reference_Upload_Template.xlsx";

const wb=Workbook.create();
const instructions=wb.worksheets.add("Instructions");
const bom=wb.worksheets.add("BOM");
const packing=wb.worksheets.add("Packing");
const catalogue=wb.worksheets.add("Catalogue");
const example=wb.worksheets.add("Example");

const headerStyle={fill:"#E5E7EB",font:{bold:true,color:"#111827",size:10},verticalAlignment:"center",
  borders:{bottom:{style:"medium",color:"#9CA3AF"}}};
const bodyStyle={font:{color:"#1F2937",size:10},verticalAlignment:"center",
  borders:{bottom:{style:"thin",color:"#E5E7EB"}}};

instructions.showGridLines=false;
instructions.getRange("A1:B1").merge();
instructions.getRange("A1").values=[["Factory OS · Reference Upload Template"]];
instructions.getRange("A1:B1").format={fill:"#374151",font:{bold:true,color:"#FFFFFF",size:14},rowHeight:30,verticalAlignment:"center"};
instructions.getRange("A3:B10").values=[
  ["Step","What to do"],
  [1,"Fill only the BOM, Packing and Catalogue tabs. Keep the column names unchanged."],
  [2,"For a new article, enter its BOM first. Use the exact same Article Code on all three tabs."],
  [3,"Each BOM row is one material rate for one article, size range and production stage."],
  [4,"Each Packing row is one size range and its pairs per carton."],
  [5,"Catalogue photos are uploaded separately in Factory OS → Catalogue. Photo File Name is only a reminder."],
  [6,"In Factory OS open Data & BOM → Upload the Factory OS article master → preview → confirm replacements → save."],
  [7,"If an article already exists, the app asks for explicit confirmation before replacing its complete BOM."],
];
instructions.getRange("A3:B3").format=headerStyle;
instructions.getRange("A4:B10").format=bodyStyle;
instructions.getRange("A1:A10").format.columnWidth=14;
instructions.getRange("B1:B10").format.columnWidth=92;
instructions.getRange("B4:B10").format.wrapText=true;
instructions.getRange("A4:B10").format.rowHeight=30;

const bomHeaders=["Article Code","Sole Type","Size Range","Stage","Component","Material","UOM","Rate per Pair"];
bom.getRange("A1:H1").values=[bomHeaders];
bom.getRange("A1:H1").format=headerStyle;
bom.getRange("A1:H51").format.columnWidth=18;
bom.getRange("A1:A51").format.columnWidth=24;
bom.getRange("E1:F51").format.columnWidth=28;
bom.getRange("H2:H51").format.numberFormat="0.000000";
bom.getRange("B2:B51").dataValidation={rule:{type:"list",values:["EVA","PVC","PU","STUCK-ON"]}};
bom.getRange("D2:D51").dataValidation={rule:{type:"list",values:["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","ASSEMBLY","PACKING","DISPATCH"]}};
bom.getRange("G2:G51").dataValidation={rule:{type:"list",values:["PAIR","MTR","CM","KG","GRAM","PCS","SHEET","LTR"]}};
bom.freezePanes.freezeRows(1);bom.showGridLines=false;

packing.getRange("A1:C1").values=[["Article Code","Size Range","Pairs per Carton"]];
packing.getRange("A1:C1").format=headerStyle;
packing.getRange("A1:A51").format.columnWidth=28;
packing.getRange("B1:B51").format.columnWidth=20;
packing.getRange("C1:C51").format.columnWidth=22;
packing.getRange("C2:C51").format.numberFormat="0";
packing.freezePanes.freezeRows(1);packing.showGridLines=false;

catalogue.getRange("A1:F1").values=[["Article Code","Description","Default Price","Sole Type","PVC Machine","Photo File Name"]];
catalogue.getRange("A1:F1").format=headerStyle;
catalogue.getRange("A1:A51").format.columnWidth=26;
catalogue.getRange("B1:B51").format.columnWidth=44;
catalogue.getRange("C1:C51").format.columnWidth=18;
catalogue.getRange("D1:F51").format.columnWidth=20;
catalogue.getRange("C2:C51").format.numberFormat="#,##0";
catalogue.getRange("D2:D51").dataValidation={rule:{type:"list",values:["EVA","PVC","PU","STUCK-ON"]}};
catalogue.getRange("E2:E51").dataValidation={rule:{type:"list",values:["","ROTARY","VERTICAL"]}};
catalogue.freezePanes.freezeRows(1);catalogue.showGridLines=false;

example.showGridLines=false;
example.getRange("A1:H1").merge();
example.getRange("A1").values=[["Example only · copy the pattern into the three upload tabs"]];
example.getRange("A1:H1").format={fill:"#F3F4F6",font:{bold:true,color:"#374151",size:11},rowHeight:26};
example.getRange("A3:H6").values=[
  bomHeaders,
  ["GLAMOUR","EVA","6X8","CUTTING","Upper","Mesh 58\"","MTR",0.42],
  ["GLAMOUR","EVA","6X8","STITCHING","Thread","Thread","MTR",1.2],
  ["GLAMOUR","EVA","9X12","PACKING","Inner Box","Inner Box","PCS",1],
];
example.getRange("A3:H3").format=headerStyle;
example.getRange("A4:H6").format=bodyStyle;
example.getRange("A8:C10").values=[
  ["Article Code","Size Range","Pairs per Carton"],
  ["GLAMOUR","6X8",24],
  ["GLAMOUR","9X12",18],
];
example.getRange("A8:C8").format=headerStyle;
example.getRange("A9:C10").format=bodyStyle;
example.getRange("A12:F13").values=[
  ["Article Code","Description","Default Price","Sole Type","PVC Machine","Photo File Name"],
  ["GLAMOUR","School shoe",625,"EVA","","glamour.jpg"],
];
example.getRange("A12:F12").format=headerStyle;
example.getRange("A13:F13").format=bodyStyle;
example.getRange("A1:A13").format.columnWidth=24;
example.getRange("B1:B13").format.columnWidth=24;
example.getRange("C1:H13").format.columnWidth=18;

await fs.mkdir(outputDir,{recursive:true});
await fs.mkdir("/Users/diyaroongta/Downloads/factory-os/public",{recursive:true});
const out=await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
const publicOut=await SpreadsheetFile.exportXlsx(wb);
await publicOut.save(publicPath);

for(const [sheetName,range] of [["Instructions","A1:B10"],["BOM","A1:H12"],["Packing","A1:C12"],["Catalogue","A1:F12"],["Example","A1:H13"]]){
  const image=await wb.render({sheetName,range,scale:1.1,format:"png"});
  await fs.writeFile(`${outputDir}/${sheetName}.png`,new Uint8Array(await image.arrayBuffer()));
}
const check=await wb.inspect({kind:"sheet,region",maxChars:5000,tableMaxRows:8,tableMaxCols:8});
const errors=await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},summary:"formula error scan"});
console.log(check.ndjson);console.log(errors.ndjson);console.log(outputPath);
