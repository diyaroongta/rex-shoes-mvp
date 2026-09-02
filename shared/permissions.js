/* Who may do what.
 *
 * Pure and dependency-free, because BOTH sides need it: the server enforces it
 * (the only place that counts) and the browser reads it to decide which
 * screens to show. Two copies of this logic would drift, and the drift would
 * show up as a screen that exists but whose every button returns 403.
 *
 * The shape is deliberately coarse. Roles that are easy to explain to the
 * person handing out accounts are roles that get handed out correctly:
 *
 *   admin    everything, including the article master, BOM, parties and
 *            capacities — the settings that silently change every future
 *            order if they are wrong
 *   planner  the daily job: raise orders and PIs, plan and re-sequence
 *            production, record dispatch, keep stock figures current
 *   viewer   look at everything, change nothing
 *
 * Anything not listed is DENIED. A new endpoint is invisible to planner and
 * viewer until someone decides where it belongs, which is the safe direction
 * to fail — and a shape test asserts every endpoint has been considered.
 */

export const ROLES = ["admin", "planner", "viewer"];

export const ROLE_LABEL = {
  admin:   "Administrator",
  planner: "Planner",
  viewer:  "Viewer (read-only)",
};

export const ROLE_SUMMARY = {
  admin:   "Full access, including the article master, BOM, parties and machine capacities.",
  planner: "Day-to-day production: orders, PIs, scheduling, dispatch and stock. Cannot change the article master, BOM, parties or capacities.",
  viewer:  "Can see the factory but cannot change anything.",
};

/* Endpoints a planner may WRITE to. Reads are open to every signed-in role,
   so this list is only about POST/PUT/PATCH/DELETE. */
const PLANNER_WRITES = new Set([
  "orders",              // raise, edit, re-sequence, delete
  "pis",                 // issue, revise, release into production, archive
  "dispatches",          // packing reports
  "read-order-photo",    // reading a handwritten slip is part of raising an order
  "read-pi",
  "copilot",
]);

/* Everything else that accepts writes is admin-only: it is master data, and a
   wrong value there is not one bad order but every future order. */
const ADMIN_WRITES = new Set([
  "reference",           // BOM upload, bulk removal, packing, MRP, sole type
  "catalogue",           // the article master itself
  "parties",             // agreed commercial terms
  "settings",            // capacities, SLA targets, PI deduction ladder
]);

/* Reachable without a session, or self-service for the signed-in user. */
const OPEN = new Set(["auth"]);

/* Every endpoint the app has. The shape test compares this against the api/
   directory, so adding a file without deciding its policy fails the build. */
export const KNOWN_ENDPOINTS = new Set([
  ...PLANNER_WRITES, ...ADMIN_WRITES, ...OPEN,
]);

/* Reference data carries two very different things behind one endpoint. Stock
   figures are a daily clerical job; the BOM is master data. Splitting them by
   body key rather than by endpoint keeps the planner able to do the first
   without opening the second. */
const PLANNER_REFERENCE_KEYS = new Set(["stock", "stock_meta"]);

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/* "/api/orders/JO1?all=1" -> "orders". The endpoint is the first segment after
   /api, which is exactly how the files under api/ are laid out. */
export function endpointOf(url){
  const path = String(url || "").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const i = parts.indexOf("api");
  return (i >= 0 ? parts[i + 1] : parts[0]) || "";
}

/* May this role make this request? Returns {allowed} or {allowed:false, reason}
   where the reason is written to be shown to the person who hit it. */
export function can(role, method, url, body){
  const endpoint = endpointOf(url);
  const verb = String(method || "GET").toUpperCase();

  /* Checked BEFORE the role is validated. Signing out must work even for an
     account whose role is missing or unrecognised — otherwise a bad role locks
     someone into a session they cannot end. */
  if(OPEN.has(endpoint)) return { allowed:true };

  if(!ROLES.includes(role))
    return { allowed:false, reason:"Your account has no recognised role. Ask an administrator to set it." };
  if(READ_METHODS.has(verb)) return { allowed:true };      // any signed-in role may read
  if(role === "admin") return { allowed:true };

  if(role === "viewer")
    return { allowed:false, reason:"Your account is read-only. Ask an administrator to change anything here." };

  // planner
  if(PLANNER_WRITES.has(endpoint)) return { allowed:true };

  if(endpoint === "reference"){
    const keys = Object.keys(body || {});
    /* An empty body would otherwise sail through on a technicality. */
    if(keys.length && keys.every(k => PLANNER_REFERENCE_KEYS.has(k))) return { allowed:true };
    return { allowed:false,
      reason:"Only an administrator can change the article master, BOM, packing or MRP. Planners can update stock figures." };
  }

  if(ADMIN_WRITES.has(endpoint))
    return { allowed:false, reason:`Only an administrator can change ${LABEL[endpoint] || endpoint}.` };

  return { allowed:false, reason:"Your role does not allow this action." };
}

const LABEL = {
  catalogue: "the article master",
  parties:   "customers and their commercial terms",
  settings:  "machine capacities and delivery targets",
  reference: "the BOM and reference data",
};

/* ---- what the browser shows ---- */

/* Screens a role may open. A screen whose every control is refused is worse
   than one that is not offered: it reads as a broken app rather than as a
   permission. Setup screens are therefore hidden rather than disabled. */
const VIEWER_TABS = new Set([
  "mis", "pis", "orders", "dispatch", "schedule", "plan", "machines", "procurement", "stock",
]);
const PLANNER_TABS = new Set([
  /* "bulk" is not listed: bulk upload is a mode INSIDE PI generation now, not
     a screen of its own, so it is governed by access to "intake".
     "jobs" is releasing PI quantities into production — squarely the
     planner's job, and the reason the role exists. */
  ...VIEWER_TABS, "intake", "jobs", "copilot",
]);

export function canSeeTab(role, tab){
  if(role === "admin") return true;
  if(role === "planner") return PLANNER_TABS.has(tab);
  if(role === "viewer") return VIEWER_TABS.has(tab);
  return false;
}

/* The first screen a role is actually allowed to open, so a viewer is never
   dropped onto a tab that is not theirs. */
export function defaultTab(role){
  return canSeeTab(role, "mis") ? "mis" : "orders";
}

export const isReadOnly = role => role === "viewer";
