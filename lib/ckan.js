// Μικρός client για το CKAN datastore API της πλατφόρμας ανοιχτών δεδομένων του Δήμου Αθηναίων.
const BASE = process.env.CKAN_BASE || 'https://opendata.cityofathens.gr';
const TIMEOUT_MS = Number(process.env.CKAN_TIMEOUT_MS || 25000);

export async function ckan(action, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const url = `${BASE}/api/3/action/${action}?${qs}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'athens-realestate-pulse/1.0 (+https://github.com/LocalAthenianDev)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`CKAN ${action} HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`CKAN ${action}: ${JSON.stringify(json.error)}`);
  return json.result;
}

const KNOWN_METRICS = ['cumulative_traffic', 'highest_visitors', 'active_visitors', 'visitors', 'value', 'count'];

// Βρίσκει το αριθμητικό πεδίο της μετρικής (π.χ. cumulative_traffic) από το data dictionary.
export function detectMetricField(fields) {
  const names = fields.map((f) => f.id);
  for (const k of KNOWN_METRICS) if (names.includes(k)) return k;
  const num = fields.find((f) => /^(int|float|numeric)/.test(f.type) && !['station_id', '_id'].includes(f.id));
  if (!num) throw new Error('Δεν βρέθηκε αριθμητικό πεδίο μετρικής');
  return num.id;
}

const day = (d) => String(d).slice(0, 10);

// Τραβάει τις πιο πρόσφατες εγγραφές ενός resource για ένα interval_type,
// σελιδοποιώντας μέχρι να καλύψει `days` ημέρες πριν από την τελευταία διαθέσιμη ημερομηνία.
export async function fetchRecent(resourceId, intervalType, days, { pageSize = 5000, maxPages = 30 } = {}) {
  const records = [];
  let metric = null;
  let latest = null;
  let cutoff = null;
  for (let page = 0; page < maxPages; page++) {
    const r = await ckan('datastore_search', {
      resource_id: resourceId,
      filters: { interval_type: intervalType },
      sort: 'date desc',
      limit: pageSize,
      offset: page * pageSize,
    });
    if (!metric) metric = detectMetricField(r.fields);
    if (!r.records.length) break;
    if (!latest) {
      latest = day(r.records[0].date);
      const c = new Date(latest + 'T00:00:00Z');
      c.setUTCDate(c.getUTCDate() - days + 1);
      cutoff = c.toISOString().slice(0, 10);
    }
    let reachedCutoff = false;
    for (const rec of r.records) {
      const d = day(rec.date);
      if (d < cutoff) { reachedCutoff = true; continue; }
      records.push({
        station_id: Number(rec.station_id),
        station_name: rec.station_name,
        neighbourhood: rec.neighbourhood_name,
        date: d,
        period_start: rec.period_start,
        value: Number(rec[metric]) || 0,
      });
    }
    if (reachedCutoff || r.records.length < pageSize) break;
  }
  return { metric, latest, cutoff, records };
}
