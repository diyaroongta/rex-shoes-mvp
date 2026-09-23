/* The factory's stage job cards: PASTING and PACKING.
 *
 * Their two formats (PASTING JC FORMATE.xlsx, PACKING JC FORMATE.xlsx) are the
 * same document as the ARMOUR cutting card one stage later: a header naming the
 * article, a size-wise PLAN grid totalling pairs, a numbered list of what the
 * store issues, signatures, then dated DT/SIZE/QTY blocks for what comes back.
 *
 * WHICH BOM STAGE FEEDS WHICH CARD. "Pasting" is the factory's word for
 * attaching the sole — their packing card signs it off as "Stuckon/pvc dept" —
 * and the stage that does that in the planner is MOLDING. So the pasting card
 * issues the MOLDING stage's materials and the packing card the PACKING
 * stage's. Nothing else in the app moves: this is a view of the same BOM.
 *
 * WHAT IS NEVER INVENTED. Quantities come from the BOM rate times the pairs on
 * the card, exactly as the cutting card computes them. Where a stage carries no
 * BOM at all, the card prints the factory's own blank checklist with an EMPTY
 * quantity column — which is what their format is — and says so through
 * `from_bom:false`, rather than making a figure up to fill the column.
 *
 * Pure: no database, no clock, no React.
 */
import { jobCardIssue } from "./bom-components.js";

const clean = v => String(v == null ? "" : v).trim();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* Printed on both of their formats, beside the material list. It is part of
   the FORM, the way the letterhead is on the packing list — every card they
   issue carries it — so it ships as a default and `config.avg_notes`
   replaces it rather than a code change. */
export const DEFAULT_AVG_NOTES = [
  { label: "NYLON THREAD", value: "46 CM" },
  { label: "BACK TAPE",    value: "12 CM" },
];

/* The pasting list off their blank format. Used ONLY when the article has no
   MOLDING BOM, so the card is still the sheet the floor knows, with the
   quantity column empty for the store to write in. */
const PASTING_CHECKLIST = [
  "Adhesive / Solvent Cement", "Primer", "Thinner", "Rubber Sole / Sheet",
  "Insole Board", "Foam Sheet", "Toe Puff", "Counter (Heel Stiffener)",
  "Lining Cloth", "Nylon Thread", "Back Tape / Heel Tape", "Eyelets / Hooks",
];

export const CARD_KINDS = {
  PASTING: {
    kind: "PASTING",
    title: "PASTING",
    stage: "MOLDING",
    issue_title: "PASTING MATERIAL ISSUED",
    /* One plan row, headed UPPER — what is going in to be pasted. */
    plan_rows: ["UPPER"],
    signatures: ["Sign. of Pasting In-charge", "Sign. of Store In-charge", "Sign. of QC In-charge"],
    movements: ["UPPER RECEIVED", "SHORTAGE / PENDING AFTER RECEIPT", "SHORTAGE RECEIPT"],
    summary: [],
    checklist: PASTING_CHECKLIST,
  },
  PACKING: {
    kind: "PACKING",
    title: "PACKING JC",
    stage: "PACKING",
    issue_title: "PACKING MATERIAL ISSUED",
    /* Three issues are signed for separately on their sheet, each with its own
       authority signatory, and each is the same run of pairs. */
    plan_rows: ["UPPER ISSUE", "INSOLE ISSUE", "TEXTION ISSUE"],
    signatures: ["Sign. of Stuckon/pvc dept incharge", "Sign. of Store In-charge", "Sign. of QC In-charge"],
    /* Their sheet spells these CARTOON and LOOS; the words are corrected here
       and nothing else about the block is changed. */
    movements: ["MOULDED/PASTED SHOE", "SENT FOR REPAIR / REJECTION", "PACKING", "CARTON RECEIVED"],
    summary: ["REJECTION/REPAIR", "PACKING", "CARTON RECEIVED", "LOOSE PAIRS"],
    checklist: [],
  },
};

export const cardKinds = () => Object.values(CARD_KINDS).map(k => ({ kind: k.kind, title: k.title, stage: k.stage }));

/* Size by size, in the order the job order was entered — the same shape the
   cutting card prints, so one size column serves the whole document. */
export function sizeCells(lines){
  const out = [];
  for(const line of lines || []){
    const order = (line.size_order && line.size_order.length) ? line.size_order : [line.combo];
    const split = (line.sizes && Object.keys(line.sizes).length) ? line.sizes : null;
    for(const size of order) out.push({ size: clean(size), qty: split ? num(split[size]) : null });
  }
  return out;
}

/* Everything one stage card needs, from the job order's lines and the article.
 *
 * `rows` are what the store issues: the stage's components where the BOM names
 * cut pieces, its materials where it does not — the cutting card's own rule.
 * `from_bom` is false when the article has nothing on that stage, and `rows` is
 * then the factory's blank checklist with no quantities. */
export function stageCard(lines, article, kind, opts = {}){
  const def = CARD_KINDS[clean(kind).toUpperCase()];
  if(!def) throw new Error(`Unknown job card: ${kind}`);

  const used = (lines || []).filter(l => num(l.qty) > 0);
  const { stages, missing_components } = jobCardIssue(used, article || {});
  const found = stages.find(s => s.stage === def.stage);

  const rows = found && found.issued.length
    ? found.issued.map(r => ({ name: clean(r.name || r.material), qty: r.qty, uom: clean(r.uom) }))
    : def.checklist.map(name => ({ name, qty: null, uom: "" }));

  const cells = sizeCells(used);
  const total = cells.reduce((a, c) => a + num(c.qty), 0)
    || used.reduce((a, l) => a + num(l.qty), 0);

  return {
    kind: def.kind,
    title: def.title,
    stage: def.stage,
    issue_title: def.issue_title,
    sizes: cells,
    total_pairs: total,
    plan_rows: def.plan_rows,
    signatures: def.signatures,
    movements: def.movements,
    summary: def.summary,
    rows,
    from_bom: !!(found && found.issued.length),
    from_components: !!(found && found.from_components),
    /* Only the cutting stage can be missing cut-piece names in a way worth
       reporting; carried through so the card can say it, as it already does. */
    missing_components,
    avg_notes: Array.isArray(opts.avg_notes) ? opts.avg_notes : DEFAULT_AVG_NOTES,
  };
}
