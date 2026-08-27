/* Shared HTTP helpers. Deliberately free of any database or provider import so
   the AI endpoints don't drag the Postgres driver into their cold start. */
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

export function wrap(handler){
  return async (req, res) => {
    try { return await handler(req, res); }
    catch(e){
      console.error(req.method, req.url, e);
      // Setup problems are worth showing; anything else stays generic.
      const setup = SETUP_CODES.has(e && e.code)
        || /is not set|does not exist|provider \d+/.test(String(e && e.message));
      const msg = setup
        ? `${e.message}${SETUP_CODES.has(e && e.code)
            ? " — the database schema is out of date. Run: psql \"$DATABASE_URL\" -f db/schema.sql"
            : ""}`
        : "Server error";
      return fail(res, 500, msg);
    }
  };
}
