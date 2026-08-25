/* Factory OS — order-slip vocabulary: size-roll mapping, packing chart, article
   matching, and the prompt used to read a handwritten slip.
   READ_PROMPT lives here so the SERVER owns it — the browser never sends a prompt. */
import { INPUTS } from "./inputs.js";
import { comboSizes } from "./pi.js";

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

  const scored=idx.map(x=>({x,
    score:x.base.filter(t=>words.includes(t)).length,
    extra:x.base.filter(t=>!words.includes(t)).length,   // tokens the text never mentioned
  })).filter(y=>y.score>0);
  if(!scored.length) return {pool:[],text,words};
  const best=Math.max(...scored.map(y=>y.score));
  let tied=scored.filter(y=>y.score===best);
  // "Gola" must not match REX GOLA PLUS: both contain "gola", but PLUS carries
  // an extra word the sheet never wrote. Fewest unmentioned words wins, so a
  // plain name matches the plain article and only "Gola Plus" reaches PLUS.
  const fewestExtra=Math.min(...tied.map(y=>y.extra));
  let pool=tied.filter(y=>y.extra===fewestExtra).map(y=>y.x);
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

/* The reader is told the real article list so it never has to guess a product.
   It gets the real CUSTOMER list for the same reason: a handwritten name is far
   easier to read correctly when you already know the twenty it could be, and a
   name invented out of bad handwriting files the order — and the invoice — to
   the wrong customer. */
export const readPrompt = (knownParties = []) => {
  const PRODUCT_LIST = productList();
  const names = [...new Set((knownParties || [])
    .map(p => String((p && p.name) || p || "").trim()).filter(Boolean))];
  const PARTY_LIST = names.length
    ? `KNOWN CUSTOMERS - the factory's current customer list is: ${names.join(", ")}. If a heading is clearly one of these, return it EXACTLY as spelled here, even when the handwriting is rough. If it is clearly someone else, return what is written. Never bend a name that does not fit onto the nearest one in this list.\n`
    : "";
  return `You are reading a HANDWRITTEN shoe factory order.
${PARTY_LIST}
PARTIES - a single sheet very often lists SEVERAL DIFFERENT CUSTOMERS, each with their own order beneath them. A party name is usually a business or a person plus a town (e.g. 'Bansal Bannala', 'Dhanani Shoe Guhati', 'Star Flw Manglore', 'Paras Indore'), often numbered 1) 2) 3). Put each order's own customer on that order as "party". NEVER carry one party across the whole sheet when other names appear - an order filed under the wrong customer is worse than one with no customer at all. If the sheet genuinely has only one party at the top, repeat it on every order. If an order has no identifiable party, return "party":"" for it rather than guessing or borrowing a neighbour's.
A PARTY IS OFTEN JUST A TOWN. 'Belgaum order' means the customer is Belgaum; 'Indore' on its own is the customer Indore. Read the heading as written - do not decide a name is "only a place" and drop it. NEVER invent a name that is not on the page, and never carry a name over from another sheet. Returning "" is better than returning a plausible-looking name you did not actually read, because a wrong customer sends the goods and the invoice to the wrong person.
KNOWN PRODUCTS - use one of these only when the writing genuinely identifies that product: ${PRODUCT_LIST}. Common minor spellings may be normalised ('Gala' = Gola, 'Silky Bly' = Silky Belly). UNRECOGNISED PRODUCT - if the sheet clearly names a different product that is not in the list (for example GLAMOUR), return that name exactly as written in \"category\" so the app can stop and ask the user to add or select it. NEVER force an unknown product onto the closest catalogue name. Where a product comes in Black and White, put which in \"color\"; otherwise leave color empty.
HOW ENTRIES ARE WRITTEN - read this part carefully, it is the single most common source of error:
- STACKED (one number written directly ABOVE another, like a fraction, often with a bar between them): the TOP number is the SIZE and the BOTTOM number is that size's NUMBER OF CARTONS. Each stack is a SEPARATE line item. Two stacks written next to each other, e.g. 8-over-2 then 9-over-3, are TWO lines - size 8 with 2 cartons, and size 9 with 3 cartons. NEVER merge two stacks into a single size-pair, and never take one stack's bottom number as the carton count for both.
- SIDE BY SIDE on the same baseline, joined by | or a space or a slash (e.g. '6|8', '9 11', '12/1'): this is ONE SIZE-PAIR (a combo pack), with its carton count written below or beside it.
If a section is marked (L), Lace or Big, set "type":"LACE" on every line in that section. If it is marked (V), Velcro or Small, set "type":"VELCRO". Do not carry a type past a new marker.
Sizes are from 6 7 8 9 10 11 12 13 1 2 3 4 5 5.5. Entries may be grouped under 'Big' (adult/gents sizes) or 'Small' (children sizes) headings - if so, set "group":"BIG" or "SMALL" on each line under that heading.
CHECKSUM - use it, do not skip it: a category often writes its carton total at the end (e.g. '= 8 CTN'). Never return that total as a line item, but DO add up the cartons across the lines you are about to return and check they equal it. If they do not match, you have misread - go back and re-read the entries as separate stacks before answering.
Any date is Indian DD/MM/YY format (11/6/26 = 11 June 2026); if no date, return "".

WORKED EXAMPLE - a sheet that reads: "1) Jindal Mahroli" / "Gala (V) BLK  Big  8-over-2  9-over-3" / "Small  8-over-1  4-over-2  = 8 CTN" / "2) Paras Indore" / "Armour (L) BLK  1-over-1  2-over-1  3-over-1  = 3 CTN"
{"date":"","orders":[{"party":"Jindal Mahroli","category":"Gola","color":"Black","lines":[{"sizes":["8"],"cartons":2,"group":"BIG"},{"sizes":["9"],"cartons":3,"group":"BIG"},{"sizes":["8"],"cartons":1,"group":"SMALL"},{"sizes":["4"],"cartons":2,"group":"SMALL"}]},{"party":"Paras Indore","category":"Armour","color":"Black","lines":[{"sizes":["1"],"cartons":1,"group":null},{"sizes":["2"],"cartons":1,"group":null},{"sizes":["3"],"cartons":1,"group":null}]}]}}
Two customers, each with their own order. Jindal's four lines total 2+3+1+2 = 8 and Paras's three total 3 - both match their stated totals, so the read is correct.

Return ONLY valid JSON, no prose, no code fences:
{"date":"YYYY-MM-DD or empty","orders":[{"party":"customer for THIS order, or empty","category":"Smart Boy","color":"Black","lines":[{"sizes":["6","8"],"cartons":2,"group":null,"type":"LACE or VELCRO or empty"}]}]}`; };

