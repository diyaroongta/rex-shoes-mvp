/* Factory OS — order-slip vocabulary: size-roll mapping, packing chart, article
   matching, and the prompt used to read a handwritten slip.
   READ_PROMPT lives here so the SERVER owns it — the browser never sends a prompt. */
import { INPUTS } from "./inputs.js";

/* The bundled inputs.js is only the SEED. Once reference data is uploaded it
   lives in the database, and both the browser and the server call
   setReference() with it — so the reader's vocabulary follows the real
   article list without a code change. */
let REF = INPUTS;
export function setReference(r){ if(r && r.articles && Object.keys(r.articles).length) REF = r; }
export function reference(){ return REF; }
/* ------------- bridge: customer order -> factory article ------------- */
export const ROLL_KY = ["6","7","8","9","10","11","12","13","1","2","3","4","5","5.5"];
// real packing chart (pairs per carton), mapped onto the BOM combo labels
export const PACKING = {
  "SMART BOY (L) BLACK": {"6X8":48,"9X11":36,"12X1":36,"2X5":24,"6X10B":18},
  "SMART BOY (L) WHITE": {"6X8":48,"9X11":36,"12X1":36,"2X5":24,"6X10B":18},
  "SILKY BELLY BLACK":   {"6X8":48,"9X11":36,"12X1":36,"2X5":24,"6X7B":24,"8X9B":24},
  "SILKY BELLY WHITE":   {"6X8":48,"9X11":36,"12X1":36,"2X5":24,"6X7B":24,"8X9B":24},
  "REX GOLA (V)":        {"8X10":18,"11X13":18,"1X3":18,"4X5":18,"6X7B":18,"8X10B":18},
  "REX GOLA (L)":        {"8X10":18,"11X13":18,"1X3":18,"4X5":18,"6X7B":18,"8X10B":18},
  "ARMOUR (VELCRO)":     {"8X10":24,"11X1":24,"2X5":18,"6X10B":18},
  "ARMOUR (LACE)":       {"8X10":24,"11X1":24,"2X5":18,"6X10B":18},
};
export const DEFAULT_PRICES = {
  "SMART BOY (L) BLACK":450,"SMART BOY (L) WHITE":450,
  "SILKY BELLY BLACK":520,"SILKY BELLY WHITE":520,
  "REX GOLA (V)":380,"REX GOLA (L)":380,
  "ARMOUR (VELCRO)":600,"ARMOUR (LACE)":600,
};
export const inr = n => { if(n==null||isNaN(n)) return "0";
  n=Math.round(n); const s=String(Math.abs(n));
  if(s.length<=3) return (n<0?"-":"")+s;
  return (n<0?"-":"")+s.slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g,",")+","+s.slice(-3); };

/* Article matching is DERIVED from INPUTS.articles — add an article to the
   reference data and the reader can find it, with no code change here. */
const ALIASES = [           // misspellings seen on real order sheets
  [/\bgala\b/g,"gola"], [/\bbly\b/g,"belly"], [/\bblk\b/g,"black"],
  [/\bwht\b/g,"white"], [/\bwh\b/g,"white"],
];
const norm = t => {
  let x=(t||"").toLowerCase().replace(/[^a-z0-9. ]+/g," ").replace(/\s+/g," ").trim();
  for(const [re,to] of ALIASES) x=x.replace(re,to);
  return x;
};
const COLOURS=["black","white"], VARIANTS={v:"velcro",l:"lace",velcro:"velcro",lace:"lace"};

function articleIndex(){
  return Object.keys(REF.articles).map(code=>{
    const n=norm(code), toks=n.split(" ");
    const colour=COLOURS.find(c=>toks.includes(c))||null;
    let variant=null;
    for(const t of toks) if(VARIANTS[t]) variant=VARIANTS[t];
    return {code, norm:n, base:toks.filter(t=>!COLOURS.includes(t)&&!VARIANTS[t]), colour, variant};
  });
}

