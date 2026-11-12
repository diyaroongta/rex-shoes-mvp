/* The Raw Material Store, in the factory's own STOCK MASTER layout.
 *
 * The client keeps one workbook per month: a DASHBOARD, then a sheet per
 * category (SOLE MASTER, INSOLE MASTER, CHEMICAL MASTER, PACKING MASTER …).
 * Each item row reads
 *
 *   S.N · CATEGORY · ITEM DESCRIPTION · SIZE · OPENING STOCK · MIN. STOCK ·
 *   REC. · ISSUE · BALANCE · UOM · RATE · OPENING / ISSUE / RECEIVE / BALANCE
 *   VALUE · ALERT · ORDER QTY · then a REC. / ISSUE pair for every day 1..31
 *
 * and ALERT is their own formula, IF(BALANCE < MIN, "MAKE ORDER", "STOCK OK"),
 * with ORDER QTY = MIN − BALANCE. This module reproduces that sheet from the
 * app's register, so the store sees the page it already knows.
 *
 * THE MONTH IS DERIVED, NOT STORED. The register keeps one running figure per
 * material (opening + received − issued) and the daily columns come from dated
 * movements: the store's own day register, job-card issues, and PO receipts.
 * A month's closing balance is today's balance with everything dated AFTER the
 * month taken back off, and its opening is that closing less the month's own
 * movements — so Opening + Rec − Issue = Balance holds on every row, for any
 * month, without a second copy of the stock that could disagree.
 *
 * ONE ITEM PER SIZE. The sheet stocks soles and insoles size by size, and
 * 1231 BLACK in 5C is not interchangeable with 1231 BLACK in 6C. The size is
 * folded into the material NAME — the same rule colour follows — so every key
 * stays the flat `NAME||UOM` that netting and the BOM already read.
 *
 * Pure: no database, no clock.
 */
import { isRealDate } from "./valid.js";
import { balanceOf } from "./stock.js";
import { materialTotals } from "./bom-components.js";

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round4 = n => Math.round(n * 10000) / 10000;
const text = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const upper = v => text(v).toUpperCase();
const nameOf = key => String(key || "").split("||")[0];
const uomOf  = key => String(key || "").split("||")[1] || "";
const EPS = 1e-6;

export const STORE_MOVE_TYPES = ["rec", "issue"];
export const STORE_MOVE_LABEL = { rec: "Received", issue: "Issued" };

/* The categories on the client's DASHBOARD, in their order. A category the
   sheet names that is not here is kept, never dropped — it simply sorts after. */
export const STORE_CATEGORIES = ["SOLE", "INSOLE", "CHEMICAL", "PACKING", "FABRIC", "GRINDERY", "PVC COMPOUND", "OTHER"];
const categoryRank = c => { const i = STORE_CATEGORIES.indexOf(upper(c)); return i < 0 ? STORE_CATEGORIES.length : i; };
export const byCategory = (a, z) => categoryRank(a) - categoryRank(z) || upper(a).localeCompare(upper(z));

/* A size as the sheet writes it. Numbers arrive from a spreadsheet as 5 or
   5.0; both are the size "5". */
export function cleanSize(v){
  if(typeof v === "number" && Number.isFinite(v)) return String(v);
  return upper(v);
}

/* The item's name on the register: description, then size when it has one. */
export function storeItemName(description, size){
  const d = upper(description), s = cleanSize(size);
  if(!s) return d;
  return d.endsWith(" " + s) ? d : `${d} ${s}`;
}
export const storeItemKey = (description, size, uom) => `${storeItemName(description, size)}||${upper(uom)}`;

/* ─── Reading the factory's workbook ─────────────────────────────────────── */

const MONTHS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
/* "(OCTOBER 2026)" in the title row → "2026-10". */
export function monthFromTitle(title){
  const m = upper(title).match(/\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{4})\b/);
  return m ? `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}` : null;
}

