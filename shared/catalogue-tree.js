/* THE CATALOGUE, AS THE FACTORY TALKS ABOUT IT.
 *
 * "Have they had Jack?" comes before "which Jack?". The article master is a
 * flat list of ~67 names where eighteen of them are Jacks, so a screen that
 * lists it as it is stored asks the second question first and buries the
 * first one. The client's own words for what they want:
 *
 *   EVA Shoes -> Jack -> Jack blk/L.grey -> lace / velcro
 *
 * Three levels, and each one is a real distinction:
 *
 *   FAMILY    the shoe. JACK. What a customer names on the phone.
 *   COLOUR    which Jack. Black/L.Grey is a different shoe to Navy, is bought
 *             and stocked separately, and is what the catalogue page shows as
 *             a row of thumbnails.
 *   CLOSURE   lace or velcro. The SAME shoe fastened two ways — and a family
 *             may have only one of them, so it is a leaf and never a tab that
 *             sits there empty.
 *
 * The family and the variant words come from shared/product-codes.js, which
 * already knows that a colour is not part of a product's name — the rule that
 * stopped "Spike Blue" matching JACK LACE BLACK-BLUE.
 *
 * Pure: no database, no clock.
 */
import { familyOf, isColourWord, isClosureWord } from "./product-codes.js";

const up = v => String(v == null ? "" : v).toUpperCase().replace(/\s+/g, " ").trim();
const CLOSURE_LABEL = { V:"Velcro", VELCRO:"Velcro", L:"Lace", LACE:"Lace",
                        DV:"Double velcro", "D/V":"Double velcro",
                        SLIPON:"Slip-on", "SLIP-ON":"Slip-on", BUCKLE:"Buckle" };

const splitWords = text => up(text)
  .split(/[^A-Z0-9.]+/)
  .flatMap(w => w.split("-"))
  .filter(Boolean);

/* THE BRACKET IS A NOTE, NOT THE COLOUR. "JACK LACE BLACK-BLUE (BLUE SKINFIT)"
   and "JACK VELCRO BLACK-BLUE" are the same shoe in the same colour, fastened
   two ways — which is precisely what the client asked to see side by side.
   Reading the bracketed words as part of the colour made them two different
   colours and split the pair apart, so the note is kept and shown but does not
   decide the grouping. A shoe whose ONLY colour words are in brackets still
   uses them, because "no colour on record" would be worse than the note. */
const outside = name => String(name).replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
const inside  = name => (String(name).match(/\(([^)]*)\)|\[([^\]]*)\]/g) || []).join(" ");

/* Split one article name into the three things a person uses to find it. */
export function variantOf(article){
  const family = familyOf(article) || up(article);
  const pick = text => {
    const closures = [], colours = [];
    for(const w of splitWords(text)){
      if(isClosureWord(w)){ if(!closures.includes(w)) closures.push(w); continue; }
      if(isColourWord(w) && !colours.includes(w)) colours.push(w);
    }
    return { closures, colours };
  };
  const main = pick(outside(article));
  const bracket = pick(inside(article));
  const colours = main.colours.length ? main.colours : bracket.colours;
  const closures = main.closures.length ? main.closures : bracket.closures;
  const note = bracket.colours.filter(c => !colours.includes(c)).map(titled).join(" ");
  return {
    article,
    family,
    note: note || "",
    /* Colours in the order they are WRITTEN. "BLACK-BLUE" is one shoe and
       "BLUE-BLACK" would be another; reordering or sorting them would merge
       two variants the factory keeps apart. */
    colour: colours.join("/") || "",
    colour_label: colours.length ? colours.map(titled).join(" / ") : "No colour on record",
    closure: closures[0] || "",
    closure_label: closures.length ? (CLOSURE_LABEL[closures[0]] || titled(closures[0])) : "",
  };
}

const titled = w => String(w).charAt(0) + String(w).slice(1).toLowerCase();

/* family -> colour -> closures. `article` carries whatever the master holds,
   so a screen can show the sole type and the photo without a second lookup. */
