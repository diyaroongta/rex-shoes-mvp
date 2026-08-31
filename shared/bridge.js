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
  return Object.keys(REF.articles).filter(code=>{
    const def=REF.articles[code]||{};
    return (def.combo_order||Object.keys(def.combos||{})).length>0;
  }).map(code=>{
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
HOW ENTRIES ARE WRITTEN - read this part carefully, it is the single most common source of error. THE TWO DIRECTIONS MEAN TWO DIFFERENT THINGS, and confusing them is what ruins a read:
- VERTICAL = SIZE ENTRY over CARTONS. One thing written directly ABOVE another, like a fraction, usually with a bar between them: the TOP is the SIZE ENTRY and the BOTTOM is that entry's NUMBER OF CARTONS. Every stack is a SEPARATE line item. Two stacks written next to each other, e.g. 8-over-2 then 9-over-3, are TWO lines - size 8 with 2 cartons, and size 9 with 3 cartons. NEVER merge two stacks into one line, never take one stack's bottom number as the carton count for both, and never return a bottom number as a size.
- HORIZONTAL = THE SIZE ENTRY ITSELF, which may be a RANGE of two sizes joined by X or x or a multiplication sign ('7X10', '11X13'), and occasionally by | or a dash ('11|13', '11-13'). Return BOTH endpoints in "sizes", e.g. "sizes":["11","13"]. A range is still ONE line item with ONE carton count.
- THE TOP OF A STACK IS OFTEN A RANGE. '7X10 over 5' is the range 7-to-10 with 5 cartons. It is NOT size 7 with 10 cartons, NOT two stacks, and NOT size 7 alone - the 10 belongs to the range and the 5 is the only carton figure on that entry. A slip very often mixes both kinds: some stacks have a range on top, others a single size.
- A ROW OF COLUMNS IS THE SAME THING, REPEATED. Most sheets do not write stacks one at a time; they write a whole ROW of sizes with the carton count under each one, like a little table without lines. Read it column by column, left to right - each column is its own line item. A row of 7 columns is 7 line items, never one.
- AN ARTICLE OFTEN HAS SEVERAL ROWS. A second or third row under the same product heading is MORE OF THAT SAME PRODUCT, not a new product and not a new customer. Return every row's columns as lines of the SAME order.
- A MARKER IN BRACKETS AT THE START OF A ROW IS ABOUT THE ROW, NOT A CUSTOMER. Never start a new order because of one. A bracketed LETTER is the SIZE RUN: (L), (Lg) or (Big) means that whole row is the Large run, so set "group":"LARGE" on every line of it; (S) or (Sm) means Small, so set "group":"SMALL". Handwritten (L) and (1) look almost identical, so use the sizes to decide - a row of Large sizes under a row that already reached the adult numbers is (L). A bracketed NUMBER, (1) (2) (3), is simply the first, second or third row of the same product. Either way the lines belong to the product already named above, and only a heading containing an actual NAME starts a new customer.
- A FRACTION BAR IS NEVER A RANGE JOINER. '11 over 2' is size 11 with 2 cartons. Written out flat it would look like '11/2', which is NOT the pair 11-and-2. Only X, x, the multiplication sign, | or a dash joins two sizes into a range; a horizontal bar with a number beneath it is always size-over-cartons.
SIZE RUN AND CLOSURE ARE SEPARATE. If a section is marked S or Small, set "group":"SMALL". If it is marked L, Large or Big, set "group":"LARGE". A free-standing L, or L beside a size, always means Large; NEVER turn that into Lace. Only the full word Lace sets "type":"LACE", and only the full word Velcro sets "type":"VELCRO". LEGACY ARTICLE-CODE EXCEPTION: when (L) is attached directly to an official catalogue article name such as REX GOLA (L) or SMART BOY (L) WHITE, preserve the complete official article name in "category"; that catalogue suffix means the legacy Lace variant. Do not convert an unattached L into that suffix. If the context is unclear, leave type empty for Match & Check instead of guessing. Do not carry a marker past a new one.
Sizes are from 6 7 8 9 10 11 12 13 1 2 3 4 5 5.5. Entries may be grouped under Large/Big or Small headings - set "group":"LARGE" or "SMALL" on each line under that heading.
If S/L or Small/Large is written, preserve it. If it is not written, preserve the entries in their exact reading order: the factory writes every Small size first and every Large size after it. For example 7, 8, 1, 2, 3 means Small 7, Small 8, then Large 1, 2, 3. Do not sort or regroup the lines.
CHECKSUM - use it, do not skip it, and REPORT it. A product usually writes a carton total at the end of each row (e.g. '= 9') and a grand total for the whole product (e.g. '= 14 CTN'). Never return a total as a line item. Do two things with it: (1) add up the cartons across the lines you are about to return and check they equal the grand total - if they do not, you have MISSED A ROW or misread a column, so go back and read every row again before answering; (2) return the product's grand total as "stated_cartons" on that order so the app can check your arithmetic independently. If no total is written, leave "stated_cartons" out.
Any date is Indian DD/MM/YY format (11/6/26 = 11 June 2026); if no date, return "".

WORKED EXAMPLE - a sheet that reads: "1) Jindal Mahroli" / "Gola BLK  Large  8-over-2  9-over-3" / "Small  8-over-1  4-over-2  = 8 CTN" / "2) Paras Indore" / "Armour Lace  Large  1-over-1  2-over-1  3-over-1  = 3 CTN"
{"date":"","orders":[{"party":"Jindal Mahroli","category":"Gola","color":"Black","lines":[{"sizes":["8"],"cartons":2,"group":"LARGE"},{"sizes":["9"],"cartons":3,"group":"LARGE"},{"sizes":["8"],"cartons":1,"group":"SMALL"},{"sizes":["4"],"cartons":2,"group":"SMALL"}]},{"party":"Paras Indore","category":"Armour","color":"Black","lines":[{"sizes":["1"],"cartons":1,"group":"LARGE","type":"LACE"},{"sizes":["2"],"cartons":1,"group":"LARGE","type":"LACE"},{"sizes":["3"],"cartons":1,"group":"LARGE","type":"LACE"}]}]}}
Two customers, each with their own order. Jindal's four lines total 2+3+1+2 = 8 and Paras's three total 3 - both match their stated totals, so the read is correct.

WORKED EXAMPLE 2 - RANGES AND SINGLE SIZES ON THE SAME SHEET, which is the read that goes wrong most often. A sheet that reads: "Bansal Barnala" / "Gola V BLACK" / then five stacks written across one line: 7X10-over-5 , 11X13-over-4 , 11-over-2 , 2-over-5 , 6-over-7
{"date":"","orders":[{"party":"Bansal Barnala","category":"REX GOLA (V)","color":"Black","lines":[{"sizes":["7","10"],"cartons":5},{"sizes":["11","13"],"cartons":4},{"sizes":["11"],"cartons":2},{"sizes":["2"],"cartons":5},{"sizes":["6"],"cartons":7}]}]}
Five stacks, five lines - never fewer. The first two have a RANGE on top (7-to-10, 11-to-13) and the last three have a SINGLE size on top; in all five the number under the bar is the carton count. Note what is NOT returned: not size 7 with 10 cartons, not the pair 11-and-2 from reading the third stack's bar as a joiner, and not one merged line holding 11, 2 and 6. No S/L is written anywhere, so "group" is omitted on every line and the app applies the ascending Small-then-Large rule itself - do not invent a group.

WORKED EXAMPLE 3 - ROWS OF COLUMNS, AND AN (L) ROW. A sheet reading: "K.P. Gurgaon" / "Spike N.Blue/S.Blue" / a row of columns 10-over-1, 12-over-1, 13-over-2, 1-over-2, 3-over-1, 4-over-1, 5-over-1 with "= 9" at its end / then a second row marked "(L)" with 6-over-2, 8-over-1, 10-over-1, 11-over-1 and "= 5" at its end / and "= 14 CTN" for the product
{"date":"","orders":[{"party":"K.P. Gurgaon","category":"Spike","color":"N.Blue / S.Blue","stated_cartons":14,"lines":[{"sizes":["10"],"cartons":1},{"sizes":["12"],"cartons":1},{"sizes":["13"],"cartons":2},{"sizes":["1"],"cartons":2},{"sizes":["3"],"cartons":1},{"sizes":["4"],"cartons":1},{"sizes":["5"],"cartons":1},{"sizes":["6"],"cartons":2,"group":"LARGE"},{"sizes":["8"],"cartons":1,"group":"LARGE"},{"sizes":["10"],"cartons":1,"group":"LARGE"},{"sizes":["11"],"cartons":1,"group":"LARGE"}]}]}
ELEVEN lines from ONE order - seven columns in the first row and four in the second. The "(L)" marks that whole second row as the LARGE run, so every one of its lines carries "group":"LARGE"; it is not a customer, not a second product, and not the number 1. 1+1+2+2+1+1+1 = 9 and 2+1+1+1 = 5, which is the 14 the sheet states, so the read is complete. Returning only the first row would give 9 and would be wrong. Note also that the same numeral appears twice - 10 in the first row is the Small run and 10 in the second row is the Large repeat - which is exactly what the ascending order is telling you; return both, and do not merge them.

Return ONLY valid JSON, no prose, no code fences:
{"date":"YYYY-MM-DD or empty","orders":[{"party":"customer for THIS order, or empty","category":"Smart Boy","color":"Black","stated_cartons":14,"lines":[{"sizes":["6","8"],"cartons":2,"group":null,"type":"LACE or VELCRO or empty"}]}]}`; };

/* Effective packing for one individual size. Explicit single-size rows win.
   Otherwise the size uses its selected range's pairs/carton, including an
   inherited ARMOUR/GOLA range. Returning the source keeps the rules screen
   and order entry able to explain the value rather than merely showing it. */
/* Which run a size belongs to, read off the range it was costed against.
   A range prints its kids sizes with an "s" (8s) and its adult repeat bare
   (8), so the range's own spelling of THIS size is the evidence — no closure,
   no roll position, no article name needed. Returns "" when the size has no
   range yet, and the caller falls back. */
function adultBandRun(article, combo, articleType, size){
  if(!combo) return "";
  const own = comboSizesForArticle(article, combo, articleType);
  const wanted = String(size).toLowerCase();
  const hit = own.find(s => String(s).toLowerCase() === wanted);
  if(hit == null) return "";
  return /[0-9]s$/i.test(String(hit)) ? "KIDS" : "ADULT";
}

export function singlePackingRule(article,size,articleType="",combo=""){
  const ref = reference();
  const raw = String(size).trim();
  const bare = raw.replace(/s$/i, "");
  const exact = (ref.packing_singles_exact || {})[article];
  if(exact){
    const scopedDirect = combo?exact[scopedSizeKey(combo,raw)]??exact[scopedSizeKey(combo,bare)]:null;
    const direct = scopedDirect
      ?? exact[raw] ?? exact[bare] ?? exact[raw.toUpperCase()] ?? exact[bare.toUpperCase()];
    if(direct != null) return {ppc:Number(direct),kind:"individual override",article,size:raw,
      ...(scopedDirect!=null?{combo}:{} )};
  }
  const sourceArticle=packingArticleSource(article);
  let sourceSize=raw;
  if(sourceArticle!==article&&combo){
    const sourceRule=packingRuleSource(article,combo);
    const ownSizes=comboSizesForArticle(article,combo,articleType);
    const sourceSizes=comboSizesForArticle(sourceRule.article,sourceRule.combo,comboType(sourceRule.article,sourceRule.combo));
    const position=ownSizes.findIndex(value=>String(value).toLowerCase()===raw.toLowerCase());
    if(position>=0&&sourceSizes[position]!=null) sourceSize=String(sourceSizes[position]);
  }
  const sourceBare=sourceSize.replace(/s$/i,"");
  const sourceExact=(ref.packing_singles_exact||{})[sourceArticle];
  if(sourceArticle!==article&&sourceExact){
    const sourceCombo=packingRuleSource(article,combo).combo;
    const scopedDirect=sourceCombo?sourceExact[scopedSizeKey(sourceCombo,sourceSize)]??sourceExact[scopedSizeKey(sourceCombo,sourceBare)]:null;
    const direct=scopedDirect
      ??sourceExact[sourceSize]??sourceExact[sourceBare]??sourceExact[sourceSize.toUpperCase()]??sourceExact[sourceBare.toUpperCase()];
    if(direct!=null) return {ppc:Number(direct),kind:"individual override",article:sourceArticle,size:sourceSize,
      ...(scopedDirect!=null?{combo:sourceCombo}:{} )};
  }
  const section = (ref.packing_singles_by_article || {})[sourceArticle]
    || (ref.packing_singles_by_article || {})[article];
  const chart = section && (ref.packing_singles || {})[section];
  if(chart && size){
  // Kids sizes are written with an "s" (8s); the roll itself holds bare
  // numerals. Strip it and force the kids band, since a bare "8" could
  // otherwise be the adult repeat further along the roll.
  const isKids = /[0-9]s$/i.test(sourceSize);
  const bandSize = isKids ? sourceSize.slice(0,-1) : sourceSize;
  let pos = ROLL_KY.indexOf(bandSize);
  if(pos >= 0 && !(isKids && pos > 7)){
  // kids run: positions 0-7 (6..13); adult run: 8-13 (1..5,5.5) then the
  // repeated adult roll printed again as 6..12 further along the sheet.
    let ppc=null;
  if(chart.kids != null || chart.adult != null){
      /* "kids" and "adult" are SIZE BANDS, not closures, and the band comes
         from the RANGE the size was costed against — that range knows which
         run it is, because it prints its own sizes either 8s..13s (kids) or
         6..13 bare (the adult repeat). Deciding it from the closure instead
         said every Velcro article was kids, so a bare 6 ordered against REX
         GOLA (V)'s adult 6X7B was packed 24/carton where its own range says
         18 — 7 cartons became 168 pairs instead of 126. The closure is only
         the fallback for a size that has not been given a range yet. */
      const bandRun = adultBandRun(article, combo, articleType, sourceSize);
      if(bandRun) ppc = bandRun === "ADULT" ? (chart.adult ?? null) : (chart.kids ?? null);
      else if(String(articleType||"").trim().toUpperCase().startsWith("L")) ppc=chart.adult ?? null;
      else ppc=pos <= 7 ? chart.kids : chart.adult;
    }else if(pos <= 7) ppc=chart["6-13"] ?? null;
    else if(pos <= 12) ppc=chart["1-5"] ?? chart["5.5-12"] ?? null;
    else ppc=chart["5.5"] ?? chart["6-12"] ?? chart["5.5-12"] ?? null;
    if(ppc!=null) return {ppc:Number(ppc),kind:"individual packing chart",article:sourceArticle,size:sourceSize};
  }
  }

  if(combo){
    const ppc=pairsPerCarton(article,combo);
    if(ppc!=null){
      const source=packingRuleSource(article,combo);
      return {ppc:Number(ppc),kind:"range default",article:source.article,combo:source.combo,size:sourceSize};
    }
  }
  return {ppc:null,kind:"missing",article:sourceArticle,size:sourceSize};
}

export function singlePackQty(article,size,articleType="",combo=""){
  return singlePackingRule(article,size,articleType,combo).ppc;
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
    const bundledSource=(PACKING[source.article]||{})[source.combo];
    if(bundledSource!=null) return Number(bundledSource);
    // Older database seeds did not carry ARMOUR's complete chart. Preserve
    // the agreed Armour bands while that database is being migrated.
    if(source.article==="ARMOUR"){
      const armour = ((ref.articles||{}).ARMOUR||{}).combo_order || ["7X10S","11X1","2X5","6X9","9X12"];
      return [24,24,18,18,18][armour.indexOf(source.combo)] ?? null;
    }
    return null;
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
  const source=packingArticleSource(article);
  if(source!==article){
    const own=(((ref.articles||{})[article]||{}).combo_order)||[];
    const sourceCombos=(((ref.articles||{})[source]||{}).combo_order)||[];
    const i=own.indexOf(combo);
    const mapped=(i>=0&&sourceCombos[i])||sourceCombos.includes(combo)&&combo;
    if(mapped) return {article:source,combo:mapped,inherited:true};
  }
  return {article,combo,inherited:false};
}

/* Factory packing policy. An explicit `packing_source` uploaded with the
   article master wins; otherwise the agreed sole-family rules apply. Keeping
   this in one shared function means Match & Check, PI quantities and the rules
   screen all change together when an article changes. */
export function packingArticleSourceFor(ref,article){
  const def=(ref.articles||{})[article]||{};
  const explicit=def.packing_source;
  if(String(explicit||"").toUpperCase()==="SELF") return article;
  if(explicit&&(ref.articles||{})[explicit]) return explicit;
  const name=String(article||"").toUpperCase();
  if(/SMART BOY|SILKY BELLY/.test(name)) return article;
  if(name==="ARMOUR"||/^ARMOUR \(/.test(name)) return article;
  if(/^REX GOLA \([VL]/.test(name)) return article;
  if(name.includes("GOLA PLUS")) return (ref.articles||{})["REX GOLA (V)"]?"REX GOLA (V)":article;
  if(def.sole_type==="EVA"&&(ref.articles||{}).ARMOUR) return "ARMOUR";
  if(def.sole_type==="PVC"&&(ref.articles||{})["REX GOLA (V)"]) return "REX GOLA (V)";
  return article;
}

export function packingArticleSource(article){
  return packingArticleSourceFor(reference(),article);
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

/* The printed factory roll contains the numerals 6..13 twice: first as Small
   (6S..13S), then as Large (6..13). A range label such as 7X10 therefore is
   ambiguous in isolation. Resolve the complete combo_order in sequence, so a
   new article with 7X10, 11X1, 2X5, 6X7, 8X12 naturally advances from the
   small run into the large run. This is article-data driven; no product name
   (GLAMOUR, SPIKE, etc.) is required in code. S forces Small, while B or L
   forces Large when the workbook needs to be explicit. */
const ARTICLE_SIZE_ROLL=["6s","7s","8s","9s","10s","11s","12s","13s","1","2","3","4","5","5.5","6","7","8","9","10","11","12","13"];

function rangeCandidates(rawCombo){
  const raw=String(rawCombo||"").toUpperCase().replace(/\s+/g,"");
  const force=/S$/.test(raw)?"small":/[BL]$/.test(raw)?"large":"";
  const core=raw.replace(/[SBL]$/,"");
  const [a,b]=core.split("X");
  if(!a||!b) return [];
  const bare=s=>String(s).replace(/S$/i,"");
  const starts=ARTICLE_SIZE_ROLL.map((s,i)=>bare(s)===a?i:-1).filter(i=>i>=0);
  const out=[];
  for(const start of starts){
    if(force==="small"&&!/S$/i.test(ARTICLE_SIZE_ROLL[start])) continue;
    if(force==="large"&&/S$/i.test(ARTICLE_SIZE_ROLL[start])) continue;
    for(let end=start;end<ARTICLE_SIZE_ROLL.length;end++){
      if(bare(ARTICLE_SIZE_ROLL[end])===b){out.push({start,end,sizes:ARTICLE_SIZE_ROLL.slice(start,end+1)});break;}
    }
  }
  return out;
}

export function sizeRunOptionsForRange(rawCombo){
  return [...new Set(rangeCandidates(rawCombo).map(candidate=>/s$/i.test(candidate.sizes[0])?"SMALL":"LARGE"))];
}

function articleSizeMap(ref,article){
  const definition=(ref.articles||{})[article]||{};
  const all=definition.combo_order||Object.keys(definition.combos||{});
  const map={};
  let cursor=0;
  for(const combo of all){
    const explicit=definition.combos?.[combo]?.size_order;
    if(Array.isArray(explicit)&&explicit.length){map[combo]=explicit.map(String);continue;}
    const candidates=rangeCandidates(combo);
    const declared=String(definition.combos?.[combo]?.size_run||"").toUpperCase();
    const eligible=declared.startsWith("S")?candidates.filter(c=>/s$/i.test(c.sizes[0]))
      :declared.startsWith("L")?candidates.filter(c=>!/s$/i.test(c.sizes[0])):candidates;
    const chosen=eligible.find(c=>c.start>=cursor)||eligible[0]||candidates.find(c=>c.start>=cursor)||candidates[0];
    if(chosen){map[combo]=chosen.sizes;cursor=chosen.end;}
    else map[combo]=comboSizes(combo);
  }
  return map;
}

export function comboSizesForArticleIn(ref,article,combo,type){
  return articleSizeMap(ref,article)[combo]||comboSizes(combo);
}

export function articleSizesForArticleIn(ref,article){
  const map=articleSizeMap(ref,article), out=[];
  for(const sizes of Object.values(map)) for(const size of sizes)
    if(!out.includes(String(size))) out.push(String(size));
  for(const size of ((ref.articles||{})[article]?.individual_sizes||[]))
    if(!out.some(v=>String(v).toUpperCase()===String(size).toUpperCase())) out.push(String(size));
  return out;
}

export const scopedSizeKey=(combo,size)=>combo?`${String(combo).toUpperCase()}::${String(size).toUpperCase()}`:String(size).toUpperCase();
export function splitScopedSizeKey(raw){
  const parts=String(raw||"").split("::");
  if(parts.length===1) return {combo:null,size:parts[0].toUpperCase(),valid:true};
  if(parts.length!==2||!parts[0]||!parts[1]) return {combo:null,size:String(raw||"").toUpperCase(),valid:false};
  return {combo:parts[0].toUpperCase(),size:parts[1].toUpperCase(),valid:true};
}

/* Accept the notations the factory actually uses. Explicit S/L always wins;
   the sequence fallback is only used for an unmarked numeral. */
export function parseSizeToken(rawSize){
  const raw=String(rawSize==null?"":rawSize).trim().toUpperCase().replace(/\s+/g,"");
  let hit=raw.match(/^(?:SMALL|S)(\d+(?:\.5)?)$/)||raw.match(/^(\d+(?:\.5)?)(?:SMALL|S)$/);
  if(hit) return {bare:hit[1],run:"SMALL",explicit:true,canonical:`${hit[1]}S`};
  hit=raw.match(/^(?:LARGE|BIG|L|B)(\d+(?:\.5)?)$/)||raw.match(/^(\d+(?:\.5)?)(?:LARGE|BIG|L|B)$/);
  if(hit) return {bare:hit[1],run:"LARGE",explicit:true,canonical:hit[1]};
  if(/^\d+(?:\.5)?$/.test(raw)) return {bare:raw,run:"",explicit:false,canonical:raw};
  return {bare:"",run:"",explicit:false,canonical:""};
}

export function createSizeSequenceState(){return {largeStarted:false,explicitLarge:false};}

/* Factory fallback: all Small sizes are written before Large sizes. Therefore
   unmarked 7,8,1,2,3 becomes 7S,8S,1,2,3. Once 1..6 appears, later 7..13 is
   Large. Explicit S/L overrides the fallback, but a Small marker after the
   Large run has begun is returned as an order error rather than silently
   reordering the client's sheet. */
export function resolveArticleSizeWithSequenceIn(ref,article,rawSize,state=createSizeSequenceState()){
  const token=parseSizeToken(rawSize);
  if(!token.bare) return {size:null,candidates:[],ambiguous:false,error:`unrecognised size ${rawSize}`};
  let run=token.run;
  const low=["1","2","3","4","5","5.5","6"].includes(token.bare);
  if(!run) run=low||state.largeStarted?"LARGE":"SMALL";
  const outOfOrder=run==="SMALL"&&state.largeStarted;
  if(run==="LARGE"){state.largeStarted=true;if(token.explicit)state.explicitLarge=true;}
  const wanted=run==="SMALL"?`${token.bare}S`:token.bare;
  const sizes=articleSizesForArticleIn(ref,article).map(String);
  const exact=sizes.find(s=>String(s).toUpperCase()===wanted.toUpperCase());
  if(exact) return {size:/s$/i.test(exact)?exact.replace(/s$/i,"")+"S":exact,candidates:[exact],ambiguous:false,run,inferred:!token.explicit,outOfOrder};
  return {size:null,candidates:[],ambiguous:false,run,inferred:!token.explicit,
    error:`size ${wanted} is not in ${article}'s configured ranges`};
}

