/* Prompt for reading an existing Proforma Invoice into structured order lines.
   Built from live reference data so it always names the real articles. */
import { reference } from "./bridge.js";

export const readPiPrompt = () => {
  const ref = reference();
  const articles = Object.keys(ref.articles).join(", ");
  return `You are reading a PROFORMA INVOICE from an Indian shoe manufacturer. Return STRICT JSON and nothing else - no preamble, no markdown fences.

KNOWN ARTICLES (map what is printed onto one of these exactly): ${articles}.
The invoice may abbreviate: "Gola+" or "Gola Plus" means REX GOLA PLUS; "Gola" with V means REX GOLA (V), with L means REX GOLA (L).

SIZES: the size column mixes two runs. Sizes written with an "s" (7s, 8s ... 13s) are the kids run. Sizes written as bare numerals (1, 2, 3 ... 12) are the adult run. Keep the "s" exactly as printed - it is not a typo and it distinguishes two different sizes.

Read EVERY size row. Do not merge rows, do not skip rows, do not invent rows.

Return this shape:
{
  "order_no": "PI/596",
  "pi_date": "2026-06-26",
  "dispatch_timeline": "45 days",
  "customer": "Pawan Marketing",
  "customer_city": "Mumbai",
  "discount_pct": 40,
  "items": [
    {"article": "REX GOLA PLUS", "vl": "Velcro", "sole_colour": "Black", "upper_colour": "Black/Black",
     "rows": [{"size": "7s", "qty": 125, "mrp": 679}, {"size": "8s", "qty": 125, "mrp": 679}]}
  ]
}

Rules:
- Dates as YYYY-MM-DD. Indian invoices write dates day-first.
- "qty" and "mrp" are plain numbers, no commas or currency symbols.
- If a value is genuinely absent, use null. Never guess a quantity or a price.
- Group rows under the article they belong to. One entry in "items" per article.`;
};
