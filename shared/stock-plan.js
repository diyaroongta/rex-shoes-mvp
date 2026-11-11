/* STOCK FIRST — a new order is checked against what is already made BEFORE
 * anything is put on a job card, so the factory only produces what it cannot
 * supply off the shelf.
 *
 *   FINISHED GOODS   boxed pairs, ready to ship     -> no production at all
 *   UPPER STOCK      stitched, QC-passed uppers     -> production starts at MOULDING
 *   neither                                         -> the full routing
 *
 * FG is always taken first, then uppers (the factory's confirmed rule).
 *
 * WHAT IS BUILT ON. Both stores already exist as event logs and stay exactly
 * as they are: shared/finished-stock.js (per article and size — the article
 * master already names the closure and colourway, so the article IS the
 * variant) and shared/upper-store.js (per article, colour and size). This
 * module adds the one thing neither had — who the stock is spoken for:
 *
 *   on hand    the sum of the store's own ledger, as before
 *   reserved   allocated to an order and not yet dispatched / issued
 *   free       on hand - reserved - what is locked to OTHER parties
 *
 * Only FREE stock is ever offered to an order. Reservations are their own
 * APPEND-ONLY ledger (`stock_reservations`): a row adds to what an order holds
 * (reserve) or takes away from it (release, issue, dispatch). Nothing is
 * edited or deleted — a correction is another row — so "reserved" is always a
 * sum and can never drift from a counter somebody overtyped.
 *
 * UPPERS STITCHED FOR AN ORDER ARE NOT FREE. An upper received against a live
 * order number is waiting for that order's moulding; offering it to the next
 * order would starve the first. That hold is DERIVED from the upper store's
 * own receipts and issues (see `heldUppers`) rather than written twice.
 *
 * Pure: no database, no clock.
 */
import { finishedStock } from "./finished-stock.js";
import { upperPositions } from "./upper-store.js";
import { partyKey } from "./customer-history.js";

export const STORES = { FG:"Finished goods", UPPER:"Upper stock" };
/* How each kind of row moves what an order HOLDS. The sign follows the kind,
   so a release can never add to a reservation by accident. */
export const RESERVATION_KINDS = {
  reserve:  { label:"Reserved for the order",        sign: 1 },
  release:  { label:"Released back to free stock",   sign:-1 },
  issue:    { label:"Issued to moulding",            sign:-1 },
  dispatch: { label:"Dispatched with the order",     sign:-1 },
};
export const STOCK_STATUS = { awaiting:"Awaiting stock decision", decided:"Stock decided" };

const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const colourOf = v => clean(v).toUpperCase();
const sizeOf = v => clean(v).toLowerCase();
const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const whole = v => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : NaN; };

/* FG is keyed without a colour: the finished-goods ledger has none, because
   the article already carries it. */
export const skuKey = (store, article, colour, size) =>
  `${store}||${clean(article)}||${store === "FG" ? "" : colourOf(colour)}||${sizeOf(size)}`;

/* ONE SIZE LARGER, and only where the roll leaves no doubt.
   An upper may be moulded into its own size or the size below — a size 5 upper
   makes a size 4 shoe. So an ordered size may draw on the NEXT size up:

     6s..12s -> the next kids size      13s -> 1 (the roll runs straight on)
     1..4    -> the next adult size
     bare 6..12 -> the next numeral of the same run

   It answers null where the next size is not certain: 5 (5.5 is a half size,
   and a bare 6 may be the kids run), 5.5, and a bare 13, whose run may or may
   not continue. Offering less stock is recoverable; moulding the wrong upper
   is not. */
export function nextSizeUp(size){
  const s = sizeOf(size);
  const kids = /^(\d+)s$/.exec(s);
  if(kids){
    const n = Number(kids[1]);
    if(n >= 6 && n < 13) return `${n + 1}s`;
    return n === 13 ? "1" : null;
  }
  if(/^\d+$/.test(s)){
    const n = Number(s);
    if((n >= 1 && n < 5) || (n >= 6 && n < 13)) return String(n + 1);
  }
  return null;
}

/* What an order asks for, size by size. A line ordered as a RANGE with no
   sizes cannot be matched to a shelf that is counted per size, so its pairs
   are reported as `unsized` instead of being spread across the range. */
export function orderDemand(order){
  const sizes = new Map();
  let unsized = 0;
  for(const line of (order && order.lines) || []){
    const exact = Object.entries((line && line.sizes) || {}).filter(([, q]) => int(q) > 0);
    if(!exact.length){ unsized += Math.max(0, int(line && line.qty)); continue; }
    for(const [size, q] of exact){
      const k = sizeOf(size);
      const row = sizes.get(k) || { size:clean(size), ordered:0 };
      row.ordered += int(q);
      sizes.set(k, row);
    }
  }
  return { sizes:[...sizes.values()], unsized };
}

