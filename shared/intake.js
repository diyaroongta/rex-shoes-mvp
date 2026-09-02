/* Handwritten-order intake normalization.

   The reader returns what is visible on the page: individual sizes with carton
   counts, or an explicit range written side-by-side. This module converts that
   evidence into the exact order-line shape used by both the PI and planner.
   Keeping this outside React prevents the photo path from inventing a different
   interpretation from the spreadsheet importer. */
import {
  articleTypes,
  articleTypeCombos,
  comboSizesForArticle,
  comboType,
  matchAmbiguous,
  matchArticle,
  parseSizeToken,
  pairsPerCarton,
  singlePackQty,
} from "./bridge.js";

/* Closure and size run are different facts. In factory notation L means the
   Large size run; it must never be expanded to Lace. Only the full closure
   words are accepted here. */
const cleanType = value => {
  const text = String(value || "").trim().toUpperCase();
  if(text === "LACE") return "LACE";
  if(text === "VELCRO") return "VELCRO";
  return "";
};

const cleanRun = value => {
  const text=String(value||"").trim().toUpperCase();
  if(["S","SMALL"].includes(text)) return "SMALL";
  if(["L","LARGE","BIG"].includes(text)) return "LARGE";
  return "";
};

export function sizeForArticleType(size, type){
  const raw = String(size ?? "").trim().toLowerCase().replace(/\.0$/, "");
  if(!raw) return "";
  const bare = raw.replace(/s$/, "");
  if(cleanRun(type) === "SMALL" && /^(?:6|7|8|9|10|11|12|13)$/.test(bare))
    return `${bare}s`;
  return bare;
}

function inferredType(article, order, line){
  const types = articleTypes(article);
  if(types.includes("ALL")) return cleanType(line.type || line.vl || order.type || order.vl);
  // An article with only ONE possible type cannot have an unreadable one. REX
  // GOLA (L) is a Lace article by its code; warning that its V/L "was not
  // readable" sent the clerk looking for a problem that does not exist.
  if(types.length === 1) return types[0];
  const explicit = cleanType(line.type || line.vl || order.type || order.vl);
  if(explicit && types.includes(explicit)) return explicit;
  return "";
}

/* A numeral 6-13 written on a slip can be the kids size (8s) or the adult
   repeat (8). Both genuinely exist on the same article — that is exactly why
   the B ranges exist — so a written size has two possible spellings. */
const sizeSpellings = (size, runHint="") => {
  const token=parseSizeToken(size);
  const bare=token.bare||String(size).replace(/s$/i, "");
  if(token.run==="SMALL"||runHint==="SMALL") return [`${bare}s`];
  if(token.run==="LARGE"||runHint==="LARGE") return [bare];
  return /^(?:6|7|8|9|10|11|12|13|13\.5)$/.test(bare) ? [bare, `${bare}s`] : [bare];
};

/* Match written sizes to one of the article's real ranges, trying both
   spellings. Returns the range AND the sizes spelled the way THAT range prints
   them, so the stored size map always keys to size_order.

   A tie is reported, never broken: on REX GOLA (L) a bare "8" fits both 8X10
   (as 8s) and 8X10B (as 8), and picking one silently changes the BOM. */
/* THE ASCENDING RULE DECIDES THE RUN. The factory writes every Small size
   before every Large one, so an unmarked 8X10 with no Large size yet written
   is the Small 8s..10s — not an open question between 8X10 and 8X10B. This
   used to be suppressed whenever a CLOSURE was written, because knowing a line
   was Velcro was mistaken for knowing its run; the two are independent, and
   the sheet had already answered the run. */
