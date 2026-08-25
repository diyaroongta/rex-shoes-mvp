import { articleCode, comboCode, existingArticleCode, normaliseMaterial } from "./bom-import.js";
import { comboSizesForArticleIn } from "./bridge.js";

export const BOM_HEADERS=["Article Code","Sole Type","Size Range","Stage","Component","Material","UOM","Rate per Pair"];
export const PACKING_HEADERS=["Article Code","Size Range","Pairs per Carton"];
export const CATALOGUE_HEADERS=["Article Code","Size Range","Description","MRP per Pair","Sole Type","PVC Machine","Packing Source","Photo File Name"];

const SOLES=new Set(["EVA","PVC","PU","STUCK-ON"]);
const STAGES=new Set(["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","ASSEMBLY","PACKING","DISPATCH"]);
const key=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
const text=v=>String(v==null?"":v).trim();
const HEADER_ALIASES={
  article:"articlecode",articleno:"articlecode",articlenumber:"articlecode",articlename:"articlecode",product:"articlecode",
  size:"sizerange",sizes:"sizerange",combo:"sizerange",sizerangecombo:"sizerange",
  process:"stage",operation:"stage",
  item:"material",itemdescription:"material",materialname:"material",
  unit:"uom",unitofmeasure:"uom",
  rate:"rateperpair",burn:"rateperpair",consumption:"rateperpair",consumptionperpair:"rateperpair",
  pairpercarton:"pairspercarton",pairscarton:"pairspercarton",ppc:"pairspercarton",packqty:"pairspercarton",
  mrp:"mrpperpair",price:"defaultprice",defaultpriceperpair:"defaultprice",
  pvcprocess:"pvcmachine",machine:"pvcmachine",photo:"photofilename",imagefilename:"photofilename",
  packingarticle:"packingsource",packinglistsource:"packingsource",inheritsfrom:"packingsource",
};
const headerKey=s=>HEADER_ALIASES[key(s)]||key(s);
const STAGE_ALIASES={MOULDING:"MOLDING",MOLD:"MOLDING",MOULD:"MOLDING",UPPERQC:"UPPER_QC",UPPERQUALITYCHECK:"UPPER_QC",PREP:"PREPARATION"};
const SOLE_ALIASES={STUCKON:"STUCK-ON",STUCK_ON:"STUCK-ON",STUCK:"STUCK-ON"};
const UOM_ALIASES={PC:"PCS","PCS.":"PCS",PIECE:"PCS",PIECES:"PCS",PAIR:"PAIR",PAIRS:"PAIR",
  METER:"MTR",METERS:"MTR",METRE:"MTR",METRES:"MTR",MTRS:"MTR",SHEETS:"SHEET",SPOOLS:"SPOOL",KGS:"KG"};
const cleanStage=v=>{const raw=text(v).toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_|_$/g,"");return STAGE_ALIASES[raw]||raw;};
const cleanSole=v=>{const raw=text(v).toUpperCase().replace(/\s+/g,"_");return SOLE_ALIASES[raw]||raw;};
const cleanUom=v=>{const raw=text(v).toUpperCase();return UOM_ALIASES[raw]||raw.replace(/\.$/,"");};

/* Find the header row rather than assuming it is the first one. A workbook
   people fill in by hand routinely carries a title and a note above the table,
   and a parser that only reads row 1 rejects the whole file for it — with a
   row-number error that points at the title, which tells the user nothing. */
function headerRowIndex(rows,required){
  const want=(required||[]).map(headerKey);
  for(let i=0;i<Math.min((rows||[]).length,25);i++){
    const map=((rows[i]||[]).map(headerKey));
    if(want.every(w=>map.includes(w))) return i;
  }
  return 0;
}

function rowObjects(rows,required){
  const at=headerRowIndex(rows,required);
  const header=(rows||[])[at]||[];
  const map=header.map(headerKey);
  return (rows||[]).slice(at+1).map((row,index)=>({
    row:at+index+2,                       // 1-based, as Excel shows it
    get:name=>row[map.indexOf(headerKey(name))],
    empty:row.every(v=>v==null||text(v)===""),
  })).filter(r=>!r.empty);
}