/* The colour an order's uppers must be: what the PI recorded, else the
   article master's own upper colour. */
export const orderColour = (order, article) =>
  colourOf(((order && order.pi) || {}).upper_colour || (article && article.upper_colour) || "");

/* UPPERS HELD FOR THE ORDER THEY WERE STITCHED FOR.
   Received against an order number (not MTS) and not yet issued back out
   against it. `liveOrders` is the set of order numbers still in work — once an
   order is cancelled or finished its leftover uppers are free again.
   Returns Map(skuKey -> {order_no: pairs}). */
export function heldUppers(upperMoves = [], liveOrders = null){
  const net = new Map();
  for(const m of upperMoves || []){
    if(m.status && m.status !== "approved") continue;
    const no = clean(m.order_no);
    if(!no || m.mts) continue;
    if(liveOrders && !liveOrders.has(no)) continue;
    const kind = clean(m.kind), q = int(m.qty);
    const sign = (kind === "in" || kind === "rework_in" || kind === "returned") ? 1 : kind === "out" ? -1 : 0;
    if(!sign) continue;
    const key = skuKey("UPPER", m.article, m.colour, m.size);
    const by = net.get(key) || {};
    by[no] = (by[no] || 0) + sign * q;
    net.set(key, by);
  }
  for(const [key, by] of net){
    for(const no of Object.keys(by)) if(by[no] <= 0) delete by[no];
    if(!Object.keys(by).length) net.delete(key);
  }
  return net;
}

/* ON HAND, RESERVED, FREE — for every SKU in both stores.
     reservations  rows of the stock_reservations ledger
     locks         [{store, article, colour, size, party, qty}] — stock kept for
                   one party; offered to that party's orders only
     liveOrders    Set of order numbers still in work (for held uppers)
   A party's lock is used up by that party's own reservations, so 50 locked
   and 30 of them reserved leaves 20 locked, not 50. */
export function stockBalance({ finishedMoves = [], jobs = [], upperMoves = [],
                               reservations = [], locks = [], liveOrders = null } = {}){
  const rows = new Map();
  const row = (store, article, colour, size) => {
    const key = skuKey(store, article, colour, size);
    if(!rows.has(key)) rows.set(key, { key, store, article:clean(article),
      colour:store === "FG" ? "" : colourOf(colour), size:clean(size),
      on_hand:0, reserved:0, held:0, by_order:{}, booked:{}, by_party:{}, locks:{}, locked:0, free:0 });
    return rows.get(key);
  };
  const fg = finishedStock(finishedMoves, jobs);
  for(const a of fg.articles) for(const s of a.size_list) row("FG", a.article, "", s.size).on_hand += int(s.pairs);
  for(const p of upperPositions(upperMoves).values()) row("UPPER", p.article, p.colour, p.size).on_hand += int(p.on_hand);

  for(const r of reservations || []){
    if(!STORES[r.store]) continue;
    const t = row(r.store, r.article, r.colour, r.size), q = int(r.qty), no = clean(r.order_no);
    t.by_order[no] = (t.by_order[no] || 0) + q;
    /* `booked` is the ledger alone — what a stock decision reserved — kept
       apart from uppers merely held for the order they were stitched for. */
    t.booked[no] = (t.booked[no] || 0) + q;
    const p = partyKey(r.party);
    if(p) t.by_party[p] = (t.by_party[p] || 0) + q;
  }
  for(const [key, by] of heldUppers(upperMoves, liveOrders)){
    const t = rows.get(key);
    if(!t) continue;
    /* An upper cannot be held twice: what a stock decision already reserved
       for the order counts toward what the order holds. */
    for(const [no, q] of Object.entries(by)){
      const extra = Math.max(0, q - Math.max(0, t.by_order[no] || 0));
      if(extra){ t.held += extra; t.by_order[no] = (t.by_order[no] || 0) + extra; }
    }
  }
  for(const l of locks || []){
    if(!STORES[l.store] || int(l.qty) <= 0 || !partyKey(l.party)) continue;
    const t = row(l.store, l.article, l.colour, l.size);
    t.locks[partyKey(l.party)] = { party:clean(l.party), qty:int(l.qty) };
  }
  const lockLeft = (t, p) => Math.max(0, (t.locks[p] ? t.locks[p].qty : 0) - Math.max(0, t.by_party[p] || 0));
  for(const t of rows.values()){
    for(const no of Object.keys(t.by_order)) if(t.by_order[no] <= 0) delete t.by_order[no];
    for(const no of Object.keys(t.booked)) if(t.booked[no] <= 0) delete t.booked[no];
    /* Reserved can never exceed what is physically there: a hold on stock
       that has since been issued elsewhere is a hold on nothing. */
    t.reserved = Math.min(Math.max(0, t.on_hand), Object.values(t.by_order).reduce((a, n) => a + n, 0));
    const open = Math.max(0, t.on_hand - t.reserved);
    t.locked = Math.min(open, Object.keys(t.locks).reduce((a, p) => a + lockLeft(t, p), 0));
    t.free = Math.max(0, open - t.locked);
  }
  const get = (store, article, colour, size) => rows.get(skuKey(store, article, colour, size)) || null;
  /* Free to ONE party: its own lock is its to use, everyone else's is not. */
  const freeFor = (store, article, colour, size, party) => {
    const t = get(store, article, colour, size);
    if(!t) return 0;
    const mine = partyKey(party);
    const others = Object.keys(t.locks).filter(p => p !== mine).reduce((a, p) => a + lockLeft(t, p), 0);
    return Math.max(0, t.on_hand - t.reserved - others);
  };
  return { rows, get, freeFor, fg_sizes_unknown: fg.articles.filter(a => a.sizes_unknown > 0)
    .map(a => ({ article:a.article, pairs:a.sizes_unknown })) };
}

