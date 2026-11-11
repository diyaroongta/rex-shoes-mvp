/* Material issues: which material went to which job card.
 *
 * The register has always kept ONE running "Issued" total per material. That
 * answers "how much rexine has left the store" and nothing else — not which
 * job took it, not whether a card has had everything its BOM calls for, not
 * what came back. So this is an EVENT LOG, like repair and the upper store:
 * each movement is a job card, a material, a quantity and a date, and every
 * total is derived. The register's own Issued figure is still kept in step —
 * it is the same sum — so the stock sheet, the netting and the buying list
 * read exactly as before.
 *
 * TWO WAYS A MATERIAL LEAVES THE STORE, set per material:
 *
 *   job_order   the card's whole BOM quantity is released when the job order
 *               is raised. This is what the app has always done, so a
 *               material nobody has set is treated this way.
 *   on_demand   the floor asks and the store hands it over. Nothing is booked
 *               when the card is raised; the keeper records each issue.
 *
 * NOTHING HERE IS REFUSED FOR BEING MORE THAN THE BOM. A floor that needs
 * another roll gets it — the BOM is a rate, not a ration — and the store
 * register is mostly unfilled, so refusing an issue above the book stock would
 * stop the store working. Both are reported as warnings instead. What IS
 * refused is the impossible: returning more than the card ever took.
 *
 * Pure: no database, no clock.
 */
import { materialTotals } from "./bom-components.js";
import { isRealDate } from "./valid.js";
import { balanceOf } from "./stock.js";

export const ISSUE_MODES = ["job_order", "on_demand"];
export const ISSUE_MODE_LABEL = { job_order: "By job order", on_demand: "On demand" };
export const ISSUE_MODE_HELP = {
  job_order: "The full BOM quantity is released when a job order is raised.",
  on_demand: "Nothing is released with the job order — the store issues it when the floor asks.",
};
export const MOVEMENT_TYPES = ["issue", "return"];

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round4 = n => Math.round(n * 10000) / 10000;
const text = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const nameOf = key => String(key || "").split("||")[0];
const uomOf  = key => String(key || "").split("||")[1] || "";
const EPS = 1e-6;

/* What was SET for a material — null when nobody has chosen. */
export const issueModeOf = meta =>
  ISSUE_MODES.includes((meta || {}).issue_mode) ? meta.issue_mode : null;

/* How the material actually behaves. Unset means "by job order", because that
   is what every card raised so far has done; changing it under the factory
   would silently stop booking materials out. */
export const effectiveIssueMode = meta => issueModeOf(meta) || "job_order";

const describe = (key, materials) => {
  const m = (materials || {})[key] || {};
  return { material_key: key, name: m.name || nameOf(key), uom: m.uom || uomOf(key) };
};

/* What raising this job card releases from the store, and what it leaves for
   the keeper to issue by hand. Both lists come from the SAME BOM total the
   card prints (`materialTotals`), so the store and the card cannot disagree. */
export function releaseLines(cardLines, article, stockMeta = {}, materials = {}){
  const released = [], on_demand = [];
  for(const [key, qty] of Object.entries(materialTotals(cardLines || [], article || {}))){
    if(!(num(qty) > 0)) continue;
    const row = { ...describe(key, materials), qty: round4(num(qty)) };
    (effectiveIssueMode((stockMeta || {})[key]) === "on_demand" ? on_demand : released).push(row);
  }
  return { released, on_demand };
}

/* Issued, returned and what the job is still holding, per material. */
export function netByMaterial(movements){
  const out = {};
  for(const m of movements || []){
    const key = text(m.material_key);
    if(!key) continue;
    const row = out[key] || (out[key] = { issued: 0, returned: 0, net: 0 });
    if(m.type === "return") row.returned = round4(row.returned + num(m.qty));
    else row.issued = round4(row.issued + num(m.qty));
    row.net = round4(row.issued - row.returned);
  }
  return out;
}

/* One hand-entered movement. `ctx.job` is the job card it is against,
   `ctx.materials` the material register, `ctx.prior` every movement already
   recorded against that card. */
