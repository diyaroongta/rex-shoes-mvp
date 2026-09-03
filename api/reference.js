import { db, q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { INPUTS } from "../shared/inputs.js";
import { articleCode, existingArticleCode, mergeBom } from "../shared/bom-import.js";
import { SOLE_TYPES, routingForSole } from "../shared/reference-edit.js";
import { resolveArticleSizeIn, splitScopedSizeKey, scopedSizeKey } from "../shared/bridge.js";
import { planRemoval, applyRemoval, ordersAtRisk } from "../shared/bom-removal.js";
import { assignCodes } from "../shared/product-codes.js";

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
    const {rows:catalogueBefore}=await client.query(
      "select article_code, image, description, price from catalogue order by article_code for update");
    const before=JSON.stringify({reference:ref,catalogue:catalogueBefore});
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

/* Optional standard colours for an article. Free text, so the only rules are
   that it is text and that it stays short enough to display. */
const MAX_COLOUR=60;
function cleanColour(value,label){
  if(value==null||value==="") return null;
  if(typeof value!=="string"&&typeof value!=="number") reject(`${label} must be text`);
  const clean=String(value).replace(/\s+/g," ").trim();
  if(!clean) return null;
  if(clean.length>MAX_COLOUR) reject(`${label} must be ${MAX_COLOUR} characters or fewer`);
  return clean;
}

/* Free-text columns the user chose to keep as notes. Recorded and displayed,
   never used in a calculation — so the only rules are size and shape. */
const MAX_NOTES=12, MAX_NOTE=200, MAX_NOTE_LABEL=60;
function cleanNotes(value,label){
  if(value==null) return null;
  if(typeof value!=="object"||Array.isArray(value)) reject(`${label}: notes must be a set of column/value pairs`);
  const entries=Object.entries(value).filter(([,v])=>v!=null&&String(v).trim()!=="");
  if(entries.length>MAX_NOTES) reject(`${label}: at most ${MAX_NOTES} extra columns can be kept as notes`);
  const clean={};
  for(const [name,v] of entries){
    const noteLabel=String(name).replace(/\s+/g," ").trim().slice(0,MAX_NOTE_LABEL);
    if(!noteLabel) continue;
    clean[noteLabel]=String(v).replace(/\s+/g," ").trim().slice(0,MAX_NOTE);
  }
  return Object.keys(clean).length?clean:null;
}

function validateBom(parsed){
  if(!parsed||!parsed.article||!parsed.combos) reject("expected a parsed BOM");
  if(!parsed.materials||typeof parsed.materials!=="object") reject("BOM materials are required");
  if(!parsed.soleType||!SOLE_TYPES.includes(parsed.soleType)) reject("Sole Type must be EVA, PVC, PU or STUCK-ON");
  parsed={...parsed,article:articleCode(parsed.article)};
  if(!parsed.article) reject("Article Code is required");
  parsed={...parsed,soleColour:cleanColour(parsed.soleColour,`${parsed.article}: Sole Colour`),
    upperColour:cleanColour(parsed.upperColour,`${parsed.article}: Upper Colour`)};
  /* Materials arrive from a workbook the browser parsed, so nothing beyond the
     fields the app understands is allowed into the reference document. */
  const materials={};
  for(const [materialKey,m] of Object.entries(parsed.materials)){
    if(!m||typeof m!=="object") reject(`${parsed.article}: material ${materialKey} is malformed`);
    const name=String(m.name==null?"":m.name).trim(), uom=String(m.uom==null?"":m.uom).trim();
    if(!name||!uom) reject(`${parsed.article}: material ${materialKey} needs a name and a unit`);
    const colour=cleanColour(m.colour,`${parsed.article}: colour of ${name}`);
    const notes=cleanNotes(m.notes,`${parsed.article}: ${name}`);
    materials[materialKey]={name:name.slice(0,200),uom,...(colour?{colour}:{}),...(notes?{notes}:{})};
  }
  parsed={...parsed,materials};
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
      const n=Number(ppc);
      if(!Number.isInteger(n)||n<1) reject(`pairs/carton for ${art} ${combo} must be a whole number of 1 or more`);
      clean[combo]=n;
    }
    ref.packing[art]={...(ref.packing[art]||{}),...clean};
    touched.push(art);
  }
  return touched;
}

