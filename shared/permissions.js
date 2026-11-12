/* Who may do what.
 *
 * Pure and dependency-free, because BOTH sides need it: the server enforces it
 * (the only place that counts) and the browser reads it to decide which
 * screens to show. Two copies of this logic would drift, and the drift would
 * show up as a screen that exists but whose every button returns 403.
 *
 * The roles are the factory's own, from their access list. A role is defined by
 * TWO things and nothing else:
 *
 *   tabs    which screens it may open
 *   writes  which endpoints it may change
 *
 * Reading follows `tabs` — a role that cannot open a screen has no business
 * reading its data. Everything not listed is DENIED, so a new endpoint is
 * admin-only until somebody classifies it, and a shape test fails the build
 * until they do.
 *
 * A dispatch clerk who records a shipment but must not raise an invoice is the
 * case this exists for. Three coarse roles could not express it: "planner"
 * could edit orders, PIs, dispatch and stock all at once.
 */

const ALL_WRITES = ["orders","pis","dispatches","reference","catalogue","parties",
                    "settings","read-order-photo","read-pi","copilot"];

/* Reference data carries two very different things behind one endpoint. Stock
   figures are a daily clerical job; the BOM is master data whose every error
   repeats across all future orders. A role gets one, the other or neither —
   judged on the body keys, not on the endpoint. */
const STOCK_KEYS = ["stock","stock_meta"];
/* Creating a material is MASTER data — it enters BOMs, netting and the buying
   list — but the person who discovers a material is missing is the store keeper
   unpacking a delivery, not the data manager. Refusing them makes the feature
   useless to the only people who need it. So it is allowed alongside stock, and
   ONLY as a creation: editing or deleting a material stays master data. */
const MATERIAL_KEYS = ["new_material","new_materials"];
/* The PLAN, as opposed to the order. Both are single-key PATCHes from the
   scheduling screens: the queue position and the manual override blob. */
const PLAN_KEYS = ["plan_override","priority"];

const EVERY_TAB = ["mis","intake","pis","orders","jobs","jobwork","status","upper_store","repair","dispatch","gatepass","finished","formats","schedule",
                   "production_input","plan","machines","stock_add","stock_issue","stock","procurement","material_new","parties","fabricators",
                   "catalogue","rules","data","copilot"];

