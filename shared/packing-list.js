/* The Packing List — the factory's own dispatch document.
 *
 * Pure: given the lines a packer actually counted, it works out the carton
 * numbers, the totals and what does not add up. No database, no clock.
 *
 * The shape comes from the client's existing sheet, and two things about it
 * matter more than they look:
 *
 * 1. CARTONS ARE COUNTED, NEVER DERIVED. The old dispatch screen divided pairs
 *    by the packing rate and showed "2.67 cartons", which is not a thing that
 *    can be put on a lorry. Sizes inside one range do not pack alike either —
 *    SPIKE's 11X1 packs 12s/13s at 24 and size 1 at 18 — so a derived figure is
 *    wrong as often as it is right. The packer enters the count.
 *
 * 2. ONE LINE CAN HOLD SEVERAL SIZES. A part carton is made up of whatever is
 *    left: the sample sheet has size 8 (10 pairs) and size 9 (16 pairs) sharing
 *    a single carton, numbered 5/49. So a line is {sizes:[...], cartons:n}, and
 *    n is not a function of the sizes.
 *
 * C/N NUMBERS are derived, because they are numbering rather than quantity: the
 * cartons of each line take the next numbers in sequence, so line 4 with two
 * cartons following four already used prints "6-7/49".
 */

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* The sheet has TWO levels, and conflating them gets the S.NO column wrong.
 *
 *   S.NO      one article + closure + colour. It spans however many size rows
 *             that combination needs — the sample sheet's S.NO 1 covers sizes
 *             8, 9 and 10.
 *   carton    one or more size rows packed into the same box(es), and the unit
 *   group     the C/N numbers actually follow. S.NO 1 holds THREE carton
 *             groups of one carton each (1/49, 2/49, 3/49); S.NO 3 holds ONE
 *             group of two sizes sharing a single box (5/49).
 *
 * So a line is {article, closure, colour, groups:[{sizes, cartons}]}. A line
 * given a flat {sizes, cartons} is read as a single group, which is the common
 * case and keeps simple entry simple.
 */
/* ONE BOX CAN HOLD TWO DIFFERENT SHOES.
 * The factory's own gate pass (SR 15941) runs STRIKE (V) down the sheet and
 * then STRIKE (L), and a single "1" in the carton column spans rows on both
 * sides of that change — same article type, different shoe, one box.
 *
 * An S.NO is still one article/closure/colour, so a box like that belongs to
 * no single line. Its parts carry the same `carton_group` label: the FIRST
 * part owns the carton count and the C/N number, the rest contribute their
 * pairs and no cartons, and the box is therefore counted and numbered ONCE
 * while each shoe's pairs stay on its own line — which is what keeps the
 * order book's per-range balance right.
 */
import { spread } from "./carton-mix.js";