function rank(category,color){
  const text=norm((category||"")+" "+(color||""));
  if(!text) return {pool:[],text,words:[]};
  const words=text.split(" ");
  const idx=articleIndex();
  const exactCode=idx.find(x=>x.norm===text);          // the code itself, e.g. "armour" -> ARMOUR
  if(exactCode) return {pool:[exactCode],text,words,exact:true};
  const baseHits=idx.filter(x=>x.base.join(" ")===text);
  if(baseHits.length===1) return {pool:baseHits,text,words,exact:true};   // unique family, e.g. "jill"

  const scored=idx.map(x=>({x,score:x.base.filter(t=>words.includes(t)).length})).filter(y=>y.score>0);
  if(!scored.length) return {pool:[],text,words};
  const best=Math.max(...scored.map(y=>y.score));
  let pool=scored.filter(y=>y.score===best).map(y=>y.x);
  const wantColour=COLOURS.find(c=>words.includes(c))||null;
  let wantVariant=null; for(const w of words) if(VARIANTS[w]) wantVariant=VARIANTS[w];
  if(wantVariant){ const v=pool.filter(x=>x.variant===wantVariant); if(v.length) pool=v; }
  else { const nv=pool.filter(x=>!x.variant); if(nv.length) pool=nv; }
  if(wantColour){ const c=pool.filter(x=>x.colour===wantColour); if(c.length) pool=c; }
  return {pool,text,words,wantColour,wantVariant};
}

export function matchArticle(category,color){
  const r=rank(category,color);
  return r.pool.length?r.pool[0].code:null;
}

/* True when several articles fit equally well and nothing in the text separates
   them — the intake screen flags these so the clerk confirms instead of the app
   guessing. Matters now that ARMOUR exists three times. */
export function matchAmbiguous(category,color){
  const r=rank(category,color);
  return !r.exact && r.pool.length>1 && !r.wantColour && !r.wantVariant;
}

export function comboRangeKY(combo){ // non-B combos only; returns [i,j] in ROLL_KY
  if(combo.endsWith("B")) return null;
  const [a,b]=combo.split("X");
  const i=ROLL_KY.indexOf(a), j=ROLL_KY.indexOf(b);
  return (i<0||j<0)?null:[i,Math.max(i,j)];
}
// map read sizes (e.g. ["6","8"] or ["7"]) to one of the article's real combos
export function comboRangeB(combo){ // B combos: range over the numeric part
  if(!combo.endsWith("B")) return null;
  const [a,b]=combo.slice(0,-1).split("X");
  const seq=["6","7","8","9","10","11","12"];
  const i=seq.indexOf(a), j=seq.indexOf(b);
  return (i<0||j<0)?null:[i,Math.max(i,j),seq];
}
/* A parsed order line is EITHER a single size on its own (the sheet wrote just
   "8 - 24 ctn") OR a size range that matches one of the article's named combos
   (the sheet wrote "6X8 - 5 ctn"). These are different things on the factory's
   own packing chart — a "SINGLE PACKSIZE" packs at its own rate per size, a
   "COMBINATION PACK" packs multiple sizes together at the combo's rate.
   Forcing a single size into the nearest range combo silently turns an
   individual-size order into a combination-pack order, which is the bug this
   function used to have: every fallback path returned SOME combo, never "this
   is just one size." Only return a combo when the sizes genuinely match one;
   otherwise say so and let the caller keep it as a single-size line. */
export function mapToCombo(sizes, articleCombos, big){
  const ss=(sizes||[]).map(String).filter(s=>s);

  if(big){ // adult sizes -> only B combos, and only on a real range match
    const bCombos=articleCombos.filter(c=>c.endsWith("B"));
    for(const c of bCombos){
      const r=comboRangeB(c); if(!r) continue;
      const p=r[2].indexOf(ss[0]);
      if(p>=0 && p>=r[0] && p<=r[1]) return {combo:c, exact:true};
    }
  }

  if(ss.length>=2){
    const k1=ss[0]+"X"+ss[1], k2=ss[1]+"X"+ss[0];
    if(articleCombos.includes(k1)) return {combo:k1, exact:true};
    if(articleCombos.includes(k2)) return {combo:k2, exact:true};
  }

  const pos = ss.length ? ROLL_KY.indexOf(ss[0]) : -1;
  if(pos>=0){
    for(const c of articleCombos){
      const r=comboRangeKY(c);
      if(r && pos>=r[0] && pos<=r[1]) return {combo:c, exact:true};
    }
  }

  // No range combo actually contains this size — it is a single-size line,
  // not a combination pack. Report it as such rather than guessing a combo.
  return {combo:null, single:ss[0]||null, exact:false};
}
const productList = () => [...new Set(articleIndex().map(a=>a.base.join(" ")))]
  .map(n=>n.replace(/\b\w/g,c=>c.toUpperCase())).join(", ");