export const ROLE_DEFS = {
  admin: {
    label:"Master",
    summary:"Sees and changes everything, including the article master, BOM, parties, capacities, "
      +"and every login: who has an account, what access it has, and resetting its password.",
    tabs:"all", writes:"all", reference:"all",
  },
  owner: {
    label:"Director (view only)",
    summary:"Sees the whole factory — production, dispatch, stocks, restocking. Changes nothing.",
    tabs:"all", writes:[], reference:null,
  },
  /* Client, 11-Nov-2026: "can see only MIS reports, order taking and orders
     pending — no viewership or access to production related tabs". Finished
     goods went with that: it is the production floor's output ledger. */
  sales: {
    label:"Sales Head",
    summary:"MIS reports, order taking and pending orders. Raises PIs and bulk orders and keeps customers' terms. "
      +"No production screens.",
    tabs:["mis","intake","pis","orders","parties","copilot"],
    writes:["orders","pis","parties","read-order-photo","read-pi","copilot"], reference:null,
  },
  dispatch: {
    label:"Dispatch Executive",
    summary:"Records dispatches and updates finished-goods stock; sees pending orders and order sheets. "
      +"Cannot raise or change an order.",
    /* The order book and the packing rules are READ here: you cannot pack a
       shipment without seeing what was ordered and how it packs. Writing is
       confined to dispatch. */
    /* Repair is the last thing that happens to a shoe before it goes on the
       lorry, so it belongs to whoever is packing it. */
    /* Gate passes: the slip for the lorry this role just packed. Saving its
       SR. No is a write to dispatches, which this role already has. */
    /* Client, 11-Nov-2026: "can update dispatch stock (fg stocks), can record
       dispatches, see pending orders, see order sheets". The finished-goods
       ledger rides on /api/dispatches, so the one grant covers both. No MIS. */
    tabs:["orders","pis","dispatch","gatepass","finished","repair","formats","rules"],
    writes:["dispatches"], reference:null,
  },
  /* The planner was once narrowed to "edit the PLAN, not the ORDER"
     (`orders:"plan"`, judged on the body keys). The client's 11-Nov-2026 list
     gives the planner order taking and dispatch outright, so it is
     `orders:"all"` now; `"plan"` remains available for a role that should
     re-sequence work without touching what was ordered. */
  planner: {
    label:"Production Planner",
    /* Client, 11-Nov-2026: sees order taking, order planning, material
       procurement, machine planning, recording production and dispatch,
       updating stocks. Cannot see MIS reports, change machine capacities
       (`settings` is not granted) or change existing BOMs (`reference` is the
       stock grant only — never the BOM). `orders:"all"` is the whole order
       endpoint AND the plan, as opposed to `"plan"`, which is the plan alone. */
    summary:"Order taking, planning, job orders, procurement, machine planning, recording production and "
      +"dispatch, and stock updates. Cannot see the MIS, change machine capacities or change a BOM.",
    tabs:["intake","pis","orders","jobs","jobwork","schedule","production_input","status","upper_store","plan","machines",
          "dispatch","gatepass","finished","repair","stock_add","stock_issue","stock","procurement","material_new",
          "formats","rules"],
    writes:["orders","pis","dispatches","read-order-photo","read-pi"], orders:"all",
    production_actuals:true, stock_plan:true, reference:"stock", purchase_orders:"all", upper_store:"record",
  },
  procurement: {
    label:"Procurement Officer",
    summary:"Works the buying list and records what has come in. Cannot change a BOM.",
    tabs:["mis","stock_add","stock","procurement","material_new","orders","schedule","formats"],
    writes:[], reference:"stock", purchase_orders:"all",
  },
  /* The upper store too: uppers in from stitching, out to pasting and
     moulding, and counted. A count that disagrees with the book goes in as a
     PENDING adjustment — the keeper who counted cannot approve it. */
  store: {
    label:"Store / Inventory Keeper",
    summary:"Stock in, stock out and physical counts. Nothing else.",
    tabs:["stock_add","stock_issue","stock","procurement","material_new","upper_store","formats"],
    writes:[], reference:"stock", purchase_orders:"receive", upper_store:"record",
  },
  /* "Stock adjustment needs store in-charge approval" — the client's own rule
     for the upper store, which needs somebody to BE the in-charge. Everything
     the store keeper does, plus approving a count adjustment. */
  store_incharge: {
    label:"Store In-charge",
    summary:"Runs the stores: everything the store keeper does, and approves stock adjustments.",
    tabs:["upper_store","stock_add","stock_issue","stock","procurement","material_new","formats"],
    writes:[], reference:"stock", purchase_orders:"receive", upper_store:"approve",
  },
  data: {
    label:"Catalogue & BOM Data Manager",
    summary:"Owns the article master: BOM workbooks, sizes, packing and MRP.",
    tabs:["mis","catalogue","rules","data","fabricators","stock","procurement","material_new"],
    writes:["catalogue"], reference:"all",
  },
  auditor: {
    label:"Auditor / Consultant",
    summary:"Reads the dashboard and the change history. No edit rights at all.",
    tabs:["mis","orders","pis","status","upper_store","repair","dispatch","gatepass","finished","schedule","procurement","stock","data"],
    writes:[], reference:null,
  },
  /* Kept because accounts already carry it, and because "sees everything,
     changes nothing" is a genuinely useful thing to hand out. */
  viewer: {
    label:"Viewer (read-only)",
    summary:"Sees the factory but cannot change anything.",
    tabs:"all", writes:[], reference:null,
  },
};

export const ROLES = Object.keys(ROLE_DEFS);
export const ROLE_LABEL = Object.fromEntries(ROLES.map(r => [r, ROLE_DEFS[r].label]));
export const ROLE_SUMMARY = Object.fromEntries(ROLES.map(r => [r, ROLE_DEFS[r].summary]));