/* Their headings, as written — "ALERRT" included — mapped to a field. */
const HEADINGS = {
  "S.N":"sn", "SN":"sn", "S.NO":"sn",
  "CATEGORY":"category", "ITEM DESCRIPTION":"description", "SIZE":"size",
  "OPENING STOCK":"opening", "MIN. STOCK":"min", "MIN STOCK":"min",
  "UOM":"uom", "RATE":"rate", "SKU":"sku", "SKU CODE":"sku", "ITEM CODE":"sku",
  "SUPPLIER":"supplier", "TERMS":"terms",
};
const headingOf = v => upper(v).replace(/\s*\.\s*$/, ".").replace(/\s+/g, " ");
const figure = v => (v === "" || v == null) ? null : (Number.isFinite(Number(v)) ? Number(v) : NaN);

/* One sheet as an array of rows (SheetJS `sheet_to_json(ws,{header:1})`).
   A sheet with no ITEM DESCRIPTION heading — the DASHBOARD — is not an item
   sheet and answers `null`. */
export function parseStockSheet(aoa = [], sheetName = ""){
  const rows = Array.isArray(aoa) ? aoa : [];
  const h = rows.findIndex(r => Array.isArray(r) && r.some(c => headingOf(c) === "ITEM DESCRIPTION"));
  if(h < 0) return null;
  const head = rows[h];
  const col = {};
  head.forEach((c, i) => { const f = HEADINGS[headingOf(c)]; if(f && col[f] == null) col[f] = i; });
  /* The daily block: a day number 1..31 over a REC. / ISSUE pair. */
  const days = [];
  head.forEach((c, i) => { const n = Number(c); if(Number.isInteger(n) && n >= 1 && n <= 31 && i > (col.description ?? 0)) days.push(i); });
  const title = rows.slice(0, h).flat().map(text).find(t => /STOCK MASTER/i.test(t)) || "";
  const fallbackCategory = upper(sheetName).replace(/\s*MASTER\s*$/, "") || upper(title.split("-")[0]);
  const warnings = [], skipped = [], items = [];
  let dailyFigures = 0;
  for(let r = h + 1; r < rows.length; r++){
    const row = rows[r] || [];
    const description = upper(row[col.description]);
    if(!description || /^(REC\.?|ISSUE)$/.test(description)) continue;
    const rowNo = r + 1, where = `${sheetName || "Sheet"} row ${rowNo}`;
    const uom = upper(row[col.uom]);
    /* The PACKAGING SUMMARY block under the packing items has a description
       and nothing else. It is a total, not an item — said, not loaded. */
    if(!uom){
      skipped.push({ where, name: description, reason: col.sn != null && Number(row[col.sn]) > 0
        ? "it has no UOM, and the UOM is part of the item's identity" : "it has no S.N or UOM, so it is not an item row" });
      continue;
    }
    /* A cell that is not a figure is read as BLANK and said: the live INSOLE
       sheet has "PAIR" typed in MIN. STOCK from row 28 down. A blank minimum
       is "not set", never an invented zero. */
    const read = f => {
      if(col[f] == null) return null;
      const n = figure(row[col[f]]);
      if(Number.isNaN(n) || (n != null && n < 0)){
        warnings.push(`${where}: ${description} — ${f === "min" ? "MIN. STOCK" : f.toUpperCase()} reads "${text(row[col[f]])}", left blank`);
        return null;
      }
      return n;
    };
    for(const d of days) for(const c of [d, d + 1]) if(num(row[c]) !== 0) dailyFigures++;
    items.push({
      row: rowNo, sheet: sheetName,
      category: upper(row[col.category]) || fallbackCategory,
      description, size: col.size == null ? "" : cleanSize(row[col.size]), uom,
      opening: read("opening"), min: read("min"), rate: read("rate"),
      ...(col.sku != null && text(row[col.sku]) ? { sku: upper(row[col.sku]) } : {}),
      ...(col.supplier != null && text(row[col.supplier]) ? { supplier: text(row[col.supplier]) } : {}),
      ...(col.terms != null && text(row[col.terms]) ? { terms: text(row[col.terms]) } : {}),
    });
  }
  return { sheet: sheetName, month: monthFromTitle(title), items, warnings, skipped, daily_figures: dailyFigures };
}

/* Every item sheet in the workbook.
   TWO ROWS NAMING THE SAME ITEM ARE BOTH LEFT OUT, by row number. The live
   CHEMICAL sheet lists GOLDEN YELLOW twice with openings of 3 and 0; which is
   right is the store's call, not the importer's, and loading the first would
   quietly decide it. Everything else loads, and the store fixes the pair. */