/* The register: every SKU with its three numbers, for the store screens. */
export function stockRegister(balance, store){
  return [...balance.rows.values()].filter(r => r.store === store
      && (r.on_hand !== 0 || r.reserved || Object.keys(r.locks).length))
    .map(r => ({ ...r, orders:Object.entries(r.by_order).map(([order_no, pairs]) => ({ order_no, pairs })),
                 party_locks:Object.values(r.locks) }));
}

const emptyUse = () => ({ fg:0, upper:{} });
const upperTotal = use => Object.values((use && use.upper) || {}).reduce((a, n) => a + int(n), 0);

/* What an order already holds through its stock decision: reserved and never
   released, whether or not it has since been issued or dispatched. Keyed the
   way an allocation is — by the size ORDERED, then the size drawn. */
export function grantedFor(reservations = [], orderNo){
  const out = {};
  for(const r of reservations || []){
    if(clean(r.order_no) !== clean(orderNo)) continue;
    const kind = clean(r.kind);
    if(kind !== "reserve" && kind !== "release") continue;
    const size = sizeOf(r.for_size || r.size), from = sizeOf(r.size);
    const use = out[size] || (out[size] = emptyUse());
    if(r.store === "FG") use.fg += int(r.qty);
    else use.upper[from] = (use.upper[from] || 0) + int(r.qty);
  }
  return out;
}

/* Reserved pairs already used up: FG that went out on a dispatch, uppers
   issued to moulding. A decision cannot be shrunk below these. */
export function consumedFor(reservations = [], orderNo){
  const out = {};
  for(const r of reservations || []){
    if(clean(r.order_no) !== clean(orderNo)) continue;
    const kind = clean(r.kind);
    if(kind !== "issue" && kind !== "dispatch") continue;
    const size = sizeOf(r.for_size || r.size), from = sizeOf(r.size);
    const use = out[size] || (out[size] = emptyUse());
    if(r.store === "FG") use.fg += -int(r.qty);
    else use.upper[from] = (use.upper[from] || 0) - int(r.qty);
  }
  return out;
}

/* Still reserved and still in the store, per ledger SKU. */
export function outstandingFor(reservations = [], orderNo){
  const acc = new Map();
  for(const r of reservations || []){
    if(clean(r.order_no) !== clean(orderNo) || !STORES[r.store]) continue;
    const key = `${skuKey(r.store, r.article, r.colour, r.size)}||${sizeOf(r.for_size || r.size)}`;
    const row = acc.get(key) || { store:r.store, article:clean(r.article),
      colour:r.store === "FG" ? "" : colourOf(r.colour), size:clean(r.size),
      for_size:clean(r.for_size || r.size), party:clean(r.party), qty:0 };
    row.qty += int(r.qty);
    acc.set(key, row);
  }
  return [...acc.values()].filter(r => r.qty > 0);
}

/* THE STOCK CHECK. Per ordered size: what is free in FG, what is free in the
   upper store (its own size, and one size larger), and the allocation the
   planner is offered — FG first, then uppers of the same size, then uppers one
   size up. Own-size use is settled for EVERY size before any size borrows from
   the size above, so a size 4 never takes the size 5 uppers a size 5 line on
   the same order needs.

   `opts.current` is what the order already holds (grantedFor): those pairs are
   the order's own, shown as used, and are not drawn from free stock again —
   which is how an order whose quantity went UP is re-checked for the added
   pairs only. */