export function buildPackingList(input = {}){
  const rows = Array.isArray(input.lines) ? input.lines : [];
  const problems = [];

  let used = 0;                       // cartons numbered so far
  const shared = new Map();           // carton_group -> {from, to, cartons, sno}
  const lines = rows.map((line, i) => {
    const sno = i + 1;
    const rawGroups = Array.isArray(line.groups) && line.groups.length
      ? line.groups
      : [{ sizes: line.sizes, cartons: line.cartons }];

    const groups = rawGroups.map(g => {
      const sizes = (Array.isArray(g.sizes) ? g.sizes : [])
        .map(s => ({ size: String(s.size ?? "").trim(), pairs: Math.round(num(s.pairs)) }))
        .filter(s => s.size !== "" || s.pairs);
      const pairs = sizes.reduce((a, s) => a + s.pairs, 0);
      const claimed = Math.max(0, Math.round(num(g.cartons)));
      const label = String(g.carton_group ?? "").trim();

      /* A shared box is allocated by its FIRST part and reused by the rest. */
      let cartons = claimed, from, to, shares = false, owns = false;
      const held = label ? shared.get(label) : null;
      if(label && held){
        shares = true;
        cartons = 0;                                   // counted once, on the owner
        from = held.from; to = held.to;
        if(claimed > 0)
          problems.push(`Carton ${label} is one box and is counted once — line ${sno} also claims `
            + `${claimed} carton${claimed === 1 ? "" : "s"}`);
      } else {
        if(label){ owns = true; cartons = claimed || 1; }
        from = used + 1;
        to = used + cartons;
        used = to;
        if(label) shared.set(label, { from, to, cartons, sno });
      }

      for(const s of sizes){
        if(!s.size) problems.push(`Line ${sno}: a size is blank`);
        if(s.pairs <= 0) problems.push(`Line ${sno}: size ${s.size||"?"} has no pairs`);
      }
      if(!sizes.length) problems.push(`Line ${sno}: no sizes entered`);
      /* A part of a shared box legitimately carries pairs and no cartons of
         its own — the box was counted where it was opened. */
      /* NAME THE SIZES, or two rows of the same size read as the same
         complaint twice. A 6X7 line drafted as 27 pairs of 6s and 27 of 7s
         produced "Line 1: 27 pairs but no cartons counted" verbatim twice,
         which looks like a repeating bug rather than two boxes to count. */
      if(pairs > 0 && cartons === 0 && !shares){
        const named = sizes.map(x => x.size).filter(Boolean).join(", ");
        problems.push(`Line ${sno}${named ? ` · ${named}` : ""}: ${pairs} pairs but no cartons counted`);
      }
      if(cartons > 0 && pairs === 0) problems.push(`Line ${sno}: ${cartons} carton(s) but no pairs`);

      return { sizes, pairs, cartons,
               ...(label ? { carton_group: label, shares_carton: shares, owns_carton: owns } : {}),
               cn_from: (cartons || shares) ? from : null,
               cn_to: (cartons || shares) ? to : null };
    });

    return {
      sno,
      article: String(line.article || "").trim(),
      closure: String(line.closure || "").trim(),      // Velcro / Lace
      colour: String(line.colour || "").trim(),
      /* Keep the order's range key through normalization. Dispatch storage is
         per range, so dropping it here made a correctly counted packing list
         save `cartons:{}` even while the screen showed the right total. */
      combo: String(line.combo || "").trim(),
      groups,
      rows: groups.reduce((a, g) => a + Math.max(1, g.sizes.length), 0),
      pairs: groups.reduce((a, g) => a + g.pairs, 0),
      cartons: groups.reduce((a, g) => a + g.cartons, 0),
    };
  });

  const total_pairs = lines.reduce((a, l) => a + l.pairs, 0);
  const total_cartons = lines.reduce((a, l) => a + l.cartons, 0);

  /* The sheet states its own dispatch quantity and carton count in the header.
     Checking the entered lines against those is the only thing that catches a
     whole line being missed — every remaining line still looks reasonable on
     its own, which is exactly how the 14-carton slip lost five of them. */
  const stated_pairs = input.dispatch_pairs == null ? null : Math.round(num(input.dispatch_pairs));
  const stated_cartons = input.dispatch_cartons == null ? null : Math.round(num(input.dispatch_cartons));
  if(stated_pairs != null && total_pairs !== stated_pairs)
    problems.push(`The lines add up to ${total_pairs} pairs but the header says ${stated_pairs}`);
  if(stated_cartons != null && total_cartons !== stated_cartons)
    problems.push(`The lines add up to ${total_cartons} cartons but the header says ${stated_cartons}`);

  return {
    customer: String(input.customer || "").trim(),
    order_no: String(input.order_no || "").trim(),
    order_qty: input.order_qty == null || input.order_qty === "" ? null : Math.round(num(input.order_qty)),
    date: input.date || null,
    lines, total_pairs, total_cartons,
    stated_pairs, stated_cartons,
    problems,
    ok: problems.length === 0,
  };
}

/* "1/49", or "6-7/49" when a line fills more than one carton. Blank when a line
   has no cartons yet, rather than a misleading "0/49". */
