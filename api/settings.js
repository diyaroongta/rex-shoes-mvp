import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { INPUTS } from "../shared/inputs.js";

/* Day offsets from the order date by which each stage should be finished.
   These decide On track / At risk / Delayed — they are the factory's promise
   to its customers, so they belong in editable settings, not in code. */
const DEFAULT_TARGETS = { CUTTING:8, STITCHING:15, PRINTING:18, MOLDING:22, ASSEMBLY:22, PACKING:28, DISPATCH:30 };

const DEFAULTS = () => {
  const capacities = {};
  for(const [k, w] of Object.entries(INPUTS.workcenters)) capacities[k] = w.capacity_per_day;
  return { capacities, sla_targets: DEFAULT_TARGETS };
};

export default wrap(async (req, res) => {
  if(req.method === "GET"){
    const { rows } = await q("select value from settings where id = 1");
    return res.status(200).json(rows.length ? rows[0].value : DEFAULTS());
  }

  if(req.method === "PUT"){
    const patch = req.body || {};
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
    await q(`insert into settings (id, value) values (1, $1)
             on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify(value)]);
    return res.status(200).json(value);
  }

  return fail(res, 405, `${req.method} not allowed`);
});
