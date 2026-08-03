import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { INPUTS } from "../shared/inputs.js";

/* Day offsets from the order date by which each stage should be finished.
   These decide On track / At risk / Delayed — they are the factory's promise
   to its customers, so they belong in editable settings, not in code. */
/* PI deduction ladder. Order matters — each step applies to the running
   balance left by the one before it. */
const DEFAULT_PI_TERMS = {
  discount_pct: 40,
  deductions: [ { label:"F.O.R.", pct:2 }, { label:"Cash Discount", pct:3 }, { label:"GST Dis", pct:4.760 } ],
  gst_pct: 5, gst_label:"GST", payment_split_pct: 50, dispatch_timeline:"45 days",
};

const DEFAULT_TARGETS = { CUTTING:8, STITCHING:15, PRINTING:18, MOLDING:22, ASSEMBLY:22, PACKING:28, DISPATCH:30 };

const DEFAULTS = () => {
  const capacities = {};
  for(const [k, w] of Object.entries(INPUTS.workcenters)) capacities[k] = w.capacity_per_day;
  return { capacities, sla_targets: DEFAULT_TARGETS, pi_terms: DEFAULT_PI_TERMS };
};

export default wrap(async (req, res) => {
  if(req.method === "GET"){
    const { rows } = await q("select value from settings where id = 1");
    return res.status(200).json(rows.length ? rows[0].value : DEFAULTS());
  }

  if(req.method === "PUT"){
    const patch = req.body || {};
    const existing = await q("select value from settings where id = 1");
    const prev = existing.rows.length ? existing.rows[0].value : {};
    const caps = patch.capacities || {};
    // Only accept known work centres, and only sane positive integers.
    const clean = {};
    for(const [k, v] of Object.entries(caps)){
      if(!INPUTS.workcenters[k]) return fail(res, 400, `unknown work centre: ${k}`);
      const n = Math.round(Number(v));
      if(!Number.isFinite(n) || n < 1) return fail(res, 400, `capacity for ${k} must be >= 1`);
      clean[k] = n;
    }
    const targets = {};
    for(const [k, v] of Object.entries(patch.sla_targets || {})){
      if(!(k in DEFAULT_TARGETS)) return fail(res, 400, `unknown stage: ${k}`);
      const n = Math.round(Number(v));
      if(!Number.isFinite(n) || n < 0) return fail(res, 400, `target for ${k} must be 0 or more`);
      targets[k] = n;
    }
    const base = DEFAULTS();
    const value = { ...base,
      capacities:  { ...base.capacities,  ...clean },
      sla_targets: { ...base.sla_targets, ...targets } };

    // Proforma Invoice terms and letterhead. Percentages are validated; the
    // deduction ladder is stored in order, since each step applies to the
    // running balance and re-ordering it changes the total.
    if(req.body.pi_terms && typeof req.body.pi_terms === "object"){
      const t = req.body.pi_terms;
      for(const k of ["discount_pct","gst_pct","payment_split_pct"]){
        if(t[k] == null) continue;
        const n = Number(t[k]);
        if(!isFinite(n) || n < 0 || n > 100) return fail(res, 400, `${k} must be between 0 and 100`);
      }
      if(t.deductions && !Array.isArray(t.deductions)) return fail(res, 400, "deductions must be a list");
      for(const d of (t.deductions || [])){
        const n = Number(d.pct);
        if(!d.label || !isFinite(n) || n < 0 || n > 100)
          return fail(res, 400, "each deduction needs a label and a percentage between 0 and 100");
      }
      value.pi_terms = { ...(base.pi_terms || {}), ...t };
    } else if(prev.pi_terms) value.pi_terms = prev.pi_terms;

    if(req.body.pi_config && typeof req.body.pi_config === "object")
      value.pi_config = req.body.pi_config;
    else if(prev.pi_config) value.pi_config = prev.pi_config;
    await q(`insert into settings (id, value) values (1, $1)
             on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify(value)]);
    return res.status(200).json(value);
  }

  return fail(res, 405, `${req.method} not allowed`);
});
