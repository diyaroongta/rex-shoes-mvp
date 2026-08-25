import { articleCode, comboCode, existingArticleCode, normaliseMaterial } from "./bom-import.js";
import { comboSizes } from "./pi.js";

export const BOM_HEADERS=["Article Code","Sole Type","Size Range","Stage","Component","Material","UOM","Rate per Pair"];
export const PACKING_HEADERS=["Article Code","Size Range","Pairs per Carton"];
export const CATALOGUE_HEADERS=["Article Code","Size Range","Description","MRP per Pair","Sole Type","PVC Machine","Photo File Name"];

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

export function parseReferenceWorkbook(sheets,reference={}){
  const errors=[],warnings=[];
  const boms={},packing={},packingSingles={},catalogue={},mrp={},catalogueMode={};
  const bomSheet=sheet(sheets,"BOM"), packingSheet=sheet(sheets,"Packing"), catalogueSheet=sheet(sheets,"Catalogue");
  if(!bomSheet&&!packingSheet&&!catalogueSheet)
    return {errors:["Workbook must contain a BOM, Packing or Catalogue sheet."],warnings,boms:[],packing,packingSingles,catalogue,mrp};

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
    const rawArticle=articleCode(r.get("Article Code"));
    const article=boms[rawArticle]?rawArticle:(existingArticleCode(reference.articles,rawArticle)||rawArticle);
    const combo=comboCode(r.get("Size Range"));
    const ppc=Math.round(Number(r.get("Pairs per Carton")));
    const prefix=`Packing row ${r.row}`;
    if(!article||!combo||!Number.isFinite(ppc)||ppc<1){errors.push(`${prefix}: Article Code, Size Range and pairs/carton of 1 or more are required.`);continue;}
    const definition=boms[article]||reference.articles?.[article];
    const combos=definition?(definition.combo_order||Object.keys(definition.combos||{})):[];
    if(combos.length&&!combos.includes(combo)){
      const allowedSingles=new Set(combos.flatMap(c=>comboSizes(c)).map(s=>String(s).toUpperCase().replace(/S$/,"")));
      const single=String(combo).toUpperCase().replace(/S$/,"");
      if(/^\d+(?:\.5)?$/.test(single)&&allowedSingles.has(single)){
        packingSingles[article]=packingSingles[article]||{};
        if(packingSingles[article][single]!=null){errors.push(`${prefix}: duplicate single-size packing rule for ${article} size ${single}.`);continue;}
        packingSingles[article][single]=ppc;
        continue;
      }
      errors.push(`${prefix}: ${combo} is neither a BOM size range nor an individual size inside ${article}'s ranges.`);continue;
    }
    packing[article]=packing[article]||{};
    if(packing[article][combo]!=null){errors.push(`${prefix}: duplicate packing rule for ${article} ${combo}.`);continue;}
    packing[article][combo]=ppc;
  }

  for(const r of rowObjects(catalogueSheet?.rows||[],["Article Code"])){
    const rawArticle=articleCode(r.get("Article Code"));
    const article=boms[rawArticle]?rawArticle:(existingArticleCode(reference.articles,rawArticle)||rawArticle);
    const combo=comboCode(r.get("Size Range"));
    const mrpRaw=r.get("MRP per Pair"), defaultRaw=r.get("Default Price");
    const priceRaw=mrpRaw!=null&&text(mrpRaw)!==""?mrpRaw:defaultRaw;
    const price=priceRaw==null||text(priceRaw)===""?null:Number(priceRaw);
    const sole=text(r.get("Sole Type")).toUpperCase();
    const machine=text(r.get("PVC Machine")).toUpperCase();
    const prefix=`Catalogue row ${r.row}`;
    if(!article){errors.push(`${prefix}: Article Code is required.`);continue;}
    if(price!=null&&(!Number.isFinite(price)||price<0)){errors.push(`${prefix}: Default Price must be 0 or more.`);continue;}
    if(sole&&!SOLES.has(sole)){errors.push(`${prefix}: Sole Type must be EVA, PVC, PU or STUCK-ON.`);continue;}
    if(machine&&!['ROTARY','VERTICAL'].includes(machine)){errors.push(`${prefix}: PVC Machine must be ROTARY or VERTICAL.`);continue;}
    if(machine&&sole&&sole!=="PVC"){errors.push(`${prefix}: PVC Machine can only be set for a PVC article.`);continue;}
    const definition=boms[article]||reference.articles?.[article];
    if(!definition){
      const base=article.replace(/\s+\d+$/,""), baseExists=base!==article&&(boms[base]||existingArticleCode(reference.articles,base));
      errors.push(baseExists
        ? `${prefix}: ${article} has no BOM. If this is another price for ${base}, keep Article Code ${base} and put its range in the Size Range column.`
        : `${prefix}: ${article} has no BOM. Add its BOM first.`);
      continue;
    }
    const ranges=definition.combo_order||Object.keys(definition.combos||{});
    if(combo&&!ranges.includes(combo)){errors.push(`${prefix}: Size Range ${combo} is not in ${article}'s BOM (${ranges.join(", ")}).`);continue;}
    const mode=combo?"range":"default";
    if(catalogueMode[article]&&catalogueMode[article]!==mode){errors.push(`${prefix}: do not mix a default-price row with size-range price rows for ${article}.`);continue;}
    if(mode==="default"&&catalogue[article]){
      errors.push(`${prefix}: duplicate Catalogue row for ${article}. Use one row per article, or add Size Range and use one row per range.`);continue;
    }
    if(combo){
      if(price==null){errors.push(`${prefix}: MRP per Pair is required when Size Range is filled.`);continue;}
      mrp[article]=mrp[article]||{};
      if(mrp[article][combo]!=null){errors.push(`${prefix}: duplicate Catalogue price for ${article} ${combo}.`);continue;}
      mrp[article][combo]=price;
    }
    catalogueMode[article]=mode;
    const incoming={
      article_code:article,
      description:text(r.get("Description"))||null,
      price:combo?null:price,
      sole_type:sole||null,
      molding_machine:machine||null,
      photo_file_name:text(r.get("Photo File Name"))||null,
    };
    const previous=catalogue[article];
    if(previous){
      for(const field of ["description","sole_type","molding_machine","photo_file_name"]){
        if(previous[field]!=null&&incoming[field]!=null&&previous[field]!==incoming[field])
          errors.push(`${prefix}: ${field.replaceAll("_"," ")} conflicts with the earlier ${article} row.`);
        else if(previous[field]==null&&incoming[field]!=null) previous[field]=incoming[field];
      }
    }else catalogue[article]=incoming;
    if(incoming.photo_file_name)
      warnings.push(`${article}: add ${incoming.photo_file_name} separately in Catalogue; browsers cannot attach a local image from an Excel cell.`);
  }

  if(!Object.keys(boms).length&&!Object.keys(packing).length&&!Object.keys(catalogue).length)
    errors.push("No data rows found. Fill at least one row in BOM, Packing or Catalogue.");

  /* A BOM upload REPLACES an article's ranges outright — it does not merge. So
     a file sent to correct one rate, containing only that one range, silently
     deletes every other range and all of its material rates. Live orders on a
     deleted range then consume machine capacity while ordering zero material.
     Work out exactly what would disappear so the caller can say so, and refuse
     rather than discover it afterwards. */
  const removals=[];
  for(const bom of Object.values(boms)){
    const existing=reference.articles?.[existingArticleCode(reference.articles,bom.article)||bom.article];
    if(!existing) continue;
    const had=existing.combo_order||Object.keys(existing.combos||{});
    const gone=had.filter(c=>!bom.combo_order.includes(c));
    if(!gone.length) continue;
    removals.push({
      article:bom.article,
      ranges:gone,
      rates:gone.reduce((n,c)=>n+Object.values((existing.combos||{})[c]?.rates||{})
        .reduce((m,st)=>m+Object.keys(st).length,0),0),
    });
  }

  return {errors,warnings,boms:Object.values(boms),packing,packingSingles,catalogue,mrp,removals};
}