export const readPrompt = () => { const PRODUCT_LIST = productList(); return `You are reading a HANDWRITTEN shoe factory order.
The top line is often the CUSTOMER/PARTY name (e.g. 'Jindal Mahroli') - capture it as "party".
KNOWN PRODUCTS - the \"category\" you return must be one of these: ${PRODUCT_LIST}. Category headers on the sheet are often shortened or misspelled ('Gala' = Gola, 'Silky Bly' = Silky Belly) - map what you see onto the closest known product. Where a product comes in Black and White, put which in \"color\"; otherwise leave color empty.
HOW ENTRIES ARE WRITTEN - read this part carefully, it is the single most common source of error:
- STACKED (one number written directly ABOVE another, like a fraction, often with a bar between them): the TOP number is the SIZE and the BOTTOM number is that size's NUMBER OF CARTONS. Each stack is a SEPARATE line item. Two stacks written next to each other, e.g. 8-over-2 then 9-over-3, are TWO lines - size 8 with 2 cartons, and size 9 with 3 cartons. NEVER merge two stacks into a single size-pair, and never take one stack's bottom number as the carton count for both.
- SIDE BY SIDE on the same baseline, joined by | or a space or a slash (e.g. '6|8', '9 11', '12/1'): this is ONE SIZE-PAIR (a combo pack), with its carton count written below or beside it.
Sizes are from 6 7 8 9 10 11 12 13 1 2 3 4 5 5.5. Entries may be grouped under 'Big' (adult/gents sizes) or 'Small' (children sizes) headings - if so, set "group":"BIG" or "SMALL" on each line under that heading.
CHECKSUM - use it, do not skip it: a category often writes its carton total at the end (e.g. '= 8 CTN'). Never return that total as a line item, but DO add up the cartons across the lines you are about to return and check they equal it. If they do not match, you have misread - go back and re-read the entries as separate stacks before answering.
Any date is Indian DD/MM/YY format (11/6/26 = 11 June 2026); if no date, return "".

WORKED EXAMPLE - a sheet that reads: "Jindal Mahroli" / "Gala (V) BLK  Big   8-over-2   9-over-3" / "Small   8-over-1   4-over-2        = 8 CTN"
{"date":"","party":"Jindal Mahroli","orders":[{"category":"Gola","color":"Black","lines":[{"sizes":["8"],"cartons":2,"group":"BIG"},{"sizes":["9"],"cartons":3,"group":"BIG"},{"sizes":["8"],"cartons":1,"group":"SMALL"},{"sizes":["4"],"cartons":2,"group":"SMALL"}]}]}
Four separate lines, and 2+3+1+2 = 8, which matches the stated total - so the read is correct.

Return ONLY valid JSON, no prose, no code fences:
{"date":"YYYY-MM-DD or empty","party":"","orders":[{"category":"Smart Boy","color":"Black","lines":[{"sizes":["6","8"],"cartons":2,"group":null}]}]}`; };

/* Pairs-per-carton for a SINGLE size on its own (the chart's "SINGLE
   PACKSIZES" rows), as opposed to a named range combo. Falls back to null
   when the article has no single-size chart on file, so callers can tell
   distinguishes an unknown rate from a real zero — never invents a number. */
export function singlePackQty(article, size){
  const ref = reference();
  const section = (ref.packing_singles_by_article || {})[article];
  const chart = section && (ref.packing_singles || {})[section];
  if(!chart || !size) return null;
  // Kids sizes are written with an "s" (8s); the roll itself holds bare
  // numerals. Strip it and force the kids band, since a bare "8" could
  // otherwise be the adult repeat further along the roll.
  const raw = String(size).trim();
  const isKids = /[0-9]s$/i.test(raw);
  const bare = isKids ? raw.slice(0,-1) : raw;
  let pos = ROLL_KY.indexOf(bare);
  if(pos < 0) return null;
  if(isKids && pos > 7) return null;
  // kids run: positions 0-7 (6..13); adult run: 8-13 (1..5,5.5) then the
  // repeated adult roll printed again as 6..12 further along the sheet.
  if(chart.kids != null || chart.adult != null) return pos <= 7 ? chart.kids : chart.adult;
  if(pos <= 7) return chart["6-13"] ?? null;
  if(pos <= 12) return chart["1-5"] ?? chart["5.5-12"] ?? null;
  return chart["5.5"] ?? chart["6-12"] ?? chart["5.5-12"] ?? null;
}