export function cartonNumbers(group, totalCartons){
  if(!group || !group.cn_from || !group.cn_to) return "";
  const span = group.cn_from === group.cn_to ? `${group.cn_from}` : `${group.cn_from}-${group.cn_to}`;
  return `${span}/${totalCartons}`;
}

/* ---------------- THE ORDER'S OWN SIZES ----------------
   An order line is stored per size range AND, when the customer ordered size
   by size, with its exact sizes ({combo, qty, sizes:{"7s":40,"8s":20}}). The
   packing list used to ignore `sizes` and divide the dispatched pairs evenly
   across every size of the range — so an order for 7s:40, 8s:20, 9s:30, 10s:30
   came back on the dispatch sheet as 30/30/30/30, and a size nobody ordered
   appeared with pairs against it. The sheet and the order book stopped
   agreeing on the very first line. These helpers make the ORDER the source of
   the sheet: what was ordered per size, what earlier packing lists already
   sent per size, and therefore what is still owed per size. */

const pos = v => Math.max(0, Math.round(num(v)));

/* The labels a line's sizes print as, in range order: the line's own
   size_order first (a lace range prints 6..9 where the default roll says
   6s..9s), then the sizes it actually carries, then the range's roll. */
export function lineSizeOrder(line, sizesForCombo){
  const out = [];
  const push = s => { const k = String(s); if(k && !out.includes(k)) out.push(k); };
  for(const s of Array.isArray(line && line.size_order) ? line.size_order : []) push(s);
  for(const s of (sizesForCombo && line ? sizesForCombo(line.combo) || [] : [])) push(s);
  for(const s of Object.keys((line && line.sizes) || {})) push(s);
  return out;
}

/* {combo: {size: pairs}} ordered — only for lines that carry exact sizes.
   A line with no size breakdown is absent, never invented. */
export function orderedSizes(order){
  const out = {};
  for(const l of (order && order.lines) || []){
    if(!l || !l.sizes || typeof l.sizes !== "object") continue;
    const bucket = out[l.combo] || (out[l.combo] = {});
    for(const [size, q] of Object.entries(l.sizes)){ const n = pos(q); if(n) bucket[size] = (bucket[size] || 0) + n; }
  }
  return out;
}

/* {combo: {size: pairs}} already sent, read off earlier packing lists. Pairs
   dispatched WITHOUT a packing list have no sizes; they are counted per combo
   as `unsized` so nobody mistakes them for still owed. */
export function packedSizes(dispatches = []){
  const sized = {}, unsized = {};
  for(const d of dispatches || []){
    const fromSheet = {};
    for(const line of ((d && d.packing_list && d.packing_list.lines) || [])){
      const combo = String(line.combo || "");
      const groups = Array.isArray(line.groups) && line.groups.length ? line.groups : [{ sizes: line.sizes }];
      for(const g of groups) for(const sz of (g.sizes || [])){
        const n = pos(sz.pairs); if(!n || !combo) continue;
        const bucket = sized[combo] || (sized[combo] = {});
        bucket[String(sz.size)] = (bucket[String(sz.size)] || 0) + n;
        fromSheet[combo] = (fromSheet[combo] || 0) + n;
      }
    }
    for(const [combo, v] of Object.entries((d && d.dispatched) || {})){
      const gap = pos(v) - (fromSheet[combo] || 0);
      if(gap > 0) unsized[combo] = (unsized[combo] || 0) + gap;
    }
  }
  return { sized, unsized };
}

/* What is still owed, size by size, for every line that has sizes. */
export function sizeBalance(order, dispatches = []){
  const ordered = orderedSizes(order);
  const { sized, unsized } = packedSizes(dispatches);
  const out = {};
  for(const [combo, sizes] of Object.entries(ordered)){
    const sent = sized[combo] || {};
    out[combo] = { unsized: unsized[combo] || 0, sizes: {} };
    for(const [size, q] of Object.entries(sizes))
      out[combo].sizes[size] = { ordered:q, sent:sent[size] || 0, remaining:Math.max(0, q - (sent[size] || 0)) };
  }
  return out;
}