export function stockCheck(order, balance, opts = {}){
  const article = clean(order && (order.article_code || order.article));
  const colour = colourOf(opts.colour != null ? opts.colour : ((order && order.pi) || {}).upper_colour);
  const party = order && order.party;
  const current = opts.current || {};
  const demand = orderDemand(order);
  const upperLeft = new Map();
  const left = size => {
    const k = sizeOf(size);
    if(!upperLeft.has(k)) upperLeft.set(k, balance.freeFor("UPPER", article, colour, size, party));
    return upperLeft.get(k);
  };
  const take = (size, n) => upperLeft.set(sizeOf(size), left(size) - n);

  const rows = demand.sizes.map(d => {
    const held = current[sizeOf(d.size)] || emptyUse();
    const fgFree = balance.freeFor("FG", article, "", d.size, party);
    const heldFg = Math.min(d.ordered, Math.max(0, int(held.fg)));
    const useFg = Math.min(d.ordered, heldFg + fgFree);
    const up = nextSizeUp(d.size);
    return { size:d.size, ordered:d.ordered, fg_free:fgFree, use_fg:useFg, held_fg:heldFg,
      upper_size_up:up, upper_free_own:left(d.size), upper_free_up:up ? left(up) : 0,
      use_upper:{}, held_upper:{ ...(held.upper || {}) } };
  });
  const need = r => r.ordered - r.use_fg - upperTotal({ upper:r.use_upper });
  /* What the order already holds comes first and costs nothing from free. */
  for(const r of rows) for(const [from, q] of Object.entries(r.held_upper)){
    const n = Math.min(need(r), Math.max(0, int(q)));
    if(n > 0) r.use_upper[from] = n;
  }
  for(const r of rows){
    const n = Math.min(need(r), left(r.size));
    if(n > 0){ const k = sizeOf(r.size); r.use_upper[k] = (r.use_upper[k] || 0) + n; take(r.size, n); }
  }
  for(const r of rows){
    if(!r.upper_size_up) continue;
    const n = Math.min(need(r), left(r.upper_size_up));
    if(n > 0){ const k = sizeOf(r.upper_size_up); r.use_upper[k] = (r.use_upper[k] || 0) + n; take(r.upper_size_up, n); }
  }
  for(const r of rows){
    r.use_upper_total = upperTotal({ upper:r.use_upper });
    r.upper_free = r.upper_free_own + r.upper_free_up;
    r.produce = r.ordered - r.use_fg - r.use_upper_total;
  }
  /* Uppers of this article on the shelf in ANOTHER colour: never offered, but
     named, so "nothing offered" is not mistaken for "nothing there". */
  const other = {};
  for(const t of balance.rows.values())
    if(t.store === "UPPER" && t.article === article && t.colour !== colour && t.free > 0)
      other[t.colour || "(no colour)"] = (other[t.colour || "(no colour)"] || 0) + t.free;
  const sum = f => rows.reduce((a, r) => a + f(r), 0);
  const totals = { ordered:sum(r => r.ordered) + demand.unsized, fg:sum(r => r.use_fg),
    upper:sum(r => r.use_upper_total), produce:sum(r => r.produce) + demand.unsized };
  const sizesWithStock = rows.filter(r => r.fg_free > 0 || r.upper_free > 0).length;
  return { order_no:order && order.order_no, article, colour, party:clean(party), rows, unsized:demand.unsized,
    totals, sizes_with_stock:sizesWithStock, any:sizesWithStock > 0,
    ready_pairs:totals.fg + totals.upper,
    upper_other_colours:Object.entries(other).map(([c, pairs]) => ({ colour:c, pairs })),
    suggestion:allocationFromRows(rows) };
}

function allocationFromRows(rows){
  const sizes = {};
  for(const r of rows){
    const upper = Object.fromEntries(Object.entries(r.use_upper).filter(([, q]) => q > 0));
    if(r.use_fg > 0 || Object.keys(upper).length) sizes[sizeOf(r.size)] = { fg:r.use_fg, upper };
  }
  return sizes;
}

/* Accepts whatever the screen sent and returns an allocation the planner can
   trust, or the reasons it cannot. `{ignore:true}` is a decision too: reserve
   nothing, make everything. */
export function normalizeAllocation(input){
  const problems = [], sizes = {};
  if(input && input.ignore) return { mode:"ignore", sizes:{}, problems };
  for(const [size, use] of Object.entries((input && input.sizes) || {})){
    const fg = whole(use && use.fg == null ? 0 : use && use.fg);
    if(Number.isNaN(fg)){ problems.push(`Size ${size}: pairs from finished goods must be a whole number of 0 or more`); continue; }
    const upper = {};
    let bad = false;
    for(const [from, q] of Object.entries((use && use.upper) || {})){
      const n = whole(q);
      if(Number.isNaN(n)){ problems.push(`Size ${size}: uppers from size ${from} must be a whole number of 0 or more`); bad = true; break; }
      if(n > 0) upper[sizeOf(from)] = n;
    }
    if(bad) continue;
    if(fg > 0 || Object.keys(upper).length) sizes[sizeOf(size)] = { fg, upper };
  }
  return { mode:Object.keys(sizes).length ? "use" : "ignore", sizes, problems };
}

