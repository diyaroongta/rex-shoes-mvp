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
