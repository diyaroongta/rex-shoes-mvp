import { articleCode, colouredMaterialName, comboCode, existingArticleCode,
  materialColourToken, normaliseMaterial } from "./bom-import.js";
import { comboSizesForArticleIn, resolveArticleSizeWithSequenceIn,
  createSizeSequenceState, scopedSizeKey, parseSizeToken, sizeRunOptionsForRange } from "./bridge.js";

export const BOM_HEADERS=["Article Code","Sole Type","Size Range","Stage","Component","Material","UOM","Rate per Pair"];
export const PACKING_HEADERS=["Article Code","Size Range","Pairs per Carton"];
export const CATALOGUE_HEADERS=["Article Code","Size Range","Description","MRP per Pair","Sole Type","PVC Machine","Packing Source","Photo File Name"];

const SOLES=new Set(["EVA","PVC","PU","STUCK-ON"]);
const STAGES=new Set(["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","ASSEMBLY","PACKING","DISPATCH"]);
/* "(optional)" in a heading is instruction to the person filling the sheet,
   not part of the field name — our own template writes it, so a header key
   that kept it would ask about a column we ourselves shipped. */
const key=s=>String(s||"").toLowerCase()
  .replace(/\((?:\s*optional\s*|\s*required\s*|\s*if any\s*)\)/g," ")
  .replace(/[^a-z0-9]+/g,"");
const text=v=>String(v==null?"":v).trim();
const HEADER_ALIASES={
  article:"articlecode",articleno:"articlecode",articlenumber:"articlecode",articlename:"articlecode",product:"articlecode",
  size:"sizerange",sizes:"sizerange",combo:"sizerange",sizerangecombo:"sizerange",
  sizerangeorindividualsize:"sizerange",rangeorindividualsize:"sizerange",
  sizerun:"sizerun",run:"sizerun",smalllarge:"sizerun",
  bomrange:"bomrange",appliestorange:"bomrange",sourcebomrange:"bomrange",bomrangeforindividualsize:"bomrange",
  process:"stage",operation:"stage",
  /* The factory's own sheet heads this column "Cutting componenet". Reading
     their spelling — typo included — is the difference between a file that
     uploads and one that reports a column nobody believes is missing. */
  cuttingcomponent:"component",cuttingcomponenet:"component",componenet:"component",
  cutcomponent:"component",part:"component",cutpart:"component",
  item:"material",itemdescription:"material",materialname:"material",
  unit:"uom",unitofmeasure:"uom",
  rate:"rateperpair",burn:"rateperpair",consumption:"rateperpair",consumptionperpair:"rateperpair",
  pairpercarton:"pairspercarton",pairscarton:"pairspercarton",ppc:"pairspercarton",packqty:"pairspercarton",
  mrp:"mrpperpair",price:"defaultprice",defaultpriceperpair:"defaultprice",
  pvcprocess:"pvcmachine",machine:"pvcmachine",photo:"photofilename",imagefilename:"photofilename",
  packingarticle:"packingsource",packinglistsource:"packingsource",inheritsfrom:"packingsource",
  /* Colours. The article's standard sole and upper colour are explicit
     headings; a bare "Colour" is resolved per sheet below, never silently. */
  solecolor:"solecolour",soleshade:"solecolour",colourofsole:"solecolour",colorofsole:"solecolour",
  uppercolor:"uppercolour",uppershade:"uppercolour",colourofupper:"uppercolour",colorofupper:"uppercolour",
  materialcolor:"materialcolour",materialshade:"materialcolour",itemcolour:"materialcolour",itemcolor:"materialcolour",
  componentcolour:"materialcolour",componentcolor:"materialcolour",shade:"materialcolour",
};

/* Every column each sheet understands. Anything else is NOT guessed at: it is
   reported so the person uploading says what it means before the file saves. */