export function validateMovement(input = {}, ctx = {}){
  const problems = [];
  const job = ctx.job || null;
  const materials = ctx.materials || {};
  if(!job) problems.push("Choose the job card this material is for");
  else if(job.cancelled) problems.push(`Job card ${job.id} was cancelled — nothing can be issued against it`);

  const type = text(input.type) || "issue";
  if(!MOVEMENT_TYPES.includes(type)) problems.push(`Unknown movement: ${type} — use issue or return`);

  const moved_on = text(input.moved_on);
  if(!isRealDate(moved_on)) problems.push("The date must be a real date (YYYY-MM-DD)");

  const note = text(input.note);
  if(note.length > 500) problems.push("The note must be 500 characters or fewer");

  const raw = Array.isArray(input.lines) ? input.lines : [];
  if(!raw.length) problems.push("Enter a quantity against at least one material");
  if(raw.length > 200) problems.push("One entry can carry at most 200 materials");

  const held = netByMaterial(ctx.prior || []);
  const seen = new Set(), lines = [];
  for(const line of raw.slice(0, 200)){
    const key = text((line || {}).material_key);
    if(!key){ problems.push("A line has no material"); continue; }
    if(!materials[key]){ problems.push(`${key} is not in the material register`); continue; }
    if(seen.has(key)){ problems.push(`${materials[key].name || nameOf(key)} appears more than once`); continue; }
    seen.add(key);
    const d = describe(key, materials);
    const qty = Number((line || {}).qty);
    if(!Number.isFinite(qty) || qty <= 0 || qty > 1e9){
      problems.push(`${d.name}: the quantity must be more than 0`); continue;
    }
    /* A return is bounded by what the card is actually holding. Material that
       never went to this job cannot come back from it. */
    if(type === "return"){
      const out = (held[key] || {}).net || 0;
      if(round4(qty) > out + EPS){
        problems.push(out > 0
          ? `${d.name}: only ${out} ${d.uom} is out against job card ${job ? job.id : ""}, so ${round4(qty)} cannot come back`
          : `${d.name}: nothing is out against job card ${job ? job.id : ""}, so nothing can come back`);
        continue;
      }
    }
    lines.push({ ...d, qty: round4(qty) });
  }

  if(problems.length) return { ok: false, problems };
  return { ok: true, problems: [], value: { job_id: job.id, type, moved_on, note, lines } };
}

/* One job card's material account: what its BOM calls for, what has gone to
   it, what came back, and what is still to issue.
 *
 * `net` is issued less returned — what the job has kept. That is the closest
 * thing to "used" the store can know: the app does not measure what the floor
 * actually consumed, so it is not called consumption. */
export function cardLedger(job, article, movements, stockMeta = {}, materials = {}){
  const lines = ((job || {}).card || {}).lines || [];
  const required = materialTotals(lines, article || {});
  const moved = netByMaterial(movements || []);
  const rows = [];
  const push = (key, on_bom) => {
    const need = round4(num(required[key]));
    const m = moved[key] || { issued: 0, returned: 0, net: 0 };
    const meta = (stockMeta || {})[key];
    rows.push({ ...describe(key, materials), on_bom,
      mode: effectiveIssueMode(meta), mode_set: issueModeOf(meta) != null,
      required: need, issued: m.issued, returned: m.returned, net: m.net,
      balance: round4(Math.max(0, need - m.net)),
      excess: on_bom ? round4(Math.max(0, m.net - need)) : 0 });
  };
  /* The BOM's own order first, then anything issued that the BOM never asked
     for — shown, not hidden: it is exactly what the store needs to see. */
  for(const key of Object.keys(required)) if(num(required[key]) > 0) push(key, true);
  for(const key of Object.keys(moved)) if(!(num(required[key]) > 0)) push(key, false);

  const bom = rows.filter(r => r.on_bom);
  return {
    job_id: (job || {}).id,
    rows,
    has_card: lines.length > 0,
    /* A card with pairs on it and no BOM behind them has NOTHING the store
       can check it against — said, rather than shown as "fully issued". */
    no_bom: lines.length > 0 && bom.length === 0,
    nothing_recorded: !(movements || []).length,
    fully_issued: bom.length > 0 && bom.every(r => r.balance <= EPS),
    pending: bom.filter(r => r.balance > EPS).length,
    unplanned: rows.filter(r => !r.on_bom).length,
  };
}

