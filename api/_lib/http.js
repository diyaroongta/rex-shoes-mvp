/* Shared HTTP helpers. Deliberately free of any database or provider import so
   the AI endpoints don't drag the Postgres driver into their cold start.
   api/_lib/auth.js observes the same rule, which is why the session guard
   below can live here at all. */
import { authSecret, sessionOf } from "./auth.js";
import { can } from "../../shared/permissions.js";

export function fail(res, status, message){
  return res.status(status).json({ error: message });
}
/* Postgres classes that always mean "the schema has not been applied", never a
   bad request. Matching on the CODE rather than the message is what makes this
   reliable: the old regex caught "relation ... does not exist" but not
   "column ... does not exist", so adding a column to schema.sql and forgetting
   to run it surfaced as a bare "Server error" with nothing to act on. */
const SETUP_CODES = new Set([
  "42P01",  // undefined_table
  "42703",  // undefined_column
  "42883",  // undefined_function
  "42704",  // undefined_object (sequence, type)
  "3F000",  // invalid_schema_name
]);

/* Every endpoint requires a signed-in user. The check lives HERE, not in each
   handler, because the one thing that must not be possible is adding an
   endpoint and forgetting to protect it — the whole order book, every PI and
   the metered AI calls sit behind these functions on a public URL.
   `wrap(handler, { public:true })` is the deliberate opt-out, and only
   api/auth.js takes it. */
export function wrap(handler, opts = {}){
  return async (req, res) => {
    try {
      if(!opts.public){
        /* A missing or too-short AUTH_SECRET is a deployment fault, not a
           failed login. Saying so plainly is the difference between five
           minutes in the Vercel settings and an afternoon of guessing. */
        try { authSecret(); }
        catch(e){ return fail(res, 503, e.message); }
        const user = sessionOf(req);
        if(!user) return res.status(401).json({ error:"Sign in required", auth:"required" });
        req.user = user;

        /* Roles are enforced HERE for the same reason the session is: an
           endpoint must not be able to ship without a policy because someone
           forgot a line. shared/permissions.js denies anything it does not
           recognise, so a new endpoint is admin-only until it is classified.
           It is pure — no database — so it costs nothing on a cold start. */
        const verdict = can(user.role, req.method, req.url, req.body);
        if(!verdict.allowed)
          return res.status(403).json({ error: verdict.reason, role: user.role, forbidden:true });
      }
      return await handler(req, res);
    }
    catch(e){
      /* A value the DATABASE refused — a date it cannot read, a number past
         its column, a check constraint — is the request's fault, not the
         server's. Postgres says which in plain words, so it goes back as a
         400 with those words instead of a bare "Server error" that reads as
         the app being broken. Classes 22 (data exception) and 23 (integrity
         constraint) are exactly that set. */
      const code = String((e && e.code) || "");
      if(/^2[23][0-9A-Z]{3}$/.test(code)){
        console.error(req.method, req.url, e);
        return fail(res, 400, `The database refused this: ${e.message}`);
      }
      /* Anything else stays generic on screen, but carries a REFERENCE that
         is printed beside the full error in the server log. "Server error"
         alone could not be matched to any log line, so a fault the factory
         hit repeatedly could not be found. */
      const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
      console.error(`[ref ${ref}]`, req.method, req.url, e);
      // Setup problems are worth showing; anything else stays generic.
      const setup = SETUP_CODES.has(code)
        || /is not set|does not exist|provider \d+/.test(String(e && e.message));
      const msg = setup
        ? `${e.message}${SETUP_CODES.has(code)
            ? " — the database schema is out of date. Run: psql \"$DATABASE_URL\" -f db/schema.sql"
            : ""}`
        : `Server error (ref ${ref})`;
      return fail(res, 500, msg);
    }
  };
}
