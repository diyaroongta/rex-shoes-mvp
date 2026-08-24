/* Pure BOM-workbook parser. Takes rows already read out of a sheet
   (array of arrays) and returns article + combos + materials in the shape the
   planner consumes. No I/O, no xlsx dependency — so the browser, the server
   and the tests all run the identical logic. */

const CATEGORY = new Set(["GRINDARY", "GRINDERY", "PACKING"]);   // column headers, not materials

/* Recorded in CM on the client's sheets, held in MTR by the app. Loading these
   without converting would overstate demand by 100x. */
const CM_MATERIALS = new Set([
  "VELCRO 20 MM HOOK", "VELCRO 20 MM LOOP", "VELCRO 25 MM HOOK", "VELCRO 25 MM LOOP",
  "BACK TAPE 14 MM", "POLYESTER BINDING 12 MM",
]);

const FORCE_STAGE = { INSOLE: "CUTTING" };      // sheets file it under PACKING; the app cuts it

export const SOLE_KEY = "SOLE 1231 EVA||PAIR";

/* Spelling and word-order variants seen across the client's workbooks —
   without this the planner treats MESH 58" and MESH-58" as two materials and
   splits demand between them. */
export function normaliseMaterial(raw){
  let s = String(raw || "").toUpperCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\s+"/g, '"');
  const sheet = s.match(/^(?:SHEET\s*)?([\d.]+)\s*MM(?:\s*SHEET)?$/);
  if(sheet) return `SHEET ${sheet[1]}MM`;
  return s;
}

export function stageFor(component, materialCategory){
  const c = String(component || "").toUpperCase().trim();
  if(FORCE_STAGE[c]) return FORCE_STAGE[c];
  if(materialCategory === "PACKING") return "PACKING";
  if(materialCategory === "GRINDARY" || materialCategory === "GRINDERY") return "STITCHING";
  return "CUTTING";
}

export const comboCode = s => String(s || "").toUpperCase().replace(/\s+/g, "");
export const articleCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9()+&./ -]+/g, "")
  .replace(/\s+/g, " ").trim();

export function existingArticleCode(articles, raw){
  const wanted=articleCode(raw);
  return Object.keys(articles||{}).find(code=>articleCode(code)===wanted)||null;
}

/* rows: array of arrays, straight from the sheet.
   opts.soleRate / opts.soleType: the sole is absent from the client's
   workbooks, so it is injected. Pass soleRate 0 to skip it. */
export function parseBom(rows, opts = {}){
  const soleRate = opts.soleRate == null ? 2 : Number(opts.soleRate);
  const soleType = opts.soleType || "EVA";
  const warnings = [];
  let article = null, combo = null;
  const combos = {};              // combo -> stage -> materialKey -> rate
  const materials = {};           // materialKey -> {name, uom}
  let loaded = 0;

  for(const r of rows){
    const c0 = r[0] == null ? "" : String(r[0]).trim();
    const c1 = r[1] == null ? "" : String(r[1]).trim();
    if(/^ARTICLE/i.test(c0)){ article = articleCode(c1); continue; }
    if(/^SIZE\s*RANGE/i.test(c0)){ combo = comboCode(c1); if(combo) combos[combo] = combos[combo] || {}; continue; }
    if(!/^\d+$/.test(c0) || !combo) continue;

    const component = String(r[1] || "").trim();
    const rawMat    = String(r[2] || "").trim();
    let   uom       = String(r[3] || "").trim().toUpperCase();
    const burnCell  = r[6];
    if(!component) continue;

    if(burnCell == null || typeof burnCell === "string" || !isFinite(Number(burnCell))){
      warnings.push({ type:"no-rate", combo, component,
        detail:`no usable rate in the sheet (${burnCell == null ? "blank" : burnCell}) — treated as not used in this size range` });
      continue;
    }
    let burn = Number(burnCell);
    const category = rawMat.toUpperCase();
    let name = CATEGORY.has(category) ? component.toUpperCase() : normaliseMaterial(rawMat);

    if(uom === "CE"){ uom = "MTR"; warnings.push({ type:"unit-typo", combo, component, detail:'unit "CE" read as MTR' }); }
    if(CM_MATERIALS.has(component.toUpperCase()) && uom === "CM"){
      name = component.toUpperCase(); burn = burn / 100; uom = "MTR";
      warnings.push({ type:"cm-converted", combo, component, detail:"converted CM to MTR (÷100)" });
    }

    const key = `${name}||${uom}`;
    const stage = stageFor(component, category);
    combos[combo][stage] = combos[combo][stage] || {};
    combos[combo][stage][key] = Number(((combos[combo][stage][key] || 0) + burn).toFixed(8));
    materials[key] = materials[key] || { name, uom };
    loaded++;
  }

  if(!article) return { error:"No ARTICLE row found — is this one of the per-article BOM workbooks?" };
  const comboNames = Object.keys(combos).filter(c => Object.keys(combos[c]).length);
  if(!comboNames.length) return { error:`No usable rate rows found for ${article}.` };

  if(soleRate > 0){
    for(const c of comboNames){
      combos[c].MOLDING = combos[c].MOLDING || {};
      combos[c].MOLDING[SOLE_KEY] = soleRate;
    }
    materials[SOLE_KEY] = { name:"Sole 1231 EVA", uom:"PAIR" };
  }

  return {
    article, soleType, loaded, warnings,
    combo_order: comboNames,
    combos: Object.fromEntries(comboNames.map(c => [c, { stitching_combo:c, rates:combos[c] }])),
    materials,
  };
}

/* Merge a parsed workbook into a reference-data document. Existing materials
   keep their stock; genuinely new ones start at 0 and are reported so the
   user knows procurement will show their full requirement, not a shortfall. */
export function mergeBom(reference, parsed, opts = {}){
  const ref = JSON.parse(JSON.stringify(reference));
  const canonical=existingArticleCode(ref.articles,parsed.article)||articleCode(parsed.article);
  const process=parsed.soleType==="STUCK-ON"?"ASSEMBLY":"MOLDING";
  const routing = opts.routing || ["CUTTING","PREPARATION","STITCHING","UPPER_QC",process,"PACKING","DISPATCH"];
  const replaced = !!ref.articles[canonical];
  const newMaterials = [];

  for(const [key, m] of Object.entries(parsed.materials)){
    if(!ref.materials[key]){ ref.materials[key] = { ...m, stock:0 }; newMaterials.push(key); }
  }
  const previous=ref.articles[canonical]||{};
  ref.articles[canonical] = {
    ...previous,
    sole_type: parsed.soleType,
    sole_assumed: false,
    combo_order: parsed.combo_order,
    routing,
    combos: parsed.combos,
  };
  if(parsed.soleType!=="PVC") ref.articles[canonical].molding_machine=null;
  return { reference:ref, replaced, newMaterials, article:canonical };
}