/* Seed a sheet from what the order already knows, so the packer types counts
   rather than re-keying the article, closure and colour on every line.

   `dispatched` is what is leaving, per range — either {combo: pairs} or, as
   the dispatch screen now sends it, {combo: {size: pairs}}. In order of trust:
     1. sizes given for this dispatch     → exactly those, nothing else
     2. the order line has exact sizes    → what is still owed per size; if
        fewer pairs are leaving than are owed, a proportional starting point,
        flagged `estimated` so the screen says so
     3. a line with no size breakdown     → the range split equally (the
        factory's combination-pack rule), flagged `estimated`
   The carton count is untouched and stays zero: cartons are COUNTED. */
export function draftFromOrder(order, sizesForCombo, dispatched = {}, previous = []){
  const pi = (order && order.pi) || {};
  const balance = sizeBalance(order, previous);
  const lines = [];
  for(const [combo, value] of Object.entries(dispatched || {})){
    const line = ((order && order.lines) || []).find(l => l.combo === combo) || { combo };
    const order_ = lineSizeOrder(line, sizesForCombo);
    let sizes, estimated = false;
    if(value && typeof value === "object"){
      sizes = order_.concat(Object.keys(value).filter(k => !order_.includes(k)))
        .map(size => ({ size, pairs: pos(value[size]) })).filter(s => s.pairs > 0);
    } else {
      const total = pos(value);
      if(total <= 0) continue;
      const owed = balance[combo];
      if(owed){
        const left = Object.fromEntries(order_.filter(s => owed.sizes[s]).map(s => [s, owed.sizes[s].remaining]));
        const leftTotal = Object.values(left).reduce((a, b) => a + b, 0);
        let take = left;
        if(leftTotal !== total){
          estimated = true;
          const names = Object.keys(left).filter(k => left[k] > 0);
          const have = names.map(k => left[k]);
          const sum = have.reduce((a, b) => a + b, 0) || 1;
          const want = Math.min(total, leftTotal || total);
          const base = have.map(h => Math.floor(h * want / sum));
          let short = want - base.reduce((a, b) => a + b, 0);
          for(let i = 0; i < base.length && short > 0; i++) if(base[i] < have[i]){ base[i]++; short--; }
          take = Object.fromEntries(names.map((k, i) => [k, base[i]]));
        }
        sizes = order_.filter(s => take[s] > 0).map(size => ({ size, pairs: take[size] }));
      } else {
        /* A COMBINATION PACK IS PACKED EQUAL — the factory's rule for a range
           ordered as a range. A starting point, flagged as one. */
        estimated = true;
        const names = order_.length ? order_ : (sizesForCombo ? sizesForCombo(combo) || [] : []);
        const share = spread(total, names.length);
        sizes = names.map((size, i) => ({ size, pairs: share[i] || 0 })).filter(s => s.pairs > 0);
      }
    }
    if(!sizes.length) continue;
    lines.push({
      article: order.article_code || "",
      closure: pi.vl || "",
      colour: pi.upper_colour || pi.sole_colour || "",
      combo, combo_pairs: sizes.reduce((a, s) => a + s.pairs, 0),
      ...(estimated ? { estimated: true } : {}),
      /* One group per size by default — the common case is a size filling its
         own cartons. Sizes are merged into one group when they share a box. */
      groups: sizes.map(s => ({ sizes:[s], cartons: 0 })),
    });
  }
  return {
    customer: (order && order.party) || "",
    order_no: (order && order.order_no) || "",
    /* The ORDER's own total, which the sheet prints beside what is leaving —
       a known figure, so the header no longer prints it blank. Null only when
       the order carries no quantities at all. */
    order_qty: ((order && order.lines) || []).reduce((a, l) => a + Math.round(num(l.qty)), 0) || null,
    date: null,     // stamped by the screen; this module takes no clock
    lines,
  };
}