export function catalogueTree(articles = {}, opts = {}){
  const codes = opts.codes || {};
  const byFamily = new Map();

  for(const [name, article] of Object.entries(articles)){
    const v = variantOf(name);
    const fam = byFamily.get(v.family) || { family:v.family, label:titleCase(v.family),
      colours:new Map(), articles:[], sole_types:new Set(), sections:new Set() };
    const colourKey = v.colour || "—";
    const colour = fam.colours.get(colourKey) || { colour:v.colour, label:v.colour_label, variants:[] };
    const sole = up((article || {}).sole_type) || null;
    const section = (article || {}).section ? String(article.section) : null;

    const entry = { ...v, code: codes[name] || null, sole_type: sole,
      section, ranges: Object.keys((article||{}).combos || {}).length,
      has_bom: hasRates(article), image: (article||{}).image || null };
    colour.variants.push(entry);
    fam.colours.set(colourKey, colour);
    fam.articles.push(entry);
    if(sole) fam.sole_types.add(sole);
    if(section) fam.sections.add(section);
    byFamily.set(v.family, fam);
  }

  return [...byFamily.values()].map(fam => ({
    family: fam.family,
    label: fam.label,
    /* The family's code prefix, when its articles have been given codes —
       JACK01..JACK18 share JACK, which is what the floor says out loud. */
    code_prefix: commonPrefix(fam.articles.map(a => a.code).filter(Boolean)),
    sole_types: [...fam.sole_types].sort(),
    sections: [...fam.sections].sort(),
    variants: fam.articles.length,
    /* A family with no BOM anywhere cannot be ordered, and a screen that does
       not say so sends someone to raise a PI against nothing. */
    without_bom: fam.articles.filter(a => !a.has_bom).length,
    colours: [...fam.colours.values()]
      .map(c => ({ ...c, variants: c.variants.sort(byClosure) }))
      .sort((a, z) => a.label.localeCompare(z.label)),
  })).sort((a, z) => a.label.localeCompare(z.label));
}

function hasRates(article){
  for(const combo of Object.values((article || {}).combos || {}))
    for(const stage of Object.values(combo.rates || {}))
      if(Object.keys(stage).length) return true;
  return false;
}
/* Lace before velcro, then by code, so one family reads the same way every
   time rather than in whatever order the upload happened to write. */
const byClosure = (a, z) =>
  String(a.closure_label).localeCompare(String(z.closure_label))
  || String(a.code||"").localeCompare(String(z.code||""), undefined, { numeric:true })
  || a.article.localeCompare(z.article);

const titleCase = s => String(s).split(" ").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");

function commonPrefix(codes){
  if(!codes.length) return null;
  const letters = codes.map(c => String(c).replace(/[-]?\d+$/, ""));
  return letters.every(l => l === letters[0]) ? letters[0] : null;
}

/* The search bar. It matches the family, the article, the colour, the closure
   and the code, because people search with all five — "jack", "JA0", "velcro
   black". Every word has to match SOMETHING, so "jack velcro" narrows rather
   than widening. */
export function searchTree(tree, query){
  const terms = up(query).split(/\s+/).filter(Boolean);
  if(!terms.length) return tree;
  const hit = (v, fam) => {
    const hay = up([fam.label, fam.code_prefix, v.article, v.colour_label, v.closure_label, v.code].join(" "));
    return terms.every(t => hay.includes(t));
  };
  return tree
    .map(fam => {
      const colours = fam.colours
        .map(c => ({ ...c, variants: c.variants.filter(v => hit(v, fam)) }))
        .filter(c => c.variants.length);
      return { ...fam, colours, variants: colours.reduce((a,c)=>a+c.variants.length,0) };
    })
    .filter(fam => fam.variants > 0);
}

/* The two tab rows the client asked for, kept SEPARATE on purpose. Their own
   catalogue mixes them — THUNDER is in the Kindergarten section and has an EVA
   sole — so one combined tab row would have to put Thunder in one place and be
   wrong in the other. */
export function filterTree(tree, filters = {}){
  const sole = filters.sole ? up(filters.sole) : null;
  const section = filters.section ? String(filters.section) : null;
  if(!sole && !section) return tree;
  return tree
    .map(fam => {
      const colours = fam.colours
        .map(c => ({ ...c, variants: c.variants.filter(v =>
          (!sole || v.sole_type === sole) && (!section || v.section === section)) }))
        .filter(c => c.variants.length);
      return { ...fam, colours, variants: colours.reduce((a,c)=>a+c.variants.length,0) };
    })
    .filter(fam => fam.variants > 0);
}

/* What the two tab rows should offer, taken from the data rather than from a
   hard-coded list — the trap that shipped a Machines tab listing 5 of 11
   machines. A section nobody has set yet simply has no tab. */
export function facetsOf(tree){
  const soles = new Set(), sections = new Set();
  let unsectioned = 0, total = 0;
  for(const fam of tree) for(const c of fam.colours) for(const v of c.variants){
    total++;
    if(v.sole_type) soles.add(v.sole_type);
    if(v.section) sections.add(v.section); else unsectioned++;
  }
  return { soles:[...soles].sort(), sections:[...sections].sort(), unsectioned, total };
}
