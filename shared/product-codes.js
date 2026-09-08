/* Product codes: one family, one prefix, a number per variant.
 *
 * Eighteen Jack articles are eighteen VARIANTS of one product — different
 * closures, different colours — so they read as JACK01 … JACK18 and sort,
 * group and get talked about as one family.
 *
 * THE PROPERTY THAT MATTERS IS STABILITY. A code goes on a job card, a PI and
 * a carton; if it were recomputed from the article list, adding one article
 * would renumber every article after it and last month's paperwork would stop
 * meaning what it said. So a code is ASSIGNED ONCE and then kept: `assignCodes`
 * only ever fills gaps, and never moves a code that already exists.
 *
 * Pure — no database, no clock.
 */

/* Variant markers, not part of the family name. A closure or a colour tells
   you WHICH Jack, not that it is a different product. */
const CLOSURE = new Set(["VELCRO","LACE","V","L","DV","D/V","SLIPON","SLIP-ON","BUCKLE"]);
const COLOUR = new Set([
  "BLACK","WHITE","BLUE","RED","BROWN","BEIGE","GREY","GRAY","TAN","NAVY","CREAM",
  "PINK","GREEN","YELLOW","ORANGE","PURPLE","MAROON","SILVER","GOLD","CAMEL","OLIVE",
  "NBLUE","N.BLUE","SKINFIT","MULTI","RUST","KHAKI","COFFEE","CHERRY","SEA",
  /* The factory's own shorthand, off the live article master: S.BLUE is sky
     blue. Left out, "RAY VELCRO WHITE S.BLUE" made a family called "RAY S.BLUE"
     — so the day a second Ray colour arrived it would be a SEPARATE family,
     which is the one thing the codes exist to prevent. */
  "SBLUE","S.BLUE","SKY","LBLUE","L.BLUE","DBLUE","D.BLUE","OFFWHITE","OFF.WHITE",
  /* R.BLUE sits in exactly the slot N.BLUE and S.BLUE do — "SPIKE LACE N.BLUE
     R.BLUE" — so it is the same kind of word. Left out, SPIKE split into a
     family of its own called "SPIKE R.BLUE". */
  "RBLUE","R.BLUE",
  /* INFERRED FROM POSITION, NOT CONFIRMED. These occupy the trailing colour
     slot across MORE THAN ONE product — "SPIKE LACE N.BLUE IV HOUSE",
     "STRIKE VELCRO WHITE IV HOUSE", "SYMBOL VELCRO WHITE RSGY" — which is
     what a shade reads like and not what a product name reads like. Treated
     as descriptors so SPIKE and STRIKE stay whole; ask the factory what they
     actually are and move them if the answer is different. */
  "RSGY","IVHOUSE",
]);

const norm = v => String(v == null ? "" : v).toUpperCase().replace(/\s+/g, " ").trim();

/* Everything in brackets is a variant note — "(BLUE SKINFIT)", "(V)" — and
   never part of the family. */
const stripBrackets = s => s.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");

/* Split on the separators the factory actually uses, so "BLACK-BLUE" and
   "N.BLUE" are seen as the colour words they are. */
const wordsOf = s => stripBrackets(s)
  .split(/[^A-Z0-9.]+/)
  .flatMap(w => w.split("-"))
  .map(w => w.trim())
  .filter(Boolean);

const isVariantWord = w => CLOSURE.has(w) || COLOUR.has(w) || COLOUR.has(w.replace(/\./g, ""));

/* The same vocabulary, for anything that needs to tell a product's NAME from
   the words that merely say which one. shared/bridge.js matches order slips
   with these: a colour must never outrank the product name. */
const up = w => String(w == null ? "" : w).toUpperCase().trim();
export const isColourWord  = w => COLOUR.has(up(w)) || COLOUR.has(up(w).replace(/\./g, ""));
export const isClosureWord = w => CLOSURE.has(up(w));
export const isDescriptorWord = w => isColourWord(w) || isClosureWord(w);

