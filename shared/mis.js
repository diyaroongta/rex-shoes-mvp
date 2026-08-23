/* Executive MIS calculations. Pure and date-injected so dashboard figures are
   deterministic in tests and can later be reused by an API/export without
   duplicating business logic in React. */

const DAY = 86400000;

const isoDay = value => {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

const dayNumber = value => {
  const iso = isoDay(value);
  return iso == null ? null : Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
};

const fromDayNumber = day => new Date(day * DAY).toISOString().slice(0, 10);

const sumObject = value => Object.values(value || {}).reduce((sum, item) => sum + (Number(item) || 0), 0);

const orderQuantity = order => Number(order && order.qty) || (order && order.lines || [])
  .reduce((sum, line) => sum + (Number(line.qty) || 0), 0);

const STATUS = {
  on_track: { key: "on_track", label: "On time" },
  at_risk: { key: "at_risk", label: "At risk" },
  breach: { key: "breach", label: "Delayed" },
};

function rangeFor(orders) {
  const dates = orders.map(o => isoDay(o.dispatch_date)).filter(Boolean).sort();
  return { from: dates[0] || null, to: dates[dates.length - 1] || null };
}

function worstStage(order) {
  const stages = Array.isArray(order.stages) ? order.stages : [];
  if (!stages.length) return null;
  return [...stages].sort((a, b) =>
    (Number(b.slip_days) || 0) - (Number(a.slip_days) || 0)
    || (Number(b.queue_wait_days) || 0) - (Number(a.queue_wait_days) || 0))[0];
}

function dispatchByOrder(dispatches) {
  const out = {};
  for (const event of dispatches || []) {
    const orderNo = String(event.order_no || "");
    if (!orderNo) continue;
    const rec = out[orderNo] || (out[orderNo] = {
      dispatched: 0, closesOrder: false, latestDate: null,
    });
    rec.dispatched += sumObject(event.dispatched);
    rec.closesOrder ||= !!event.closes_order;
    const date = isoDay(event.dispatched_on);
    if (date && (!rec.latestDate || date > rec.latestDate)) rec.latestDate = date;
  }
  return out;
}

function fiveDayBuckets(todayDay, orders, dispatches) {
  const start = todayDay - 29;
  return Array.from({ length: 6 }, (_, index) => {
    const from = start + index * 5;
    const to = from + 4;
    const ordered = orders.reduce((sum, order) => {
      const day = dayNumber(order.order_date);
      return sum + (day != null && day >= from && day <= to ? orderQuantity(order) : 0);
    }, 0);
    const dispatched = (dispatches || []).reduce((sum, event) => {
      const day = dayNumber(event.dispatched_on);
      return sum + (day != null && day >= from && day <= to ? sumObject(event.dispatched) : 0);
    }, 0);
    return { from: fromDayNumber(from), to: fromDayNumber(to), ordered, dispatched };
  });
}

export function buildMisSnapshot(state, dispatches = [], options = {}) {
  const today = isoDay(options.today) || new Date().toISOString().slice(0, 10);
  const todayDay = dayNumber(today);
  const orders = Array.isArray(state && state.orders) ? state.orders : [];
  const byDispatch = dispatchByOrder(dispatches);

  const orderRows = orders.map(order => {
    const qty = orderQuantity(order);
    const shipment = byDispatch[order.order_no] || { dispatched: 0, closesOrder: false, latestDate: null };
    const dispatched = Math.min(qty, shipment.dispatched);
    const rawBalance = Math.max(0, qty - dispatched);
    const pending = shipment.closesOrder ? 0 : rawBalance;
    const shortage = shipment.closesOrder ? rawBalance : 0;
    const health = STATUS[order.sla] || STATUS.on_track;
    const bottleneck = worstStage(order);
    return {
      order_no: order.order_no,
      pi_no: order.pi && order.pi.pi_no || "",
      party: order.party || "",
      article: order.article || order.article_code || "",
      qty,
      dispatched,
      pending,
      shortage,
      completion_pct: qty ? Math.min(100, 100 * dispatched / qty) : 0,
      order_date: isoDay(order.order_date),
      dispatch_date: isoDay(order.dispatch_date),
      actual_dispatch_date: shipment.latestDate,
      lead_days: Number(order.lead_days) || 0,
      status: health.key,
      status_label: health.label,
      bottleneck: bottleneck && bottleneck.stage || null,
      slip_days: bottleneck ? Number(bottleneck.slip_days) || 0 : 0,
    };
  });

  const status = {};
  for (const key of Object.keys(STATUS)) {
    const matching = orderRows.filter(order => order.status === key);
    status[key] = { ...STATUS[key], count: matching.length, ...rangeFor(matching) };
  }

  const monthStart = todayDay - 29;
  const orderedLast30 = orders.reduce((sum, order) => {
    const day = dayNumber(order.order_date);
    return sum + (day != null && day >= monthStart && day <= todayDay ? orderQuantity(order) : 0);
  }, 0);
  const dispatchedLast30 = (dispatches || []).reduce((sum, event) => {
    const day = dayNumber(event.dispatched_on);
    return sum + (day != null && day >= monthStart && day <= todayDay ? sumObject(event.dispatched) : 0);
  }, 0);

  const machineRows = (state && state.machine_load || []).map(machine => {
    const values = Object.values((state.daily_load || {})[machine.work_center] || {})
      .map(Number).filter(value => value > 0);
    const scheduled = values.reduce((sum, value) => sum + value, 0);
    return {
      work_center: machine.work_center,
      name: machine.name,
      stage: machine.stage,
      capacity_per_day: Number(machine.capacity_per_day) || 0,
      average_output: values.length ? scheduled / values.length : 0,
      avg_util_pct: Number(machine.avg_util_pct) || 0,
      peak_util_pct: Number(machine.peak_util_pct) || 0,
      busy_days: Number(machine.busy_days) || values.length,
    };
  }).sort((a, b) => b.avg_util_pct - a.avg_util_pct);

  const overallUtil = machineRows.length
    ? machineRows.reduce((sum, machine) => sum + machine.avg_util_pct, 0) / machineRows.length
    : 0;
  const averageLeadDays = orderRows.length
    ? orderRows.reduce((sum, order) => sum + order.lead_days, 0) / orderRows.length
    : 0;

  return {
    as_of: today,
    total_orders: orderRows.length,
    total_pairs: orderRows.reduce((sum, order) => sum + order.qty, 0),
    status,
    average_production_days: averageLeadDays,
    capacity_util_pct: overallUtil,
    ordered_last_30_days: orderedLast30,
    dispatched_last_30_days: dispatchedLast30,
    shortfall_last_30_days: Math.max(0, orderedLast30 - dispatchedLast30),
    dispatch_coverage_pct: orderedLast30 ? 100 * dispatchedLast30 / orderedLast30 : 0,
    month_from: fromDayNumber(monthStart),
    month_to: today,
    trend: fiveDayBuckets(todayDay, orders, dispatches),
    machines: machineRows,
    orders: orderRows.sort((a, b) => {
      const rank = { breach: 0, at_risk: 1, on_track: 2 };
      return rank[a.status] - rank[b.status]
        || String(a.dispatch_date || "").localeCompare(String(b.dispatch_date || ""))
        || String(a.order_no).localeCompare(String(b.order_no));
    }),
  };
}

