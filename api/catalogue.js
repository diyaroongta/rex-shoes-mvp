import { db, q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { INPUTS } from "../shared/inputs.js";
import { articleCode, existingArticleCode } from "../shared/bom-import.js";
import { SOLE_TYPES, routingForSole } from "../shared/reference-edit.js";

export default wrap(async (req, res) => {
  if(req.method === "GET"){
    const { rows } = await q("select article_code, image, description, price from catalogue order by article_code");
    return res.status(200).json(Object.fromEntries(rows.map(r => [r.article_code, r])));
  }

  if(req.method === "PUT"){
    const { article_code, image, description, price, create_catalogue_only=false, sole_type="EVA" } = req.body || {};
    if(!article_code) return fail(res, 400, "article_code is required");
    if(image && image.length > 1_500_000) return fail(res, 413, "image too large — it should be resized before upload");
    if(image && !/^data:image\/(?:jpeg|png|webp);base64,/i.test(image)) return fail(res,400,"image must be a JPEG, PNG or WebP file");
    if(description!=null && String(description).length>500) return fail(res,400,"description must be 500 characters or fewer");
    const p = price == null || price === "" ? null : Number(price);
    if(p != null && (!isFinite(p) || p < 0)) return fail(res, 400, "price must be a number");
    const client=await db().connect();
    try{
      await client.query("begin");
      const {rows}=await client.query("select value from reference_data where id=1");
      const ref=JSON.parse(JSON.stringify(rows.length?rows[0].value:INPUTS));
      let canonical=existingArticleCode(ref.articles,article_code);
      let createdWithoutBom=false;
      if(!canonical){
        if(!create_catalogue_only){await client.query("rollback");return fail(res,400,`unknown article: ${article_code} — upload its BOM first`);}
        canonical=articleCode(article_code);
        const sole=String(sole_type||"").toUpperCase();
        if(!canonical){await client.query("rollback");return fail(res,400,"article_code is required");}
        if(!SOLE_TYPES.includes(sole)){await client.query("rollback");return fail(res,400,"sole_type must be EVA, PVC, PU or STUCK-ON");}
        const catalogueBefore=await client.query("select article_code, image, description, price from catalogue order by article_code for update");
        const before=JSON.stringify({reference:ref,catalogue:catalogueBefore.rows});
        ref.articles=ref.articles||{};
        ref.articles[canonical]={sole_type:sole,sole_assumed:false,combo_order:[],combos:{},
          routing:routingForSole(["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","PACKING","DISPATCH"],sole)};
        await client.query(`insert into reference_data (id, value) values (1, $1)
                            on conflict (id) do update set value=$1, updated_at=now()`,[JSON.stringify(ref)]);
        await client.query(`insert into reference_data_history (change_type, article_code, value)
                            values ('catalogue-only-add',$1,$2)`,[canonical,before]);
        createdWithoutBom=true;
      }
      const previous=await client.query("select article_code, image, description, price from catalogue where article_code=$1 for update",[canonical]);
      await client.query("insert into catalogue_history (article_code, value) values ($1,$2)",
                         [canonical,JSON.stringify(previous.rows[0]||{article_code:canonical,existed:false})]);
      await client.query(`insert into catalogue (article_code, image, description, price)
                          values ($1,$2,$3,$4)
                          on conflict (article_code) do update set
                            image = coalesce($2, catalogue.image),
                            description = coalesce($3, catalogue.description),
                            price = coalesce($4, catalogue.price),
                            updated_at = now()`,
                         [canonical,image||null,description==null?null:String(description),p]);
      await client.query("commit");
      const ranges=ref.articles[canonical]?.combo_order||Object.keys(ref.articles[canonical]?.combos||{});
      return res.status(200).json({ok:true,article_code:canonical,created_without_bom:createdWithoutBom,missing_bom:!ranges.length});
    }catch(e){try{await client.query("rollback");}catch(_){ }throw e;}
    finally{client.release();}
  }

  if(req.method === "DELETE"){
    const { article_code } = req.query || {};
    if(!article_code) return fail(res, 400, "article_code is required");
    const client=await db().connect();
    try{
      await client.query("begin");
      const {rows}=await client.query("select value from reference_data where id=1 for update");
      const ref=JSON.parse(JSON.stringify(rows.length?rows[0].value:INPUTS));
      const canonical=existingArticleCode(ref.articles,article_code);
      if(!canonical){await client.query("rollback");return fail(res,404,`unknown article: ${article_code}`);}
      const definition=ref.articles[canonical]||{};
      const ranges=definition.combo_order||Object.keys(definition.combos||{});
      if(ranges.length){
        await client.query("rollback");
        return fail(res,409,`${canonical} already has a BOM. Remove individual BOM items in Packing & BOM rules; a complete article cannot be deleted from Catalogue.`);
      }

      const catalogueBefore=await client.query(
        "select article_code, image, description, price from catalogue order by article_code for update");
      const before=JSON.stringify({reference:ref,catalogue:catalogueBefore.rows});
      delete ref.articles[canonical];
      if(ref.packing) delete ref.packing[canonical];
      if(ref.packing_singles_exact) delete ref.packing_singles_exact[canonical];
      if(ref.mrp) delete ref.mrp[canonical];
      await client.query("delete from catalogue where article_code = $1",[canonical]);
      await client.query(`insert into reference_data (id, value) values (1, $1)
                          on conflict (id) do update set value=$1, updated_at=now()`,[JSON.stringify(ref)]);
      await client.query(`insert into reference_data_history (change_type, article_code, value)
                          values ('catalogue-item-delete',$1,$2)`,[canonical,before]);
      await client.query("commit");
      return res.status(200).json({deleted:canonical,removed_article:true});
    }catch(e){try{await client.query("rollback");}catch(_){ }throw e;}
    finally{client.release();}
  }

  return fail(res, 405, `${req.method} not allowed`);
});
