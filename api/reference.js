import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { INPUTS } from "../shared/inputs.js";
import { mergeBom } from "../shared/bom-import.js";

/* Reference data lives in the database so a BOM upload never needs a deploy.
   The bundled inputs.js is the seed used on first run. */
async function current(){
  const { rows } = await q("select value from reference_data where id = 1");
  return rows.length ? rows[0].value : INPUTS;
}
async function save(value){
  await q(`insert into reference_data (id, value) values (1, $1)
           on conflict (id) do update set value = $1, updated_at = now()`,
          [JSON.stringify(value)]);
}

export default wrap(async (req, res) => {
  if(req.method === "GET"){
    const ref = await current();
    return res.status(200).json(ref);
  }

  /* Merge one parsed BOM workbook. The client parses the sheet with the shared
     parser and posts the result; everything is re-checked here. */
  if(req.method === "POST"){
    const { parsed, routing } = req.body || {};
    if(!parsed || !parsed.article || !parsed.combos) return fail(res, 400, "expected a parsed BOM in { parsed }");
    if(!parsed.soleType) return fail(res, 400, "soleType is required — it decides which machine the article uses");

    const ref = await current();
    let rates = 0;
    for(const c of Object.values(parsed.combos)){
      if(!c.rates || !Object.keys(c.rates).length) return fail(res, 400, "a size range has no rates");
      for(const st of Object.values(c.rates)) rates += Object.keys(st).length;
    }
    if(!rates) return fail(res, 400, "no rates found in the upload");

    const { reference, replaced, newMaterials } = mergeBom(ref, parsed, { routing });
    await save(reference);
    return res.status(200).json({
      article: parsed.article, replaced, rates,
      combos: Object.keys(parsed.combos).length,
      new_materials: newMaterials,
      articles_total: Object.keys(reference.articles).length,
      materials_total: Object.keys(reference.materials).length,
    });
  }

  /* Direct edits: stock figures, packing chart, an article's sole type. */
  if(req.method === "PATCH"){
    const ref = await current();
    const { stock, packing, sole_type } = req.body || {};
    if(stock && typeof stock === "object"){
      for(const [key, v] of Object.entries(stock)){
        if(!ref.materials[key]) return fail(res, 400, `unknown material: ${key}`);
        const n = Number(v);
        if(!isFinite(n) || n < 0) return fail(res, 400, `stock for ${key} must be 0 or more`);
        ref.materials[key].stock = n;
      }
    }
    if(packing && typeof packing === "object"){
      ref.packing = ref.packing || {};
      for(const [art, chart] of Object.entries(packing)){
        if(!ref.articles[art]) return fail(res, 400, `unknown article: ${art}`);
        const clean = {};
        for(const [combo, ppc] of Object.entries(chart)){
          const n = Math.round(Number(ppc));
          if(!Number.isFinite(n) || n < 1) return fail(res, 400, `pairs/carton for ${art} ${combo} must be 1 or more`);
          clean[combo] = n;
        }
        ref.packing[art] = clean;
      }
    }
    if(sole_type && typeof sole_type === "object"){
      for(const [art, st] of Object.entries(sole_type)){
        if(!ref.articles[art]) return fail(res, 400, `unknown article: ${art}`);
        if(!["PVC","PU","EVA","STUCK-ON"].includes(st)) return fail(res, 400, `bad sole type: ${st}`);
        ref.articles[art].sole_type = st;
        ref.articles[art].sole_assumed = false;
      }
    }
    await save(ref);
    return res.status(200).json({ ok:true });
  }

  return fail(res, 405, `${req.method} not allowed`);
});