function sheet(sheets,name){
  const wanted=key(name);
  const aliases={bom:new Set(["bom","bommaster","billofmaterials","billofmaterial"]),
    packing:new Set(["packing","packinglist","packingmaster","cartonpacking"]),
    catalogue:new Set(["catalogue","catalog","articlecatalogue","articlecatalog","cataloguemaster"])};
  return (sheets||[]).find(s=>(aliases[wanted]||new Set([wanted])).has(key(s.name||s.sheetName)));
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
    const sole=cleanSole(r.get("Sole Type"));
    const combo=comboCode(r.get("Size Range"));
    const stage=cleanStage(r.get("Stage"));
    const component=text(r.get("Component"));
    const material=normaliseMaterial(r.get("Material")||component);
    const uom=cleanUom(r.get("UOM"));
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

  const workbookReference={...reference,articles:{...(reference.articles||{})}};
  for(const bom of Object.values(boms)) workbookReference.articles[bom.article]={
    ...(workbookReference.articles[bom.article]||{}),combo_order:bom.combo_order,combos:bom.combos,sole_type:bom.soleType,
  };

  for(const r of rowObjects(packingSheet?.rows||[],PACKING_HEADERS)){
    const rawArticle=articleCode(r.get("Article Code"));
    const article=boms[rawArticle]?rawArticle:(existingArticleCode(reference.articles,rawArticle)||rawArticle);
    const combo=comboCode(r.get("Size Range"));
    const ppc=Number(r.get("Pairs per Carton"));
    const prefix=`Packing row ${r.row}`;
    if(!article||!combo||!Number.isInteger(ppc)||ppc<1){errors.push(`${prefix}: Article Code, Size Range and a whole-number pairs/carton of 1 or more are required.`);continue;}
    const definition=boms[article]||reference.articles?.[article];
    const combos=definition?(definition.combo_order||Object.keys(definition.combos||{})):[];
    if(combos.length&&!combos.includes(combo)){
      const printed=combos.flatMap(c=>comboSizesForArticleIn(workbookReference,article,c)).map(s=>String(s).toUpperCase());
      const rawSingle=String(combo).toUpperCase();
      let single=printed.find(s=>s===rawSingle)||null;
      if(!single){
        const candidates=[...new Set(printed.filter(s=>s.replace(/S$/i,"")===rawSingle.replace(/S$/i,"")))];
        if(candidates.length===1) single=candidates[0];
        else if(candidates.length>1){errors.push(`${prefix}: size ${rawSingle} is ambiguous; write ${candidates.join(" or ")} exactly.`);continue;}
      }
      if(single&&/^\d+(?:\.5)?S?$/.test(single)){
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
    let article=boms[rawArticle]?rawArticle:(existingArticleCode(reference.articles,rawArticle)||rawArticle);
    let combo=comboCode(r.get("Size Range"));
    const mrpRaw=r.get("MRP per Pair"), defaultRaw=r.get("Default Price");
    const priceRaw=mrpRaw!=null&&text(mrpRaw)!==""?mrpRaw:defaultRaw;
    const price=priceRaw==null||text(priceRaw)===""?null:Number(priceRaw);
    let description=text(r.get("Description"))||null;
    // Compatibility with the first client template: it had no Size Range
    // column, so ranges were entered under Description and Excel sometimes
    // renamed a repeated code to "THUNDER 1". Only repair this when the cell
    // is an exact range in the base article's BOM; otherwise keep rejecting it.
    if(!combo&&description&&price!=null){
      const base=rawArticle.replace(/\s+\d+$/,"");
      const candidates=[article,base].filter((v,i,a)=>v&&a.indexOf(v)===i);
      for(const candidate of candidates){
        const canonical=boms[candidate]?candidate:existingArticleCode(reference.articles,candidate);
        const def=canonical&&(boms[canonical]||reference.articles?.[canonical]);
        const ranges=def&&(def.combo_order||Object.keys(def.combos||{}));
        const described=comboCode(description);
        if(ranges?.includes(described)){
          article=canonical;combo=described;description=null;
          warnings.push(`Catalogue row ${r.row}: read ${described} from the old Description column${rawArticle!==canonical?` and treated ${rawArticle} as ${canonical}`:""}.`);
          break;
        }
      }
    }
    const sole=cleanSole(r.get("Sole Type"));
    const machine=text(r.get("PVC Machine")).toUpperCase();
    const packingSource=articleCode(r.get("Packing Source"));
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
      description,
      price:combo?null:price,
      sole_type:sole||null,
      molding_machine:machine||null,
      packing_source:packingSource||null,
      photo_file_name:text(r.get("Photo File Name"))||null,
    };
    const previous=catalogue[article];
    if(previous){
      for(const field of ["description","sole_type","molding_machine","packing_source","photo_file_name"]){
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