/* THE DECISION, AS LEDGER ROWS.
   The target allocation is compared with what the order already holds, and the
   difference becomes rows: more is a `reserve` (and must be FREE right now),
   less is a `release` (and cannot go below what has already been dispatched or
   issued). The server calls this inside the locked transaction with fresh
   figures, so two planners reaching for the last 40 pairs cannot both be told
   yes: the second gets `stale` and the numbers as they now stand.

   opts.onCards  {size: pairs} already on full-routing job cards — FG cannot
                 take over pairs that are already being made. */
export function planReservations(order, input, balance, reservations = [], opts = {}){
  const target = normalizeAllocation(input);
  const problems = [...target.problems];
  const article = clean(order && (order.article_code || order.article));
  const colour = colourOf(opts.colour != null ? opts.colour : ((order && order.pi) || {}).upper_colour);
  const party = clean(order && order.party), orderNo = clean(order && order.order_no);
  const ordered = Object.fromEntries(orderDemand(order).sizes.map(d => [sizeOf(d.size), d]));
  const granted = grantedFor(reservations, orderNo), consumed = consumedFor(reservations, orderNo);
  const onCards = opts.onCards || {};
  let stale = false;

  for(const [size, use] of Object.entries(target.sizes)){
    const d = ordered[size];
    if(!d){ problems.push(`Size ${size} is not on ${orderNo}, so no stock can be set against it`); continue; }
    const total = use.fg + upperTotal(use);
    if(total > d.ordered)
      problems.push(`Size ${d.size}: ${total} pairs from stock is more than the ${d.ordered} ordered`);
    const making = Math.max(0, int(onCards[size]));
    if(use.fg > Math.max(0, d.ordered - making))
      problems.push(`Size ${d.size}: ${making} pairs are already on job cards, so at most ${Math.max(0, d.ordered - making)} can come from finished goods`);
    const up = nextSizeUp(d.size);
    for(const from of Object.keys(use.upper))
      if(from !== size && from !== sizeOf(up || ""))
        problems.push(`Size ${d.size} can use uppers of size ${d.size}${up ? ` or ${up}` : ""} only — not size ${from}`);
  }

  /* Every (store, drawn size, ordered size) either side knows about. */
  const cells = new Map();
  const cell = (store, from, size) => {
    const k = `${store}||${from}||${size}`;
    if(!cells.has(k)) cells.set(k, { store, from, size, want:0, have:0, used:0 });
    return cells.get(k);
  };
  const spread = (src, field) => {
    for(const [size, use] of Object.entries(src)){
      if(int(use.fg)) cell("FG", size, size)[field] += int(use.fg);
      for(const [from, q] of Object.entries(use.upper || {})) if(int(q)) cell("UPPER", from, size)[field] += int(q);
    }
  };
  spread(target.sizes, "want"); spread(granted, "have"); spread(consumed, "used");

  const rows = [], drawn = new Map();
  const label = c => c.store === "FG" ? `finished goods size ${c.size}` : `size ${c.from} uppers`;
  for(const c of cells.values()){
    if(c.want < c.used){
      problems.push(`${c.used} pair(s) of ${label(c)} have already been ${c.store === "FG" ? "dispatched" : "issued to moulding"} for this order, so the allocation cannot drop below that`);
      continue;
    }
    const delta = c.want - c.have;
    if(!delta) continue;
    const displaySize = (ordered[c.size] || {}).size || c.size;
    const base = { store:c.store, article, colour:c.store === "FG" ? "" : colour,
      size:c.store === "FG" ? displaySize : c.from, for_size:displaySize, order_no:orderNo, party };
    if(delta < 0){ rows.push({ ...base, kind:"release", qty:delta, reason:opts.reason || "Stock decision changed" }); continue; }
    const key = skuKey(c.store, article, colour, c.from);
    const taken = drawn.get(key) || 0;
    const free = balance.freeFor(c.store, article, colour, c.from, party) - taken;
    if(delta > free){
      stale = true;
      problems.push(`Only ${Math.max(0, free)} pair(s) of ${label(c)} are free now, and ${delta} were asked for`);
      continue;
    }
    drawn.set(key, taken + delta);
    rows.push({ ...base, kind:"reserve", qty:delta, reason:opts.reason || null });
  }
  return { ok:!problems.length, stale, problems, rows,
    allocation:{ mode:target.mode, sizes:target.sizes, colour } };
}

/* Everything an order still holds, handed back to free stock: the order was
   cancelled, or closed short at dispatch. */
