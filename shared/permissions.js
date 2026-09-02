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

const EVERY_TAB = ["mis","intake","pis","orders","jobs","jobcards","jobwork","dispatch","schedule",
                   "plan","machines","procurement","stock","parties","fabricators",
                   "catalogue","rules","data","copilot"];

export const ROLE_DEFS = {
  admin: {
    label:"Admin (IT)",
    summary:"Everything, including the article master, BOM, parties, capacities and accounts.",
    tabs:"all", writes:"all", reference:"all",
  },
  owner: {
    label:"Owner / Director",
    summary:"Sees the whole factory. Changes nothing.",
    tabs:"all", writes:[], reference:null,
  },
  sales: {
    label:"CRM / Sales",
    summary:"Raises PIs and bulk orders, and maintains customers and their terms.",
    tabs:["mis","intake","pis","orders","parties","copilot"],
    writes:["orders","pis","parties","read-order-photo","read-pi","copilot"], reference:null,
  },
  dispatch: {
    label:"Dispatch Executive",
    summary:"Records what shipped and how it was packed. Cannot raise or change an order.",
    /* The order book and the packing rules are READ here: you cannot pack a
       shipment without seeing what was ordered and how it packs. Writing is
       confined to dispatch. */
    tabs:["mis","orders","pis","dispatch","rules"],
    writes:["dispatches"], reference:null,
  },
  /* UNCHANGED from the three-role model. Accounts already carry it and it is
     the day-to-day operating role: orders, PIs, scheduling, dispatch, stock.
     The narrower roles below sit beside it rather than carving it up. */
  planner: {
    label:"Planner",
    summary:"Day-to-day production: orders, PIs, scheduling, dispatch and stock. "
      +"Cannot change the article master, BOM, parties or capacities.",
    tabs:["mis","intake","pis","orders","jobs","jobcards","jobwork","dispatch","schedule",
          "plan","machines","procurement","stock","copilot"],
    writes:["orders","pis","dispatches","read-order-photo","read-pi","copilot"],
    reference:"stock",
  },
  procurement: {
    label:"Procurement Officer",
    summary:"Works the buying list and records what has come in. Cannot change a BOM.",
    tabs:["mis","procurement","stock","orders","schedule"],
    writes:[], reference:"stock",
  },
  store: {
    label:"Store / Inventory Keeper",
    summary:"Stock in, stock out and physical counts. Nothing else.",
    tabs:["stock","procurement"],
    writes:[], reference:"stock",
  },
  data: {
    label:"Catalogue & BOM Data Manager",
    summary:"Owns the article master: BOM workbooks, sizes, packing and MRP.",
    tabs:["mis","catalogue","rules","data","fabricators","stock","procurement"],
    writes:["catalogue"], reference:"all",
  },
  auditor: {
    label:"Auditor / Consultant",
    summary:"Reads the dashboard and the change history. No edit rights at all.",
    tabs:["mis","orders","pis","dispatch","schedule","procurement","stock","data"],
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

export function canSeeTab(role, tab){
  const def = defOf(role);
  if(!def) return false;
  return def.tabs === "all" ? EVERY_TAB.includes(tab) : def.tabs.includes(tab);
}

/* May this role make this request? Returns {allowed} or {allowed:false, reason}
   where the reason is written to be shown to the person who hit it. */
export function can(role, method, url, body){
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

  if(endpoint === "reference"){
    if(def.reference === "all") return { allowed:true };
    const keys = Object.keys(body || {});
    if(def.reference === "stock" && keys.length && keys.every(k => STOCK_KEYS.includes(k)))
      return { allowed:true };
    return { allowed:false, reason: def.reference === "stock"
      ? "You can update stock figures, but only a data manager or an administrator can change the BOM, packing or MRP."
      : `${def.label} cannot change the BOM or reference data.` };
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
  const def = defOf(role);
  if(!def) return "mis";
  return def.tabs === "all" ? "mis" : (def.tabs[0] || "mis");
}

/* True when a role may change nothing at all. */
export function isReadOnly(role){
  const def = defOf(role);
  if(!def) return true;
  return def.writes !== "all" && def.writes.length === 0 && !def.reference;
}