function exactCombo(article, type, sizes,runHint=""){
  const combos = articleTypeCombos(article, type);
  const hits = [];
  for(const combo of combos){
    const run = comboSizesForArticle(article, combo, type);
    if(!run.length) continue;
    if(sizes.length === 1){
      const hit = run.find(r => sizeSpellings(sizes[0],runHint).includes(r));
      if(hit) hits.push({ combo, sizes:[hit] });
      continue;
    }
    // A side-by-side range is only accepted when its endpoints match a real
    // factory range. Choosing a merely nearby range would silently change BOM.
    if(sizeSpellings(sizes[0],runHint).includes(run[0])
       && sizeSpellings(sizes[sizes.length - 1],runHint).includes(run[run.length - 1]))
      hits.push({ combo, sizes:run });
  }
  if(hits.length === 1) return hits[0];
  return { combo:null, sizes:null, candidates:hits.map(h => h.combo) };
}

/* Two lines are the SAME line only when they resolved to the same real range.
   `null === null` used to make every unresolved single size one row, so a slip
   writing 11, 2 and 6 as three separate stacks arrived as a single "11s, 2, 6"
   line whose carton count was the sum divided by one size's packing rate. An
   unresolved size is precisely a size we cannot key, so it can never be
   merged with another. */
/* WHAT THE NUMBER UNDER A SIZE MEANS.
 *
 * The slip stacks size over quantity — "12" over "18" — and that lower figure
 * is sometimes cartons and sometimes pairs. The factory's own rule is the size
 * of the number: a carton count for one size is a small number, so anything
 * ABOVE TEN is pairs. "12 over 18" is eighteen PAIRS of size 12; "11X13 over
 * 4" is four CARTONS of that range.
 *
 * Reading eighteen pairs as eighteen cartons multiplies the order by the
 * packing rate — on SPIKE's 11X1 that is 24x — so a 288-pair order came back
 * as thousands. Getting this the wrong way round is not a rounding error, it
 * is a different order.
 *
 * It is a heuristic and it is stated as one: `basis` comes back on every line
 * so the screen can show which way it was read, and a genuinely large carton
 * count is corrected by hand. */
export const CARTON_LIMIT = 10;

export function readQuantity(written, ppc){
  const n = Math.max(0, Number(written) || 0);
  if(!n) return { pairs:0, cartons:0, basis:null };
  if(n > CARTON_LIMIT)
    return { pairs:n, cartons: ppc ? +(n/ppc).toFixed(4) : null, basis:"pairs" };
  return { pairs: ppc ? n*ppc : 0, cartons:n, basis:"cartons" };
}

function mergeSpecific(lines, incoming){
  const existing = incoming.combo
    && lines.find(line => line.combo === incoming.combo && line.sizes && incoming.sizes);
  if(!existing){ lines.push(incoming); return; }
  for(const [size, qty] of Object.entries(incoming.sizes))
    existing.sizes[size] = (Number(existing.sizes[size]) || 0) + Number(qty || 0);
  existing.qty = Object.values(existing.sizes).reduce((sum, qty) => sum + Number(qty || 0), 0);
  /* ADD THE CARTONS THE SLIP WROTE. Dividing merged pairs by ONE size's rate
     re-derives a number the sheet already states, and sizes inside a range do
     not all pack alike: on SPIKE's 11X1, 12s and 13s pack 24 to a carton and
     size 1 packs 18, so 1+2+2 = 5 written cartons came back as 108/24 = 4.5
     and the slip's own "= 14 CTN" no longer added up. */
  existing.cartons = +(Number(existing.cartons || 0) + Number(incoming.cartons || 0)).toFixed(4);
  existing.raw = [existing.raw, incoming.raw].filter(Boolean).join(", ");
}