export function releaseRows(reservations = [], orderNo, reason){
  return outstandingFor(reservations, orderNo).map(r => ({ store:r.store, article:r.article, colour:r.colour,
    size:r.size, for_size:r.for_size, order_no:clean(orderNo), party:r.party,
    kind:"release", qty:-r.qty, reason:reason || "Released" }));
}

/* AN ORDER EDITED AFTER ITS STOCK WAS RESERVED.
   A size reduced or removed must not keep stock tied to pairs that no longer
   exist: the excess is released — uppers before finished goods, because FG
   needs no production and is the better thing to keep. A size that GREW (or
   is new) has pairs nobody has decided about, so the order goes back to
   awaiting; what it already holds is kept. Never trims below what has already
   been dispatched or issued. */
export function reconcileAllocation(order, allocation, reservations = []){
  const orderNo = clean(order && order.order_no);
  const sizes = {};
  const consumed = consumedFor(reservations, orderNo);
  const ordered = Object.fromEntries(orderDemand(order).sizes.map(d => [sizeOf(d.size), d.ordered]));
  let changed = false;
  for(const [size, use] of Object.entries((allocation && allocation.sizes) || {})){
    const max = ordered[size] || 0, used = consumed[size] || emptyUse();
    const next = { fg:int(use.fg), upper:{ ...(use.upper || {}) } };
    let over = next.fg + upperTotal(next) - max;
    for(const from of Object.keys(next.upper)){
      if(over <= 0) break;
      const cut = Math.min(over, Math.max(0, int(next.upper[from]) - Math.max(0, int((used.upper || {})[from]))));
      if(cut){ next.upper[from] -= cut; over -= cut; changed = true; }
      if(!next.upper[from]) delete next.upper[from];
    }
    if(over > 0){
      const cut = Math.min(over, Math.max(0, next.fg - Math.max(0, int(used.fg))));
      if(cut){ next.fg -= cut; changed = true; }
    }
    if(next.fg > 0 || Object.keys(next.upper).length) sizes[size] = next;
  }
  const covered = size => { const u = sizes[size]; return u ? u.fg + upperTotal(u) : 0; };
  const before = (allocation && allocation.ordered) || null;
  /* Grown since the decision: more pairs of a size than were ordered when the
     planner last looked at it. */
  const grew = before
    ? Object.keys(ordered).some(size => ordered[size] > (before[size] || 0))
    : false;
  return { changed, grew, allocation:{ ...(allocation || {}), sizes, ordered },
    uncovered:Object.fromEntries(Object.keys(ordered).map(s => [s, ordered[s] - covered(s)])) };
}

/* Stamps what was ordered at the moment of the decision, so a later edit can
   tell a size that grew from one that did not. */
export const withOrdered = (allocation, order) => ({ ...allocation,
  ordered:Object.fromEntries(orderDemand(order).sizes.map(d => [sizeOf(d.size), d.ordered])) });

const usable = order => {
  const a = order && order.stock_allocation;
  return a && a.mode === "use" && a.sizes && Object.keys(a.sizes).length ? a : null;
};

/* Take `bySize` pairs out of an order's lines, in the order the lines are
   written. Only a line that names its sizes can give any up. Returns the lines
   as taken and as left; both keep every other field of the line. */
export function splitLines(lines = [], bySize = {}){
  const want = Object.fromEntries(Object.entries(bySize || {}).map(([s, n]) => [sizeOf(s), Math.max(0, int(n))]));
  const taken = [], left = [];
  for(const line of lines || []){
    if(!line.sizes || typeof line.sizes !== "object"){ left.push(line); continue; }
    const t = {}, l = {};
    for(const [size, q] of Object.entries(line.sizes)){
      const have = Math.max(0, int(q)), n = Math.min(have, want[sizeOf(size)] || 0);
      if(n){ t[size] = n; want[sizeOf(size)] -= n; }
      l[size] = have - n;
    }
    const tq = Object.values(t).reduce((a, n) => a + n, 0);
    if(tq) taken.push({ ...line, qty:tq, sizes:t });
    const lq = Math.max(0, int(line.qty)) - tq;
    if(lq > 0) left.push({ ...line, qty:lq, sizes:l });
  }
  return { taken, left };
}

/* WHAT STILL HAS TO BE PRODUCED. The order less the pairs its stock decision
   covers from finished goods — those are never made, so they are on no job
   card and buy no material. The order itself is untouched: the customer still
   ordered, and is still owed, every pair. */
export function productionOrder(order){
  const a = usable(order);
  if(!a) return order;
  const fg = Object.fromEntries(Object.entries(a.sizes).map(([s, u]) => [s, int(u.fg)]));
  if(!Object.values(fg).some(n => n > 0)) return order;
  return { ...order, lines:splitLines(order.lines, fg).left };
}

/* Pairs of each ORDERED size that come from upper stock, and so start at
   moulding. */
