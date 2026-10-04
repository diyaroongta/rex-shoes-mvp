/* JOB CARD FILLED % — the weekly check the factory asked for.
 *
 * A job card goes out on paper and has to come BACK filled in (received,
 * rejected, repair, cartons, signatures). It counts as RECEIVED once a photo
 * of the completed card is filed against it. For a week:
 *
 *   issued    job cards issued that week (cancelled cards and samples excluded)
 *   received  of those, how many have a completed-card photo on file
 *   open      issued − received
 *   pct       received / issued, null when nothing was issued
 *
 * Pure: the week is passed in.
 */
export const jobIdOfUnit = unitKey => { const m = /#JC(\d+)$/.exec(String(unitKey || "")); return m ? Number(m[1]) : null; };

export function jobCardFill(jobs = [], docs = [], from = "", to = ""){
  const withPhoto = new Set((docs || []).map(d => Number(d.job_id)).filter(Number.isFinite));
  const inWeek = (jobs || []).filter(j => !j.cancelled && !j.sample
    && String(j.issued_on || "").slice(0, 10) >= from && String(j.issued_on || "").slice(0, 10) <= to);
  const received = inWeek.filter(j => withPhoto.has(Number(j.id)));
  const open = inWeek.filter(j => !withPhoto.has(Number(j.id)));
  /* Everything still out without a filled card, whatever week it went out —
     a card from three weeks ago that never came back is the one to chase. */
  const outstanding = (jobs || []).filter(j => !j.cancelled && !j.sample && !withPhoto.has(Number(j.id))
    && String(j.issued_on || "").slice(0, 10) <= to);
  return { from, to, issued: inWeek.length, received: received.length, open: open.length,
    pct: inWeek.length ? Math.round(1000 * received.length / inWeek.length) / 10 : null,
    open_cards: open.map(j => ({ id:j.id, card_no:(j.card && j.card.card_no) || `#${j.id}`, order_no:j.order_no, article:j.article, issued_on:j.issued_on })),
    outstanding: outstanding.length };
}