/* The factory's recommended eleven named users. These are seat targets, not
   placeholder accounts: a login is only created after an administrator gives
   it a real person's name, username and temporary password. */
export const RECOMMENDED_USER_COUNTS = Object.freeze({
  admin:1,
  owner:3,
  sales:1,
  dispatch:1,
  planner:1,
  procurement:1,
  store:1,
  data:1,
  auditor:1,
});

export const KNOWN_ENDPOINTS = new Set([...ALL_WRITES, "auth"]);

const OPEN = new Set(["auth"]);
const READ_METHODS = new Set(["GET","HEAD","OPTIONS"]);

/* "/api/orders/JO1?all=1" -> "orders". The endpoint is the first segment after
   /api, which is exactly how the files under api/ are laid out. */
export function endpointOf(url){
  const path = String(url || "").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const i = parts.indexOf("api");
  return (i >= 0 ? parts[i + 1] : parts[0]) || "";
}

const defOf = role => ROLE_DEFS[role] || null;

/* ONE ACCOUNT, SEVERAL ROLES. A sales head who also sits on the board, or a
   planner who also records dispatch, is given both roles rather than a third
   invented one. The roles are stored in the existing `users.role` column as a
   comma-separated list ("sales,owner") — a single role is just a list of one,
   so every account that already exists reads exactly as before.
   The account may do whatever ANY of its roles may do: each exported check
   below asks the single-role version once per role. Unrecognised entries are
   dropped, and a list with nothing recognised in it is still refused
   everything — the fail-closed rule does not loosen because a list is longer. */
export function rolesOf(role){
  const list = Array.isArray(role) ? role : String(role || "").split(",");
  return [...new Set(list.map(r => String(r).trim().toLowerCase()).filter(Boolean))];
}
const knownRoles = role => rolesOf(role).filter(r => ROLE_DEFS[r]);
/* A stored role value: known roles only, in ROLE_DEFS order, comma-joined.
   null when nothing recognisable was given. */
export function normalizeRoles(role){
  const set = new Set(knownRoles(role));
  const out = ROLES.filter(r => set.has(r));
  return out.length ? out.join(",") : null;
}
export const hasRole = (role, wanted) => knownRoles(role).includes(wanted);
export const rolesLabel = role => {
  const list = knownRoles(role);
  return list.length ? list.map(r => ROLE_DEFS[r].label).join(" + ") : String(role || "");
};
const anyRole = (role, fn) => knownRoles(role).some(fn);

export function canSeeTab(role, tab){
  return anyRole(role, r => canSeeTabOne(r, tab));
}
function canSeeTabOne(role, tab){
  const def = defOf(role);
  if(!def) return false;
  if(tab === "profiles") return role === "admin";
  return def.tabs === "all" ? EVERY_TAB.includes(tab) : def.tabs.includes(tab);
}

/* May this role make this request? Returns {allowed} or {allowed:false, reason}
   where the reason is written to be shown to the person who hit it. */
