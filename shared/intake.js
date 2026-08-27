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

function mergeSpecific(lines, incoming){
  const existing = lines.find(line => line.combo === incoming.combo && line.sizes && incoming.sizes);
  if(!existing){ lines.push(incoming); return; }
  for(const [size, qty] of Object.entries(incoming.sizes))
    existing.sizes[size] = (Number(existing.sizes[size]) || 0) + Number(qty || 0);
  existing.qty = Object.values(existing.sizes).reduce((sum, qty) => sum + Number(qty || 0), 0);
  existing.cartons = existing.ppc ? +(existing.qty / existing.ppc).toFixed(4) : existing.cartons + incoming.cartons;
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
        if(!runHint&&!written){
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
        const cartons = Math.max(0, Number(rawLine.cartons) || 0);
        if(!sizes.length || cartons <= 0) continue;
        const match = exactCombo(article, type, sizes,runHint);
        const combo = match.combo;
        const raw = sizes.join("|") + (type ? ` (${type})` : "");

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
          const qty = ppc == null ? 0 : cartons * ppc;
          const incoming = {
            combo,
            type: lineType,
            single: combo ? undefined : size,
            exact: !!combo,
            raw,
            cartons,
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
        lines.push({
          combo,
          type: lineType,
          single: combo ? undefined : sizes.join("×"),
          exact: !!combo,
          raw,
          cartons,
          ppc: ppc ?? "",
          ppcKnown: ppc != null,
          qty: ppc == null ? 0 : cartons * ppc,
          size_order: combo ? comboSizesForArticle(article, combo, lineType) : sizes,
        });
        if(!combo) issues.push(`${article} ${type || ""}: ${sizes.join("×")} is not an exact configured size range.`);
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