export function upperPairs(order){
  const a = usable(order), out = {};
  if(a) for(const [size, use] of Object.entries(a.sizes)){
    const n = upperTotal(use);
    if(n > 0) out[size] = n;
  }
  return out;
}

export const fgPairs = order => {
  const a = usable(order);
  return a ? Object.values(a.sizes).reduce((n, u) => n + int(u.fg), 0) : 0;
};

/* One line per source for the screens: where each pair of the order comes from. */
export function allocationSummary(order){
  const demand = orderDemand(order), a = usable(order);
  const rows = demand.sizes.map(d => {
    const use = (a && a.sizes[sizeOf(d.size)]) || emptyUse();
    const upper = upperTotal(use);
    return { size:d.size, ordered:d.ordered, fg:int(use.fg), upper, upper_from:{ ...(use.upper || {}) },
             produce:d.ordered - int(use.fg) - upper };
  });
  const sum = f => rows.reduce((n, r) => n + f(r), 0);
  return { rows, ordered:sum(r => r.ordered) + demand.unsized, fg:sum(r => r.fg), upper:sum(r => r.upper),
    produce:sum(r => r.produce) + demand.unsized, unsized:demand.unsized,
    mode:(order && order.stock_allocation && order.stock_allocation.mode) || null };
}

/* Is this order waiting on a person? Only one the server marked — an order
   from before this existed has no status and is never held back. */
export const awaitingDecision = order => !!order && order.stock_status === "awaiting";

/* THE DISPATCH REMINDER. What the order still holds in finished goods — to be
   pre-filled into the slip — and, where it holds nothing (the planner chose
   "ignore stock", or stock arrived later), the FREE finished goods that match
   its article and sizes: shown as a reminder, never pre-filled. `shipped` is
   {size: pairs} already dispatched, so stock is never suggested for a size the
   customer has had in full. */
export function dispatchPrefill(order, reservations = [], balance = null, shipped = {}){
  const orderNo = clean(order && order.order_no), article = clean(order && (order.article_code || order.article));
  const reserved = outstandingFor(reservations, orderNo).filter(r => r.store === "FG")
    .map(r => ({ size:r.for_size, pairs:r.qty }));
  const reservedPairs = reserved.reduce((a, r) => a + r.pairs, 0);
  const free = [];
  if(balance) for(const d of orderDemand(order).sizes){
    const owed = d.ordered - Math.max(0, int((shipped || {})[d.size] != null ? shipped[d.size] : (shipped || {})[sizeOf(d.size)]))
      - reserved.filter(r => sizeOf(r.size) === sizeOf(d.size)).reduce((a, r) => a + r.pairs, 0);
    const n = Math.min(Math.max(0, owed), balance.freeFor("FG", article, "", d.size, order && order.party));
    if(n > 0) free.push({ size:d.size, pairs:n });
  }
  return { order_no:orderNo, reserved, reserved_pairs:reservedPairs,
    free, free_pairs:free.reduce((a, r) => a + r.pairs, 0) };
}

/* A dispatch that ships pairs out of finished goods. `fromStock` is
   {size: pairs}. Reserved pairs go first; anything beyond them must be FREE.
   Returns the finished-stock issues and the reservation rows that record it,
   or the reasons it cannot be done. Stock can never go below zero. */
export function dispatchFromStock(order, fromStock = {}, reservations = [], balance){
  const problems = [], issues = [], rows = [];
  const orderNo = clean(order && order.order_no), article = clean(order && (order.article_code || order.article));
  const ordered = Object.fromEntries(orderDemand(order).sizes.map(d => [sizeOf(d.size), d]));
  const held = {};
  for(const r of outstandingFor(reservations, orderNo)) if(r.store === "FG")
    held[sizeOf(r.for_size)] = (held[sizeOf(r.for_size)] || 0) + r.qty;
  for(const [size, v] of Object.entries(fromStock || {})){
    const n = whole(v);
    if(Number.isNaN(n)){ problems.push(`Size ${size}: pairs from stock must be a whole number of 0 or more`); continue; }
    if(!n) continue;
    const d = ordered[sizeOf(size)];
    if(!d){ problems.push(`Size ${size} is not on ${orderNo}`); continue; }
    const mine = Math.min(n, held[sizeOf(size)] || 0), extra = n - mine;
    const free = balance.freeFor("FG", article, "", d.size, order && order.party);
    if(extra > free){
      problems.push(`Size ${d.size}: ${n} pairs from stock were entered, but only ${mine + Math.max(0, free)} are available to this order`);
      continue;
    }
    issues.push({ article, size:d.size, qty:-n, kind:"issued", order_no:orderNo });
    if(mine) rows.push({ store:"FG", article, colour:"", size:d.size, for_size:d.size, order_no:orderNo,
      party:clean(order && order.party), kind:"dispatch", qty:-mine, reason:null });
  }
  return { ok:!problems.length, problems, issues, rows,
    pairs:issues.reduce((a, m) => a - m.qty, 0) };
}

