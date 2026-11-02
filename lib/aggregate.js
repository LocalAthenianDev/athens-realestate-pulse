// Συνδυάζει τα τρία datasets WiFi σε δείκτες ανά σταθμό, χρήσιμους για αγορά/ενοικίαση ακινήτων.
import { fetchRecent } from './ckan.js';
import { loadStationCoords } from './stations.js';
import { mockFetch, mockCoords } from './mock.js';

export const RESOURCES = {
  cumulative: { id: 'fa73f026-7a01-4d5c-9b8d-f13d176bf5fa', dataset: 'wifi-cumulative-traffic-all-stations', label: 'WiFi Αθροιστική Επισκεψιμότητα' },
  highest: { id: '1cdccaf9-c11b-4393-b3c7-cf9d3f78ad0f', dataset: 'wifi-highest-visitors-all-stations', label: 'WiFi Μέγιστη Επισκεψιμότητα' },
  active: { id: '4beed3ab-20d4-42b8-8d36-eb55030567b1', dataset: 'wifi-active-visitors-all-stations', label: 'WiFi Πληθυσμιακή Συγκέντρωση' },
};

const MOCK = process.env.MOCK === '1';
const WINDOW = Number(process.env.WINDOW_DAYS || 30);
const HOURLY_DAYS = Number(process.env.HOURLY_DAYS || 14);

const athensHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: '2-digit', hourCycle: 'h23' });
const slotOf = (ts) => {
  const h = Number(athensHour.format(new Date(ts)));
  return Number.isFinite(h) ? h - (h % 2) : null;
};

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const addDays = (d, n) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function get(kind, interval, days) {
  if (MOCK) return mockFetch(kind, interval, days);
  return fetchRecent(RESOURCES[kind].id, interval, days);
}

function percentiles(stations, key) {
  const vals = stations.map((s) => s.metrics[key]).filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  for (const s of stations) {
    const v = s.metrics[key];
    if (v === null || !Number.isFinite(v) || vals.length < 2) { s.pct[key] = null; continue; }
    let lo = 0;
    while (lo < vals.length && vals[lo] < v) lo++;
    let hi = lo;
    while (hi < vals.length && vals[hi] === v) hi++;
    s.pct[key] = Math.round((((lo + hi - 1) / 2) / (vals.length - 1)) * 100);
  }
}

