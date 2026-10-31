/* UPPER STORE — the stitched upper, between the stitching line and the sole.
 *
 *   Stitching line / outside fabrication  ->  UPPER STORE  ->  pasting / moulding
 *
 * An EVENT LOG, for the reason repair and finished stock are: every movement
 * is a date, an article, a colour, a size and a quantity, and the stock is the
 * sum of them. A wrong entry is deleted and re-entered; a stored counter would
 * drift the first time one was corrected.
 *
 *   in        received from a stitching LINE or an outside VENDOR and PASSED at
 *             QC, against an order number or marked MTS — a receipt always
 *             says where it came from and what it is for
 *   qc_failed failed QC at receipt, with its defect. Held in QC — in the
 *             building but NOT available, so it can never be issued
 *   rework_out  failed uppers sent back to the line / vendor that made them
 *   rework_in   reworked uppers back from that maker and passed: into stock.
 *             Failing again is another qc_failed, marked `rework`
 *   out       issued to PASTING or MOULDING against a production order — never
 *             more than the store holds
 *   returned  unused uppers back from pasting / moulding
 *   damaged   rejected or damaged, WITH a reason. Damaged in the store comes
 *             off the shelf; damaged at pasting / moulding was already issued,
 *             so it comes off what that floor is holding, not off the shelf;
 *             scrapped from QC hold comes off that maker's hold
 *   adjust    a physical count correcting the book, signed — PENDING until the
 *             store in-charge approves it, and counting for nothing until then
 *
 * ONE POOL. Uppers are a common pool per article, colour and size; the order
 * number on a receipt or an issue is the reference, not a reservation. The
 * client's own note leaves "reserve or pool?" open, and a pool is the one that
 * can be narrowed into reservations later without rewriting history.
 *
 * Pure — no database, no clock. `today` is always passed in.
 */
import { ROLL_KY } from "./bridge.js";

export const UPPER_KINDS = {
  in:       { label:"Stock in (QC passed)" },
  qc_failed:  { label:"QC failed" },
  rework_out: { label:"Sent for rework" },
  rework_in:  { label:"Back from rework" },
  out:      { label:"Issued" },
  returned: { label:"Returned unused" },
  damaged:  { label:"Damaged / rejected" },
  adjust:   { label:"Count adjustment" },
};
export const SOURCE_TYPES = { line:"Stitching line", vendor:"Outside fabrication" };
export const DESTINATIONS = { PASTING:"Pasting", MOULDING:"Moulding" };
export const DAMAGE_AT = { STORE:"In the store", PASTING:"At pasting", MOULDING:"At moulding", QC:"Scrapped from QC hold" };
/* The client's own three reasons for taking an upper off the moving list. */
export const HOLD_REASONS = { hold:"Order hold", cancelled:"Order cancelled", mts:"MTS upper" };
export const AGE_BUCKETS = ["0-7", "8-15", "16-30", "30+"];
/* "Issued within last 7 days (changeable)" — the client's number. Whether it
   should be 15 or 30 is still theirs to confirm, so it is a setting. */
export const DEFAULT_MOVING_DAYS = 7;

const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const colourOf = v => clean(v).toUpperCase();
/* Rounding is not accepting: 2.5 uppers is a typing mistake, so it is refused
   rather than rounded into the record. `tally` only sums accepted values. */