/* AN ISSUE MUST NOT TAKE WHAT ANOTHER ORDER HOLDS.
   Checked beside each store's own validator: a movement out of FG or the upper
   store may take free stock and the order's own reservation, never a different
   order's. `moves` are [{store, article, colour, size, qty (positive, going
   out), order_no}] and are checked IN ORDER, like every batch here.
   Only a RESERVATION refuses. Uppers merely held for the order they were
   stitched for are not offered to a new order, but the floor may still issue
   them where they are needed — the upper store stays one pool to work from. */
export function checkWithdrawals(moves = [], balance){
  const problems = [], gone = new Map();
  for(const m of moves || []){
    const t = balance.get(m.store, m.article, m.colour, m.size);
    const q = Math.max(0, int(m.qty));
    if(!q) continue;
    const key = skuKey(m.store, m.article, m.colour, m.size);
    const no = clean(m.order_no);
    const who = t ? Object.keys(t.booked).filter(o => o !== no) : [];
    const others = t ? Math.min(Math.max(0, t.on_hand), who.reduce((a, o) => a + t.booked[o], 0)) : 0;
    const available = (t ? t.on_hand : 0) - others - (gone.get(key) || 0);
    if(q > available){
      problems.push(`${STORES[m.store]} ${m.article}${m.colour ? ` ${m.colour}` : ""} size ${m.size}: `
        + `${Math.max(0, available)} pair(s) can be taken`
        + (others > 0 ? ` — ${others} more are reserved for ${who.join(", ")}` : "")
        + `, and ${q} were asked for`);
      continue;
    }
    gone.set(key, (gone.get(key) || 0) + q);
  }
  return problems;
}

/* Reservation rows that record stock leaving for the order that holds it —
   uppers issued to moulding, or finished goods issued out by hand. Derived
   from the store's own movements, so the keeper records one thing and the
   reservation follows it. */
export function issueRowsFor(outMoves = [], reservations = [], store = "UPPER"){
  const rows = [], left = new Map();
  for(const m of outMoves || []){
    const no = clean(m.order_no);
    if(!no || (store === "UPPER" && clean(m.kind) !== "out")) continue;
    const mine = outstandingFor(reservations, no).filter(r => r.store === store
      && skuKey(store, r.article, r.colour, r.size) === skuKey(store, m.article, m.colour, m.size));
    let q = Math.abs(int(m.qty));
    for(const r of mine){
      if(!q) break;
      const k = `${no}||${skuKey(store, r.article, r.colour, r.size)}||${sizeOf(r.for_size)}`;
      const have = left.has(k) ? left.get(k) : r.qty;
      const n = Math.min(q, have);
      if(!n) continue;
      left.set(k, have - n); q -= n;
      /* Finished goods handed to the order by hand have gone to the customer
         just as surely as those on a dispatch slip. */
      rows.push({ store, article:r.article, colour:r.colour, size:r.size, for_size:r.for_size,
        order_no:no, party:r.party, kind:store === "FG" ? "dispatch" : "issue", qty:-n, reason:null });
    }
  }
  return rows;
}

/* A party lock, checked before it is stored. qty 0 removes the lock. */
export function validateLock(input = {}){
  const problems = [];
  const store = clean(input.store).toUpperCase();
  const lock = { store, article:clean(input.article), colour:store === "FG" ? "" : colourOf(input.colour),
    size:clean(input.size), party:clean(input.party), qty:whole(input.qty) };
  if(!STORES[store]) problems.push("store must be FG or UPPER");
  if(!lock.article) problems.push("article is required");
  if(!lock.size) problems.push("size is required — stock is locked per size");
  if(!lock.party) problems.push("name the party the stock is kept for");
  if(Number.isNaN(lock.qty)) problems.push("pairs must be a whole number of 0 or more");
  return { lock, problems };
}

/* A reservation row checked before it is written: the sign follows the kind. */
export function validateReservationRow(r = {}){
  const kind = RESERVATION_KINDS[clean(r.kind)];
  const q = int(r.qty);
  if(!kind || !STORES[r.store] || !clean(r.article) || !clean(r.size) || !clean(r.order_no) || !q) return null;
  return { store:r.store, article:clean(r.article), colour:r.store === "FG" ? "" : colourOf(r.colour),
    size:clean(r.size), for_size:clean(r.for_size || r.size), qty:kind.sign * Math.abs(q), kind:clean(r.kind),
    order_no:clean(r.order_no), party:clean(r.party) || null, job_card_no:clean(r.job_card_no) || null,
    dispatch_id:r.dispatch_id == null ? null : Number(r.dispatch_id), reason:clean(r.reason).slice(0, 300) || null };
}