/* Pairs-per-carton for a SINGLE size on its own (the chart's "SINGLE
   PACKSIZES" rows), as opposed to a named range combo. Falls back to null
   when the article has no single-size chart on file, so callers can tell
   distinguishes an unknown rate from a real zero — never invents a number. */
export function singlePackQty(article, size, articleType=""){
  const ref = reference();
  const raw = String(size).trim();
  const bare = raw.replace(/s$/i, "");
  const exact = (ref.packing_singles_exact || {})[article];
  if(exact){
    const direct = exact[raw] ?? exact[bare] ?? exact[raw.toUpperCase()] ?? exact[bare.toUpperCase()];
    if(direct != null) return Number(direct);
  }
  const section = (ref.packing_singles_by_article || {})[article];
  const chart = section && (ref.packing_singles || {})[section];
  if(!chart || !size) return null;
  // Kids sizes are written with an "s" (8s); the roll itself holds bare
  // numerals. Strip it and force the kids band, since a bare "8" could
  // otherwise be the adult repeat further along the roll.
  const isKids = /[0-9]s$/i.test(raw);
  const bandSize = isKids ? raw.slice(0,-1) : raw;
  let pos = ROLL_KY.indexOf(bandSize);
  if(pos < 0) return null;
  if(isKids && pos > 7) return null;
  const type=String(articleType||"").trim().toUpperCase();
  // kids run: positions 0-7 (6..13); adult run: 8-13 (1..5,5.5) then the
  // repeated adult roll printed again as 6..12 further along the sheet.
  if(chart.kids != null || chart.adult != null){
    if(type.startsWith("L")) return chart.adult ?? null;
    if(type.startsWith("V")) return chart.kids ?? null;
    return pos <= 7 ? chart.kids : chart.adult;
  }
  if(pos <= 7) return chart["6-13"] ?? null;
  if(pos <= 12) return chart["1-5"] ?? chart["5.5-12"] ?? null;
  return chart["5.5"] ?? chart["6-12"] ?? chart["5.5-12"] ?? null;
}

/* Combination-pack lookup. SPIKE uses ARMOUR's packing list by position: its
   fourth BOM range is named 6X8 where ARMOUR calls the equivalent band 6X9.
   Keeping the relationship here means a clerk changing ARMOUR's packing list
   immediately changes SPIKE too, rather than leaving a copied value stale. */
