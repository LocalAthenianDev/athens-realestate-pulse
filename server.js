import express from 'express';
import compression from 'compression';
import { buildDataset } from './lib/aggregate.js';

const PORT = process.env.PORT || 3000;
const TTL_MS = Number(process.env.CACHE_TTL_MIN || 60) * 60_000;

// Cache στη μνήμη: σερβίρει πάντα την τελευταία καλή έκδοση και ανανεώνει στο παρασκήνιο.
const cache = { data: null, at: 0, refreshing: null, lastError: null };

function refresh() {
  if (cache.refreshing) return cache.refreshing;
  const started = Date.now();
  cache.refreshing = buildDataset()
    .then((d) => {
      cache.data = d;
      cache.at = Date.now();
      cache.lastError = null;
      console.log(`[cache] ${d.stations.length} σταθμοί, τελευταία ημερομηνία ${d.meta.latest}, ${Date.now() - started}ms`);
      return d;
    })
    .catch((e) => {
      cache.lastError = e.message;
      console.error('[cache] αποτυχία ανανέωσης:', e.message);
      if (!cache.data) throw e;
      return cache.data;
    })
    .finally(() => { cache.refreshing = null; });
  return cache.refreshing;
}

async function getData() {
  if (!cache.data) return refresh();
  if (Date.now() - cache.at > TTL_MS) refresh();
  return cache.data;
}

const APP_ENV = process.env.APP_ENV || 'production';

const app = express();
app.use(compression());
// Το δοκιμαστικό site δεν πρέπει να εμφανίζεται σε μηχανές αναζήτησης
if (APP_ENV !== 'production') app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
app.use(express.static('public', { maxAge: '5m' }));
// Ανοιχτές βιβλιοθήκες και γραμματοσειρά από τον δικό μας server, χωρίς CDN τρίτων
const vendor = (pkgPath) => express.static(new URL(`./node_modules/${pkgPath}`, import.meta.url).pathname, { maxAge: '7d' });
app.use('/vendor/leaflet', vendor('leaflet/dist'));
app.use('/vendor/chartjs', vendor('chart.js/dist'));
app.use('/vendor/commissioner', vendor('@fontsource/commissioner'));

const send = (res, fn) => getData()
  .then((d) => { res.set('Cache-Control', 'public, max-age=60'); fn(d); })
  .catch((e) => res.status(503).json({ error: 'Τα ανοιχτά δεδομένα δεν είναι διαθέσιμα αυτή τη στιγμή', detail: e.message }));

app.get('/api/meta', (req, res) => send(res, (d) => res.json({ ...d.meta, env: APP_ENV, cacheAgeMin: Math.round((Date.now() - cache.at) / 60000), lastError: cache.lastError })));
app.get('/api/stations', (req, res) => send(res, (d) => res.json({ meta: { ...d.meta, env: APP_ENV }, stations: d.stations })));
app.get('/api/stations/:id/series', (req, res) => send(res, (d) => {
  const s = d.series[req.params.id];
  if (!s) return res.status(404).json({ error: 'Άγνωστος σταθμός' });
  res.json(s);
}));
app.get('/healthz', (req, res) => res.json({ ok: true, cached: Boolean(cache.data) }));

app.listen(PORT, () => {
  console.log(`Athens Real Estate Pulse στο http://localhost:${PORT}${process.env.MOCK === '1' ? ' (MOCK)' : ''}`);
  refresh().catch(() => {});
});
