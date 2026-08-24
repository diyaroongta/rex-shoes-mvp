import { db, q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { INPUTS } from "../shared/inputs.js";
import { existingArticleCode } from "../shared/bom-import.js";

export default wrap(async (req, res) => {
  if(req.method === "GET"){
    const { rows } = await q("select article_code, image, description, price from catalogue order by article_code");
    return res.status(200).json(Object.fromEntries(rows.map(r => [r.article_code, r])));
  }

  if(req.method === "PUT"){
    const { article_code, image, description, price } = req.body || {};
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
      const ref=rows.length?rows[0].value:INPUTS;
      const canonical=existingArticleCode(ref.articles,article_code);
      if(!canonical){await client.query("rollback");return fail(res,400,`unknown article: ${article_code} — upload its BOM first`);}
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
      return res.status(200).json({ok:true,article_code:canonical});
    }catch(e){try{await client.query("rollback");}catch(_){ }throw e;}
    finally{client.release();}
  }

  if(req.method === "DELETE"){
    const { article_code } = req.query;
    if(!article_code) return fail(res, 400, "article_code is required");
    await q("delete from catalogue where article_code = $1", [article_code]);
    return res.status(200).json({ deleted: article_code });
  }

  return fail(res, 405, `${req.method} not allowed`);
});