export const COLUMN_LABELS={
  articlecode:"Article Code",soletype:"Sole Type",sizerange:"Size Range",sizerun:"Size Run",
  bomrange:"BOM Range",stage:"Stage",component:"Component",material:"Material",
  materialcolour:"Material Colour",uom:"UOM",rateperpair:"Rate per Pair",
  solecolour:"Sole Colour",uppercolour:"Upper Colour",pairspercarton:"Pairs per Carton",
  description:"Description",mrpperpair:"MRP per Pair",defaultprice:"Default Price",
  pvcmachine:"PVC Machine",packingsource:"Packing Source",photofilename:"Photo File Name",
};
export const COLUMN_HELP={
  materialcolour:"Colour of THIS material. A coloured material is bought separately — black and blue rexine become two lines with their own stock.",
  solecolour:"The article's standard sole colour. Prefills new orders and the PI; it does not change what is bought.",
  uppercolour:"The article's standard upper colour. Prefills new orders and the PI; it does not change what is bought.",
  component:"The part the material is used on. Only a fallback for a blank Material cell.",
  sizerun:"Small or Large, when the same numerals exist in both runs.",
  bomrange:"Which BOM size range a standalone size borrows.",
};
export const SHEET_COLUMNS={
  BOM:["articlecode","soletype","sizerange","sizerun","stage","component","material","materialcolour",
    "uom","rateperpair","solecolour","uppercolour"],
  Packing:["articlecode","sizerange","bomrange","pairspercarton"],
  Catalogue:["articlecode","sizerange","bomrange","description","mrpperpair","defaultprice","soletype",
    "pvcmachine","packingsource","photofilename","solecolour","uppercolour"],
};
/* A bare "Colour" means different things on different sheets: next to a
   material it is that material's colour; on the Catalogue it is the shoe's
   upper. Each is only a SUGGESTION — the upload asks before using it. */
const SHEET_GUESSES={
  BOM:{colour:"materialcolour",color:"materialcolour"},
  Catalogue:{colour:"uppercolour",color:"uppercolour"},
  Packing:{},
};
export const IGNORE_COLUMN="__ignore__";
export const NOTE_COLUMN="__note__";

/* A column resolver for one sheet. `chosen` holds what the user has already
   confirmed for this file, keyed "Sheet::header", and always wins. */
function resolverFor(label,chosen={}){
  const guesses=SHEET_GUESSES[label]||{};
  const known=new Set(SHEET_COLUMNS[label]||[]);
  return cell=>{
    const raw=key(cell);
    if(!raw) return "";
    const decided=chosen[`${label}::${raw}`];
    if(decided) return decided===IGNORE_COLUMN||decided===NOTE_COLUMN?`${decided}:${raw}`:decided;
    const aliased=HEADER_ALIASES[raw]||raw;
    if(known.has(aliased)) return aliased;
    if(guesses[raw]) return guesses[raw];
    return aliased;
  };
}
const headerKey=s=>HEADER_ALIASES[key(s)]||key(s);
const STAGE_ALIASES={MOULDING:"MOLDING",MOLD:"MOLDING",MOULD:"MOLDING",UPPERQC:"UPPER_QC",UPPERQUALITYCHECK:"UPPER_QC",PREP:"PREPARATION"};
const SOLE_ALIASES={STUCKON:"STUCK-ON",STUCK_ON:"STUCK-ON",STUCK:"STUCK-ON"};
const UOM_ALIASES={PC:"PCS","PCS.":"PCS",PIECE:"PCS",PIECES:"PCS",PAIR:"PAIR",PAIRS:"PAIR",
  METER:"MTR",METERS:"MTR",METRE:"MTR",METRES:"MTR",MTRS:"MTR",SHEETS:"SHEET",SPOOLS:"SPOOL",KGS:"KG"};
const cleanStage=v=>{const raw=text(v).toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_|_$/g,"");return STAGE_ALIASES[raw]||raw;};
const cleanSole=v=>{const raw=text(v).toUpperCase().replace(/\s+/g,"_");return SOLE_ALIASES[raw]||raw;};
const cleanUom=v=>{const raw=text(v).toUpperCase();return UOM_ALIASES[raw]||raw.replace(/\.$/,"");};
/* Colours are free text — the factory writes "N.Blue / S.Blue" as readily as
   "Black". Keep exactly what was typed apart from stray spacing; compare
   case-insensitively so BLACK and Black are not read as a disagreement. */
