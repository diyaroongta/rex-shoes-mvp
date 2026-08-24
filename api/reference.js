import { db, q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { INPUTS } from "../shared/inputs.js";
import { articleCode, existingArticleCode, mergeBom } from "../shared/bom-import.js";
import { SOLE_TYPES, routingForSole } from "../shared/reference-edit.js";

/* Reference data lives in the database so a BOM upload never needs a deploy.
   The bundled inputs.js is the seed used on first run. */
async function current(){
  const { rows } = await q("select value from reference_data where id = 1");
  return rows.length ? rows[0].value : INPUTS;
}

class InputError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const reject=(message,status=400)=>{throw new InputError(message,status);};
const BOM_STAGES=new Set(["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","ASSEMBLY","PACKING","DISPATCH"]);

async function mutateReference(changeType, article, mutation){
  const client=await db().connect();
  try{
    await client.query("begin");
    const {rows}=await client.query("select value from reference_data where id = 1 for update");
    const ref=JSON.parse(JSON.stringify(rows.length?rows[0].value:INPUTS));
    const before=JSON.stringify(ref);
    const result=(await mutation(ref,client))||{};
    await client.query(`insert into reference_data (id, value) values (1, $1)
                        on conflict (id) do update set value = $1, updated_at = now()`,
                       [JSON.stringify(ref)]);
    await client.query(`insert into reference_data_history (change_type, article_code, value)
                        values ($1,$2,$3)`,[changeType,article||null,before]);
    await client.query("commit");
    return result;
  }catch(e){
    try{await client.query("rollback");}catch(_){ }
    throw e;
  }finally{client.release();}
}

function validateBom(parsed){
  if(!parsed||!parsed.article||!parsed.combos) reject("expected a parsed BOM");
  if(!parsed.materials||typeof parsed.materials!=="object") reject("BOM materials are required");
  if(!parsed.soleType||!SOLE_TYPES.includes(parsed.soleType)) reject("Sole Type must be EVA, PVC, PU or STUCK-ON");
  parsed={...parsed,article:articleCode(parsed.article)};
  if(!parsed.article) reject("Article Code is required");
  let rates=0;
  for(const [combo,c] of Object.entries(parsed.combos)){
    if(!combo||!c.rates||!Object.keys(c.rates).length) reject(`${parsed.article}: a size range has no rates`);
    for(const [stageName,stage] of Object.entries(c.rates)){
      if(!BOM_STAGES.has(stageName)) reject(`${parsed.article} ${combo}: unknown BOM stage ${stageName}`);
      for(const [materialKey,value] of Object.entries(stage||{})){
        if(!parsed.materials[materialKey]) reject(`${parsed.article} ${combo}: missing material definition for ${materialKey}`);
        const n=Number(value);
        if(!Number.isFinite(n)||n<=0) reject(`${parsed.article} ${combo}: every BOM rate must be greater than 0`);
        rates++;
      }
    }
  }
  if(!rates) reject(`${parsed.article}: no rates found in the upload`);
  return {parsed,rates};
}

function applyPacking(ref, packing){
  const touched=[];
  ref.packing=ref.packing||{};
  for(const [rawArticle,chart] of Object.entries(packing||{})){
    const art=existingArticleCode(ref.articles,rawArticle);
    if(!art) reject(`unknown article in Packing sheet: ${rawArticle} — add its BOM first`);
    const allowed=new Set(ref.articles[art].combo_order||Object.keys(ref.articles[art].combos||{}));
    const clean={};
    for(const [rawCombo,ppc] of Object.entries(chart||{})){
      const combo=String(rawCombo).toUpperCase().replace(/\s+/g,"");
      if(!allowed.has(combo)) reject(`Packing ${art} ${combo}: size range is not in that article's BOM`);
      const n=Math.round(Number(ppc));
      if(!Number.isFinite(n)||n<1) reject(`pairs/carton for ${art} ${combo} must be 1 or more`);
      clean[combo]=n;
    }
    ref.packing[art]={...(ref.packing[art]||{}),...clean};
    touched.push(art);
  }
  return touched;
}

export default wrap(async (req, res) => {
  if(req.method === "GET"){
    const ref = await current();
    return res.status(200).json(ref);
  }

  /* Merge one parsed BOM workbook. The client parses the sheet with the shared
     parser and posts the result; everything is re-checked here. */
  if(req.method === "POST"){
    try{
      const {parsed,routing,batch,confirm_replace=false}=req.body||{};
      const incoming=batch?.boms||(parsed?[parsed]:[]);
      if(!incoming.length&&!batch) return fail(res,400,"expected a parsed BOM or master workbook batch");
      const validated=incoming.map(validateBom);
      const label=validated.length===1?validated[0].parsed.article:null;
      const result=await mutateReference(batch?"master-upload":"bom-upload",label,async(ref,client)=>{
        const replacements=validated.map(x=>existingArticleCode(ref.articles,x.parsed.article)).filter(Boolean);
        if(replacements.length&&!confirm_replace)
          reject(`This upload would replace existing BOMs: ${[...new Set(replacements)].join(", ")}. Confirm replacement and upload again.`,409);
        let rates=0;const newMaterials=[];const articles=[];
        for(const item of validated){
          const merged=mergeBom(ref,item.parsed,{routing});
          Object.assign(ref,merged.reference);
          rates+=item.rates;newMaterials.push(...merged.newMaterials);articles.push(merged.article);
        }
        const packed=applyPacking(ref,batch?.packing||{});
        const catalogue=[];
        for(const [raw,entry] of Object.entries(batch?.catalogue||{})){
          const art=existingArticleCode(ref.articles,raw);
          if(!art) reject(`unknown article in Catalogue sheet: ${raw} — add its BOM first`);
          if(entry.sole_type&&!SOLE_TYPES.includes(entry.sole_type)) reject(`${art}: invalid Sole Type`);
          if(entry.molding_machine&&!['ROTARY','VERTICAL'].includes(entry.molding_machine)) reject(`${art}: invalid PVC Machine`);
          if(entry.price!=null&&(!Number.isFinite(Number(entry.price))||Number(entry.price)<0)) reject(`${art}: Default Price must be 0 or more`);
          if(entry.description!=null&&String(entry.description).length>500) reject(`${art}: description must be 500 characters or fewer`);
          if(entry.sole_type){
            ref.articles[art].sole_type=entry.sole_type;
            ref.articles[art].sole_assumed=false;
            ref.articles[art].routing=routingForSole(ref.articles[art].routing,entry.sole_type);
          }
          if(entry.molding_machine){
            if(ref.articles[art].sole_type!=="PVC") reject(`${art}: PVC Machine can only be set for a PVC article`);
            ref.articles[art].molding_machine=entry.molding_machine;
          }else if(ref.articles[art].sole_type!=="PVC") ref.articles[art].molding_machine=null;
          const previous=await client.query("select article_code, image, description, price from catalogue where article_code=$1 for update",[art]);
          await client.query("insert into catalogue_history (article_code, value) values ($1,$2)",
            [art,JSON.stringify(previous.rows[0]||{article_code:art,existed:false})]);
          await client.query(`insert into catalogue (article_code, description, price)
                              values ($1,$2,$3)
                              on conflict (article_code) do update set
                                description=coalesce($2,catalogue.description),
                                price=coalesce($3,catalogue.price), updated_at=now()`,
                             [art,entry.description||null,entry.price]);
          catalogue.push(art);
        }
        return {articles,replacements:[...new Set(replacements)],rates,newMaterials:[...new Set(newMaterials)],packed,catalogue,
          articlesTotal:Object.keys(ref.articles||{}).length,materialsTotal:Object.keys(ref.materials||{}).length};
      });
      return res.status(200).json({
        ok:true,article:result.articles[0],articles:result.articles,
        replaced:result.replacements.length>0,replaced_articles:result.replacements,rates:result.rates,
        combos:validated.reduce((n,x)=>n+Object.keys(x.parsed.combos).length,0),
        new_materials:result.newMaterials,packing_articles:result.packed,catalogue_articles:result.catalogue,
        articles_total:result.articlesTotal,materials_total:result.materialsTotal,
      });
    }catch(e){if(e instanceof InputError)return fail(res,e.status,e.message);throw e;}
  }

  /* Direct edits: stock figures, packing chart, an article's sole type. */
  if(req.method === "PATCH"){
    try{
    const body=req.body||{};
    await mutateReference("reference-edit",null,async ref=>{
    const { stock, packing, sole_type } = body;   // mrp handled below
    if(stock && typeof stock === "object"){
      for(const [key, v] of Object.entries(stock)){
        if(!ref.materials[key]) reject(`unknown material: ${key}`);
        const n = Number(v);
        if(!isFinite(n) || n < 0) reject(`stock for ${key} must be 0 or more`);
        ref.materials[key].stock = n;
      }
    }
    if(packing && typeof packing === "object"){
      applyPacking(ref,packing);
    }
    if(body.stock_meta && typeof body.stock_meta === "object"){
      ref.stock_meta = ref.stock_meta || {};
      for(const [key, fields] of Object.entries(body.stock_meta)){
        if(!ref.materials[key]) reject(`unknown material: ${key}`);
        const cur = { ...(ref.stock_meta[key] || {}) };
        for(const [f, v] of Object.entries(fields)){
          if(["category","size"].includes(f)){ cur[f] = String(v).slice(0,60); continue; }
          if(!["opening","rec","issue","min_stock","min","rate"].includes(f))
            reject(`unknown stock field: ${f}`);
          const n = Number(v);
          if(!isFinite(n) || n < 0) reject(`${f} for ${key} must be 0 or more`);
          cur[f === "min" ? "min_stock" : f] = n;
        }
        ref.stock_meta[key] = cur;
        // keep materials.stock in step so procurement nets against the same number
        const md = ref.stock_meta[key];
        if(md.opening != null || md.rec != null || md.issue != null)
          ref.materials[key].stock = (Number(md.opening)||0) + (Number(md.rec)||0) - (Number(md.issue)||0);
      }
    }
    if(body.mrp && typeof body.mrp === "object"){
      ref.mrp = ref.mrp || {};
      for(const [art, chart] of Object.entries(body.mrp)){
        if(!ref.articles[art]) reject(`unknown article: ${art}`);
        const clean = { ...(ref.mrp[art] || {}) };
        for(const [combo, v] of Object.entries(chart)){
          const n = Math.round(Number(v));
          if(!Number.isFinite(n) || n < 0) reject(`MRP for ${art} ${combo} must be 0 or more`);
          clean[combo] = n;
        }
        ref.mrp[art] = clean;
      }
    }
    /* Which PVC machine an article runs on. Factory knowledge — settable here
       rather than guessed, since an unassigned article silently defaults to
       rotary and makes that machine look like a bottleneck it may not be. */
    if(body.molding_machine && typeof body.molding_machine === "object"){
      for(const [art, machine] of Object.entries(body.molding_machine)){
        if(!ref.articles[art]) reject(`unknown article: ${art}`);
        if(machine === null || machine === ""){ ref.articles[art].molding_machine = null; continue; }
        if(!["ROTARY","VERTICAL"].includes(machine))
          reject(`molding machine for ${art} must be ROTARY or VERTICAL`);
        if(ref.articles[art].sole_type !== "PVC")
          reject(`${art} is ${ref.articles[art].sole_type}, not PVC — it has only one molding machine`);
        ref.articles[art].molding_machine = machine;
      }
    }
    if(sole_type && typeof sole_type === "object"){
      for(const [art, st] of Object.entries(sole_type)){
        if(!ref.articles[art]) reject(`unknown article: ${art}`);
        if(!SOLE_TYPES.includes(st)) reject(`bad sole type: ${st}`);
        ref.articles[art].sole_type = st;
        ref.articles[art].sole_assumed = false;
        ref.articles[art].routing = routingForSole(ref.articles[art].routing,st);
        if(st !== "PVC") ref.articles[art].molding_machine = null;
      }
    }
    });
    return res.status(200).json({ ok:true });
    }catch(e){if(e instanceof InputError)return fail(res,e.status,e.message);throw e;}
  }

  return fail(res, 405, `${req.method} not allowed`);
});
