/* The stitching lines, in one board: the factory's own lines and the job
 * workers outside, side by side.
 *
 * `withFabricators` in job-work.js answers "how much is out with each name",
 * and it is built from the JOBS — so a line with nothing on it today does not
 * appear at all. A line layout has to show the idle line too: an empty line is
 * the most useful thing on the board, because it is the one that can take the
 * next card.
 *
 * The lines themselves are never invented. This lists the fabricator master,
 * so the board has four lines when the factory has entered four and says how
 * many are set up when it has fewer.
 *
 * Pure: no database, no clock.
 */
import { withFabricators } from "./job-work.js";
import { TYPE_LABEL } from "./fabricators.js";

const clean = v => String(v == null ? "" : v).trim();
const ORDER = { internal_line: 0, external: 1, sample: 2 };

/* One row per active fabricator, loaded or idle, internal lines first. */
export function lineBoard(fabricators = [], jobs = []){
  /* withFabricators returns a LIST, sorted by what is out. Keyed by name here
     so an idle line can be looked up and still be given a row. */
  const load = Object.fromEntries(withFabricators(jobs || []).map(l => [l.fabricator, l]));
  const seen = new Set();

  const rows = (fabricators || [])
    .filter(f => f && f.active !== false)
    .map(f => {
      const name = clean(f.name);
      seen.add(name);
      const l = load[name] || {};
      return {
        fabricator: name,
        type: f.type || "",
        type_label: TYPE_LABEL[f.type] || f.type || "",
        issued: l.issued || 0,
        received: l.received || 0,
        /* Still with them: issued and not back, on OPEN jobs only. A closed
           job's balance was written off as a shortage and is not out there. */
        with_them: l.with_them || 0,
        shortage: l.shortage || 0,
        open_jobs: l.open_jobs || 0,
        idle: !(l.open_jobs > 0),
      };
    });

  /* A name on a job that is no longer in the master — deactivated, renamed —
     still has pairs against it, and dropping the row would lose them. */
  for(const [name, l] of Object.entries(load)){
    if(seen.has(name)) continue;
    rows.push({ fabricator: name, type: l.type || "", type_label: TYPE_LABEL[l.type] || l.type || "",
      issued: l.issued || 0, received: l.received || 0, with_them: l.with_them || 0,
      shortage: l.shortage || 0, open_jobs: l.open_jobs || 0, idle: !(l.open_jobs > 0),
      not_in_master: true });
  }

  rows.sort((a, z) =>
    (ORDER[a.type] ?? 9) - (ORDER[z.type] ?? 9) ||
    z.with_them - a.with_them ||
    a.fabricator.localeCompare(z.fabricator));

  const internal = rows.filter(r => r.type === "internal_line");
  return {
    rows,
    internal_lines: internal.length,
    idle_lines: internal.filter(r => r.idle).length,
    totals: rows.reduce((t, r) => ({
      issued: t.issued + r.issued, received: t.received + r.received,
      with_them: t.with_them + r.with_them, shortage: t.shortage + r.shortage,
      open_jobs: t.open_jobs + r.open_jobs,
    }), { issued:0, received:0, with_them:0, shortage:0, open_jobs:0 }),
  };
}