const MAX_COLOUR=60;
const cleanColour=v=>text(v).replace(/\s+/g," ").trim();
const sameColour=(a,b)=>String(a||"").toUpperCase()===String(b||"").toUpperCase();
const cleanRun=v=>{const raw=text(v).toUpperCase();if(!raw)return "";if(raw.startsWith("S"))return "SMALL";if(raw.startsWith("L")||raw.startsWith("B"))return "LARGE";return raw;};

/* Find the header row rather than assuming it is the first one. A workbook
   people fill in by hand routinely carries a title and a note above the table,
   and a parser that only reads row 1 rejects the whole file for it — with a
   row-number error that points at the title, which tells the user nothing. */
function headerRowIndex(rows,required,resolve=headerKey){
  const want=(required||[]).map(headerKey);
  for(let i=0;i<Math.min((rows||[]).length,25);i++){
    const map=((rows[i]||[]).map(resolve));
    if(want.every(w=>map.includes(w))) return i;
  }
  return 0;
}

function rowObjects(rows,required,resolve=headerKey){
  const at=headerRowIndex(rows,required,resolve);
  const header=(rows||[])[at]||[];
  const map=header.map(resolve);
  /* Columns the user chose to keep as a free-text note. They are recorded and
     shown, never used in any calculation. */
  const noteCols=map.map((k,i)=>[k,i]).filter(([k])=>String(k).startsWith(`${NOTE_COLUMN}:`))
    .map(([,i])=>({index:i,label:text(header[i])||`Column ${i+1}`}));
  return (rows||[]).slice(at+1).map((row,index)=>({
    row:at+index+2,                       // 1-based, as Excel shows it
    get:name=>row[map.indexOf(headerKey(name))],
    notes:()=>Object.fromEntries(noteCols.map(c=>[c.label,text(row[c.index])]).filter(([,v])=>v)),
    empty:row.every(v=>v==null||text(v)===""),
  })).filter(r=>!r.empty);
}

function duplicateHeaders(rows,required,resolve=headerKey){
  const at=headerRowIndex(rows,required,resolve), header=(rows||[])[at]||[];
  const seen=new Set(),duplicates=new Set();
  for(const cell of header){
    const canonical=resolve(cell);
    if(!canonical||String(canonical).startsWith(`${IGNORE_COLUMN}:`)||String(canonical).startsWith(`${NOTE_COLUMN}:`))continue;
    if(seen.has(canonical))duplicates.add(canonical);else seen.add(canonical);
  }
  return [...duplicates];
}

const tokensOf=s=>String(s||"").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/* The closest column this sheet already understands, or null. Deliberately
   only a SUGGESTION: nothing is imported from a guessed column until the
   person uploading confirms it. */
function suggestColumn(label,rawKey,headerText){
  const want=tokensOf(headerText||rawKey);
  let best=null,bestScore=0;
  for(const col of SHEET_COLUMNS[label]||[]){
    const canonical=key(COLUMN_LABELS[col]||col);
    const overlap=tokensOf(COLUMN_LABELS[col]||col).filter(t=>want.includes(t)).length;
    const near=canonical.includes(rawKey)||rawKey.includes(canonical)?1:0;
    const score=overlap+near;
    if(score>bestScore){bestScore=score;best=col;}
  }
  return bestScore>0?best:null;
}

/* Columns in the file that this sheet does not already understand, plus the
   ones whose meaning depends on the sheet (a bare "Colour"). Each carries what
   the importer would do with it, so the UI can ask for a yes rather than
   silently dropping a column the factory took the trouble to fill in. */
