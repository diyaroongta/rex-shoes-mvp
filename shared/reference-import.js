import { articleCode, comboCode, normaliseMaterial } from "./bom-import.js";

export const BOM_HEADERS=["Article Code","Sole Type","Size Range","Stage","Component","Material","UOM","Rate per Pair"];
export const PACKING_HEADERS=["Article Code","Size Range","Pairs per Carton"];
export const CATALOGUE_HEADERS=["Article Code","Description","Default Price","Sole Type","PVC Machine","Photo File Name"];

const SOLES=new Set(["EVA","PVC","PU","STUCK-ON"]);
const STAGES=new Set(["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","ASSEMBLY","PACKING","DISPATCH"]);
const key=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
const text=v=>String(v==null?"":v).trim();

/* Find the header row rather than assuming it is the first one. A workbook
   people fill in by hand routinely carries a title and a note above the table,
   and a parser that only reads row 1 rejects the whole file for it — with a
   row-number error that points at the title, which tells the user nothing. */
function headerRowIndex(rows,required){
  const want=(required||[]).map(key);
  for(let i=0;i<Math.min((rows||[]).length,25);i++){
    const map=((rows[i]||[]).map(key));
    if(want.every(w=>map.includes(w))) return i;
  }
  return 0;
}

function rowObjects(rows,required){
  const at=headerRowIndex(rows,required);
  const header=(rows||[])[at]||[];
  const map=header.map(key);
  return (rows||[]).slice(at+1).map((row,index)=>({
    row:at+index+2,                       // 1-based, as Excel shows it
    get:name=>row[map.indexOf(key(name))],
    empty:row.every(v=>v==null||text(v)===""),
  })).filter(r=>!r.empty);
}

function sheet(sheets,name){
  const wanted=key(name);
  return (sheets||[]).find(s=>key(s.name||s.sheetName)===wanted);
}

export function parseReferenceWorkbook(sheets){
  const errors=[],warnings=[];
  const boms={},packing={},catalogue={};
  const bomSheet=sheet(sheets,"BOM"), packingSheet=sheet(sheets,"Packing"), catalogueSheet=sheet(sheets,"Catalogue");
  if(!bomSheet&&!packingSheet&&!catalogueSheet)
    return {errors:["Workbook must contain a BOM, Packing or Catalogue sheet."],warnings,boms:[],packing,catalogue};

  const seen=new Set();
  for(const r of rowObjects(bomSheet?.rows||[],["Article Code","Size Range","Stage","Material"])){
    const article=articleCode(r.get("Article Code"));
    const sole=text(r.get("Sole Type")).toUpperCase();
    const combo=comboCode(r.get("Size Range"));
    const stage=text(r.get("Stage")).toUpperCase().replace(/\s+/g,"_");
    const component=text(r.get("Component"));
    const material=normaliseMaterial(r.get("Material")||component);
    const uom=text(r.get("UOM")).toUpperCase();
    const rate=Number(r.get("Rate per Pair"));
    const prefix=`BOM row ${r.row}`;
    if(!article||!sole||!combo||!stage||!material||!uom||!Number.isFinite(rate)||rate<=0){
      errors.push(`${prefix}: complete every required field and use a rate greater than 0.`);continue;
    }
    if(!SOLES.has(sole)){errors.push(`${prefix}: Sole Type must be EVA, PVC, PU or STUCK-ON.`);continue;}
    if(!STAGES.has(stage)){errors.push(`${prefix}: unknown Stage ${stage}.`);continue;}
    const duplicate=[article,combo,stage,material,uom].join("|");
    if(seen.has(duplicate)){errors.push(`${prefix}: duplicate BOM material for ${article} ${combo} ${stage}.`);continue;}
    seen.add(duplicate);
    const bom=boms[article]||(boms[article]={article,soleType:sole,combo_order:[],combos:{},materials:{},warnings:[]});
    if(bom.soleType!==sole){errors.push(`${prefix}: ${article} has more than one Sole Type.`);continue;}
    if(!bom.combos[combo]){bom.combo_order.push(combo);bom.combos[combo]={stitching_combo:combo,rates:{}};}
    const materialKey=`${material}||${uom}`;
    bom.combos[combo].rates[stage]=bom.combos[combo].rates[stage]||{};
    bom.combos[combo].rates[stage][materialKey]=rate;
    bom.materials[materialKey]={name:material,uom};
  }

  for(const r of rowObjects(packingSheet?.rows||[],PACKING_HEADERS)){
    const article=articleCode(r.get("Article Code"));
    const combo=comboCode(r.get("Size Range"));
    const ppc=Math.round(Number(r.get("Pairs per Carton")));
    const prefix=`Packing row ${r.row}`;
    if(!article||!combo||!Number.isFinite(ppc)||ppc<1){errors.push(`${prefix}: Article Code, Size Range and pairs/carton of 1 or more are required.`);continue;}
    packing[article]=packing[article]||{};
    if(packing[article][combo]!=null){errors.push(`${prefix}: duplicate packing rule for ${article} ${combo}.`);continue;}
    packing[article][combo]=ppc;
  }

  for(const r of rowObjects(catalogueSheet?.rows||[],["Article Code"])){
    const article=articleCode(r.get("Article Code"));
    const priceRaw=r.get("Default Price"), price=priceRaw==null||text(priceRaw)===""?null:Number(priceRaw);
    const sole=text(r.get("Sole Type")).toUpperCase();
    const machine=text(r.get("PVC Machine")).toUpperCase();
    const prefix=`Catalogue row ${r.row}`;
    if(!article){errors.push(`${prefix}: Article Code is required.`);continue;}
    if(price!=null&&(!Number.isFinite(price)||price<0)){errors.push(`${prefix}: Default Price must be 0 or more.`);continue;}
    if(sole&&!SOLES.has(sole)){errors.push(`${prefix}: Sole Type must be EVA, PVC, PU or STUCK-ON.`);continue;}
    if(machine&&!['ROTARY','VERTICAL'].includes(machine)){errors.push(`${prefix}: PVC Machine must be ROTARY or VERTICAL.`);continue;}
    if(machine&&sole&&sole!=="PVC"){errors.push(`${prefix}: PVC Machine can only be set for a PVC article.`);continue;}
    if(catalogue[article]){errors.push(`${prefix}: duplicate Catalogue row for ${article}.`);continue;}
    catalogue[article]={
      article_code:article,
      description:text(r.get("Description"))||null,
      price,
      sole_type:sole||null,
      molding_machine:machine||null,
      photo_file_name:text(r.get("Photo File Name"))||null,
    };
    if(catalogue[article].photo_file_name)
      warnings.push(`${article}: add ${catalogue[article].photo_file_name} separately in Catalogue; browsers cannot attach a local image from an Excel cell.`);
  }

  if(!Object.keys(boms).length&&!Object.keys(packing).length&&!Object.keys(catalogue).length)
    errors.push("No data rows found. Fill at least one row in BOM, Packing or Catalogue.");

  return {errors,warnings,boms:Object.values(boms),packing,catalogue};
}
