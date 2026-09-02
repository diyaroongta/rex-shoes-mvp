/* Components: the cut pieces a material is turned into.
 *
 * One material yields several components — ARMOR REXION becomes VAMP, ADDI,
 * PALTA and the rest — and the same component name can be cut from more than
 * one material. The BOM therefore carries components hanging off a material
 * row, not instead of it.
 *
 * THE RULE THAT KEEPS PROCUREMENT CORRECT: a component is a BREAKDOWN of its
 * material, never an addition to it. The material rate already covers every
 * component cut from it, so buying, netting and stock are computed exactly as
 * before and components are invisible to them. Treating a component as its own
 * demand would double-count the material it comes from — ordering the rexine
 * once for the sheet and again for each of the fourteen pieces cut out of it.
 *
 * So there are two views of one BOM:
 *
 *   material-wise    what to buy, what is in stock, what the BOM screens show
 *   component-wise   what a job card issues to a fabricator, per stage
 *
 * Component quantities are pieces per PAIR, which is how the job card reads:
 * VAMP 2/pair over 912 pairs prints 1,824 PCS.
 */

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clean = v => String(v == null ? "" : v).trim();

/* Components stored against one article's size range, as
   { STAGE: { MATERIAL: [ {name, per_pair, uom} ] } }. Kept beside `rates`
   rather than inside it so every existing reader of `rates` — the planner, the
   netting, every BOM screen — is untouched by this. */
export function componentsOf(article, combo, stage){
  const c = ((((article || {}).combos || {})[combo] || {}).components || {})[stage];
  return c && typeof c === "object" ? c : {};
}

export function hasComponents(article){
  for(const combo of Object.values((article || {}).combos || {}))
    for(const byMaterial of Object.values(combo.components || {}))
      for(const list of Object.values(byMaterial || {}))
        if(Array.isArray(list) && list.length) return true;
  return false;
}

/* What a job card issues, stage by stage.
 *
 * A stage that has components lists its COMPONENTS; a stage that has none — the
 * stitching consumables, thread and labels and velcro — lists its MATERIALS, as
 * the factory's own card does. Nothing is invented for a stage that has no
 * component data: it falls back to materials and says so, rather than printing
 * an empty cutting list that reads as "nothing to cut". */
export function jobCardIssue(lines, article, opts = {}){
  const stages = {};
  const missing = new Set();

  for(const line of lines || []){
    const combo = clean(line.combo);
    const qty = Math.round(num(line.qty));
    if(qty <= 0) continue;
    const rates = (((article || {}).combos || {})[combo] || {}).rates || {};

    for(const [stage, materials] of Object.entries(rates)){
      const bucket = stages[stage] || (stages[stage] = { stage, components: {}, materials: {}, from_components: false });

      for(const [material, rate] of Object.entries(materials || {})){
        /* The material line is always accumulated: it is what procurement and
           the store work from, and the card's second half prints it directly. */
        const m = bucket.materials[material]
          || (bucket.materials[material] = { material, name: nameOf(material), uom: uomOf(material), qty: 0 });
        m.qty = round4(m.qty + num(rate) * qty);

        const list = componentsOf(article, combo, stage)[material];
        if(!Array.isArray(list) || !list.length){
          if(stage === "CUTTING") missing.add(material);
          continue;
        }
        for(const comp of list){
          const name = clean(comp.name);
          if(!name) continue;
          const key = `${name}||${clean(comp.uom) || "PCS"}`;
          const c = bucket.components[key] || (bucket.components[key] = {
            name, uom: clean(comp.uom) || "PCS", per_pair: 0, qty: 0,
            /* Which material it is cut from — the store issues the material,
               the card names the piece, and the two have to be traceable. */
            materials: [],
          });
          c.per_pair = num(comp.per_pair);
          c.qty = round4(c.qty + num(comp.per_pair) * qty);
          if(!c.materials.includes(material)) c.materials.push(material);
        }
      }
    }
  }

  const out = Object.values(stages).map(b => {
    const components = Object.values(b.components).sort((a, z) => a.name.localeCompare(z.name));
    const materials = Object.values(b.materials).sort((a, z) => a.name.localeCompare(z.name));
    return {
      stage: b.stage,
      /* The card prints components where they exist, materials where they do
         not. `issued` is what to put on the document either way. */
      from_components: components.length > 0,
      components, materials,
      issued: components.length ? components : materials,
    };
  });

  const order = opts.stageOrder || ["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","ASSEMBLY","PACKING","DISPATCH"];
  out.sort((a, z) => {
    const ia = order.indexOf(a.stage), iz = order.indexOf(z.stage);
    return (ia < 0 ? 99 : ia) - (iz < 0 ? 99 : iz);
  });

  return { stages: out, missing_components: [...missing].sort() };
}

/* The material view — unchanged behaviour, stated explicitly so it is obvious
   that adding components does not move a single procurement number. */
export function materialTotals(lines, article){
  const totals = {};
  for(const line of lines || []){
    const rates = (((article || {}).combos || {})[clean(line.combo)] || {}).rates || {};
    const qty = Math.round(num(line.qty));
    for(const materials of Object.values(rates))
      for(const [material, rate] of Object.entries(materials || {}))
        totals[material] = round4((totals[material] || 0) + num(rate) * qty);
  }
  return totals;
}

/* A component list is only valid against a material that exists on that stage:
   a piece cut from a material nobody issues cannot be cut. */
export function validateComponents(article){
  const problems = [];
  for(const [combo, def] of Object.entries((article || {}).combos || {})){
    for(const [stage, byMaterial] of Object.entries(def.components || {})){
      const rates = (def.rates || {})[stage] || {};
      for(const [material, list] of Object.entries(byMaterial || {})){
        if(!Object.prototype.hasOwnProperty.call(rates, material))
          problems.push(`${combo} ${stage}: components are listed against ${nameOf(material)}, which is not a material on that stage`);
        for(const c of (Array.isArray(list) ? list : [])){
          if(!clean(c.name)) problems.push(`${combo} ${stage} ${nameOf(material)}: a component has no name`);
          if(!(num(c.per_pair) > 0))
            problems.push(`${combo} ${stage} ${clean(c.name) || "a component"}: needs a quantity per pair`);
        }
      }
    }
  }
  return problems;
}

/* Materials are keyed NAME||UOM throughout the app. */
const nameOf = key => String(key || "").split("||")[0];
const uomOf  = key => String(key || "").split("||")[1] || "";
const round4 = n => Math.round(n * 10000) / 10000;