export function buildPhotoCards(parsed, reference){
  const articles = (reference && reference.articles) || {};
  const cards = [];
  const issues = [];

  for(const order of (parsed && parsed.orders) || []){
    const matched = matchArticle(order.category, order.color);
    if(!Object.keys(articles).length){ issues.push("No articles are configured."); continue; }
    if(!matched || !articles[matched]){
      issues.push(`${String(order.category || "Unknown article").trim()}: no configured article match; add or select the article before generating the PI.`);
      continue;
    }

    /* WHICH article a line belongs to can depend on its V/L, and the two
       families behave oppositely:

         SPIKE / ARMOUR / JILL …  one article, two rolls   -> ONE card
         REX GOLA (V) / (L)       two articles, own BOMs   -> TWO cards

       Resolving the article per line and then grouping by article handles both
       without either family knowing about the other. */
    const articleFor = lineType => {
      if(!lineType) return matched;
      const withType = matchArticle(`${order.category || ""} ${lineType}`, order.color);
      return withType && articles[withType] ? withType : matched;
    };
    const article = matched;

    /* GROUP BY ARTICLE. A sheet writing SPIKE with a Velcro section and a Lace
       section ordered one shoe in two rolls, so the type rides on each LINE and
       the article stays whole. A sheet writing Gala (V) and Gala (L) ordered
       two different articles, so those land on two cards. Both fall out of
       grouping by the article each line resolves to. */
    const byArticle = new Map();
    const sizeSequence = new Map();

    {
      for(const rawLine of order.lines || []){
        // Probe with the type AS WRITTEN, before any article constrains it —
        // on a legacy family the written (L) is what selects the other article,
        // so asking the (V) article what type it allows would always say V.
        const written = cleanType(rawLine.type || rawLine.vl || order.type || order.vl);
        const article = articleFor(written);
        const available = articleTypes(article);
        const inferred = inferredType(article, order, rawLine);
        // With no closure written, keep all of the article's ranges available.
        // The exact range/size run can resolve the line; silently choosing the
        // first closure is what used to turn Large into Lace/Velcro.
        const type = inferred || "";
        if(!byArticle.has(article)) byArticle.set(article, []);
        const lines = byArticle.get(article);
        const rawSizes=(rawLine.sizes||[]).filter(v=>String(v??"").trim()!=="");
        const explicitRuns=[...new Set(rawSizes.map(size=>parseSizeToken(size).run).filter(Boolean))];
        let runHint=explicitRuns.length===1?explicitRuns[0]:"";
        if(!runHint) runHint=cleanRun(rawLine.run||rawLine.group||order.run||order.group);
        if(!runHint){
          const state=sizeSequence.get(article)||{largeStarted:false};
          const first=parseSizeToken(rawSizes[0]);
          if(first.bare){
            const low=["1","2","3","4","5","5.5","6"].includes(first.bare);
            runHint=low||state.largeStarted?"LARGE":"SMALL";
            if(runHint==="LARGE")state.largeStarted=true;
          }
          sizeSequence.set(article,state);
        }
        const sizes = rawSizes.map(size => {
          const token=parseSizeToken(size);
          if(token.run==="SMALL")return `${token.bare}s`;
          if(token.run==="LARGE")return token.bare;
          if(runHint==="SMALL")return `${token.bare||size}s`;
          return token.bare||String(size);
        }).filter(Boolean);
        /* The figure as WRITTEN. Whether it means cartons or pairs is decided
           by readQuantity, per line, once the packing rate is known. */
        const written_qty = Math.max(0, Number(rawLine.cartons) || 0);
        if(!sizes.length || written_qty <= 0) continue;
        const match = exactCombo(article, type, sizes, runHint);
        const combo = match.combo;
        /* PROVENANCE, not a label the invoice prints. It must read back as the
           slip wrote it — "11X13", not the "11s|13s" the run inference chose,
           which looked like a value the clerk could correct by typing. */
        const raw = rawSizes.map(size => parseSizeToken(size).bare || String(size)).join("X");

        // Once a range is known IT decides the type — the section heading only
        // has to get us to the right range.
        const lineType = combo ? (comboType(article, combo) || type) : type;
        if(!combo && match.candidates && match.candidates.length > 1)
          issues.push(`${article}: ${sizes.join("×")} fits both ${match.candidates.join(" and ")} — `
            + `pick which range it should be costed against.`);

        if(sizes.length === 1){
          // The spelling the CHOSEN range uses, so the size map keys to
          // size_order and the packing rate is looked up on the right roll.
          const size = combo ? match.sizes[0] : sizes[0];
          const ppc = singlePackQty(article, size, lineType,combo);
          /* Each size at ITS OWN rate, and the written figure read as pairs or
             cartons by its size. */
          const read = readQuantity(written_qty, ppc);
          const qty = read.pairs;
          const incoming = {
            combo,
            type: lineType,
            single: combo ? undefined : size,
            exact: !!combo,
            raw,
            basis: read.basis,
            cartons: read.cartons,
            ppc: ppc ?? "",
            ppcKnown: ppc != null,
            qty,
            sizes: qty > 0 ? { [size]: qty } : undefined,
            size_order: combo ? comboSizesForArticle(article, combo, lineType) : [size],
          };
          mergeSpecific(lines, incoming);
          if(!combo) issues.push(`${article} ${type || ""}: size ${size} has no matching BOM range.`);
          if(ppc == null) issues.push(`${article} ${type || ""}: size ${size} has no single-size packing rate.`);
          continue;
        }

        const ppc = combo ? pairsPerCarton(article, combo) : null;
        const readLine = readQuantity(written_qty, ppc);
        lines.push({
          combo,
          type: lineType,
          single: combo ? undefined : sizes.join("×"),
          exact: !!combo,
          raw,
          basis: readLine.basis,
          cartons: readLine.cartons,
          ppc: ppc ?? "",
          ppcKnown: ppc != null,
          qty: readLine.pairs,
          size_order: combo ? comboSizesForArticle(article, combo, lineType) : sizes,
        });
        if(!combo) issues.push(`${article} ${type || ""}: ${sizes.join("×")} is not an exact configured size range.`);
      }

      /* The sheet writes its own carton total ("= 14 CTN"). It is the one
         independent check on the whole read, so it is CHECKED, not trusted: a
         reader that drops a whole block of entries produces lines that look
         perfectly reasonable on their own, and only the total gives it away. */
      const stated = Number(order.stated_cartons);
      if(Number.isFinite(stated) && stated > 0){
        let counted = 0;
        for(const group of byArticle.values())
          for(const line of group) counted += Number(line.cartons) || 0;
        if(Math.abs(counted - stated) > 0.01)
          issues.push(String(order.category || "this order").trim()
            + ": the sheet totals " + stated + " cartons but only "
            + (+counted.toFixed(2)) + " were read. Entries have been missed or misread"
            + " — check the slip against the lines below before saving.");
      }

      for(const [article, lines] of byArticle){
        // The card's own V/L is a SUMMARY of its lines, never a discriminator.
        // A shoe ordered in both rolls has no single type, and must not be
        // split into two articles just to give it one.
        const present = [...new Set(lines.map(l => l.type).filter(Boolean))];
        cards.push({
          article,
          party: String(order.party || "").trim(),
          customer_city: order.customer_city || "",
          vl: present.length === 1 ? present[0] : "",
          types: present,
          matched: !!matched,
          ambiguous: matchAmbiguous(order.category, order.color),
          raw: `${order.category || ""} ${order.color || ""}`.trim(),
          lines,
        });
      }
    }
  }
  return { cards: cards.filter(card => card.lines.length), issues };
}

/* Which sizes a range brings along that were never on the slip.
 *
 * A size range is a fixed run, so mapping a written "2, 4, 5" to the range 2X5
 * quietly adds size 3 — and mapping "9, 10, 11" to 9X12 adds size 12. That is
 * often exactly right, because the slip abbreviates a continuous run, but it
 * is a DECISION and not a reading: the extra size gets priced, costed and
 * made. Naming it is the difference between the clerk confirming an
 * abbreviation and discovering an invented size at dispatch.
 *
 * Compared on the bare numeral, so a written "12" matches the range's "12s" —
 * which run a line belongs to is a separate question, already shown beside it.
 */
export function sizesNotWritten(raw, sizeOrder){
  const bare = v => {
    const t = parseSizeToken(v);
    return t.bare || String(v == null ? "" : v).trim().toUpperCase().replace(/S$/,"");
  };
  const written = new Set(String(raw == null ? "" : raw)
    .split(/[^0-9A-Za-z.]+/).filter(Boolean).map(bare));
  if(!written.size) return [];                 // nothing written: nothing to compare against
  return (sizeOrder || []).filter(s => !written.has(bare(s)));
}