function pendingColumns(label,rows,required,chosen){
  const known=new Set(SHEET_COLUMNS[label]||[]);
  const guesses=SHEET_GUESSES[label]||{};
  const at=headerRowIndex(rows,required,resolverFor(label,chosen));
  const header=(rows||[])[at]||[];
  const out=[];
  header.forEach((cell,i)=>{
    const raw=key(cell);
    if(!raw) return;
    const aliased=HEADER_ALIASES[raw]||raw;
    if(known.has(aliased)) return;                       // an understood column
    const samples=[];
    for(const row of (rows||[]).slice(at+1)){
      const v=text((row||[])[i]);
      if(v&&!samples.includes(v)) samples.push(v);
      if(samples.length>=3) break;
    }
    const suggestion=guesses[raw]||suggestColumn(label,raw,text(cell));
    out.push({
      sheet:label, header:text(cell)||`Column ${i+1}`, key:raw, samples,
      suggestion:suggestion||null,
      suggestionLabel:suggestion?COLUMN_LABELS[suggestion]:null,
      choice:chosen[`${label}::${raw}`]||null,
      applied:chosen[`${label}::${raw}`]||suggestion||IGNORE_COLUMN,
    });
  });
  return out;
}

const round6=n=>Math.round(n*1e6)/1e6;

function sheet(sheets,name){
  const wanted=key(name);
  const aliases={bom:new Set(["bom","bommaster","billofmaterials","billofmaterial"]),
    packing:new Set(["packing","packinglist","packingmaster","cartonpacking"]),
    catalogue:new Set(["catalogue","catalog","articlecatalogue","articlecatalog","cataloguemaster"])};
  return (sheets||[]).find(s=>(aliases[wanted]||new Set([wanted])).has(key(s.name||s.sheetName)));
}

/* opts.columnMap: decisions the user has already confirmed for THIS file,
   keyed "Sheet::headerkey" — a column name, IGNORE_COLUMN or NOTE_COLUMN. */