export function parseStockWorkbook(sheets = {}){
  const parsed = Object.entries(sheets || {}).map(([name, aoa]) => parseStockSheet(aoa, name)).filter(Boolean);
  const problems = [], warnings = parsed.flatMap(p => p.warnings), skipped = parsed.flatMap(p => p.skipped);
  const groups = new Map();
  for(const p of parsed) for(const it of p.items){
    const key = storeItemKey(it.description, it.size, it.uom);
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...it, key, name: nameOf(key) });
  }
  const items = [];
  for(const [key, rows] of groups){
    if(rows.length === 1){ items.push(rows[0]); continue; }
    skipped.push({ where: rows.map(x => `${x.sheet} row ${x.row}`).join(", "), name: `${nameOf(key)} (${uomOf(key)})`,
      reason: "the same item is on more than one row — keep one and upload again" });
  }
  if(!parsed.length) problems.push('No item sheet was found. Each category sheet needs an "ITEM DESCRIPTION" heading, as on SOLE MASTER.');
  const months = [...new Set(parsed.map(p => p.month).filter(Boolean))];
  return { ok: !problems.length, problems, warnings, skipped, items,
           sheets: parsed.map(p => ({ sheet:p.sheet, items:p.items.length, month:p.month })),
           month: months.length === 1 ? months[0] : null, daily_figures: parsed.reduce((n, p) => n + p.daily_figures, 0) };
}

/* What loading those items would do: new items to create, and changed
   figures on items already on the register. A blank cell changes nothing —
   an empty MIN. STOCK is "not filled in", not "minimum zero". */
const IMPORT_FIELDS = [["category","category"],["size","size"],["opening","opening"],["min","min_stock"],["rate","rate"],
                       ["sku","sku"],["supplier","supplier"],["terms","terms"]];
export function importPlan(items = [], materials = {}, stockMeta = {}){
  const create = [], update = {}, changes = [];
  let unchanged = 0;
  for(const it of items){
    if(!(materials || {})[it.key]){
      create.push({ name: it.name, uom: it.uom, category: it.category, size: it.size,
        opening: it.opening ?? 0, min: it.min ?? 0, rate: it.rate ?? 0,
        ...(it.sku ? { sku: it.sku } : {}), ...(it.supplier ? { supplier: it.supplier } : {}), ...(it.terms ? { terms: it.terms } : {}) });
      continue;
    }
    const meta = (stockMeta || {})[it.key] || {};
    const current = { ...meta, opening: meta.opening ?? num(materials[it.key].stock) };
    const patch = {}, diff = [];
    for(const [from, to] of IMPORT_FIELDS){
      const v = it[from];
      if(v == null || v === "") continue;
      const before = current[to];
      const same = typeof v === "number" ? num(before) === v && before != null : upper(before) === upper(v);
      if(same) continue;
      patch[to] = v;
      diff.push({ field: to, before: before ?? null, after: v });
    }
    if(diff.length){ update[it.key] = patch; changes.push({ key: it.key, name: it.name, uom: it.uom, diff }); }
    else unchanged++;
  }
  return { create, update, changes, unchanged };
}

/* ─── The day register: received and issued, by date ────────────────────── */

/* One entry from the Issue Register: a date, received-or-issued, and a
   quantity against one or more items. */