/* The family an article belongs to: its name with closures, colours and
   bracketed notes removed. "JACK LACE BLACK-BLUE (BLUE SKINFIT)" -> "JACK".
   A name that is nothing BUT variant words keeps its own name, because a
   family of "" would sweep unrelated articles together. */
/* Two-word shade names the factory writes with a space. Folded before the
   words are split, or "IV" and "HOUSE" are judged separately and neither is
   recognised. */
const PAIRS = [[/\bIV\s+HOUSE\b/g, "IVHOUSE"]];
const foldPairs = s => PAIRS.reduce((t, [re, to]) => t.replace(re, to), s);

export function familyOf(article){
  const words = wordsOf(foldPairs(norm(article)));
  const kept = words.filter(w => !isVariantWord(w));
  return (kept.length ? kept : words).join(" ");
}

/* The code prefix for a family: TWO characters, because a customer has to be
   able to write it on an order without mistyping it. "REXGOLAPLUS01" is a code
   nobody copies correctly twice.
   Two characters cannot be unique by construction — SPADE and SPIKE both want
   SP — so a family gets the best candidate still free, and once it has one it
   keeps it. The ladder is deliberate rather than alphabetical fallback: the
   second choice should still LOOK like the product, which is why SPIKE lands
   on SI and not on SQ. */