const exact = v => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };
const tally = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
const isoDay = v => {
  if(v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return clean(v).slice(0, 10);
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/* THE FACTORY'S SIZE SERIES, not number order. The roll runs 6..13 (the kids
   run, printed 8s) and then 1..5.5 (adult); a bare 6..13 is the adult REPEAT
   of a B range and comes after 5.5. Sorting by number put adult 1, 2, 3 ahead
   of kids 6s, 7s — smaller-looking sizes jumping the queue on Live stock.
   A size the roll does not know sorts after it, by number. */
export function sizeRank(size){
  const s = clean(size).toUpperCase();
  const kids = /^(\d+(?:\.5)?)S$/.exec(s);
  if(kids){ const i = ROLL_KY.indexOf(kids[1]); if(i >= 0 && i < 8) return i; }
  const i = ROLL_KY.indexOf(s);
  if(i >= 8) return i;               // 1 .. 5.5
  if(i >= 0) return ROLL_KY.length + i;   // bare 6 .. 13 — the adult repeat
  return null;
}
const bySize = (a, z) => {
  const ra = sizeRank(a), rz = sizeRank(z);
  if(ra != null && rz != null && ra !== rz) return ra - rz;
  if(ra != null && rz == null) return -1;
  if(ra == null && rz != null) return 1;
  return String(a).localeCompare(String(z), undefined, { numeric:true });
};

export const upperKey = (article, colour, size) => `${clean(article)}||${colourOf(colour)}||${clean(size)}`;

export function daysBetween(from, to){
  const a = isoDay(from), b = isoDay(to);
  if(!ISO.test(a) || !ISO.test(b)) return null;
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function ageBucket(days){
  if(days == null) return null;
  if(days <= 7) return "0-7";
  if(days <= 15) return "8-15";
  if(days <= 30) return "16-30";
  return "30+";
}

const counts = m => !m.status || m.status === "approved";
const where = m => clean(m.destination || m.damaged_at).toUpperCase();

const emptyPosition = (article, colour, size) => ({ key:upperKey(article, colour, size),
  article:clean(article), colour:colourOf(colour), size:clean(size),
  on_hand:0, received:0, issued:0, returned:0, damaged:0, adjusted:0, pending_adjust:0,
  at:{ PASTING:0, MOULDING:0 }, racks:[], first_in:null, last_in:null, last_out:null,
  qc_hold:0, rework:0, qc:{} });

/* QC hold and rework are kept PER MAKER: an upper that failed from one vendor
   goes back to that vendor, never to whoever happens to be next in the list. */
const qcOf = (p, m) => {
  const source = clean(m.source);
  return p.qc[source] || (p.qc[source] = { source, source_type:clean(m.source_type) || null, hold:0, rework:0, defects:[] });
};

/* One movement applied to one position. The ledger, the validator and the
   delete check all go through here, so they cannot disagree about what a
   movement does. */
function fold(p, m){
  const kind = clean(m.kind), qty = tally(m.qty), on = isoDay(m.moved_on);
  if(kind === "adjust"){
    if(m.status === "pending") p.pending_adjust += qty;
    else if(counts(m)){ p.adjusted += qty; p.on_hand += qty; }
    return;
  }
  if(!counts(m)) return;
  const floor = where(m);
  if(kind === "in" || kind === "rework_in"){
    p.received += qty; p.on_hand += qty;
    if(kind === "rework_in"){ qcOf(p, m).rework -= qty; p.rework -= qty; }
    if(on && (!p.first_in || on < p.first_in)) p.first_in = on;
    if(on && (!p.last_in || on > p.last_in)) p.last_in = on;
    const rack = clean(m.rack);
    if(rack && !p.racks.includes(rack)) p.racks.push(rack);
  }else if(kind === "out"){
    p.issued += qty; p.on_hand -= qty;
    if(p.at[floor] != null) p.at[floor] += qty;
    if(on && (!p.last_out || on > p.last_out)) p.last_out = on;
  }else if(kind === "returned"){
    p.returned += qty; p.on_hand += qty;
    if(p.at[floor] != null) p.at[floor] -= qty;
  }else if(kind === "qc_failed"){
    const q = qcOf(p, m);
    q.hold += qty; p.qc_hold += qty;
    if(m.rework){ q.rework -= qty; p.rework -= qty; }
    const defect = clean(m.reason);
    if(defect && !q.defects.includes(defect)) q.defects.push(defect);
  }else if(kind === "rework_out"){
    const q = qcOf(p, m);
    q.hold -= qty; p.qc_hold -= qty; q.rework += qty; p.rework += qty;
  }else if(kind === "damaged"){
    p.damaged += qty;
    if(floor === "QC"){ qcOf(p, m).hold -= qty; p.qc_hold -= qty; }
    else if(floor === "STORE" || !floor) p.on_hand -= qty;
    else if(p.at[floor] != null) p.at[floor] -= qty;
  }
}

/* Every movement folded into one position per article / colour / size.
   `on_hand` is on the store's shelf; `at` is what pasting and moulding hold
   that the store issued and has not had back. Pending and rejected count
   adjustments are listed but move nothing. */
export function upperPositions(moves = []){
  const out = new Map();
  for(const m of moves || []){
    if(!clean(m.article) || !clean(m.size) || !UPPER_KINDS[clean(m.kind)]) continue;
    const key = upperKey(m.article, m.colour, m.size);
    if(!out.has(key)) out.set(key, emptyPosition(m.article, m.colour, m.size));
    fold(out.get(key), m);
  }
  return out;
}

/* A batch of movements checked IN ORDER against the existing log, so ten sizes
   issued in one go are each checked against what the ones before them left.
   The browser and the server both call this, so the screen cannot be told one
   answer and the database given another. Returns {rows, problems}. */
export function validateUpperMoves(input = [], existing = []){
  const problems = [], rows = [];
  const pos = upperPositions(existing);
  const list = Array.isArray(input) ? input : [];
  for(const [i, m] of list.entries()){
    const at = list.length > 1 ? `Row ${i + 1}: ` : "";
    const kind = clean(m && m.kind);
    const article = clean(m && m.article), size = clean(m && m.size), colour = colourOf(m && m.colour);
    const qty = exact(m && m.qty);
    const moved_on = isoDay(m && m.moved_on);
    const before = problems.length;
    if(!UPPER_KINDS[kind]){ problems.push(`${at}movement must be one of ${Object.keys(UPPER_KINDS).join(", ")}`); continue; }
    if(!article) problems.push(`${at}article is required`);
    if(!size) problems.push(`${at}size is required — uppers are counted size by size`);
    if(kind === "adjust" ? (!Number.isFinite(qty) || qty === 0) : (!Number.isFinite(qty) || qty <= 0))
      problems.push(`${at}${kind === "adjust" ? "an adjustment must be a whole number other than 0"
                                             : "quantity must be a whole number of 1 or more"}`);
    if(moved_on && !ISO.test(moved_on)) problems.push(`${at}date must be YYYY-MM-DD`);

    const row = { kind, article, colour, size, qty: Number.isFinite(qty) ? qty : 0,
      moved_on: moved_on || null,
      order_no: clean(m.order_no) || null, job_card_no: clean(m.job_card_no) || null,
      mts: m.mts === true, rework: false,
      source_type: null, source: null, destination: null, damaged_at: null,
      rack: null, reason: clean(m.reason).slice(0, 300) || null,
      status: kind === "adjust" ? "pending" : "approved" };

    /* Anything a maker hands over — a receipt, a QC failure, rework going out
       or coming back — names that maker. */
    const fromMaker = ["in", "qc_failed", "rework_out", "rework_in"].includes(kind);
    if(fromMaker){
      row.source_type = clean(m.source_type).toLowerCase() || null;
      row.source = clean(m.source) || null;
      if(!row.source) problems.push(`${at}name the line or the vendor it came from`);
    }
    if(kind === "qc_failed"){
      row.rework = m.rework === true;
      if(!row.reason) problems.push(`${at}record the defect a failed upper was rejected for`);
    }
    /* A FIRST receipt — passed or failed — is new work arriving, so it says
       what it is for: an order number, or MTS said in so many words. A job
       card number alone is not an order reference. Rework coming back is the
       same uppers returning and carries no new reference. */
    if(kind === "in" || (kind === "qc_failed" && !row.rework)){
      if(!SOURCE_TYPES[row.source_type]) problems.push(`${at}say whether it came from a stitching line or outside fabrication`);
      if(row.order_no && row.mts) problems.push(`${at}an upper is either for an order or MTS, not both`);
      else if(!row.order_no && !row.mts) problems.push(`${at}a receipt needs an order number, or mark it MTS`);
    }
    if(kind === "in") row.rack = clean(m.rack).slice(0, 40) || null;
    if(kind === "rework_in") row.rack = clean(m.rack).slice(0, 40) || null;
    if(kind === "out" || kind === "returned"){
      row.destination = clean(m.destination).toUpperCase() || null;
      if(!DESTINATIONS[row.destination]) problems.push(`${at}${kind === "out" ? "issue to" : "returned from"} pasting or moulding?`);
      if(kind === "out" && !row.order_no) problems.push(`${at}an issue is made against a production order — name it`);
    }
    if(kind === "damaged"){
      row.damaged_at = clean(m.damaged_at).toUpperCase() || "STORE";
      row.source = clean(m.source) || null;
      if(!DAMAGE_AT[row.damaged_at]) problems.push(`${at}damaged where — in the store, at pasting, at moulding or in QC hold?`);
      if(row.damaged_at === "QC" && !row.source) problems.push(`${at}name whose QC hold it is scrapped from`);
      if(!row.reason) problems.push(`${at}a damaged or rejected upper needs a reason`);
    }
    if(kind === "adjust" && !row.reason) problems.push(`${at}an adjustment needs a reason`);
    if(problems.length > before) continue;

    const key = upperKey(article, colour, size);
    if(!pos.has(key)) pos.set(key, emptyPosition(article, colour, size));
    const p = pos.get(key);
    const label = `${article}${colour ? " " + colour : ""} size ${size}`;
    if(kind === "out" || (kind === "damaged" && row.damaged_at === "STORE")){
      /* The rule the client wrote first: no issue above available stock. */
      if(qty > p.on_hand){
        problems.push(`${at}only ${Math.max(0, p.on_hand)} upper(s) of ${label} are in the store`);
        continue;
      }
    }
    /* Rework moves uppers between ONE maker's QC hold and that maker. */
    const q = row.source ? (p.qc[row.source] || { hold:0, rework:0 }) : { hold:0, rework:0 };
    if((kind === "rework_out" || (kind === "damaged" && row.damaged_at === "QC")) && qty > q.hold){
      problems.push(`${at}only ${Math.max(0, q.hold)} upper(s) of ${label} from ${row.source} are in QC hold`);
      continue;
    }
    if((kind === "rework_in" || (kind === "qc_failed" && row.rework)) && qty > q.rework){
      problems.push(`${at}only ${Math.max(0, q.rework)} upper(s) of ${label} are with ${row.source} for rework`);
      continue;
    }
    const floor = kind === "returned" ? row.destination : kind === "damaged" ? row.damaged_at : null;
    if(floor && floor !== "STORE" && floor !== "QC" && qty > p.at[floor]){
      problems.push(`${at}only ${Math.max(0, p.at[floor])} upper(s) of ${label} are out at ${DESTINATIONS[floor].toLowerCase()}`);
      continue;
    }
    rows.push(row);
    fold(p, row);   // so the next row in the batch sees what this one left
  }
  if(!rows.length && !problems.length) problems.push("No movements to record");
  return { rows, problems };
}

/* May a pending adjustment be approved now? The count may be old by the time
   it is approved, so it is checked against TODAY's book: an adjustment that
   would take the shelf below zero is refused, not floored. */
export function checkApproval(move, existing = []){
  if(!move || move.kind !== "adjust") return { ok:false, problem:"Only a count adjustment needs approval" };
  if(move.status !== "pending") return { ok:false, problem:`This adjustment is already ${move.status}` };
  const p = upperPositions(existing).get(upperKey(move.article, move.colour, move.size));
  const now = p ? p.on_hand : 0;
  if(now + tally(move.qty) < 0)
    return { ok:false, problem:`The store now holds ${now} of size ${move.size}; taking off ${Math.abs(tally(move.qty))} would leave it below zero. Count again.` };
  return { ok:true };
}

/* Deleting a movement must not leave the book claiming negative uppers —
   removing a receipt that has since been issued would. */
export function checkDelete(id, existing = []){
  const target = (existing || []).find(m => String(m.id) === String(id));
  if(!target) return { ok:false, missing:true, problem:"That movement is no longer there — reload the screen" };
  const p = upperPositions((existing || []).filter(m => m !== target))
    .get(upperKey(target.article, target.colour, target.size));
  if(p && (p.on_hand < 0 || p.at.PASTING < 0 || p.at.MOULDING < 0
           || Object.values(p.qc).some(q => q.hold < 0 || q.rework < 0)))
    return { ok:false, problem:"Deleting this would leave the book below zero for that size — delete the movement recorded after it first" };
  return { ok:true };
}

/* LIVE STOCK, article / colour / size. Below zero is a bookkeeping fault and
   is reported, never floored. Articles follow `opts.articleRank` — the
   company's series (family, then product code) as the screen works it out
   from the article master — and fall back to A-Z for an article with none. */
export function upperStock(moves = [], opts = {}){
  const rank = opts.articleRank || {};
  const byArticle = (a, z) => {
    const ra = rank[a], rz = rank[z];
    if(ra != null && rz != null && ra !== rz) return ra - rz;
    if(ra != null && rz == null) return -1;
    if(ra == null && rz != null) return 1;
    return a.localeCompare(z);
  };
  const groups = new Map();
  for(const p of upperPositions(moves).values()){
    const gk = `${p.article}||${p.colour}`;
    if(!groups.has(gk)) groups.set(gk, { article:p.article, colour:p.colour, on_hand:0, sizes:[],
      at:{ PASTING:0, MOULDING:0 }, racks:[], first_in:null, last_in:null, last_out:null, pending_adjust:0, negative:[],
      qc_hold:0, rework:0 });
    const g = groups.get(gk);
    g.on_hand += p.on_hand;
    g.qc_hold += p.qc_hold;
    g.rework += p.rework;
    g.pending_adjust += p.pending_adjust;
    for(const f of Object.keys(g.at)) g.at[f] += p.at[f];
    for(const r of p.racks) if(!g.racks.includes(r)) g.racks.push(r);
    if(p.first_in && (!g.first_in || p.first_in < g.first_in)) g.first_in = p.first_in;
    if(p.last_in && (!g.last_in || p.last_in > g.last_in)) g.last_in = p.last_in;
    if(p.last_out && (!g.last_out || p.last_out > g.last_out)) g.last_out = p.last_out;
    if(p.on_hand < 0) g.negative.push(p.size);
    g.sizes.push({ size:p.size, on_hand:p.on_hand, at:p.at, racks:p.racks, pending_adjust:p.pending_adjust,
                   qc_hold:p.qc_hold, rework:p.rework });
  }
  const list = [...groups.values()].map(g => ({ ...g, sizes: g.sizes.sort((a, z) => bySize(a.size, z.size)) }))
    .filter(g => g.on_hand !== 0 || g.negative.length || g.at.PASTING || g.at.MOULDING || g.pending_adjust
                 || g.qc_hold || g.rework)
    .sort((a, z) => byArticle(a.article, z.article) || a.colour.localeCompare(z.colour));
  return { groups:list, total: list.reduce((n, g) => n + g.on_hand, 0) };
}

/* What the store holds of one article / colour, per size — the issue screen
   shows it beside every quantity box so "short" is visible before Save. */
export function onHandBySize(moves, article, colour){
  const out = {};
  for(const p of upperPositions(moves).values())
    if(p.article === clean(article) && p.colour === colourOf(colour)) out[p.size] = p.on_hand;
  return out;
}

/* THE STOCK IN / OUT LEDGER, oldest first with the running balance of that
   article / colour / size after each line, then returned newest first. */
export function upperLedger(moves = []){
  const sorted = [...(moves || [])].sort((a, z) =>
    String(isoDay(a.moved_on)).localeCompare(String(isoDay(z.moved_on))) || (Number(a.id) || 0) - (Number(z.id) || 0));
  const bal = {};
  const rows = sorted.map(m => {
    const key = upperKey(m.article, m.colour, m.size);
    const effect = effectOf(m);
    bal[key] = (bal[key] || 0) + effect;
    return { ...m, moved_on: isoDay(m.moved_on), colour:colourOf(m.colour), effect, balance: bal[key] };
  });
  return rows.reverse();
}

/* What one movement did to the store's shelf. */
export function effectOf(m){
  const qty = tally(m.qty), kind = clean(m.kind);
  if(!counts(m)) return 0;
  if(kind === "in" || kind === "rework_in" || kind === "returned" || kind === "adjust") return qty;
  if(kind === "out") return -qty;
  if(kind === "damaged") return (where(m) === "STORE" || !where(m)) ? -qty : 0;
  return 0;
}

/* MOVING vs NON-MOVING, with ageing. Automatic from the last issue date: an
   article / colour issued within `movingDays` is moving. One never issued is
   aged from its first receipt. A manual tag overrides the automatic one and
   always carries its reason — "Non-moving needs a reason" is the client's rule,
   and the automatic tag supplies its own. */
export function movingStatus(moves = [], tags = [], today, movingDays = DEFAULT_MOVING_DAYS){
  const limit = Number.isInteger(Number(movingDays)) && Number(movingDays) > 0 ? Number(movingDays) : DEFAULT_MOVING_DAYS;
  const tagOf = new Map((tags || []).map(t => [`${clean(t.article)}||${colourOf(t.colour)}`, t]));
  const rows = upperStock(moves).groups.filter(g => g.on_hand > 0).map(g => {
    const since = g.last_out || g.first_in;
    const days = since ? daysBetween(since, today) : null;
    const auto = days != null && days > limit ? "non_moving" : "moving";
    const tag = tagOf.get(`${g.article}||${g.colour}`);
    const status = tag ? tag.tag : auto;
    let reason;
    if(tag) reason = (HOLD_REASONS[tag.reason_code] ? HOLD_REASONS[tag.reason_code] + (tag.reason ? " — " + tag.reason : "") : tag.reason) || "";
    else if(auto === "non_moving")
      reason = g.last_out ? `No issue for ${days} days` : `Never issued — in the store since ${g.first_in}`;
    else reason = g.last_out ? `Issued ${days} day(s) ago` : `Received ${days ?? "?"} day(s) ago, not yet issued`;
    return { article:g.article, colour:g.colour, on_hand:g.on_hand, last_out:g.last_out, first_in:g.first_in,
             days_idle:days, bucket:ageBucket(days), status, reason, manual:!!tag };
  }).sort((a, z) => (z.days_idle ?? -1) - (a.days_idle ?? -1) || a.article.localeCompare(z.article));
  const buckets = Object.fromEntries(AGE_BUCKETS.map(b => [b, { groups:0, pairs:0 }]));
  for(const r of rows) if(r.bucket){ buckets[r.bucket].groups += 1; buckets[r.bucket].pairs += r.on_hand; }
  const sum = s => rows.filter(r => r.status === s).reduce((n, r) => n + r.on_hand, 0);
  return { rows, buckets, moving_pairs: sum("moving"), non_moving_pairs: sum("non_moving"), moving_days: limit };
}

/* A manual tag, checked. `tag:"auto"` hands it back to the automatic rule. */
export function validateTag(input = {}){
  const t = { article:clean(input.article), colour:colourOf(input.colour), tag:clean(input.tag),
              reason_code: clean(input.reason_code).toLowerCase() || null, reason: clean(input.reason).slice(0, 300) || null };
  const problems = [];
  if(!t.article) problems.push("article is required");
  if(!["moving", "non_moving", "auto"].includes(t.tag)) problems.push("tag must be moving, non_moving or auto");
  if(t.tag === "non_moving" && !HOLD_REASONS[t.reason_code] && !t.reason)
    problems.push("non-moving needs a reason — order hold, cancelled, MTS, or a note");
  if(t.tag === "moving" && !t.reason) problems.push("say why it is moving again");
  if(t.reason_code && !HOLD_REASONS[t.reason_code]) problems.push(`reason must be one of ${Object.keys(HOLD_REASONS).join(", ")}`);
  return { tag:t, problems };
}

/* OUTSIDE FABRICATION — sent, received, pending. Read straight off the job
   work the factory already issues to external fabricators; nothing is entered
   twice. Overdue only means something once the factory says how long a
   fabricator is allowed: with no turnaround set, nothing is called overdue —
   an invented deadline would put every job in red. */
export function outsideFabrication(jobs = [], today, dueDays = null){
  const due = Number.isInteger(Number(dueDays)) && Number(dueDays) > 0 ? Number(dueDays) : null;
  const rows = (jobs || [])
    .filter(j => clean(j.fabricator_type) === "external" && !j.sample
      && (!clean(j.stage) || clean(j.stage).toUpperCase() === "STITCHING"))
    .map(j => {
      const sent = tally(j.qty), received = tally(j.received), shortage = tally(j.shortage);
      const closed = clean(j.status) === "closed";
      const pending = closed ? 0 : Math.max(0, sent - received);
      const days = daysBetween(j.issued_on, today);
      return { id:j.id, fabricator:clean(j.fabricator), article:clean(j.article), order_no:j.order_no || null,
        card_no: clean((j.card || {}).card_no) || null, issued_on:isoDay(j.issued_on), sent, received, shortage,
        pending, days_out:days, overdue: !!(due && pending > 0 && days != null && days > due) };
    })
    .sort((a, z) => z.pending - a.pending || String(a.issued_on).localeCompare(String(z.issued_on)));
  const byFab = new Map();
  for(const r of rows){
    if(!byFab.has(r.fabricator)) byFab.set(r.fabricator, { fabricator:r.fabricator, jobs:0, sent:0, received:0, pending:0, shortage:0, overdue:0 });
    const f = byFab.get(r.fabricator);
    f.jobs += 1; f.sent += r.sent; f.received += r.received; f.pending += r.pending; f.shortage += r.shortage;
    if(r.overdue) f.overdue += 1;
  }
  return { rows, fabricators:[...byFab.values()].sort((a, z) => z.pending - a.pending), due_days:due };
}

/* SHORTAGE — what live orders still need against what the store holds.
   Per order and size: ordered, less what has already been issued against
   that order (net of returns). Matched to the store by article and size; the
   colour is reported, not matched, because the article master already names
   the colourway in most articles and a colour typed differently on a receipt
   would otherwise read as a shortage. A line ordered as a RANGE with no sizes
   cannot be put against any one size, so its pairs are counted separately
   instead of being split evenly across the range. `done` names orders that no
   longer need uppers (shipped, closed, production complete). */
export function upperShortage(orders = [], moves = [], done = new Set()){
  const issued = {};
  for(const m of moves || []){
    if(!counts(m) || !m.order_no) continue;
    const k = `${clean(m.order_no)}||${clean(m.size)}`;
    if(m.kind === "out") issued[k] = (issued[k] || 0) + tally(m.qty);
    if(m.kind === "returned") issued[k] = (issued[k] || 0) - tally(m.qty);
  }
  const available = {}, colours = {};
  for(const p of upperPositions(moves).values()){
    const k = `${p.article}||${p.size}`;
    available[k] = (available[k] || 0) + Math.max(0, p.on_hand);
    if(p.on_hand > 0 && p.colour) (colours[k] = colours[k] || new Set()).add(p.colour);
  }
  const need = new Map(), unsized = new Map();
  for(const o of orders || []){
    if(!o || o.active === false || done.has(o.order_no)) continue;
    const article = clean(o.article_code || o.article);
    if(!article) continue;
    for(const line of o.lines || []){
      const sizes = Object.entries(line.sizes || {}).filter(([, q]) => tally(q) > 0);
      if(!sizes.length){
        const q = tally(line.qty);
        if(q > 0){
          const u = unsized.get(article) || { article, pairs:0, orders:[] };
          u.pairs += q; if(!u.orders.includes(o.order_no)) u.orders.push(o.order_no);
          unsized.set(article, u);
        }
        continue;
      }
      for(const [size, q] of sizes){
        const k = `${clean(o.order_no)}||${clean(size)}`;
        const left = Math.max(0, tally(q) - Math.max(0, issued[k] || 0));
        issued[k] = Math.max(0, (issued[k] || 0) - tally(q));   // a pair issued is used once
        if(left <= 0) continue;
        const nk = `${article}||${clean(size)}`;
        const r = need.get(nk) || { article, size:clean(size), need:0, orders:[] };
        r.need += left; if(!r.orders.includes(o.order_no)) r.orders.push(o.order_no);
        need.set(nk, r);
      }
    }
  }
  const rows = [...need.entries()].map(([k, r]) => {
    const have = available[k] || 0;
    return { ...r, available:have, short:Math.max(0, r.need - have), colours:[...(colours[k] || [])] };
  }).sort((a, z) => z.short - a.short || a.article.localeCompare(z.article) || bySize(a.size, z.size));
  return { rows, short_pairs: rows.reduce((n, r) => n + r.short, 0),
           articles_short: [...new Set(rows.filter(r => r.short > 0).map(r => r.article))],
           sizes_unknown: [...unsized.values()] };
}

/* THE QC QUEUE — every failed upper not yet resolved, per article, colour,
   size and MAKER: still in QC hold here, or out with the maker for rework.
   It empties as rework comes back passed, or as held uppers are scrapped. */
export function qcQueue(moves = []){
  const rows = [];
  for(const p of upperPositions(moves).values())
    for(const q of Object.values(p.qc))
      if(q.hold > 0 || q.rework > 0)
        rows.push({ article:p.article, colour:p.colour, size:p.size, source:q.source, source_type:q.source_type,
                    hold:q.hold, rework:q.rework, defects:q.defects });
  return rows.sort((a, z) => a.source.localeCompare(z.source) || a.article.localeCompare(z.article)
    || a.colour.localeCompare(z.colour) || bySize(a.size, z.size));
}

/* QC BY MAKER. The rejection ratio is uppers that failed their FIRST
   inspection against everything that maker sent for inspection — passed plus
   failed. Rework failing again is reported beside it, not added in, or the
   same upper would count against the maker twice. Null, not 0, when nothing
   has been inspected: "no receipts" and "0% rejected" are different claims. */
export function rejectionRatios(moves = []){
  const by = new Map();
  const row = s => { if(!by.has(s)) by.set(s, { source:s, inspected:0, passed:0, failed:0, sent_for_rework:0,
    reworked_back:0, failed_again:0, scrapped:0, ratio:null }); return by.get(s); };
  for(const m of moves || []){
    if(!counts(m) || !clean(m.source)) continue;
    const r = row(clean(m.source)), qty = tally(m.qty);
    if(m.kind === "in"){ r.inspected += qty; r.passed += qty; }
    else if(m.kind === "qc_failed" && !m.rework){ r.inspected += qty; r.failed += qty; }
    else if(m.kind === "qc_failed") r.failed_again += qty;
    else if(m.kind === "rework_out") r.sent_for_rework += qty;
    else if(m.kind === "rework_in") r.reworked_back += qty;
    else if(m.kind === "damaged" && where(m) === "QC") r.scrapped += qty;
  }
  return [...by.values()].filter(r => r.inspected || r.sent_for_rework || r.failed_again).map(r => ({ ...r,
    ratio: r.inspected > 0 ? Math.round(r.failed / r.inspected * 1000) / 10 : null }))
    .sort((a, z) => (z.ratio ?? -1) - (a.ratio ?? -1) || a.source.localeCompare(z.source));
}

/* PHYSICAL COUNT — counted against the book. Returns the comparison and the
   adjustments it implies; those go in PENDING, for the store in-charge. */
export function countAdjustments(moves, article, colour, counted = {}, note = ""){
  const book = onHandBySize(moves, article, colour);
  const rows = [], adjustments = [];
  for(const [size, raw] of Object.entries(counted || {})){
    if(raw === "" || raw == null) continue;
    const c = exact(raw);
    if(!Number.isFinite(c) || c < 0) continue;
    const system = book[clean(size)] || 0;
    const diff = c - system;
    rows.push({ size:clean(size), system, counted:c, diff });
    if(diff !== 0) adjustments.push({ kind:"adjust", article:clean(article), colour:colourOf(colour), size:clean(size), qty:diff,
      reason: `Physical count: book ${system}, counted ${c}${clean(note) ? " — " + clean(note) : ""}` });
  }
  return { rows: rows.sort((a, z) => bySize(a.size, z.size)), adjustments };
}

/* The rules the client has still to confirm, as settings. Moving days defaults
   to their own 7; the overdue turnaround and the rejection alert level have no
   default because nobody has said what they are. */
export function normalizeUpperRules(input = {}){
  const problems = [];
  const out = { moving_days: DEFAULT_MOVING_DAYS, fabrication_due_days: null, rejection_alert_pct: null,
                repair_rejection_alert_pct: null };
  const days = (v, name, max) => {
    if(v === "" || v == null) return null;
    const n = Number(v);
    if(!Number.isInteger(n) || n < 1 || n > max){ problems.push(`${name} must be a whole number from 1 to ${max}`); return null; }
    return n;
  };
  const md = days(input.moving_days, "moving days", 365);
  if(md != null) out.moving_days = md;
  out.fabrication_due_days = days(input.fabrication_due_days, "fabrication turnaround days", 365);
  for(const [k, name] of [["rejection_alert_pct", "QC rejection alert %"], ["repair_rejection_alert_pct", "repair rejection alert %"]]){
    if(input[k] === "" || input[k] == null) continue;
    const n = Number(input[k]);
    if(!Number.isFinite(n) || n <= 0 || n > 100) problems.push(`${name} must be above 0 and at most 100`);
    else out[k] = n;
  }
  return { rules:out, problems };
}

/* THE ALERTS the client listed. Each fires only on something recorded:
   a low-stock alert is a RUNNING article (one a live order still needs) whose
   uppers do not cover that need; overdue and rejection fire only once the
   factory has set the turnaround and the level. */
export function upperAlerts({ moving, shortage, fabrication, ratios, repair, rules = {} } = {}){
  const out = [];
  for(const r of (moving && moving.rows) || [])
    if(r.status === "non_moving")
      out.push({ kind:"non_moving", text:`${r.article}${r.colour ? " " + r.colour : ""}: ${r.on_hand} pairs non-moving — ${r.reason}` });
  const short = new Map();
  for(const r of (shortage && shortage.rows) || []) if(r.short > 0){
    const s = short.get(r.article) || { short:0, sizes:[] };
    s.short += r.short; s.sizes.push(r.size); short.set(r.article, s);
  }
  for(const [article, s] of short)
    out.push({ kind:"low_stock", text:`${article}: ${s.short} uppers short for live orders (sizes ${s.sizes.join(", ")})` });
  for(const r of (fabrication && fabrication.rows) || []) if(r.overdue)
    out.push({ kind:"fabrication_overdue",
      text:`${r.fabricator}${r.card_no ? " — " + r.card_no : ""}: ${r.pending} of ${r.sent} still out after ${r.days_out} days` });
  const pct = Number(rules.rejection_alert_pct);
  if(pct > 0) for(const r of ratios || []) if(r.ratio != null && r.ratio >= pct)
    out.push({ kind:"rejection", text:`${r.source}: ${r.ratio}% failed QC (${r.failed} of ${r.inspected})` });
  /* The Repair screen is the record of shoes sent for repair, so its figures
     drive this one: rejected after repair against sent for repair, per article. */
  const repairPct = Number(rules.repair_rejection_alert_pct);
  if(repairPct > 0) for(const r of (repair && repair.articles) || []) if(r.ratio != null && r.ratio >= repairPct)
    out.push({ kind:"repair_rejection", text:`${r.article}: ${r.ratio}% of shoes sent for repair were rejected (${r.rejected} of ${r.sent})` });
  return out;
}