/* Keep a sheet's PAIRS in step with what step 1 says is leaving, without
   throwing away a single carton the packer has already counted. A size that
   went to zero leaves its group (a group left empty goes too, unless it is a
   mixed box being built); a size newly leaving is added as its own group. */
export function syncSheetPairs(sheet, leaving, order, sizesForCombo){
  const next = JSON.parse(JSON.stringify(sheet || { lines: [] }));
  const fresh = draftFromOrder(order, sizesForCombo, leaving);
  for(const freshLine of fresh.lines){
    let line = next.lines.find(l => l.combo === freshLine.combo);
    if(!line){ next.lines.push(freshLine); continue; }
    const want = Object.fromEntries(freshLine.groups.flatMap(g => g.sizes).map(s => [s.size, s.pairs]));
    const seen = new Set();
    line.groups = line.groups.map(g => {
      if(g.carton_group) return g;                        // a box shared across shoes is the packer's
      const sizes = g.sizes.filter(sz => want[sz.size] > 0 && !seen.has(sz.size))
        .map(sz => { seen.add(sz.size); return { ...sz, pairs: want[sz.size] }; });
      return { ...g, sizes };
    }).filter(g => g.carton_group || g.sizes.length || g.mixed);
    for(const [size, pairs] of Object.entries(want))
      if(!seen.has(size)) line.groups.push({ sizes:[{ size, pairs }], cartons: 0 });
    line.combo_pairs = freshLine.combo_pairs;
    if(freshLine.estimated) line.estimated = true; else delete line.estimated;
  }
  next.lines = next.lines.filter(l => fresh.lines.some(f => f.combo === l.combo)
    || (l.groups || []).some(g => g.carton_group));
  return next;
}

/* THE SHEET AGAINST THE ORDER — run on the screen AND on the server.
   The server used to compare only the GRAND TOTAL, so a sheet could move 30
   pairs from 7X10 to 11X1, or put pairs on a size the customer never ordered,
   and still be accepted as long as the sum matched. Now:
     - each range on the sheet must add up to what that range is dispatching
     - on a line ordered size by size, a size must be one that was ordered and
       cannot exceed what is still owed of it (earlier sheets subtracted). */
export function checkAgainstOrder(sheet, order, dispatched = {}, previous = []){
  const problems = [];
  const built = buildPackingList(sheet || {});
  const perCombo = {}, perSize = {};
  for(const line of built.lines){
    const combo = line.combo || "";
    for(const g of line.groups) for(const sz of g.sizes){
      perCombo[combo] = (perCombo[combo] || 0) + sz.pairs;
      const b = perSize[combo] || (perSize[combo] = {});
      b[sz.size] = (b[sz.size] || 0) + sz.pairs;
    }
  }
  const leaving = {};
  for(const [c, v] of Object.entries(dispatched || {})){
    const n = v && typeof v === "object" ? Object.values(v).reduce((a, b) => a + pos(b), 0) : pos(v);
    if(n) leaving[c] = n;
  }
  for(const combo of new Set([...Object.keys(perCombo), ...Object.keys(leaving)])){
    if(!combo){ problems.push("A packing-list line is not tied to a size range of this order"); continue; }
    if((perCombo[combo] || 0) !== (leaving[combo] || 0))
      problems.push(`${combo}: the packing list has ${perCombo[combo] || 0} pairs but ${leaving[combo] || 0} are being dispatched`);
  }
  const balance = sizeBalance(order, previous);
  for(const [combo, sizes] of Object.entries(perSize)){
    const owed = balance[combo];
    if(!owed) continue;                                   // ordered as a range: no size list to hold it to
    for(const [size, pairs] of Object.entries(sizes)){
      const row = owed.sizes[size];
      if(!row){ problems.push(`${combo}: size ${size} was not ordered (ordered: ${Object.keys(owed.sizes).join(", ")})`); continue; }
      if(pairs > row.remaining)
        problems.push(`${combo} size ${size}: ${pairs} pairs packed but only ${row.remaining} of ${row.ordered} ordered are still owed`);
    }
  }
  return problems;
}