export function can(role, method, url, body){
  if(OPEN.has(endpointOf(url))) return { allowed:true };
  const list = knownRoles(role);
  if(!list.length) return canOne(null, method, url, body);
  let first = null;
  for(const r of list){
    const verdict = canOne(r, method, url, body);
    if(verdict.allowed) return verdict;
    first = first || verdict;
  }
  return first;
}
function canOne(role, method, url, body){
  const endpoint = endpointOf(url);
  const verb = String(method || "GET").toUpperCase();

  /* Checked BEFORE the role is validated. Signing out must work even for an
     account whose role is missing or unrecognised. */
  if(OPEN.has(endpoint)) return { allowed:true };

  const def = defOf(role);
  if(!def)
    return { allowed:false, reason:"Your account has no recognised role. Ask an administrator to set it." };

  if(READ_METHODS.has(verb)) return { allowed:true };
  if(def.writes === "all") return { allowed:true };

  /* Purchase orders ride on /api/reference only to avoid a thirteenth Vercel
     function. They are separately authorised: Procurement raises, edits,
     receives and cancels; Store may only receive goods against an existing
     PO. Neither permission grants access to BOM or MRP changes. */
  if(endpoint === "reference" && /(?:\?|&)resource=purchase_orders(?:&|$)/.test(String(url||""))){
    if(def.purchase_orders === "all") return {allowed:true};
    if(def.purchase_orders === "receive" && verb === "PATCH" && body?.action === "receive")
      return {allowed:true};
    return {allowed:false,reason:def.purchase_orders === "receive"
      ? "The Store can receive goods against a purchase order, but Procurement must raise, edit or cancel it."
      : `${def.label} cannot change purchase orders.`};
  }

  /* Material issues ride on /api/reference for the same twelve-function
     reason. Handing material over against a job card is the store's daily
     work, so it follows the stock grant — and nothing else: it is checked on
     the body as well as the URL, so it cannot be reached through, or used to
     reach, the BOM. Raising a job card books its own release on the server and
     needs no grant here. */
  if(endpoint === "reference" && (/(?:\?|&)resource=material_issues(?:&|$)/.test(String(url||""))
     || (body && body.resource === "material_issues"))){
    if(def.reference === "all" || def.reference === "stock") return {allowed:true};
    return {allowed:false,reason:`${def.label} cannot issue or take back material. That is the Store's.`};
  }

  /* The Raw Material Store's day register — received and issued, by date.
     The store's daily work, so it follows the stock grant exactly as material
     issues do, checked on the body as well as the URL. */
  if(endpoint === "reference" && (/(?:\?|&)resource=store_register(?:&|$)/.test(String(url||""))
     || (body && body.resource === "store_register"))){
    if(def.reference === "all" || def.reference === "stock") return {allowed:true};
    return {allowed:false,reason:`${def.label} cannot record receipts or issues in the store.`};
  }

  if(endpoint === "reference"){
    if(def.reference === "all") return { allowed:true };
    const keys = Object.keys(body || {});
    if(def.reference === "stock" && keys.length
       && keys.every(k => STOCK_KEYS.includes(k) || MATERIAL_KEYS.includes(k)))
      return { allowed:true };
    return { allowed:false, reason: def.reference === "stock"
      ? "You can update stock figures, but only a data manager or an administrator can change the BOM, packing or MRP."
      : `${def.label} cannot change the BOM or reference data.` };
  }

  /* A photo of the completed job card is filed by whoever records the day's
     production — the same person, the same moment. */
  if(endpoint === "dispatches" && /(?:\?|&)resource=job_card_docs(?:&|$)/.test(String(url||""))){
    if(def.production_actuals || def.writes.includes("dispatches")) return {allowed:true};
    return {allowed:false,reason:`${def.label} cannot file job-card photos.`};
  }
  /* The upper store rides on /api/dispatches for the twelve-function reason,
     but it is NOT dispatch work: a dispatch clerk's `dispatches` write must not
     reach it. Checked on the body as well as the URL so a resource smuggled in
     the body cannot fall through to that broader grant. Recording is the store
     keeper's; approving an adjustment (the only PATCH) is the in-charge's. */
  if(endpoint === "dispatches" && (/(?:\?|&)resource=upper_store(?:&|$)/.test(String(url||""))
     || (body && body.resource === "upper_store"))){
    if(def.upper_store === "approve") return {allowed:true};
    if(def.upper_store === "record"){
      if(verb === "PATCH")
        return {allowed:false,reason:"A stock adjustment needs the store in-charge's approval."};
      return {allowed:true};
    }
    return {allowed:false,reason:`${def.label} cannot change the upper store.`};
  }
  if(endpoint === "dispatches" && /(?:\?|&)resource=production_actuals(?:&|$)/.test(String(url||""))){
    if(def.production_actuals) return {allowed:true};
    return {allowed:false,reason:`${def.label} cannot record production achievement.`};
  }

  /* STOCK DECISIONS AND PARTY LOCKS — use ready stock for an order, or keep
     stock for one party. They ride on /api/dispatches for the twelve-function
     reason and are the planner's call, not the dispatch clerk's: checked here,
     before the generic `dispatches` grant, on the URL and the body both. */
  if(endpoint === "dispatches" && (/(?:\?|&)resource=stock_plan(?:&|$)/.test(String(url||""))
     || (body && body.resource === "stock_plan"))){
    if(def.stock_plan) return {allowed:true};
    return {allowed:false,reason:`Only the Production Planner or an administrator can reserve, release or lock stock. ${def.label} cannot.`};
  }

  /* THE SCHEDULE IS THE PLANNER'S. Moving, locking and re-planning a block is
     a `plan_override` PATCH on /api/orders, so a role with the whole endpoint
     (Sales) could otherwise drag the production board about. The factory's
     rule is Production Planner and Admin only. */
  if(endpoint === "orders" && body && typeof body === "object" && "plan_override" in body && def.orders !== "plan" && def.orders !== "all")
    return { allowed:false,
      reason:"Only the Production Planner or an administrator can move, lock or re-plan the schedule." };

  /* Edit the plan, not the order. A production planner re-sequences work and
     pins machines; creating, re-pricing or deleting an order belongs to
     Sales. */
  if(endpoint === "orders" && def.orders === "plan"){
    if(verb !== "PATCH")
      return { allowed:false, reason:`${def.label} can re-sequence production but cannot create or delete an order.` };
    const keys = Object.keys(body || {});
    if(keys.length && keys.every(k => PLAN_KEYS.includes(k))) return { allowed:true };
    return { allowed:false,
      reason:`${def.label} can change the plan — sequence, start date, machine, days — but not what was ordered.` };
  }

  if(def.writes.includes(endpoint)) return { allowed:true };

  return { allowed:false,
    reason: KNOWN_ENDPOINTS.has(endpoint)
      ? `${def.label} cannot change ${LABEL[endpoint] || endpoint}. Ask an administrator if you need to.`
      : "Your role does not allow this action." };
}