export function prefixCandidates(family){
  const name = norm(family);
  const words = name.split(" ").filter(Boolean);
  const flat = name.replace(/[^A-Z0-9]/g, "");
  const out = [];
  const push = p => { if(p && p.length === 2 && !out.includes(p)) out.push(p); };
  if(words.length > 1){
    push(words[0][0] + words[1][0]);                        // REX GOLA -> RG
    push(words[0][0] + words[words.length - 1][0]);         // REX GOLA PLUS -> RP
  }
  push(flat.slice(0, 2));                                   // SPADE -> SP
  for(let i = 2; i < flat.length; i++) push(flat[0] + flat[i]);   // SPIKE -> SI, SK, SE
  for(const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") push(flat[0] + c);
  return out;
}

/* The prefix a family would take if nothing were in its way. Kept for callers
   that only want to group; assignCodes is what resolves collisions. */
export function prefixOf(article){
  return prefixCandidates(familyOf(article))[0] || "XX";
}

/* A prefix that ends in a LETTER runs straight into its number — JACK07 — and
   reads back unambiguously. A prefix that ends in a DIGIT does not: the X-1
   article would give "X1" + "01" = "X101", which reads equally well as X1 №01
   and X10 №1, so a later run would claim the wrong number. Those take a
   hyphen: X1-01. */
/* AA000 — two characters, then three digits. Fixed width, so a code is always
   five characters and a prefix can never run into its own number. */
const CODE = /^([A-Z][A-Z0-9])(\d{3})$/;
/* The shapes issued before the two-character scheme, still parsed so an
   existing code can be recognised and reissued rather than duplicated. */
const SEPARATED = /^([A-Z0-9]+)-(\d{2,})$/;
const PLAIN     = /^([A-Z0-9]*?[A-Z])(\d{2,})$/;

/* Pull the prefix and number out of an existing code, so codes already in use
   are respected rather than re-derived. */
export function parseCode(code){
  const c = norm(code).replace(/\s+/g, "");
  const now = CODE.exec(c);
  if(now) return { prefix: now[1], n: Number(now[2]), current: true };
  const sep = SEPARATED.exec(c);
  if(sep) return { prefix: sep[1], n: Number(sep[2]), current: false };
  const m = PLAIN.exec(c);
  return m ? { prefix: m[1], n: Number(m[2]), current: false } : null;
}

/* Is this code in the shape currently issued? An older one is honoured for
   recognition but reissued, so the master never carries two schemes at once —
   half AA000 and half REXGOLAPLUS01 is worse than either. */
export const isCurrentShape = code => !!(parseCode(code) || {}).current;

/* Assign a code to every article that does not have one.
 *
 * `existing` is whatever is already stored, article -> code. Those are kept
 * exactly as they are; only gaps are filled, and each new code takes the next
 * free number in its family. Articles are walked in the order given, so a
 * stable list produces a stable numbering.
 *
 * Returns { codes, assigned, conflicts } — `assigned` is only the new ones, so
 * a caller can report what it did rather than rewriting everything.
 */
export function assignCodes(articles, existing = {}, opts = {}){
  const width = opts.width || 3;
  const codes = {};
  const assigned = {};
  const reissued = {};
  const conflicts = [];
  const used = new Map();          // prefix -> Set of numbers taken
  const taken = new Set();         // every code string in use
  const famPrefix = new Map();     // family -> the prefix it already holds
  const prefixFam = new Map();     // prefix -> the family holding it

  const claim = (prefix, n) => {
    if(!used.has(prefix)) used.set(prefix, new Set());
    used.get(prefix).add(n);
  };

  /* Existing codes are honoured first, so nothing already printed moves —
     but only if they are in the shape currently issued. A master carrying
     half AA000 and half REXGOLAPLUS01 is worse than either, so an older code
     is recognised, released and reissued. */
  for(const article of articles){
    const current = norm(existing[article]).replace(/\s+/g, "");
    if(!current) continue;
    const parsed = parseCode(current);
    if(!parsed || !parsed.current){ if(current) reissued[article] = current; continue; }
    if(taken.has(current)){
      conflicts.push(`${article}: code ${current} is already used by another article`);
      continue;
    }
    const family = familyOf(article) || article;
    /* One family, one prefix. A stored code that disagrees with the prefix its
       family already holds is a leftover from an earlier scheme, not a second
       opinion — it goes back in the queue. */
    if(famPrefix.has(family) && famPrefix.get(family) !== parsed.prefix){ reissued[article] = current; continue; }
    if(prefixFam.has(parsed.prefix) && prefixFam.get(parsed.prefix) !== family){ reissued[article] = current; continue; }
    codes[article] = current;
    taken.add(current);
    famPrefix.set(family, parsed.prefix);
    prefixFam.set(parsed.prefix, family);
    claim(parsed.prefix, parsed.n);
  }

  /* Families are settled in a FIXED order — alphabetical — so the same master
     produces the same prefixes on any machine and in any run. Only families
     with no prefix yet are choosing; one already held is never taken away. */
  const families = [...new Set(articles.map(a => familyOf(a) || a))].sort();
  for(const family of families){
    if(famPrefix.has(family)) continue;
    const prefix = prefixCandidates(family).find(p => !prefixFam.has(p));
    if(!prefix){ conflicts.push(`${family}: no two-character prefix is free`); continue; }
    famPrefix.set(family, prefix);
    prefixFam.set(prefix, family);
  }

  for(const article of articles){
    if(codes[article]) continue;
    const family = familyOf(article) || article;
    const prefix = famPrefix.get(family);
    if(!prefix) continue;
    if(!used.has(prefix)) used.set(prefix, new Set());
    const inUse = used.get(prefix);
    let n = 1;
    while(inUse.has(n)) n++;
    const code = `${prefix}${String(n).padStart(width, "0")}`;
    claim(prefix, n);
    codes[article] = code;
    assigned[article] = code;
    taken.add(code);
  }

  return { codes, assigned, reissued, conflicts, prefixes: Object.fromEntries(famPrefix) };
}

/* Articles grouped by family, for a screen that lists them together. */
export function families(articles, codes = {}){
  const out = {};
  for(const article of articles){
    const family = familyOf(article) || article;
    (out[family] = out[family] || []).push({ article, code: codes[article] || null });
  }
  for(const list of Object.values(out))
    list.sort((a, z) => String(a.code||"").localeCompare(String(z.code||""), undefined, { numeric:true })
      || a.article.localeCompare(z.article));
  return out;
}

/* "JACK01 · JACK LACE BLACK-BLUE" — the code leads, because that is what the
   factory will say out loud once these exist. */
export function labelFor(article, codes = {}){
  const code = codes[article];
  return code ? `${code} · ${article}` : article;
}
