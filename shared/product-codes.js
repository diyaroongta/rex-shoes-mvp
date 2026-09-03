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

/* The family an article belongs to: its name with closures, colours and
   bracketed notes removed. "JACK LACE BLACK-BLUE (BLUE SKINFIT)" -> "JACK".
   A name that is nothing BUT variant words keeps its own name, because a
   family of "" would sweep unrelated articles together. */
export function familyOf(article){
  const words = wordsOf(norm(article));
  const kept = words.filter(w => !isVariantWord(w));
  return (kept.length ? kept : words).join(" ");
}

/* The code prefix for a family: its words run together. "SILKY BELLY" ->
   "SILKYBELLY", so SILKYBELLY01 and SILKYBELLY02 are unmistakably one family
   and cannot collide with another product that merely starts the same way. */
export function prefixOf(article){
  return familyOf(article).replace(/[^A-Z0-9]/g, "");
}

/* A prefix that ends in a LETTER runs straight into its number — JACK07 — and
   reads back unambiguously. A prefix that ends in a DIGIT does not: the X-1
   article would give "X1" + "01" = "X101", which reads equally well as X1 №01
   and X10 №1, so a later run would claim the wrong number. Those take a
   hyphen: X1-01. */
const digitEnding = prefix => /\d$/.test(prefix);
const SEPARATED = /^([A-Z0-9]+)-(\d{2,})$/;      // the hyphen settles it outright
const PLAIN     = /^([A-Z0-9]*?[A-Z])(\d{2,})$/;  // otherwise the prefix ends at its last letter

/* Pull the prefix and number out of an existing code, so codes already in use
   are respected rather than re-derived. */
export function parseCode(code){
  const c = norm(code).replace(/\s+/g, "");
  const sep = SEPARATED.exec(c);
  if(sep) return { prefix: sep[1], n: Number(sep[2]) };
  const m = PLAIN.exec(c);
  return m ? { prefix: m[1], n: Number(m[2]) } : null;
}

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
  const width = opts.width || 2;
  const codes = {};
  const assigned = {};
  const conflicts = [];
  const used = new Map();          // prefix -> Set of numbers taken
  const taken = new Set();         // every code string in use

  const claim = (prefix, n) => {
    if(!used.has(prefix)) used.set(prefix, new Set());
    used.get(prefix).add(n);
  };

  /* Existing codes are honoured first, so nothing already printed moves. */
  for(const article of articles){
    const current = norm(existing[article]).replace(/\s+/g, "");
    if(!current) continue;
    if(taken.has(current)){
      conflicts.push(`${article}: code ${current} is already used by another article`);
      continue;
    }
    codes[article] = current;
    taken.add(current);
    const parsed = parseCode(current);
    if(parsed) claim(parsed.prefix, parsed.n);
  }

  for(const article of articles){
    if(codes[article]) continue;
    const prefix = prefixOf(article) || "ITEM";
    if(!used.has(prefix)) used.set(prefix, new Set());
    const inUse = used.get(prefix);
    let n = 1;
    while(inUse.has(n)) n++;
    const code = `${prefix}${digitEnding(prefix) ? "-" : ""}${String(n).padStart(width, "0")}`;
    claim(prefix, n);
    codes[article] = code;
    assigned[article] = code;
    taken.add(code);
  }

  return { codes, assigned, conflicts };
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