const LABEL = {
  orders:"orders", pis:"proforma invoices", dispatches:"dispatch records",
  catalogue:"the article master", parties:"customers and their terms",
  settings:"machine capacities and delivery targets", reference:"the BOM and reference data",
  "read-order-photo":"the order-slip reader", "read-pi":"the PI reader", copilot:"the copilot",
};

/* The first screen a role is actually allowed to open, so nobody is dropped
   onto a tab that is not theirs. */
export function defaultTab(role){
  return defaultTabOne(knownRoles(role)[0]);
}
function defaultTabOne(role){
  const def = defOf(role);
  if(!def) return "mis";
  return def.tabs === "all" ? "mis" : (def.tabs[0] || "mis");
}

/* True when a role may change nothing at all. */
export function isReadOnly(role){
  return !anyRole(role, r => !isReadOnlyOne(r));
}
function isReadOnlyOne(role){
  const def = defOf(role);
  if(!def) return true;
  /* `orders` counts: a production planner writes nothing on the ORDER but does
     change the PLAN, so calling them read-only would be wrong on screen and
     would hide the controls they are meant to use. */
  return def.writes !== "all" && def.writes.length === 0
    && !def.reference && !def.orders && !def.production_actuals && !def.upper_store;
}

/* What this role may do in the upper store: "approve" (everything, including
   approving a count adjustment), "record", or null for read-only. */
/* May this role move, lock and re-plan blocks on the production board? */
export function canEditSchedule(role){
  return anyRole(role, canEditScheduleOne);
}
function canEditScheduleOne(role){
  const def = defOf(role);
  return !!def && (def.writes === "all" || def.orders === "plan" || def.orders === "all");
}

/* May this role decide an order's stock, and lock stock to a party? */
export function canDecideStock(role){
  return anyRole(role, canDecideStockOne);
}
function canDecideStockOne(role){
  const def = defOf(role);
  return !!def && (def.writes === "all" || !!def.stock_plan);
}

export function upperStoreAccess(role){
  const levels = knownRoles(role).map(upperStoreAccessOne);
  return levels.includes("approve") ? "approve" : levels.includes("record") ? "record" : null;
}
function upperStoreAccessOne(role){
  const def = defOf(role);
  if(!def) return null;
  if(def.writes === "all") return "approve";
  return def.upper_store || null;
}
