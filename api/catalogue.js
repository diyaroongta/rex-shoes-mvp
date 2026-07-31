import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";

export default wrap(async (req, res) => {
  if(req.method === "GET"){
    const { rows } = await q("select article_code, image, description, price from catalogue order by article_code");
    return res.status(200).json(Object.fromEntries(rows.map(r => [r.article_code, r])));
  }

  if(req.method === "PUT"){
    const { article_code, image, description, price } = req.body || {};
    if(!article_code) return fail(res, 400, "article_code is required");
    if(image && image.length > 1_500_000) return fail(res, 413, "image too large — it should be resized before upload");
    const p = price == null || price === "" ? null : Number(price);
    if(p != null && (!isFinite(p) || p < 0)) return fail(res, 400, "price must be a number");
    await q(`insert into catalogue (article_code, image, description, price)
             values ($1,$2,$3,$4)
             on conflict (article_code) do update set
               image = coalesce($2, catalogue.image),
               description = coalesce($3, catalogue.description),
               price = coalesce($4, catalogue.price),
               updated_at = now()`,
            [article_code, image || null, description || null, p]);
    return res.status(200).json({ ok:true, article_code });
  }

  if(req.method === "DELETE"){
    const { article_code } = req.query;
    if(!article_code) return fail(res, 400, "article_code is required");
    await q("delete from catalogue where article_code = $1", [article_code]);
    return res.status(200).json({ deleted: article_code });
  }

  return fail(res, 405, `${req.method} not allowed`);
});