function applySinglePacking(ref, packingSingles,{allowDelete=false}={}){
  const touched=[];
  ref.packing_singles_exact=ref.packing_singles_exact||{};
  for(const [rawArticle,chart] of Object.entries(packingSingles||{})){
    const art=existingArticleCode(ref.articles,rawArticle);
    if(!art) reject(`unknown article in single-size Packing rows: ${rawArticle} — add its BOM first`);
    const clean={};
    for(const [rawSize,ppc] of Object.entries(chart||{})){
      const scoped=splitScopedSizeKey(rawSize);
      if(!scoped.valid) reject(`Packing ${art}: invalid range/size key ${rawSize}`);
      const allowed=new Set(ref.articles[art].combo_order||Object.keys(ref.articles[art].combos||{}));
      if(scoped.combo&&!allowed.has(scoped.combo)) reject(`Packing ${art}: BOM range ${scoped.combo} is not in that article's BOM`);
      const resolved=resolveArticleSizeIn(ref,art,scoped.size);
      if(resolved.ambiguous) reject(`Packing ${art} size ${rawSize}: ambiguous; write ${resolved.candidates.join(" or ")} exactly`);
      const size=resolved.size;
      if(!size) reject(`Packing ${art} size ${rawSize}: size is not inside that article's BOM ranges`);
      const storageKey=scopedSizeKey(scoped.combo,size);
      if(allowDelete&&(ppc==null||ppc==="")){delete ref.packing_singles_exact[art]?.[storageKey];continue;}
      const n=Number(ppc);
      if(!Number.isInteger(n)||n<1) reject(`pairs/carton for ${art} size ${size} must be a whole number of 1 or more`);
      clean[storageKey]=n;
    }
    ref.packing_singles_exact[art]={...(ref.packing_singles_exact[art]||{}),...clean};
    touched.push(art);
  }
  return touched;
}

function applyMrp(ref,mrp){
  const touched=[];
  ref.mrp=ref.mrp||{};
  for(const [rawArticle,chart] of Object.entries(mrp||{})){
    const art=existingArticleCode(ref.articles,rawArticle);
    if(!art) reject(`unknown article in Catalogue prices: ${rawArticle} — add its BOM first`);
    const allowed=new Set(ref.articles[art].combo_order||Object.keys(ref.articles[art].combos||{}));
    const clean={...(ref.mrp[art]||{})};
    for(const [rawCombo,value] of Object.entries(chart||{})){
      const raw=String(rawCombo).toUpperCase().replace(/\s+/g,"");
      const scoped=splitScopedSizeKey(raw);
      if(!scoped.valid) reject(`MRP ${art}: invalid range/size key ${raw}`);
      if(scoped.combo&&!allowed.has(scoped.combo)) reject(`MRP ${art}: BOM range ${scoped.combo} is not in that article's BOM`);
      const resolved=allowed.has(raw)?{size:raw}:resolveArticleSizeIn(ref,art,scoped.size);
      if(resolved.ambiguous) reject(`MRP ${art} ${raw}: ambiguous; write ${resolved.candidates.join(" or ")} exactly`);
      const combo=resolved.size&&(scoped.combo?scopedSizeKey(scoped.combo,resolved.size):resolved.size);
      if(!combo) reject(`MRP ${art} ${raw}: value is neither a size range nor an individual size in that article's BOM`);
      const n=Number(value);
      if(!Number.isFinite(n)||n<0) reject(`MRP for ${art} ${combo} must be 0 or more`);
      clean[combo]=n;
    }
    ref.mrp[art]=clean;touched.push(art);
  }
  return touched;
}

