/* Shared HTTP helpers. Deliberately free of any database or provider import so
   the AI endpoints don't drag the Postgres driver into their cold start. */
export function fail(res, status, message){
  return res.status(status).json({ error: message });
}
export function wrap(handler){
  return async (req, res) => {
    try { return await handler(req, res); }
    catch(e){
      console.error(req.method, req.url, e);
      // Setup problems are worth showing; anything else stays generic.
      const msg = /is not set|relation .* does not exist|provider \d+/.test(String(e.message))
        ? e.message
        : "Server error";
      return fail(res, 500, msg);
    }
  };
}