/* What the keeper should know before saving. Never a refusal.
   The stock compared against is the REGISTER's balance — opening + received -
   issued — not `material.stock` on its own, which is only the opening figure
   for a material whose movements have not been folded back into it. */
export function movementWarnings(value, ledger, materials = {}, stockMeta = {}){
  if(!value || value.type !== "issue") return [];
  const byKey = Object.fromEntries(((ledger || {}).rows || []).map(r => [r.material_key, r]));
  const out = [];
  for(const line of value.lines || []){
    const row = byKey[line.material_key];
    if(!row || !row.on_bom)
      out.push(`${line.name} is not on this card's BOM.`);
    else if(row.net + line.qty > row.required + EPS)
      out.push(`${line.name}: this takes the card to ${round4(row.net + line.qty)} ${line.uom} `
        + `against a BOM requirement of ${row.required}.`);
    const stock = balanceOf((materials || {})[line.material_key] || {}, (stockMeta || {})[line.material_key] || {});
    if(line.qty > stock + EPS)
      out.push(`${line.name}: the register shows ${round4(stock)} ${line.uom} in stock, and ${line.qty} is being issued.`);
  }
  return out;
}

/* Book movements onto the register. MUTATES `ref` — it is called on the copy a
   transaction has locked, so the figure the keeper saw cannot be the figure
   that is overwritten. An issue adds to the register's Issued total and a
   return takes it off again; Stock = Opening + Received - Issued throughout.
   A material that has since left the register is skipped and reported. */
export function bookMovements(ref, type, lines){
  const missing = [];
  ref.stock_meta = ref.stock_meta || {};
  const sign = type === "return" ? -1 : 1;
  for(const line of lines || []){
    const key = line.material_key;
    const material = (ref.materials || {})[key];
    if(!material){ missing.push(key); continue; }
    const meta = { ...(ref.stock_meta[key] || {}) };
    /* A material whose only figure came from the BOM upload has no movement
       record yet; that figure becomes its opening balance, as it does for a
       receipt, instead of being rebuilt from zero. */
    if(meta.opening == null && meta.rec == null && meta.issue == null) meta.opening = num(material.stock);
    meta.issue = round4(num(meta.issue) + sign * num(line.qty));
    ref.stock_meta[key] = meta;
    material.stock = round4(num(meta.opening) + num(meta.rec) - num(meta.issue));
  }
  return { missing };
}

/* May this movement be undone? An issue that later returns were made against
   cannot simply vanish — the card would be left having returned material it
   never took. Returns the reason, or null when it is safe. */
export function undoProblem(movement, sameJob){
  if(!movement || movement.type !== "issue") return null;
  const rest = (sameJob || []).filter(m => String(m.id) !== String(movement.id));
  const after = (netByMaterial(rest)[movement.material_key] || { net: 0 }).net;
  if(after < -EPS)
    return text(`${movement.name || nameOf(movement.material_key)}: ${round4(-after)} ${movement.uom || ""} `
      + `has been returned against this issue. Undo the return first.`);
  return null;
}

/* Where one material went: job card by job card, most recent first. */
export function materialTrail(movements, materialKey){
  const byJob = new Map();
  for(const m of movements || []){
    if(m.material_key !== materialKey) continue;
    const row = byJob.get(m.job_id) || { job_id: m.job_id, fabricator: m.fabricator || "",
      article: m.article || "", order_no: m.order_no || "", issued: 0, returned: 0, net: 0, last_on: "" };
    if(m.type === "return") row.returned = round4(row.returned + num(m.qty));
    else row.issued = round4(row.issued + num(m.qty));
    row.net = round4(row.issued - row.returned);
    if(String(m.moved_on || "") > row.last_on) row.last_on = String(m.moved_on || "");
    byJob.set(m.job_id, row);
  }
  return [...byJob.values()].sort((a, z) => z.last_on.localeCompare(a.last_on) || num(z.job_id) - num(a.job_id));
}