export async function buildDataset() {
  const errors = [];
  const safe = (p, label) => p.catch((e) => { errors.push(`${label}: ${e.message}`); return null; });

  const [cum, hig, act, hourly, coordsInfo] = await Promise.all([
    safe(get('cumulative', 'OneDay', WINDOW * 2), 'cumulative'),
    safe(get('highest', 'OneDay', WINDOW * 2), 'highest'),
    safe(get('active', 'OneDay', WINDOW * 2), 'active'),
    safe(get('active', 'TwoHours', HOURLY_DAYS), 'active/TwoHours'),
    MOCK ? Promise.resolve({ coords: mockCoords, extra: {}, source: 'mock' }) : loadStationCoords(),
  ]);
  if (!cum && !hig && !act) throw new Error('Κανένα dataset δεν απάντησε. ' + errors.join(' | '));

  const latest = [hig, cum, act].filter(Boolean).map((r) => r.latest).filter(Boolean).sort().pop();
  const recentFrom = addDays(latest, -(WINDOW - 1));
  const prevFrom = addDays(latest, -(WINDOW * 2 - 1));

  const st = new Map();
  const touch = (r) => {
    if (!st.has(r.station_id)) st.set(r.station_id, { id: r.station_id, name: r.station_name, neighbourhood: r.neighbourhood, daily: { cumulative: {}, highest: {}, active: {} }, slots: {} });
    return st.get(r.station_id);
  };
  for (const [kind, res] of [['cumulative', cum], ['highest', hig], ['active', act]]) {
    if (!res) continue;
    for (const r of res.records) touch(r).daily[kind][r.date] = r.value;
  }
  if (hourly) {
    for (const r of hourly.records) {
      const slot = slotOf(r.period_start);
      if (slot === null) continue;
      const s = touch(r);
      (s.slots[slot] ||= []).push(r.value);
    }
  }

  const stations = [];
  const series = {};
  for (const s of st.values()) {
    const vals = (kind, from, to) => Object.entries(s.daily[kind]).filter(([d]) => d >= from && d <= to).map(([, v]) => v);
    const wk = (kind, weekend) => Object.entries(s.daily[kind])
      .filter(([d]) => d >= recentFrom)
      .filter(([d]) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return weekend === (w === 0 || w === 6); })
      .map(([, v]) => v);

    const visitors = mean(vals('highest', recentFrom, latest));
    const traffic = mean(vals('cumulative', recentFrom, latest));
    const concurrent = mean(vals('active', recentFrom, latest));
    const trendKind = Object.keys(s.daily.highest).length ? 'highest' : 'cumulative';
    const prev = mean(vals(trendKind, prevFrom, addDays(recentFrom, -1)));
    const rec = mean(vals(trendKind, recentFrom, latest));
    const we = mean(wk(trendKind, true));
    const wd = mean(wk(trendKind, false));

    const profile = Array.from({ length: 12 }, (_, i) => { const m = mean(s.slots[i * 2] || []); return m === null ? null : Math.round(m * 10) / 10; });
    const total = profile.reduce((a, b) => a + (b || 0), 0);
    const share = (hours) => (total > 0 ? hours.reduce((a, h) => a + (profile[h / 2] || 0), 0) / total : null);
    const peakIdx = total > 0 ? profile.indexOf(Math.max(...profile.map((x) => x || 0))) : -1;

    const metrics = {
      visitors: visitors && Math.round(visitors),
      traffic: traffic && Math.round(traffic),
      concurrent: concurrent && Math.round(concurrent * 10) / 10,
      dwellMin: visitors && traffic ? Math.round((traffic / visitors) * 30) : null,
      trendPct: prev && rec ? Math.round((rec / prev - 1) * 1000) / 10 : null,
      weekendRatio: we && wd ? Math.round((we / wd) * 100) / 100 : null,
      nightShare: share([22, 0, 2, 4]) !== null ? Math.round(share([22, 0, 2, 4]) * 1000) / 10 : null,
      eveningShare: share([18, 20]) !== null ? Math.round(share([18, 20]) * 1000) / 10 : null,
      peakHour: peakIdx >= 0 ? peakIdx * 2 : null,
      daysCovered: vals(trendKind, recentFrom, latest).length,
    };
    stations.push({
      id: s.id,
      name: s.name,
      neighbourhood: s.neighbourhood,
      coords: coordsInfo.coords[s.id] || null,
      link: coordsInfo.extra[s.id]?.link || null,
      metrics,
      pct: {},
      profile: total > 0 ? profile : null,
    });

    const dates = [];
    for (let d = prevFrom; d <= latest; d = addDays(d, 1)) dates.push(d);
    series[s.id] = {
      dates,
      visitors: dates.map((d) => s.daily.highest[d] ?? null),
      traffic: dates.map((d) => s.daily.cumulative[d] ?? null),
      concurrent: dates.map((d) => s.daily.active[d] ?? null),
    };
  }
  for (const k of ['visitors', 'traffic', 'concurrent', 'dwellMin', 'trendPct', 'weekendRatio', 'nightShare', 'eveningShare']) percentiles(stations, k);
  stations.sort((a, b) => (b.metrics.visitors || 0) - (a.metrics.visitors || 0));

  const ageDays = Math.round((Date.now() - new Date(latest + 'T00:00:00Z')) / 86400000);
  return {
    meta: {
      latest,
      windowFrom: recentFrom,
      windowDays: WINDOW,
      ageDays,
      stale: ageDays > 7,
      fetchedAt: new Date().toISOString(),
      stations: stations.length,
      withCoords: stations.filter((s) => s.coords).length,
      coordsSource: coordsInfo.source,
      hourly: Boolean(hourly && hourly.records.length),
      mock: MOCK,
      errors,
      sources: Object.values(RESOURCES).map((r) => ({ label: r.label, url: `https://opendata.cityofathens.gr/dataset/${r.dataset}` })),
    },
    stations,
    series,
  };
}
