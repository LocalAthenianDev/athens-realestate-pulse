// Συντεταγμένες σταθμών WiFi.
// 1) Προσπαθεί να τις βρει στο Μητρώο Σταθμών WiFi (dataset wifi-stations-registry).
// 2) Συμπληρώνει / αντικαθιστά από το τοπικό data/station-coords.json αν υπάρχει.
import { readFile } from 'node:fs/promises';
import { ckan } from './ckan.js';

const REGISTRY_ID = process.env.STATIONS_DATASET || 'wifi-stations-registry';

function parseCoords(rec) {
  const keys = Object.keys(rec);
  const find = (re) => keys.find((k) => re.test(k));
  const latK = find(/^(lat|latitude|y|γεωγρ.*πλάτος)$/i) || find(/lat/i);
  const lonK = find(/^(lon|lng|long|longitude|x)$/i) || find(/(lon|lng)/i);
  if (latK && lonK) {
    const lat = parseFloat(rec[latK]);
    const lon = parseFloat(rec[lonK]);
    if (isFinite(lat) && isFinite(lon)) return [lat, lon];
  }
  const geomK = find(/(geom|geometry|location|wkt|point)/i);
  if (geomK && rec[geomK]) {
    const g = rec[geomK];
    try {
      const o = typeof g === 'string' && g.trim().startsWith('{') ? JSON.parse(g) : g;
      if (o && o.coordinates) return [Number(o.coordinates[1]), Number(o.coordinates[0])];
    } catch { /* συνέχισε */ }
    const m = String(g).match(/(-?\d+\.\d+)[ ,]+(-?\d+\.\d+)/);
    if (m) {
      const a = parseFloat(m[1]);
      const b = parseFloat(m[2]);
      // Η Αθήνα: lat ~37.9, lon ~23.7
      return a > b ? [a, b] : [b, a];
    }
  }
  return null;
}

export async function loadStationCoords() {
  const coords = {};
  const extra = {};
  let source = 'none';
  try {
    const pkg = await ckan('package_show', { id: REGISTRY_ID });
    const res = pkg.resources.find((r) => r.datastore_active) || pkg.resources[0];
    if (res) {
      let records;
      if (res.datastore_active) {
        records = (await ckan('datastore_search', { resource_id: res.id, limit: 1000 })).records;
      } else {
        // Το Μητρώο δημοσιεύεται ως αρχείο JSON: το κατεβάζουμε απευθείας.
        const raw = await (await fetch(res.url, { signal: AbortSignal.timeout(25000) })).json();
        records = Array.isArray(raw) ? raw : raw.records || raw.stations || raw.data || raw.features?.map((f) => ({ ...f.properties, geometry: f.geometry })) || [];
      }
      const flatten = (o, out = {}) => {
        for (const [k, v] of Object.entries(o || {})) {
          if (v && typeof v === 'object' && !Array.isArray(v) && !('coordinates' in v)) flatten(v, out);
          else if (!(k in out)) out[k] = v;
        }
        return out;
      };
      for (const raw of records) {
        const rec = flatten(raw);
        const id = Number(rec.station_id ?? rec.id);
        if (!id) continue;
        const c = parseCoords(rec);
        if (c) coords[id] = c;
        const hubKey = 'neighbourhood_url' in rec ? 'neighbourhood_url' : Object.keys(rec).find((k) => /citizenhub/i.test(k));
        extra[id] = {
          link: hubKey && /^https?:/.test(String(rec[hubKey])) ? rec[hubKey] : null,
          address: rec.station_address || null,
          district: rec.municipal_district_name || null,
        };
      }
      if (Object.keys(coords).length) source = 'registry';
    }
  } catch (e) {
    console.warn('[stations] Μητρώο σταθμών μη διαθέσιμο:', e.message);
  }
  try {
    const local = JSON.parse(await readFile(new URL('../data/station-coords.json', import.meta.url), 'utf8'));
    for (const [id, c] of Object.entries(local)) if (Array.isArray(c) && c.length === 2) coords[Number(id)] = c;
    if (Object.keys(local).length) source = source === 'registry' ? 'registry+local' : 'local';
  } catch { /* δεν υπάρχει τοπικό αρχείο */ }
  return { coords, extra, source };
}