/* Canonicalise a workbook size without guessing between Small and Large.
   7S is Small; bare 7 is Large when that article has a Large 7; 7L/7B are
   accepted aliases for Large. If an old article only has Small 7, a bare 7 is
   accepted for backwards compatibility because there is only one candidate. */
export function resolveArticleSizeIn(ref,article,rawSize){
  const parsed=parseSizeToken(rawSize);
  const raw=parsed.canonical||String(rawSize==null?"":rawSize).trim().toUpperCase().replace(/\s+/g,"");
  const sizes=articleSizesForArticleIn(ref,article).map(String);
  const canonical=s=>/S$/i.test(String(s))?String(s).replace(/S$/i,"")+"S":String(s);
  const largeAlias=/^[0-9]+(?:\.5)?[LB]$/.test(raw)?raw.slice(0,-1):raw;
  const exact=sizes.find(s=>s.toUpperCase()===largeAlias);
  if(exact) return {size:canonical(exact),candidates:[canonical(exact)],ambiguous:false};
  if(/S$/.test(raw)||/[LB]$/.test(raw)) return {size:null,candidates:[],ambiguous:false};
  const candidates=sizes.filter(s=>s.replace(/S$/i,"").toUpperCase()===raw).map(canonical);
  return {size:candidates.length===1?candidates[0]:null,candidates,ambiguous:candidates.length>1};
}

export function comboSizesForArticle(article,combo,type){
  return comboSizesForArticleIn(reference(),article,combo,type);
}
