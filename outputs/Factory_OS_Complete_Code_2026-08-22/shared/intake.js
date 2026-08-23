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
  matchAmbiguous,
  matchArticle,
  pairsPerCarton,
  singlePackQty,
} from "./bridge.js";

const cleanType = value => {
  const text = String(value || "").trim().toUpperCase();
  if(text.startsWith("L") || text === "BIG") return "LACE";
  if(text.startsWith("V") || text === "SMALL") return "VELCRO";
  return "";
};

export function sizeForArticleType(size, type){
  const raw = String(size ?? "").trim().toLowerCase().replace(/\.0$/, "");
  if(!raw) return "";
  const bare = raw.replace(/s$/, "");
  if(cleanType(type) === "VELCRO" && /^(?:6|7|8|9|10|11|12|13)$/.test(bare))
    return `${bare}s`;
  return bare;
}

function inferredType(article, order, line){
  const types = articleTypes(article);
  if(types.includes("ALL")) return cleanType(line.type || line.vl || order.type || order.vl);
  const explicit = cleanType(line.type || line.vl || line.group || order.type || order.vl || order.group);
  if(explicit && types.includes(explicit)) return explicit;

  // Sizes 1..5 only exist on the Velcro/kids half of split EVA articles.
  // Adult 6..12 is inherently ambiguous without (L), BIG or an explicit type.
  const sizes = (line.sizes || []).map(v => String(v).replace(/s$/i, ""));
  if(sizes.some(s => ["1","2","3","4","5","5.5"].includes(s))) return "VELCRO";
  return "";
}

function exactCombo(article, type, sizes){
  const combos = articleTypeCombos(article, type);
  if(sizes.length === 1)
    return combos.find(combo => comboSizesForArticle(article, combo, type).includes(sizes[0])) || null;

  // A side-by-side range is only accepted when its endpoints match a real
  // factory range. Choosing a merely nearby range would silently change BOM.
  return combos.find(combo => {
    const run = comboSizesForArticle(article, combo, type);
    return run.length && run[0] === sizes[0] && run[run.length - 1] === sizes[sizes.length - 1];
  }) || null;
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
    const article = matched && articles[matched] ? matched : Object.keys(articles)[0];
    if(!article){ issues.push("No articles are configured."); continue; }

    const groups = new Map();
    for(const rawLine of order.lines || []){
      const type = inferredType(article, order, rawLine);
      const key = type || "UNRESOLVED";
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rawLine);
    }
    if(!groups.size) groups.set(articleTypes(article)[0] || "", []);

    for(const [groupKey, rawLines] of groups){
      const available = articleTypes(article);
      const type = groupKey === "UNRESOLVED"
        ? (available.includes("ALL") ? "" : available[0])
        : groupKey;
      const lines = [];
      if(groupKey === "UNRESOLVED" && !available.includes("ALL"))
        issues.push(`${article}: V/L was not readable for sizes ${rawLines.flatMap(l => l.sizes || []).join(", ")}; review the selected type.`);

      for(const rawLine of rawLines){
        const sizes = (rawLine.sizes || []).map(size => sizeForArticleType(size, type)).filter(Boolean);
        const cartons = Math.max(0, Number(rawLine.cartons) || 0);
        if(!sizes.length || cartons <= 0) continue;
        const combo = exactCombo(article, type, sizes);
        const raw = sizes.join("|") + (type ? ` (${type})` : "");

        if(sizes.length === 1){
          const size = sizes[0];
          const ppc = singlePackQty(article, size, type);
          const qty = ppc == null ? 0 : cartons * ppc;
          const incoming = {
            combo,
            single: combo ? undefined : size,
            exact: !!combo,
            raw,
            cartons,
            ppc: ppc ?? 1,
            ppcKnown: ppc != null,
            qty,
            sizes: qty > 0 ? { [size]: qty } : undefined,
            size_order: combo ? comboSizesForArticle(article, combo, type) : [size],
          };
          mergeSpecific(lines, incoming);
          if(!combo) issues.push(`${article} ${type || ""}: size ${size} has no matching BOM range.`);
          if(ppc == null) issues.push(`${article} ${type || ""}: size ${size} has no single-size packing rate.`);
          continue;
        }

        const ppc = combo ? pairsPerCarton(article, combo) : null;
        lines.push({
          combo,
          single: combo ? undefined : sizes.join("×"),
          exact: !!combo,
          raw,
          cartons,
          ppc: ppc ?? 1,
          ppcKnown: ppc != null,
          qty: ppc == null ? 0 : cartons * ppc,
          size_order: combo ? comboSizesForArticle(article, combo, type) : sizes,
        });
        if(!combo) issues.push(`${article} ${type || ""}: ${sizes.join("×")} is not an exact configured size range.`);
      }

      cards.push({
        article,
        party: String(order.party || "").trim(),
        customer_city: order.customer_city || "",
        vl: type,
        matched: !!matched,
        ambiguous: matchAmbiguous(order.category, order.color),
        raw: `${order.category || ""} ${order.color || ""}`.trim(),
        lines,
      });
    }
  }
  return { cards: cards.filter(card => card.lines.length), issues };
}
