import { db, q } from "./_lib/db.js";
import { planAddRange } from "../shared/add-range.js";
import { fail, wrap } from "./_lib/http.js";
import { INPUTS } from "../shared/inputs.js";
import { articleCode, existingArticleCode, mergeBom } from "../shared/bom-import.js";
import { SOLE_TYPES, routingForSole } from "../shared/reference-edit.js";
import { resolveArticleSizeIn, splitScopedSizeKey, scopedSizeKey } from "../shared/bridge.js";
import { planRemoval, applyRemoval, ordersAtRisk } from "../shared/bom-removal.js";
import { assignCodes } from "../shared/product-codes.js";
import { colouredMaterialName } from "../shared/bom-import.js";
import { validatePurchaseOrder, validatePurchaseReceipt,
         purchaseOrderProgress } from "../shared/purchase-orders.js";

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

/* Supplier purchase orders share the reference endpoint so the deployment
   stays inside Vercel's twelve-function limit. They are NOT reference data:
   their own tables hold the commercial document and an immutable receipt log.
   A receipt also books the same quantity into the stock register, in the same
   transaction, so PO tracking and physical stock cannot disagree. */
async function ensurePurchaseOrderTables(client=null){
  const run=client?client.query.bind(client):q;
  await run("create sequence if not exists purchase_order_no_seq start 1");
  await run(`create table if not exists purchase_orders (
    po_no text primary key,
    supplier text not null,
    po_date date not null,
    expected_on date,
    status text not null default 'open' check (status in ('open','partial','received','cancelled')),
    additional_information text not null default '',
    lines jsonb not null,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
  await run(`create table if not exists purchase_order_receipts (
    id bigserial primary key,
    po_no text not null references purchase_orders(po_no) on delete restrict,
    received_on date not null,
    lines jsonb not null,
    note text not null default '',
    received_by text,
    created_at timestamptz not null default now()
  )`);
  await run("create index if not exists purchase_order_receipts_po_idx on purchase_order_receipts (po_no, received_on, id)");
}

const isoDate=value=>value instanceof Date?value.toISOString().slice(0,10):String(value||"").slice(0,10);
const poRow=(row,receipts=[])=>purchaseOrderProgress({
  po_no:row.po_no,supplier:row.supplier,po_date:isoDate(row.po_date),
  expected_on:row.expected_on?isoDate(row.expected_on):"",status:row.status,
  additional_information:row.additional_information||"",lines:row.lines||[],
  created_by:row.created_by||"",created_at:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at||""),
  receipts:receipts.map(r=>({id:r.id,received_on:isoDate(r.received_on),lines:r.lines||[],
    note:r.note||"",received_by:r.received_by||"",created_at:r.created_at instanceof Date?r.created_at.toISOString():String(r.created_at||"")})),
});

async function purchaseOrders(req,res){
  if(req.method==="GET"){
    await ensurePurchaseOrderTables();
    const {rows:orders}=await q(`select po_no, supplier, po_date, expected_on, status,
      additional_information, lines, created_by, created_at
      from purchase_orders order by po_date desc, po_no desc`);
    const {rows:receipts}=await q(`select id, po_no, received_on, lines, note, received_by, created_at
      from purchase_order_receipts order by received_on, id`);
    const by={};for(const receipt of receipts)(by[receipt.po_no]=by[receipt.po_no]||[]).push(receipt);
    return res.status(200).json(orders.map(order=>poRow(order,by[order.po_no]||[])));
  }

  if(req.method==="POST"){
    const bulk=Array.isArray(req.body?.purchase_orders);
    const inputs=bulk?req.body.purchase_orders:[req.body||{}];
    if(!inputs.length)return fail(res,400,"The upload has no purchase orders");
    if(inputs.length>50)return fail(res,400,"One upload can create at most 50 purchase orders");
    const checkedOrders=[];
    for(let index=0;index<inputs.length;index++){
      const checked=validatePurchaseOrder(inputs[index]);
      if(!checked.ok)return fail(res,400,`${bulk?`PO group ${index+1}: `:""}${checked.error}`);
      checkedOrders.push(checked.value);
    }
    /* Names and units come from the material master, never from the browser.
       Otherwise a direct request could put an invented material on an
       official PO even though Stock could never receive it. */
    const ref=await current();
    for(const order of checkedOrders)for(const line of order.lines){
        const material=ref.materials?.[line.material_key];
        if(!material)return fail(res,409,`${line.material_key} is not in the material register`);
        line.name=material.name;line.uom=material.uom;
      }
    const client=await db().connect();
    try{
      await client.query("begin");await ensurePurchaseOrderTables(client);
      const made=[];
      for(const checked of checkedOrders){
        const {rows:numberRows}=await client.query("select nextval('purchase_order_no_seq') as n");
        const no=`PO-${checked.po_date.slice(0,4)}-${String(numberRows[0].n).padStart(6,"0")}`;
        const {rows}=await client.query(`insert into purchase_orders
          (po_no,supplier,po_date,expected_on,additional_information,lines,created_by)
          values ($1,$2,$3,$4,$5,$6,$7)
          returning po_no,supplier,po_date,expected_on,status,additional_information,lines,created_by,created_at`,
          [no,checked.supplier,checked.po_date,checked.expected_on,
           checked.additional_information,JSON.stringify(checked.lines),req.user?.username||null]);
        made.push(poRow(rows[0]||{...checked,po_no:no,status:"open",created_by:req.user?.username},[]));
      }
      await client.query("commit");
      return res.status(201).json(bulk?{purchase_orders:made}:made[0]);
    }catch(error){try{await client.query("rollback");}catch(_){}throw error;}finally{client.release();}
  }

  if(req.method==="PATCH"){
    const body=req.body||{}, action=String(body.action||"receive"), no=String(body.po_no||"").trim();
    if(!no)return fail(res,400,"PO number is required");
    await ensurePurchaseOrderTables();
    if(action==="cancel"){
      const {rows}=await q(`update purchase_orders set status='cancelled',updated_at=now()
        where po_no=$1 and status in ('open','partial')
        returning po_no,status`,[no]);
      if(!rows.length)return fail(res,404,`No open purchase order ${no} was found`);
      return res.status(200).json({po_no:no,status:"cancelled"});
    }
    if(action==="update"){
      const {rows:found}=await q("select * from purchase_orders where po_no=$1",[no]);
      if(!found.length)return fail(res,404,`No purchase order ${no} was found`);
      const merged={...found[0],...body,lines:found[0].lines,
        po_date:body.po_date||isoDate(found[0].po_date),
        expected_on:Object.prototype.hasOwnProperty.call(body,"expected_on")?body.expected_on:isoDate(found[0].expected_on)};
      const checked=validatePurchaseOrder(merged);
      if(!checked.ok)return fail(res,400,checked.error);
      const {rows}=await q(`update purchase_orders set supplier=$2,po_date=$3,expected_on=$4,
        additional_information=$5,updated_at=now() where po_no=$1
        returning po_no,supplier,po_date,expected_on,status,additional_information,lines,created_by,created_at`,
        [no,checked.value.supplier,checked.value.po_date,checked.value.expected_on,checked.value.additional_information]);
      return res.status(200).json(poRow(rows[0],[]));
    }
    if(action!=="receive")return fail(res,400,"action must be receive, update or cancel");

    const client=await db().connect();
    try{
      await client.query("begin");await ensurePurchaseOrderTables(client);
      const {rows:orders}=await client.query("select * from purchase_orders where po_no=$1 for update",[no]);
      if(!orders.length){await client.query("rollback");return fail(res,404,`No purchase order ${no} was found`);}
      if(orders[0].status==="cancelled"){await client.query("rollback");return fail(res,409,`${no} is cancelled`);}
      const {rows:prior}=await client.query(`select id,po_no,received_on,lines,note,received_by,created_at
        from purchase_order_receipts where po_no=$1 order by received_on,id`,[no]);
      const order=poRow(orders[0],prior), checked=validatePurchaseReceipt(body,order);
      if(!checked.ok){await client.query("rollback");return fail(res,400,checked.error);}

      const {rows:refs}=await client.query("select value from reference_data where id=1 for update");
      const ref=JSON.parse(JSON.stringify(refs.length?refs[0].value:INPUTS));
      const before=JSON.stringify(ref);
      ref.stock_meta=ref.stock_meta||{};
      for(const received of checked.value.lines){
        if(!ref.materials?.[received.material_key]){
          await client.query("rollback");
          return fail(res,409,`${received.material_key} is no longer in the material register`);
        }
        const material=ref.materials[received.material_key];
        const meta={...(ref.stock_meta[received.material_key]||{})};
        if(meta.opening==null&&meta.rec==null&&meta.issue==null)meta.opening=Number(material.stock)||0;
        meta.rec=(Number(meta.rec)||0)+received.quantity;
        ref.stock_meta[received.material_key]=meta;
        material.stock=(Number(meta.opening)||0)+(Number(meta.rec)||0)-(Number(meta.issue)||0);
      }
      await client.query(`insert into reference_data_history (change_type,article_code,value)
                          values ('purchase-order-receipt',null,$1)`,[before]);
      await client.query(`insert into reference_data (id,value) values (1,$1)
                          on conflict (id) do update set value=$1,updated_at=now()`,[JSON.stringify(ref)]);
      const {rows:made}=await client.query(`insert into purchase_order_receipts
        (po_no,received_on,lines,note,received_by) values ($1,$2,$3,$4,$5)
        returning id,po_no,received_on,lines,note,received_by,created_at`,
        [no,checked.value.received_on,JSON.stringify(checked.value.lines),checked.value.note,req.user?.username||null]);
      const next=poRow(orders[0],[...prior,made[0]]);
      await client.query("update purchase_orders set status=$2,updated_at=now() where po_no=$1",[no,next.status]);
      await client.query("commit");
      return res.status(201).json(next);
    }catch(error){try{await client.query("rollback");}catch(_){}throw error;}finally{client.release();}
  }
  return fail(res,405,`${req.method} not allowed`);
}

export default wrap(async (req, res) => {
  if(String((req.query||{}).resource||"")==="purchase_orders"
     || String((req.body||{}).resource||"")==="purchase_orders")
    return purchaseOrders(req,res);
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
        let restoredCodes = 0;
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
          /* A PRODUCT CODE IS AN IDENTITY, NOT A STATE.
             The restore replaces the whole reference document, which rolled the
             codes back with it — a restore on 4 Sep silently wiped every JACK
             and JILL code assigned that morning. That defeats the one guarantee
             the codes exist for: JA003 is printed on a job card and a PI, and
             if a rollback frees it, the next assignment can hand JA003 to a
             DIFFERENT article and last month's paperwork quietly points at the
             wrong shoe. Codes are carried across; everything else — BOM,
             packing, MRP, stock — rolls back as before. */
          const keepCodes = {};
          for(const [name, def] of Object.entries(ref.articles || {}))
            if(def && def.product_code) keepCodes[name] = def.product_code;

          for(const k of Object.keys(ref)) delete ref[k];
          Object.assign(ref, snapshotRef);

          let carried = 0;
          for(const [name, code] of Object.entries(keepCodes)){
            /* Only for articles the snapshot still has. One that the restore
               removes takes its code with it, which is correct. */
            if(ref.articles && ref.articles[name] && ref.articles[name].product_code !== code){
              ref.articles[name].product_code = code;
              carried++;
            }
          }
          restoredCodes = carried;
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
          catalogue_total: result.catalogue,
          /* Reported so the person restoring can SEE that the codes were kept
             rather than having to trust it. */
          product_codes_kept: restoredCodes });
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

    /* A NEW SIZE RANGE on an existing article — e.g. big 11–12 on GOLA PLUS —
       without re-uploading the whole workbook. Rates are copied only from a
       range the person names; pack quantity and MRP only as typed. See
       shared/add-range.js. Master data: the reference allowlist keeps it to
       admin and the data manager. */
    if(body.add_combo && typeof body.add_combo === "object"){
      const pre = planAddRange(await current(), body.add_combo);
      if(pre.problems.length) return fail(res, 400, pre.problems.join("; "));
      let plan = null;
      await mutateReference("add-range", pre.article, async ref => {
        plan = planAddRange(ref, body.add_combo);
        if(plan.problems.length) reject(plan.problems.join("; "));
        plan.apply(ref);
        return { combo:plan.combo };
      });
      return res.status(200).json({ ok:true, article:plan.article, combo:plan.combo, sizes:plan.sizes,
        copied_from:plan.copied_from, warnings:plan.warnings });
    }

    /* A material the BOM has never mentioned. Today one can only be born from a
       BOM upload, and the Stock register refuses a figure against a material it
       does not know — so a delivery of something new cannot be recorded at all
       until somebody edits a workbook. */
    if(body.new_material && typeof body.new_material === "object"){
      const m = body.new_material;
      const name = String(m.name || "").replace(/\s+/g," ").trim().toUpperCase();
      const uom  = String(m.uom  || "").replace(/\s+/g," ").trim().toUpperCase();
      if(!name) return fail(res, 400, "A material name is required");
      if(!uom)  return fail(res, 400, "A unit of measure is required — it is part of the material's identity");
      if(name.length > 200) return fail(res, 400, "Material name must be 200 characters or fewer");

      const num = (v,label) => {
        if(v == null || v === "") return 0;
        const n = Number(v);
        if(!Number.isFinite(n) || n < 0) throw new Error(`${label} must be 0 or more`);
        return n;
      };
      let opening, min, rate, supplierRate;
      try{ opening = num(m.opening,"Opening stock"); min = num(m.min,"Minimum"); rate = num(m.rate,"Rate");
           supplierRate = num(m.supplier_rate,"Supplier rate"); }
      catch(e){ return fail(res, 400, e.message); }
      const supplier = String(m.supplier || "").replace(/\s+/g," ").trim().slice(0,120);
      const dispatchLocation = String(m.dispatch_location || "").replace(/\s+/g," ").trim().slice(0,120);

      /* Checked BEFORE the transaction so the answer is a sentence rather than
         a 500. The in-transaction check below stays as the real guard — two
         people adding the same material at once would both pass this one. */
      const existing = await current();
      const preview = `${colouredMaterialName(name, m.colour)}||${uom}`;
      if((existing.materials || {})[preview])
        return fail(res, 409, `${preview} is already on the material list. `
          + `Search for it on the Stock register and set its figures there.`);

      let created = null, key = "";
      try{
      await mutateReference("material-add", null, async ref => {
        /* The colour is folded into the NAME, because black and blue rexine are
           bought, stocked and netted separately — the same rule the BOM import
           follows, so a material added here and one added by upload land on the
           same key rather than becoming two materials. */
        const full = colouredMaterialName(name, m.colour);
        key = `${full}||${uom}`;
        if(ref.materials[key]) throw Object.assign(new Error(`${key} is already on the material list`), {status:409});
        ref.materials[key] = { name: full, uom, stock: opening,
          ...(String(m.colour||"").trim() ? { colour: String(m.colour).trim().toUpperCase() } : {}) };
        ref.stock_meta = ref.stock_meta || {};
        ref.stock_meta[key] = { opening, rec:0, issue:0,
          ...(min ? { min_stock:min } : {}), ...(rate ? { rate } : {}),
          ...(supplier ? { supplier } : {}), ...(supplierRate ? { supplier_rate:supplierRate } : {}),
          ...(dispatchLocation ? { dispatch_location:dispatchLocation } : {}) };
        created = ref.materials[key];
      });
      }catch(e){
        if(e && e.status === 409) return fail(res, 409, e.message);
        throw e;
      }

      return res.status(201).json({ ok:true, material_key:key, material:created });
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
        /* A material whose only figure came from the BOM upload has no
           movement record yet — its stock lives in materials.stock alone. The
           first receipt against it used to rebuild stock as 0 + received and
           wipe that figure. It becomes the opening balance instead. */
        if(cur.opening == null && cur.rec == null && cur.issue == null)
          cur.opening = Number(ref.materials[key].stock) || 0;
        /* A DELIVERY IS ADDED BY THE SERVER, NOT TOTALLED BY THE BROWSER.
           `rec` is a running total. Two people booking deliveries from two
           screens would each send "what I saw + what arrived", and the second
           save would silently erase the first — goods in the store, not on the
           register. `rec_add` is applied here, inside the row lock above. */
        if("rec_add" in fields){
          if("rec" in fields) reject(`send either rec or rec_add for ${key}, not both`);
          const n = Number(fields.rec_add);
          if(!isFinite(n) || n <= 0) reject(`quantity received for ${key} must be more than 0`);
          cur.rec = (Number(cur.rec) || 0) + n;
        }
        for(const [f, v] of Object.entries(fields)){
          if(f === "rec_add") continue;
          if(["category","size","supplier","dispatch_location"].includes(f)){ cur[f] = String(v).slice(0,120); continue; }
          if(!["opening","rec","issue","min_stock","min","rate","supplier_rate"].includes(f))
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
    /* WHICH PART OF THE CATALOGUE an article belongs in — the client's own
       "Toddler / MTO / Regular" tabs. Free text, and deliberately so: their
       printed catalogue names its own sections differently again
       (Kindergarten, PVC, EVA, Rubber, Regular), so a fixed list here would
       either refuse the factory's real words or invent a taxonomy nobody
       uses. Blank clears it, and an article with no section is counted as
       unassigned on screen rather than being dropped into a default. */
    if(body.section && typeof body.section === "object"){
      for(const [art, value] of Object.entries(body.section)){
        if(!ref.articles[art]) reject(`unknown article: ${art}`);
        const name = value == null ? "" : String(value).trim().slice(0,40);
        ref.articles[art].section = name || null;
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