export function pairsPerCarton(article, combo){
  const ref = reference();
  const source=packingRuleSource(article,combo);
  if(source.inherited){
    const inherited = ((ref.packing||{})[source.article]||{})[source.combo];
      if(inherited != null) return Number(inherited);
      // Older database seeds only carried ARMOUR's two middle ranges. Keep
      // SPIKE correct during migration even before reference data is re-saved.
    const armour = ((ref.articles||{}).ARMOUR||{}).combo_order || ["7X10S","11X1","2X5","6X9","9X12"];
    return [24,24,18,18,18][armour.indexOf(source.combo)] ?? null;
  }
  const direct = ((ref.packing||{})[article]||{})[combo];
  if(direct != null) return Number(direct);
  const bundled=(PACKING[article]||{})[combo];
  if(bundled != null) return Number(bundled);
  if(SPLIT_ARTICLE_TYPES.has(article)){
    const combos=(((ref.articles||{})[article]||{}).combo_order)||[];
    const i=combos.indexOf(combo);
    return [24,24,18,18,18][i]??null;
  }
  return null;
}

export function packingRuleSource(article,combo){
  const ref=reference();
  if(article==="SPIKE"){
    const spike=((ref.articles||{}).SPIKE||{}).combo_order||["7X10S","11X1","2X5","6X8","9X12"];
    const armour=((ref.articles||{}).ARMOUR||{}).combo_order||["7X10S","11X1","2X5","6X9","9X12"];
    const i=spike.indexOf(combo);
    if(i>=0) return {article:"ARMOUR",combo:armour[i],inherited:true};
  }
  return {article,combo,inherited:false};
}

/* JILL/ARMOUR/PERCY/SPADE/SPIKE are single catalogue articles with two order
   types. Their first three ranges are the Velcro/kids roll; their last two
   ranges are the Lace/adult roll. Keeping this rule in one shared helper stops
   the intake screen, bulk importer and rules display from interpreting the
   same article differently. Legacy articles whose code already says (LACE) or
   (VELCRO) continue to expose their complete own range list. */
export const SPLIT_ARTICLE_TYPES = new Set(["JILL","ARMOUR","PERCY","SPADE","SPIKE"]);

/* Where the Velcro roll ends and the Lace roll begins in combo_order. One
   constant, because every function below has to agree about it. */
export const VELCRO_RANGE_COUNT = 3;

export const articleCombos = article => {
  const ref=reference();
  const a=(ref.articles||{})[article]||{};
  return a.combo_order || Object.keys(a.combos||{});
};

export function articleTypes(article){
  if(SPLIT_ARTICLE_TYPES.has(article)) return ["VELCRO","LACE"];
  const text=String(article||"").toUpperCase();
  if(/\(L(?:ACE)?\)/.test(text)) return ["LACE"];
  if(/\(V(?:ELCRO)?\)/.test(text)) return ["VELCRO"];
  return ["ALL"];
}

/* THE TYPE BELONGS TO THE SIZE RANGE, NOT TO THE ORDER.

   SPIKE is ONE shoe. Its first three ranges are the Velcro roll and its last
   two are the Lace roll, and no range name appears in both halves — so the
   range alone says which it is. Treating V/L as a property of the order forced
   one handwritten SPIKE order with a Velcro section and a Lace section to
   become two separate articles on the invoice and two separate jobs in the
   plan, which is not what the factory made.

   Every size/packing lookup derives the type from the range, so a caller can no
   longer pass a type that contradicts it. */
export function comboType(article, combo){
  if(!SPLIT_ARTICLE_TYPES.has(article)){
    const [only]=articleTypes(article);
    return only==="ALL" ? "" : only;
  }
  const i=articleCombos(article).indexOf(combo);
  if(i<0) return "";
  return i<VELCRO_RANGE_COUNT ? "VELCRO" : "LACE";
}

export function articleTypeCombos(article, type){
  const all=articleCombos(article);
  if(!SPLIT_ARTICLE_TYPES.has(article)) return [...all];
  const t=String(type||"").trim().toUpperCase();
  if(t.startsWith("L")) return all.slice(VELCRO_RANGE_COUNT);
  if(t.startsWith("V")) return all.slice(0,VELCRO_RANGE_COUNT);
  return [...all];                                  // no type given: the whole shoe
}

export function comboSizesForArticle(article, combo, type){
  /* The adult-roll relabelling belongs ONLY to the split articles, where Lace
     genuinely means the adult roll. On a legacy code like REX GOLA (L) the
     (V)/(L) is the CLOSURE — it names a different article with its own BOM, and
     that article's ranges still use the ordinary roll plus its own B ranges.
     Relabelling those turns 8s into 8, matches nothing, and strands every pair.

     Within a split article the RANGE decides, whatever `type` claims. */
  if(!SPLIT_ARTICLE_TYPES.has(article)) return comboSizes(combo);
  if(!comboType(article, combo).startsWith("L")) return comboSizes(combo);
  const [a,b]=String(combo||"").toUpperCase().replace(/[SB]$/," ").trim().split("X");
  const adult=["6","7","8","9","10","11","12","13"];
  const i=adult.indexOf(a), j=adult.indexOf(b);
  return i<0||j<0 ? comboSizes(combo) : adult.slice(i,Math.max(i,j)+1);
}