export function parseReferenceWorkbook(sheets,reference={},opts={}){
  const errors=[],warnings=[];
  const boms={},packing={},packingSingles={},catalogue={},mrp={},individualSizes={};
  const bomSheet=sheet(sheets,"BOM"), packingSheet=sheet(sheets,"Packing"), catalogueSheet=sheet(sheets,"Catalogue");
  if(!bomSheet&&!packingSheet&&!catalogueSheet)
    return {errors:["Workbook must contain a BOM, Packing or Catalogue sheet."],warnings,boms:[],packing,packingSingles,catalogue,mrp,individualSizes,
      columns:[],columnMap:{}};

  const BOM_REQUIRED=["Article Code","Size Range","Stage","Material"];
  const SHEETS=[["BOM",bomSheet,BOM_REQUIRED],["Packing",packingSheet,PACKING_HEADERS],["Catalogue",catalogueSheet,["Article Code"]]];

  /* Read whatever the factory added to the file. An unrecognised column is
     never imported on a guess and never dropped in silence: the best match is
     applied so the preview shows the real outcome, and the column is returned
     for the user to confirm or change before anything saves. */
  const chosen={...(opts.columnMap||{})};
  const columns=[];
  for(const [label,input,required] of SHEETS){
    if(!input)continue;
    for(const column of pendingColumns(label,input.rows||[],required,chosen)) columns.push(column);
  }
  const columnMap={...chosen};
  for(const column of columns) columnMap[`${column.sheet}::${column.key}`]=column.applied;
  const resolvers=Object.fromEntries(SHEETS.map(([label])=>[label,resolverFor(label,columnMap)]));

  for(const [label,input,required] of SHEETS){
    if(!input)continue;
    const duplicates=duplicateHeaders(input.rows||[],required,resolvers[label]);
    if(duplicates.length)errors.push(`${label}: duplicate column${duplicates.length===1?"":"s"} ${duplicates.map(d=>COLUMN_LABELS[d]||d).join(", ")}. Keep one column for each field.`);
  }

  const seen=new Set();
  for(const r of rowObjects(bomSheet?.rows||[],BOM_REQUIRED,resolvers.BOM)){
    const article=articleCode(r.get("Article Code"));
    const sole=cleanSole(r.get("Sole Type"));
    const rawRange=comboCode(r.get("Size Range"));
    const combo=rawRange;
    const sizeRun=cleanRun(r.get("Size Run"));
    const stage=cleanStage(r.get("Stage"));
    const component=text(r.get("Component"));
    const materialColour=materialColourToken(r.get("Material Colour"));
    const material=colouredMaterialName(normaliseMaterial(r.get("Material")||component),materialColour);
    const uom=cleanUom(r.get("UOM"));
    const rate=Number(r.get("Rate per Pair"));
    const soleColour=cleanColour(r.get("Sole Colour"));
    const upperColour=cleanColour(r.get("Upper Colour"));
    const prefix=`BOM row ${r.row}`;
    /* A COMPONENT row may legitimately be zero — a piece cut from what is
       already being bought for another component consumes nothing extra. The
       material's total is what procurement uses, and that is the sum. Without
       a component named, zero is still a missing rate. */
    const zeroIsFine = !!component && Number.isFinite(rate) && rate === 0;
    if(!article||!sole||!combo||!stage||!material||!uom||!Number.isFinite(rate)||(rate<0)||(rate===0&&!zeroIsFine)){
      /* Name what is actually wrong. "Complete every required field" sent
         people hunting across twelve columns; a zero rate in particular looks
         filled in, and it is the one that silently orders none of a material
         the shoe genuinely uses. */
      const missing=[["Article Code",article],["Sole Type",sole],["Size Range",combo],
                     ["Stage",stage],["Material",material],["UOM",uom]]
        .filter(([,v])=>!v).map(([k])=>k);
      errors.push(missing.length
        ? `${prefix}: ${missing.join(", ")} ${missing.length===1?"is":"are"} blank.`
        : `${prefix}: ${material} has no rate per pair. A rate of 0 would order none of it — `
          +`enter the consumption, or name a cutting component if it is cut from another material.`);
      continue;
    }
    if(!SOLES.has(sole)){errors.push(`${prefix}: Sole Type must be EVA, PVC, PU or STUCK-ON.`);continue;}
    if(!STAGES.has(stage)){errors.push(`${prefix}: unknown Stage ${stage}.`);continue;}
    if(sizeRun&&!['SMALL','LARGE'].includes(sizeRun)){errors.push(`${prefix}: Size Run must be Small or Large.`);continue;}
    const tooLong=[["Sole Colour",soleColour],["Upper Colour",upperColour]].find(([,v])=>v.length>MAX_COLOUR);
    if(tooLong){errors.push(`${prefix}: ${tooLong[0]} must be ${MAX_COLOUR} characters or fewer.`);continue;}
    /* ONE MATERIAL, SEVERAL COMPONENTS. The revised sheet writes a row per cut
       piece, so MESH 58" WHITE appears once as VAMP MESH and again as MESH
       TOUNGE. Those are not duplicates: the material's consumption is the SUM
       of its components. Treating them as duplicates rejected the whole file;
       keeping the first row silently understated MESH by 25% and REXINE 54" by
       75%, which is worse. A true duplicate is the SAME component twice. */
    const duplicate=[article,combo,stage,material,uom,component||""].join("|");
    if(seen.has(duplicate)){
      /* Without a component these really are two rows for one material, which
         is the long-standing error and keeps its wording. With a component it
         is the same PIECE listed twice, which is a different mistake. */
      errors.push(component
        ? `${prefix}: duplicate BOM component ${component} for ${article} ${combo} ${stage} ${material}.`
        : `${prefix}: duplicate BOM material for ${article} ${combo} ${stage}.`);
      continue;
    }
    seen.add(duplicate);
    const bom=boms[article]||(boms[article]={article,soleType:sole,soleColour:null,upperColour:null,
      combo_order:[],combos:{},materials:{},warnings:[]});
    if(bom.soleType!==sole){errors.push(`${prefix}: ${article} has more than one Sole Type.`);continue;}
    /* Colour is a property of the article, not of one BOM row, so two rows that
       disagree cannot both be right. Refuse rather than let row order decide. */
    let colourConflict=false;
    for(const [field,label,value] of [["soleColour","Sole Colour",soleColour],["upperColour","Upper Colour",upperColour]]){
      if(!value) continue;
      if(bom[field]&&!sameColour(bom[field],value)){
        errors.push(`${prefix}: ${article} has more than one ${label} (${bom[field]}, then ${value}). Use one colour per article.`);
        colourConflict=true;
      }else if(!bom[field]) bom[field]=value;
    }
    if(colourConflict) continue;
    if(!bom.combos[combo]){bom.combo_order.push(combo);bom.combos[combo]={stitching_combo:combo,rates:{},...(sizeRun?{size_run:sizeRun}:{})};}
    else if(sizeRun&&bom.combos[combo].size_run&&bom.combos[combo].size_run!==sizeRun){errors.push(`${prefix}: ${article} ${combo} has conflicting Size Run values.`);continue;}
    else if(sizeRun) bom.combos[combo].size_run=sizeRun;
    const materialKey=`${material}||${uom}`;
    bom.combos[combo].rates[stage]=bom.combos[combo].rates[stage]||{};
    /* += , not = . Procurement reads this figure. */
    bom.combos[combo].rates[stage][materialKey]=
      round6((bom.combos[combo].rates[stage][materialKey]||0)+rate);
    if(component){
      /* Kept BESIDE the rates, never inside them, so every existing reader of
         `rates` is untouched: the BOM screens and procurement stay
         material-wise, and only the job card looks in here. */
      const comps=bom.combos[combo].components=bom.combos[combo].components||{};
      const byStage=comps[stage]=comps[stage]||{};
      const list=byStage[materialKey]=byStage[materialKey]||[];
      list.push({name:component,per_pair:rate,uom});
    }
    const rowNotes=r.notes();
    bom.materials[materialKey]={name:material,uom,
      ...(materialColour?{colour:materialColour}:{}),
      ...(Object.keys(rowNotes).length?{notes:{...(bom.materials[materialKey]?.notes||{}),...rowNotes}}:
          bom.materials[materialKey]?.notes?{notes:bom.materials[materialKey].notes}:{})};
  }

  /* Colour splits a material in two. Say so before it saves: the new colour
     carries its own stock, so procurement will show its full requirement until
     a stock figure is entered against it. */
  for(const bom of Object.values(boms)){
    const fresh=Object.entries(bom.materials).filter(([k,m])=>m.colour&&!(reference.materials||{})[k]);
    if(!fresh.length) continue;
    warnings.push(`${bom.article}: ${fresh.length} colour-specific material${fresh.length===1?" is":"s are"} new `
      +`(for example ${fresh[0][1].name}). Each is stocked and bought separately, and starts at 0 stock until you enter one.`);
  }

  const workbookReference={...reference,articles:{...(reference.articles||{})}};
  for(const bom of Object.values(boms)){
    workbookReference.articles[bom.article]={
      ...(workbookReference.articles[bom.article]||{}),combo_order:bom.combo_order,combos:bom.combos,sole_type:bom.soleType,
    };
    for(const combo of bom.combo_order){
      if(!bom.combos[combo].size_run&&sizeRunOptionsForRange(combo).length>1){
        const inferred=comboSizesForArticleIn(workbookReference,bom.article,combo)[0]?.endsWith("s")?"Small":"Large";
        warnings.push(`${bom.article} ${combo}: Size Run was blank and was read as ${inferred} from its position. Write Small/Large to make it explicit.`);
      }
    }
  }

  const packingSequence={};
  for(const r of rowObjects(packingSheet?.rows||[],PACKING_HEADERS,resolvers.Packing)){
    const rawArticle=articleCode(r.get("Article Code"));
    const article=boms[rawArticle]?rawArticle:(existingArticleCode(reference.articles,rawArticle)||rawArticle);
    const rawRange=comboCode(r.get("Size Range"));
    const combo=rawRange;
    const bomRange=comboCode(r.get("BOM Range"));
    const ppc=Number(r.get("Pairs per Carton"));
    const prefix=`Packing row ${r.row}`;
    if(!article||!combo||!Number.isInteger(ppc)||ppc<1){errors.push(`${prefix}: Article Code, Size Range and a whole-number pairs/carton of 1 or more are required.`);continue;}
    const definition=boms[article]||reference.articles?.[article];
    const combos=definition?(definition.combo_order||Object.keys(definition.combos||{})):[];
    if(bomRange&&!combos.includes(bomRange)){errors.push(`${prefix}: BOM Range ${bomRange} is not in ${article}'s BOM (${combos.join(", ")}).`);continue;}
    if(combos.length&&!combos.includes(combo)){
      packingSequence[article]=packingSequence[article]||createSizeSequenceState();
      const token=parseSizeToken(rawRange);
      const extra=token.bare?[`${token.bare}S`,token.bare]:[];
      const refForSize=bomRange?{...workbookReference,articles:{...workbookReference.articles,
        [article]:{...workbookReference.articles[article],individual_sizes:[...(workbookReference.articles[article]?.individual_sizes||[]),...extra]}}}:workbookReference;
      const resolved=resolveArticleSizeWithSequenceIn(refForSize,article,rawRange,packingSequence[article]);
      const single=resolved.size;
      if(resolved.error){errors.push(`${prefix}: ${resolved.error}${bomRange?"":"; write S/L explicitly or add BOM Range for a standalone size"}.`);continue;}
      if(single&&/^\d+(?:\.5)?S?$/.test(single)){
        packingSingles[article]=packingSingles[article]||{};
        const storageKey=scopedSizeKey(bomRange,single);
        if(packingSingles[article][storageKey]!=null){
          if(Number(packingSingles[article][storageKey])===ppc){warnings.push(`${prefix}: repeated identical packing rule for ${article} ${bomRange?`${bomRange} / `:""}size ${single}; kept once.`);continue;}
          errors.push(`${prefix}: conflicting packing rule for ${article} ${bomRange?`${bomRange} / `:""}size ${single}; earlier row has ${packingSingles[article][storageKey]}, this row has ${ppc}.`);continue;
        }
        packingSingles[article][storageKey]=ppc;
        individualSizes[article]=individualSizes[article]||[];
        if(!individualSizes[article].includes(single)) individualSizes[article].push(single);
        if(resolved.outOfOrder) warnings.push(`${prefix}: explicit Small size ${single} appears after Large sizes; kept because S/L was written explicitly.`);
        if(resolved.inferred&&["7","8","9","10","11","12","13","13.5"].includes(token.bare)) warnings.push(`${prefix}: inferred ${single} from ascending Small-then-Large order; write S/L to make it explicit.`);
        continue;
      }
      errors.push(`${prefix}: ${combo} is neither a BOM size range nor an individual size inside ${article}'s ranges.`);continue;
    }
    packing[article]=packing[article]||{};
    if(packing[article][combo]!=null){
      if(Number(packing[article][combo])===ppc){warnings.push(`${prefix}: repeated identical packing rule for ${article} ${combo}; kept once.`);continue;}
      errors.push(`${prefix}: conflicting packing rule for ${article} ${combo}; earlier row has ${packing[article][combo]}, this row has ${ppc}.`);continue;
    }
    packing[article][combo]=ppc;
  }

  const catalogueSequence={};
  for(const r of rowObjects(catalogueSheet?.rows||[],["Article Code"],resolvers.Catalogue)){
    const rawArticle=articleCode(r.get("Article Code"));
    let article=boms[rawArticle]?rawArticle:(existingArticleCode(reference.articles,rawArticle)||rawArticle);
    let combo=comboCode(r.get("Size Range"));
    const bomRange=comboCode(r.get("BOM Range"));
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
    const soleColour=cleanColour(r.get("Sole Colour"));
    const upperColour=cleanColour(r.get("Upper Colour"));
    const machine=text(r.get("PVC Machine")).toUpperCase();
    const packingSource=articleCode(r.get("Packing Source"));
    const prefix=`Catalogue row ${r.row}`;
    if(!article){errors.push(`${prefix}: Article Code is required.`);continue;}
    if(price!=null&&(!Number.isFinite(price)||price<0)){errors.push(`${prefix}: Default Price must be 0 or more.`);continue;}
    if(sole&&!SOLES.has(sole)){errors.push(`${prefix}: Sole Type must be EVA, PVC, PU or STUCK-ON.`);continue;}
    const longColour=[["Sole Colour",soleColour],["Upper Colour",upperColour]].find(([,v])=>v.length>MAX_COLOUR);
    if(longColour){errors.push(`${prefix}: ${longColour[0]} must be ${MAX_COLOUR} characters or fewer.`);continue;}
    const bomColourClash=[["soleColour","Sole Colour",soleColour],["upperColour","Upper Colour",upperColour]]
      .find(([field,,value])=>value&&boms[article]?.[field]&&!sameColour(boms[article][field],value));
    if(bomColourClash){
      errors.push(`${prefix}: ${bomColourClash[1]} ${bomColourClash[2]} contradicts ${boms[article][bomColourClash[0]]} on the BOM sheet for ${article}.`);continue;
    }
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
    if(bomRange&&!ranges.includes(bomRange)){errors.push(`${prefix}: BOM Range ${bomRange} is not in ${article}'s BOM (${ranges.join(", ")}).`);continue;}
    let priceKey=null;
    if(combo){
      if(ranges.includes(combo)) priceKey=combo;
      else{
        catalogueSequence[article]=catalogueSequence[article]||createSizeSequenceState();
        const token=parseSizeToken(combo);
        const extra=token.bare?[`${token.bare}S`,token.bare]:[];
        const refForSize=bomRange?{...workbookReference,articles:{...workbookReference.articles,
          [article]:{...workbookReference.articles[article],individual_sizes:[...(workbookReference.articles[article]?.individual_sizes||[]),...extra]}}}:workbookReference;
        const resolved=resolveArticleSizeWithSequenceIn(refForSize,article,combo,catalogueSequence[article]);
        if(resolved.error){errors.push(`${prefix}: ${resolved.error}${bomRange?"":"; write S/L explicitly or add BOM Range for a standalone size"}.`);continue;}
        priceKey=scopedSizeKey(bomRange,resolved.size);
        individualSizes[article]=individualSizes[article]||[];
        if(!individualSizes[article].includes(resolved.size)) individualSizes[article].push(resolved.size);
        if(resolved.outOfOrder) warnings.push(`${prefix}: explicit Small size ${resolved.size} appears after Large sizes; kept because S/L was written explicitly.`);
        if(resolved.inferred&&["7","8","9","10","11","12","13","13.5"].includes(token.bare)) warnings.push(`${prefix}: inferred ${resolved.size} from ascending Small-then-Large order; write S/L to make it explicit.`);
      }
    }
    if(priceKey&&price!=null){
      mrp[article]=mrp[article]||{};
      if(mrp[article][priceKey]!=null){
        if(Number(mrp[article][priceKey])===price){warnings.push(`${prefix}: repeated identical MRP for ${article} ${priceKey}; kept once.`);continue;}
        errors.push(`${prefix}: conflicting Catalogue price for ${article} ${priceKey}; earlier row has ${mrp[article][priceKey]}, this row has ${price}.`);continue;
      }
      mrp[article][priceKey]=price;
    }else if(priceKey&&price==null){
      warnings.push(`${prefix}: ${article} ${priceKey} was accepted as a size entry; no MRP was supplied.`);
    }
    const incoming={
      article_code:article,
      description,
      price:priceKey?null:price,
      sole_type:sole||null,
      sole_colour:soleColour||null,
      upper_colour:upperColour||null,
      molding_machine:machine||null,
      packing_source:packingSource||null,
      photo_file_name:text(r.get("Photo File Name"))||null,
    };
    // Columns the user chose to keep as a note: recorded against the article,
    // shown in Catalogue, and used by no calculation.
    const rowNotes=r.notes();
    if(Object.keys(rowNotes).length) incoming.notes=rowNotes;
    const previous=catalogue[article];
    if(previous&&incoming.notes) previous.notes={...(previous.notes||{}),...incoming.notes};
    if(previous){
      // Colours compare case-insensitively; Black and BLACK are one colour.
      for(const [field,label] of [["sole_colour","Sole Colour"],["upper_colour","Upper Colour"]]){
        if(previous[field]&&incoming[field]&&!sameColour(previous[field],incoming[field]))
          errors.push(`${prefix}: ${label} conflicts with the earlier ${article} row.`);
        else if(previous[field]==null&&incoming[field]!=null) previous[field]=incoming[field];
      }
      for(const field of ["description","price","sole_type","molding_machine","packing_source","photo_file_name"]){
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

  return {errors,warnings,boms:Object.values(boms),packing,packingSingles,catalogue,mrp,individualSizes,removals,
    columns,columnMap};
}