export function validateStoreEntry(input = {}, materials = {}){
  const problems = [];
  const type = text(input.type) || "issue";
  if(!STORE_MOVE_TYPES.includes(type)) problems.push(`Unknown entry: ${type} — use rec or issue`);
  const moved_on = text(input.moved_on);
  if(!isRealDate(moved_on)) problems.push("The date must be a real date (YYYY-MM-DD)");
  const note = text(input.note);
  if(note.length > 500) problems.push("The note must be 500 characters or fewer");
  const raw = Array.isArray(input.lines) ? input.lines : [];
  if(!raw.length) problems.push("Enter a quantity against at least one item");
  if(raw.length > 200) problems.push("One entry can carry at most 200 items");
  const seen = new Set(), lines = [];
  for(const line of raw.slice(0, 200)){
    const key = text((line || {}).material_key);
    if(!key){ problems.push("A line has no item"); continue; }
    const m = (materials || {})[key];
    if(!m){ problems.push(`${key} is not in the item register`); continue; }
    if(seen.has(key)){ problems.push(`${m.name || nameOf(key)} appears more than once`); continue; }
    seen.add(key);
    const qty = Number((line || {}).qty);
    if(!Number.isFinite(qty) || qty <= 0 || qty > 1e9){ problems.push(`${m.name || nameOf(key)}: the quantity must be more than 0`); continue; }
    lines.push({ material_key: key, name: m.name || nameOf(key), uom: m.uom || uomOf(key), qty: round4(qty) });
  }
  if(problems.length) return { ok:false, problems };
  return { ok:true, problems:[], value:{ type, moved_on, note, lines } };
}

/* Book an entry onto the register — MUTATES `ref`, the copy a transaction has
   locked. Received adds to Rec., issued to Issue; `sign` -1 takes an entry
   back off when it is undone. Stock = Opening + Rec − Issue throughout. */
export function bookStoreEntry(ref, type, lines, sign = 1){
  const missing = [];
  ref.stock_meta = ref.stock_meta || {};
  const field = type === "rec" ? "rec" : "issue";
  for(const line of lines || []){
    const key = line.material_key;
    const material = (ref.materials || {})[key];
    if(!material){ missing.push(key); continue; }
    const meta = { ...(ref.stock_meta[key] || {}) };
    if(meta.opening == null && meta.rec == null && meta.issue == null) meta.opening = num(material.stock);
    meta[field] = round4(num(meta[field]) + sign * num(line.qty));
    ref.stock_meta[key] = meta;
    material.stock = round4(num(meta.opening) + num(meta.rec) - num(meta.issue));
  }
  return { missing };
}

/* Said, never refused: an issue above the book balance (the register is mostly
   unfilled, and refusing would stop the store), and the REORDER ALERT — the
   sheet's MAKE ORDER — for every item the entry leaves below its minimum.
   Worked out against the balance BEFORE the entry is booked. */
export function entryWarnings(value, materials = {}, stockMeta = {}){
  const warnings = [], reorder = [];
  for(const line of (value && value.lines) || []){
    const meta = (stockMeta || {})[line.material_key] || {};
    const before = balanceOf((materials || {})[line.material_key] || {}, meta);
    const after = round4(before + (value.type === "rec" ? line.qty : -line.qty));
    if(value.type === "issue" && line.qty > before + EPS)
      warnings.push(`${line.name}: ${line.qty} ${line.uom} issued, but the register shows only ${before}. Saved — check the count.`);
    const min = num(meta.min_stock);
    if(min > 0 && after < min - EPS)
      reorder.push({ material_key: line.material_key, name: line.name, uom: line.uom, balance: after, min, order_qty: round4(min - after) });
  }
  return { warnings, reorder };
}

/* ─── The month, as the sheet prints it ──────────────────────────────────── */