export default wrap(async (req, res) => {
  if(req.method === "GET"){
    /* The revision log, so a wrong upload can actually be undone. Snapshots
       nobody can restore are not a safety net. Values are omitted here — the
       list is for choosing, the restore reads the value itself. */
    if(req.query && req.query.history){
      const { rows } = await q(
        `select revision_id, change_type, article_code, created_at
           from reference_data_history order by created_at desc limit 25`);
      return res.status(200).json(rows.map(r => ({
        ...r,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      })));
    }
    const ref = await current();
    return res.status(200).json(ref);
  }

  /* Merge one parsed BOM workbook. The client parses the sheet with the shared
     parser and posts the result; everything is re-checked here. */
  if(req.method === "POST"){
    try{
      /* Undo. The restore is itself snapshotted first, so undoing a wrong undo
         is also possible — otherwise recovery becomes its own way to lose data. */
      if(req.body && req.body.restore_revision != null){
        const id = Number(req.body.restore_revision);
        if(!Number.isInteger(id)) return fail(res, 400, "restore_revision must be a revision id");
        const { rows } = await q("select value, change_type, article_code, created_at from reference_data_history where revision_id = $1",[id]);
        if(!rows.length) return fail(res, 404, `no such revision: ${id}`);
        const snapshot = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
        const snapshotRef=snapshot?.reference||snapshot;
        const snapshotCatalogue=Array.isArray(snapshot?.catalogue)?snapshot.catalogue:null;
        if(!snapshotRef || !snapshotRef.articles) return fail(res, 422, "that revision does not hold a usable reference document");
        const {rows:liveOrders}=await q(`select order_no, article_code, lines from orders where active`);
        const conflicts=[];
        for(const order of liveOrders){
          const def=snapshotRef.articles[order.article_code];
          if(!def){conflicts.push(`${order.order_no}: article ${order.article_code} would disappear`);continue;}
          const combos=new Set(def.combo_order||Object.keys(def.combos||{}));
          const missing=(order.lines||[]).map(l=>l.combo).filter(c=>!combos.has(c));
          if(missing.length) conflicts.push(`${order.order_no}: ranges ${[...new Set(missing)].join(", ")} would disappear`);
        }
        if(conflicts.length) return fail(res,409,"Cannot restore while it would invalidate live orders — "+conflicts.slice(0,10).join("; "));
        const result = await mutateReference("restore", rows[0].article_code, async (ref,client) => {
          for(const k of Object.keys(ref)) delete ref[k];
          Object.assign(ref, snapshotRef);
          if(snapshotCatalogue){
            await client.query("delete from catalogue");
            for(const entry of snapshotCatalogue)
              await client.query(`insert into catalogue (article_code, image, description, price)
                values ($1,$2,$3,$4)`,[entry.article_code,entry.image||null,entry.description||null,entry.price??null]);
          }
          return { articles: Object.keys(snapshotRef.articles || {}).length,
                   materials: Object.keys(snapshotRef.materials || {}).length,
                   catalogue: snapshotCatalogue?.length??null };
        });
        return res.status(200).json({ ok:true, restored_revision:id,
          undid: rows[0].change_type, article_code: rows[0].article_code,
          articles_total: result.articles, materials_total: result.materials,
          catalogue_total: result.catalogue });
      }

      const {parsed,routing,batch,confirm_replace=false,confirm_remove_ranges=false,bom_mode="replace"}=req.body||{};
      if(!["merge","replace"].includes(bom_mode)) return fail(res,400,"bom_mode must be merge or replace");
      const incoming=batch?.boms||(parsed?[parsed]:[]);
      if(!incoming.length&&!batch) return fail(res,400,"expected a parsed BOM or master workbook batch");
      const validated=incoming.map(validateBom);
      const label=validated.length===1?validated[0].parsed.article:null;
      const result=await mutateReference(batch?`master-upload-${bom_mode}`:`bom-upload-${bom_mode}`,label,async(ref,client)=>{
        const replacements=validated.map(x=>existingArticleCode(ref.articles,x.parsed.article)).filter(Boolean);
        if(bom_mode==="replace"&&replacements.length&&!confirm_replace)
          reject(`This upload would replace existing BOMs: ${[...new Set(replacements)].join(", ")}. Confirm replacement and upload again.`,409);

        /* A BOM upload replaces an article's ranges outright. A file sent to
           correct one rate, holding only that one range, therefore DELETES the
           rest — and any live order on a deleted range keeps consuming machine
           capacity while ordering zero material. Name what would go and make
           the caller say yes to that specifically, not just to "replace". */
        const removing=[];
        for(const item of validated){
          const code=existingArticleCode(ref.articles,item.parsed.article);
          if(!code) continue;
          const had=ref.articles[code].combo_order||Object.keys(ref.articles[code].combos||{});
          const gone=had.filter(c=>!item.parsed.combo_order.includes(c));
          if(gone.length) removing.push(`${code}: ${gone.join(", ")}`);
        }
        if(bom_mode==="replace"&&removing.length&&!confirm_remove_ranges)
          reject(`This upload also REMOVES size ranges that are loaded today — ${removing.join("; ")}. `
            +`Any order already placed on those ranges would lose its material rates. `
            +`Include every range for the article, or confirm the removal and upload again.`,409);

        let rates=0;const newMaterials=[];const articles=[];
        for(const item of validated){
          const existing=existingArticleCode(ref.articles,item.parsed.article);
          if(bom_mode==="merge"&&existing&&ref.articles[existing].sole_type&&ref.articles[existing].sole_type!==item.parsed.soleType)
            reject(`${existing}: update mode cannot change Sole Type from ${ref.articles[existing].sole_type} to ${item.parsed.soleType}. Use complete replacement if that change is intentional.`);
          const merged=mergeBom(ref,item.parsed,{routing,mode:bom_mode});
          Object.assign(ref,merged.reference);
          rates+=item.rates;newMaterials.push(...merged.newMaterials);articles.push(merged.article);
        }
        for(const [rawArticle,sizes] of Object.entries(batch?.individualSizes||{})){
          const art=existingArticleCode(ref.articles,rawArticle);
          if(!art) reject(`unknown article in individual sizes: ${rawArticle} — add its BOM first`);
          const current=ref.articles[art].individual_sizes||[];
          ref.articles[art].individual_sizes=[...new Set([...current,...(sizes||[]).map(String)])];
        }
        const packed=applyPacking(ref,batch?.packing||{});
        const packedSingles=applySinglePacking(ref,batch?.packingSingles||{});
        for(const art of new Set([...packed,...packedSingles])){
          if(ref.articles[art]) ref.articles[art].packing_source="SELF";
        }
        const priced=applyMrp(ref,batch?.mrp||{});
        const catalogue=[];
        for(const [raw,entry] of Object.entries(batch?.catalogue||{})){
          const art=existingArticleCode(ref.articles,raw);
          if(!art) reject(`unknown article in Catalogue sheet: ${raw} — add its BOM first`);
          if(entry.sole_type&&!SOLE_TYPES.includes(entry.sole_type)) reject(`${art}: invalid Sole Type`);
          if(entry.molding_machine&&!['ROTARY','VERTICAL'].includes(entry.molding_machine)) reject(`${art}: invalid PVC Machine`);
          if(entry.price!=null&&(!Number.isFinite(Number(entry.price))||Number(entry.price)<0)) reject(`${art}: Default Price must be 0 or more`);
          if(entry.description!=null&&String(entry.description).length>500) reject(`${art}: description must be 500 characters or fewer`);
          const soleColour=cleanColour(entry.sole_colour,`${art}: Sole Colour`);
          const upperColour=cleanColour(entry.upper_colour,`${art}: Upper Colour`);
          // Optional: only a supplied colour writes, so a Catalogue row about
          // something else never clears colours already on file.
          if(soleColour) ref.articles[art].sole_colour=soleColour;
          if(upperColour) ref.articles[art].upper_colour=upperColour;
          const notes=cleanNotes(entry.notes,art);
          if(notes) ref.articles[art].notes={...(ref.articles[art].notes||{}),...notes};
          if(Object.prototype.hasOwnProperty.call(entry,"packing_source")){
          if(entry.packing_source){
              const requested=String(entry.packing_source).toUpperCase();
              const source=requested==="SELF"?art:existingArticleCode(ref.articles,entry.packing_source);
              if(!source) reject(`${art}: Packing Source ${entry.packing_source} is not an article with a BOM`);
              ref.articles[art].packing_source=source===art?"SELF":source;
            }else if((batch?.packing||{})[art]||(batch?.packingSingles||{})[art]){
              // Supplying an article's own packing chart is an explicit
              // customization. Use it unless this same row names a source.
              ref.articles[art].packing_source="SELF";
            }else{
              delete ref.articles[art].packing_source;
            }
          }
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
        return {articles,replacements:[...new Set(replacements)],rates,newMaterials:[...new Set(newMaterials)],packed,packedSingles,priced,catalogue,
          articlesTotal:Object.keys(ref.articles||{}).length,materialsTotal:Object.keys(ref.materials||{}).length};
      });
      return res.status(200).json({
        ok:true,article:result.articles[0],articles:result.articles,
        replaced:result.replacements.length>0,replaced_articles:result.replacements,rates:result.rates,
        combos:validated.reduce((n,x)=>n+Object.keys(x.parsed.combos).length,0),
        new_materials:result.newMaterials,packing_articles:result.packed,
        single_packing_articles:result.packedSingles,mrp_articles:result.priced,catalogue_articles:result.catalogue,
        articles_total:result.articlesTotal,materials_total:result.materialsTotal,
      });
    }catch(e){if(e instanceof InputError)return fail(res,e.status,e.message);throw e;}
  }

  /* Direct edits: stock figures, packing chart, an article's sole type. */
  if(req.method === "PATCH"){
    try{
    const body=req.body||{};

    /* Bulk BOM removal: whole articles, whole size ranges, individual
       materials, or any mix, in one confirmed action. Removing them one at a
       time was the only way, which does not scale past a handful and made
       clearing out an article the factory no longer runs a morning's work.

       The preview and the deletion are computed by the SAME pure function, so
       what the clerk confirms is what happens — a preview produced by
       different code from the delete is a preview that can be wrong. */
    /* Product codes: one prefix per family, a number per variant, assigned
       ONCE and then kept. Only gaps are filled — a code already on a job card
       or a PI must never move, so this can be run again safely as articles are
       added. */
    if(body.assign_product_codes){
      let result=null;
      await mutateReference("product-codes",null,async ref=>{
        const names=Object.keys(ref.articles||{});
        const existing={};
        for(const n of names) if(ref.articles[n].product_code) existing[n]=ref.articles[n].product_code;
        result=assignCodes(names, existing);
        for(const [name,code] of Object.entries(result.codes)) ref.articles[name].product_code=code;
        return result;
      });
      return res.status(200).json({ ok:true, codes:result.codes,
        assigned:result.assigned, conflicts:result.conflicts,
        newly_coded:Object.keys(result.assigned).length });
    }

    if(body.bom_removal && typeof body.bom_removal === "object"){
      const sel=body.bom_removal;
      const dryRun=!!sel.dry_run;
      const ref=await current();
      const plan=planRemoval(ref,sel);
      if(plan.errors.length) return fail(res,400,plan.errors.slice(0,10).join("; "));
      if(plan.empty) return fail(res,400,"Nothing was selected for removal");

      /* Which live orders this would strand. Checked against active orders
         only — an archived order is already off the board. */
      const {rows:live}=await q(
        "select order_no, article_code, lines from orders where active order by order_no");
      const atRisk=ordersAtRisk(plan,live);

      if(dryRun)
        return res.status(200).json({ dry_run:true, plan, orders_at_risk:atRisk });

      /* The default is to refuse. An order whose article vanishes cannot be
         planned at all, so this is a real consequence and not a formality —
         it is overridable, but only by saying so about THESE orders. */
      if(atRisk.length && !sel.confirm_in_use){
        const names=atRisk.slice(0,8).map(r=>`${r.order_no} (${r.detail})`).join("; ");
        return fail(res,409,
          `${atRisk.length} live order${atRisk.length===1?"":"s"} depend${atRisk.length===1?"s":""} on what you are removing: `
          +`${names}${atRisk.length>8?"; and more":""}. Those orders will stay on the sheet but cannot be planned `
          +`until their article is restored or they are re-articled. Confirm to remove anyway.`);
      }

      const label=plan.articles.length===1&&!plan.ranges.length&&!plan.materials.length
        ?plan.articles[0].article:null;
      await mutateReference("bom-bulk-remove",label,async ref2=>{
        /* Re-planned against the row this transaction locked, so a BOM
           uploaded between the preview and the confirmation cannot cause a
           stale plan to delete something the clerk never saw. */
        const fresh=planRemoval(ref2,sel);
        if(fresh.errors.length) reject(fresh.errors.slice(0,10).join("; "));
        if(fresh.empty) reject("Nothing was selected for removal");
        applyRemoval(ref2,fresh);
        return fresh;
      });

      return res.status(200).json({ ok:true, removed:plan.totals,
        removed_articles:plan.articles.map(a=>a.article),
        removed_ranges:plan.ranges.map(r=>`${r.article} ${r.combo}`),
        removed_materials:plan.materials.length,
        emptied_ranges:plan.emptied_ranges, emptied_articles:plan.emptied_articles,
        orders_affected:atRisk });
    }

    let removedBomItems=0;
    const directChangeType=body.bom_remove?"bom-item-remove":"reference-edit";
    const directChangeArticle=Array.isArray(body.bom_remove)&&body.bom_remove.length===1
      ?articleCode(body.bom_remove[0]?.article):null;
    await mutateReference(directChangeType,directChangeArticle,async ref=>{
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
    if(body.packing_singles && typeof body.packing_singles === "object"){
      applySinglePacking(ref,body.packing_singles,{allowDelete:true});
    }
    if(body.bom_remove!=null){
      if(!Array.isArray(body.bom_remove)||!body.bom_remove.length) reject("bom_remove must contain at least one BOM item");
      for(const item of body.bom_remove){
        const art=existingArticleCode(ref.articles,item?.article);
        if(!art) reject(`unknown BOM article: ${item?.article||"blank"}`);
        const combo=String(item?.combo||"").toUpperCase().replace(/\s+/g,"");
        const stage=String(item?.stage||"").toUpperCase();
        const material=String(item?.material||"");
        const rates=ref.articles[art]?.combos?.[combo]?.rates?.[stage];
        if(!rates||!Object.prototype.hasOwnProperty.call(rates,material))
          reject(`${art} ${combo}: BOM item ${stage} / ${material} was not found`);
        delete rates[material];removedBomItems++;
        if(!Object.keys(rates).length) delete ref.articles[art].combos[combo].rates[stage];
        const remaining=Object.values(ref.articles[art].combos[combo].rates||{})
          .reduce((n,entries)=>n+Object.keys(entries||{}).length,0);
        if(!remaining) reject(`${art} ${combo}: cannot remove its last BOM item; replace or delete the complete size range instead`);
      }
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
    if(body.mrp && typeof body.mrp === "object") applyMrp(ref,body.mrp);
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
    return res.status(200).json({ ok:true, removed_bom_items:removedBomItems });
    }catch(e){if(e instanceof InputError)return fail(res,e.status,e.message);throw e;}
  }

  return fail(res, 405, `${req.method} not allowed`);
});
