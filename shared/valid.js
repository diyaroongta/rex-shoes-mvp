/* Input checks that Postgres would otherwise make for us — as a 500.
   A date the database cannot read, or a count past its integer column, used to
   reach the INSERT and come back as a bare "Server error". The person typing
   it cannot tell that from the app being broken, so every validator that
   writes a date or a quantity checks it HERE first and names the field. */

/* A REAL calendar day in YYYY-MM-DD. The shape alone is not enough:
   2026-13-40 has the right shape and Postgres refuses it, and 02/11/2026 is
   read by the server's date style as 11 FEBRUARY and saved without complaint. */
export function isRealDate(value){
  const s = String(value == null ? "" : value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/* Postgres `integer`. A quantity past it is a typing slip, never a real order. */
export const MAX_INT = 2147483647;
export const fitsInteger = n => Number.isFinite(Number(n)) && Math.abs(Number(n)) <= MAX_INT;

/* THE DAY A STORED DATE MEANS, as YYYY-MM-DD.
   A Postgres `date` reaches the browser as a TIMESTAMP — midnight in the
   server's own zone, so "2026-11-10T00:00:00.000Z" from a UTC server and
   "2026-11-09T18:30:00.000Z" from one in India are the same day. Printing it
   raw put that string on the Job Orders Database and on the issue slip;
   slicing its first ten characters is right on one server and a day early on
   the other. A plain date is returned as it is; a timestamp is read as the
   local day it falls on, which is the day that was keyed. */
export function localDay(value){
  if(value == null || value === "") return "";
  if(!(value instanceof Date)){
    const s = String(value).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    value = new Date(s);
    if(isNaN(value)) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
  }
  if(isNaN(value)) return "";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