const monthBounds = month => {
  const [y, m] = String(month || "").split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}`, days };
};

/* A dated movement from any source, as +received / +issued.
   A job-card RETURN is material coming back: it takes Issue down. */
const effect = m => {
  const q = num(m.qty);
  if(m.type === "rec") return { rec: q, issue: 0 };
  if(m.type === "return") return { rec: 0, issue: -q };
  return { rec: 0, issue: q };
};

/* `rows` are the register rows (key, name, uom, category, size, stock, min,
   rate …); `movements` every dated movement on or after the month's first day.
   Returns the month's sheet, one row per item, with the daily grid. */
export function monthSheet(rows = [], movements = [], month){
  const { first, last, days } = monthBounds(month);
  const byKey = new Map();
  for(const m of movements || []){
    const on = String(m.moved_on || "").slice(0, 10);
    if(!m.material_key || on < first) continue;
    const slot = byKey.get(m.material_key) || { after:{ rec:0, issue:0 }, rec:0, issue:0, daily:{} };
    const e = effect(m);
    if(on > last){ slot.after.rec += e.rec; slot.after.issue += e.issue; }
    else{
      const d = Number(on.slice(8, 10));
      const day = slot.daily[d] || (slot.daily[d] = { rec:0, issue:0 });
      day.rec = round4(day.rec + e.rec); day.issue = round4(day.issue + e.issue);
      slot.rec += e.rec; slot.issue += e.issue;
    }
    byKey.set(m.material_key, slot);
  }
  const out = (rows || []).map(r => {
    const s = byKey.get(r.key) || { after:{ rec:0, issue:0 }, rec:0, issue:0, daily:{} };
    const balance = round4(num(r.stock) - s.after.rec + s.after.issue);
    const rec = round4(s.rec), issue = round4(s.issue);
    const opening = round4(balance - rec + issue);
    const min = num(r.min), rate = num(r.rate);
    const makeOrder = balance < min - EPS;
    return { ...r, opening, rec, issue, balance, min, rate,
      opening_value: round4(rate * opening), receive_value: round4(rate * rec),
      issue_value: round4(rate * issue), balance_value: round4(rate * balance),
      alert: makeOrder ? "MAKE ORDER" : "STOCK OK", order_qty: makeOrder ? round4(min - balance) : 0,
      daily: s.daily };
  });
  return { month, first, last, days, rows: out };
}

/* The DASHBOARD: category-wise value and quantity, and the grand totals. A
   category whose items are counted in different units has no meaningful
   quantity total — it is shown as MIXED rather than adding kilos to pairs. */
export function storeDashboard(sheetRows = []){
  const cats = new Map();
  for(const r of sheetRows){
    const c = upper(r.category) || "UNCATEGORISED";
    const g = cats.get(c) || { category:c, items:0, below_min:0, uoms:new Set(),
      opening:0, rec:0, issue:0, balance:0, opening_value:0, receive_value:0, issue_value:0, balance_value:0 };
    g.items++; if(r.alert === "MAKE ORDER") g.below_min++;
    g.uoms.add(upper(r.uom));
    for(const f of ["opening","rec","issue","balance","opening_value","receive_value","issue_value","balance_value"]) g[f] = round4(g[f] + num(r[f]));
    cats.set(c, g);
  }
  const list = [...cats.values()].sort((a, z) => byCategory(a.category, z.category))
    .map(g => ({ ...g, uoms: undefined, units: g.uoms.size === 1 ? [...g.uoms][0] : "MIXED" }));
  const total = f => round4(list.reduce((n, g) => n + g[f], 0));
  return { categories: list, totals: { opening_value: total("opening_value"), receive_value: total("receive_value"),
    issue_value: total("issue_value"), balance_value: total("balance_value"), below_min: total("below_min"), items: total("items") } };
}

/* The month in their workbook's own column order, for download. */
export function monthSheetAoa(sheet, category){
  const rows = (sheet.rows || []).filter(r => !category || upper(r.category) === upper(category));
  const label = new Date(`${sheet.first}T00:00:00Z`).toLocaleString("en-GB", { month:"long", year:"numeric", timeZone:"UTC" }).toUpperCase();
  const dayNos = Array.from({ length: sheet.days }, (_, i) => i + 1);
  return [
    [`${category ? upper(category) : "RAW MATERIAL"} - STOCK MASTER  (${label})`],
    ["S.N","CATEGORY","ITEM DESCRIPTION","SIZE","SKU","OPENING STOCK","MIN. STOCK","REC.","ISSUE","BALANCE","UOM","RATE",
     "OPENING VALUE","ISSUE VALUE","RECEIVE VALUE","BALANCE VALUE","ALERT","ORDER QTY", ...dayNos.flatMap(d => [d, ""])],
    [...Array(18).fill(""), ...dayNos.flatMap(() => ["REC.","ISSUE"])],
    ...rows.map((r, i) => [i + 1, r.category, r.description || r.name, r.size || "", r.sku || "", r.opening, r.min || "", r.rec, r.issue,
      r.balance, r.uom, r.rate || "", r.opening_value, r.issue_value, r.receive_value, r.balance_value, r.alert, r.order_qty,
      ...dayNos.flatMap(d => { const x = r.daily[d]; return [x && x.rec ? x.rec : "", x && x.issue ? x.issue : ""]; })]),
  ];
}

/* ─── Job orders waiting on material ─────────────────────────────────────── */

/* WHEN A JOB ORDER IS RAISED AGAINST MATERIAL THAT IS NOT THERE, THE STORE IS
   TOLD. Derived live, not stored as a message: it appears the moment a card
   needs more than the shelf holds, and goes by itself when the delivery is
   booked — a stored notice would still be shouting a week after the lorry came.

   For every OPEN job card, what it still needs of each material is its BOM
   total less what has already gone to it (job-card issues, net of returns).
   A material released whole with the job order is already booked out, so it
   needs nothing more — but if that release took the register BELOW ZERO, the
   store promised material it did not have, and that is a shortage too.

   NOT ALERTED: a material nobody has ever counted. 195 of 266 had no figure
   when the register was first measured; "short" on every one of them would be
   a banner everyone learns to scroll past. They are counted instead. */
const counted = meta => num(meta.rec) > 0 || num(meta.min_stock) > 0 || num(meta.opening) > 0;

export function jobMaterialAlerts(jobs = [], articles = {}, materials = {}, stockMeta = {}, issues = []){
  const netByJob = new Map();
  for(const m of issues || []){
    const k = `${m.job_id}::${m.material_key}`;
    netByJob.set(k, round4((netByJob.get(k) || 0) + (m.type === "return" ? -num(m.qty) : num(m.qty))));
  }
  const open = (jobs || []).filter(j => j && !j.cancelled && j.status !== "closed" && !j.archived
    && ((j.card || {}).lines || []).length);
  const need = new Map();   // material -> { outstanding, jobs:[{job_id, card_no, article, order_no, outstanding, held}] }
  for(const j of open){
    const start = (j.card || {}).start_stage;
    const lines = j.card.lines.map(l => (start && !l.from_stage) ? { ...l, from_stage: start } : l);
    for(const [key, qty] of Object.entries(materialTotals(lines, (articles || {})[j.article] || {}))){
      if(!(num(qty) > 0)) continue;
      const held = netByJob.get(`${j.id}::${key}`) || 0;
      const outstanding = Math.max(0, round4(num(qty) - held));
      const n = need.get(key) || { outstanding:0, jobs:[] };
      n.outstanding = round4(n.outstanding + outstanding);
      n.jobs.push({ job_id: j.id, order_no: j.order_no || "", article: j.article, fabricator: j.fabricator || "",
                    required: round4(num(qty)), held, outstanding });
      need.set(key, n);
    }
  }
  const alerts = [];
  let uncounted = 0;
  for(const [key, n] of need){
    const m = (materials || {})[key];
    if(!m) continue;                                   // not on the register: the job screen already says so
    const meta = (stockMeta || {})[key] || {};
    const balance = balanceOf(m, meta);
    const short = round4(Math.max(0, n.outstanding - Math.max(0, balance)) + Math.max(0, -balance));
    if(short <= EPS) continue;
    if(!counted(meta)){ uncounted++; continue; }
    alerts.push({ material_key: key, name: m.name || nameOf(key), uom: m.uom || uomOf(key), balance,
      outstanding: n.outstanding, short,
      jobs: n.jobs.filter(x => x.outstanding > EPS || (balance < 0 && x.held > EPS)) });
  }
  alerts.sort((a, z) => z.jobs.length - a.jobs.length || z.short - a.short || a.name.localeCompare(z.name));
  return { alerts, uncounted };
}

/* Uppers for a card that starts at MOULDING, size by size, against what the
   upper store holds of that article and colour. A size short is named; the
   larger-size rule belongs to the order's stock decision, not to this check. */
export function upperShortage(lines = [], onHand = {}){
  const want = {};
  for(const l of lines || [])
    for(const [s, q] of Object.entries((l && l.sizes) || {})) if(num(q) > 0) want[s] = (want[s] || 0) + num(q);
  return Object.entries(want).map(([size, wanted]) => ({ size, wanted, on_hand: num(onHand[size]),
    short: Math.max(0, wanted - Math.max(0, num(onHand[size]))) })).filter(r => r.short > 0);
}
