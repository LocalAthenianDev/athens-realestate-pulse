/* Athens Pulse · Ακίνητα */
(() => {
  const PROFILES = {
    commercial: {
      label: 'Score επαγγελματικού χώρου',
      title: 'Κατάταξη για επαγγελματικό χώρο',
      weights: { visitors: 0.45, dwellMin: 0.25, trendPct: 0.15, concurrent: 0.15 },
      why: 'Μετράει κυρίως πόσος κόσμος περνάει, πόση ώρα μένει και αν η κίνηση ανεβαίνει. Υψηλό score σημαίνει περισσότερους πιθανούς πελάτες στο σημείο.',
    },
    quiet: {
      label: 'Score ήσυχης κατοικίας',
      title: 'Κατάταξη για ήσυχη κατοικία',
      weights: { nightShare: -0.4, visitors: -0.35, weekendRatio: -0.25 },
      why: 'Ευνοεί σημεία με λίγη νυχτερινή κίνηση, χαμηλή συνολική επισκεψιμότητα και ήρεμα Σαββατοκύριακα.',
    },
    lively: {
      label: 'Score ζωντανής κατοικίας',
      title: 'Κατάταξη για ζωντανή κατοικία',
      weights: { eveningShare: 0.35, weekendRatio: 0.25, concurrent: 0.25, trendPct: 0.15 },
      why: 'Ευνοεί σημεία με κόσμο τα βράδια και τα Σαββατοκύριακα, σταθερή παρουσία στο δρόμο και ανοδική τάση.',
    },
  };

  const state = { profile: 'commercial', level: 'nb', data: null, items: [], selected: null, q: '' };
  const $ = (s) => document.querySelector(s);
  const fmt = new Intl.NumberFormat('el-GR');
  const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const ramp = () => ['--s0', '--s1', '--s2', '--s3', '--s4'].map(css);
  const colorFor = (score) => ramp()[Math.min(4, Math.floor((score ?? 0) / 20))];
  const title = (s) => s || ''; // Τα ονόματα γειτονιών έρχονται κεφαλαία χωρίς τόνους: τα δείχνουμε όπως είναι

  function score(pct, weights) {
    let sum = 0;
    let w = 0;
    for (const [k, wt] of Object.entries(weights)) {
      const p = pct[k];
      if (p === null || p === undefined) continue;
      sum += Math.abs(wt) * (wt < 0 ? 100 - p : p);
      w += Math.abs(wt);
    }
    return w ? Math.round(sum / w) : null;
  }

  const avg = (arr) => { const v = arr.filter((x) => x !== null && x !== undefined && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

  function buildItems() {
    const { weights } = PROFILES[state.profile];
    const st = state.data.stations.map((s) => ({ ...s, kind: 'st', key: 'st' + s.id, score: score(s.pct, weights) }));
    if (state.level === 'st') return st;
    const groups = new Map();
    for (const s of st) {
      const k = s.neighbourhood || 'Χωρίς γειτονιά';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    return [...groups].map(([name, list]) => {
      const keys = Object.keys(list[0].metrics);
      const metrics = Object.fromEntries(keys.map((k) => [k, avg(list.map((s) => s.metrics[k]))]));
      const pct = Object.fromEntries(Object.keys(list[0].pct).map((k) => [k, avg(list.map((s) => s.pct[k]))]));
      const withC = list.filter((s) => s.coords);
      const profiles = list.map((s) => s.profile).filter(Boolean);
      return {
        kind: 'nb', key: 'nb' + name, name, neighbourhood: name, stations: list, metrics, pct,
        score: Math.round(avg(list.map((s) => s.score)) ?? 0),
        coords: withC.length ? [avg(withC.map((s) => s.coords[0])), avg(withC.map((s) => s.coords[1]))] : null,
        profile: profiles.length ? profiles[0].map((_, i) => avg(profiles.map((p) => p[i]))) : null,
      };
    });
  }

  /* ---------- Χάρτης ---------- */
  let map = null;
  let layer = null;
  function initMap() {
    const anyCoords = state.data.stations.some((s) => s.coords);
    if (!anyCoords) { $('#map').hidden = true; $('#nomap').hidden = false; $('#legend').hidden = true; return; }
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([37.985, 23.73], 13);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap, &copy; CARTO',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    const pts = state.data.stations.filter((s) => s.coords).map((s) => s.coords);
    if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30] });
  }

  function drawMap() {
    if (!map) return;
    layer.clearLayers();
    const maxV = Math.max(...state.items.map((i) => i.metrics.visitors || 0), 1);
    for (const it of state.items) {
      if (!it.coords) continue;
      const r = 6 + 16 * Math.sqrt((it.metrics.visitors || 0) / maxV);
      const sel = state.selected && state.selected.key === it.key;
      const m = L.circleMarker(it.coords, {
        radius: r, weight: sel ? 3 : 1.5, color: sel ? css('--accent') : css('--surface'),
        fillColor: colorFor(it.score), fillOpacity: 0.9,
      }).addTo(layer);
      m.bindTooltip(`<b>${title(it.name)}</b><br>${PROFILES[state.profile].label}: <b>${it.score ?? 'n/a'}</b><br>${fmt.format(Math.round(it.metrics.visitors || 0))} επισκέπτες/ημέρα`);
      m.on('click', () => select(it));
    }
    const r = ramp();
    $('#legend').innerHTML = `${PROFILES[state.profile].label}<div class="bar">${r.map((c) => `<i style="background:${c}"></i>`).join('')}</div><div class="ends"><span>0</span><span>100</span></div>Μέγεθος κύκλου: επισκέπτες/ημέρα`;
  }

  /* ---------- Κατάταξη ---------- */
  function drawRanking() {
    $('#rank-title').textContent = PROFILES[state.profile].title;
    const q = state.q.toLocaleLowerCase('el-GR');
    const list = state.items
      .filter((i) => !q || (i.name + ' ' + (i.neighbourhood || '')).toLocaleLowerCase('el-GR').includes(q))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const ol = $('#ranking');
    if (!list.length) { ol.innerHTML = '<li class="empty">Δεν βρέθηκαν αποτελέσματα</li>'; return; }
    ol.innerHTML = list.map((it, i) => {
      const sub = it.kind === 'nb'
        ? `${it.stations.length} ${it.stations.length === 1 ? 'σταθμός' : 'σταθμοί'} · ${fmt.format(Math.round(it.metrics.visitors || 0))} επισκ./ημέρα`
        : `${title(it.neighbourhood)} · ${fmt.format(it.metrics.visitors || 0)} επισκ./ημέρα`;
      return `<li data-key="${it.key}" class="${state.selected && state.selected.key === it.key ? 'active' : ''}" tabindex="0">
        <span class="pos">${i + 1}</span>
        <div><div class="nm">${title(it.name)}</div><div class="sub">${sub}</div>
          <div class="meter"><i style="width:${it.score ?? 0}%;background:${colorFor(it.score)}"></i></div></div>
        <span class="sc">${it.score ?? '–'}</span></li>`;
    }).join('');
  }

  /* ---------- Λεπτομέρειες ---------- */
  let chDaily = null;
  let chHourly = null;
  const kpi = (val, label, pct) => `<div class="kpi"><b>${val}</b><span>${label}</span>${pct !== null && pct !== undefined ? `<em>${Math.round(pct)}ο εκατοστημόριο</em>` : ''}</div>`;

  async function select(it) {
    state.selected = it;
    drawRanking();
    drawMap();
    const p = PROFILES[state.profile];
    const m = it.metrics;
    $('#detail').hidden = false;
    $('#d-kicker').textContent = it.kind === 'nb' ? 'Γειτονιά' : `Σταθμός WiFi #${it.id} · ${title(it.neighbourhood)}`;
    $('#d-title').textContent = title(it.name);
    $('#d-score').textContent = it.score ?? 'n/a';
    $('#d-score').style.color = colorFor(it.score) === ramp()[0] ? css('--ink') : colorFor(it.score);
    $('#d-score-label').textContent = '/ 100 · ' + p.label;
    const n = (v, d = 0) => (v === null || v === undefined ? 'n/a' : fmt.format(Number(v.toFixed(d))));
    const sign = (v) => (v === null || v === undefined ? 'n/a' : (v > 0 ? '+' : '') + n(v, 1) + '%');
    $('#d-kpis').innerHTML = [
      kpi(n(m.visitors), 'Επισκέπτες/ημέρα', it.pct.visitors),
      kpi(m.dwellMin ? `${n(m.dwellMin)}′` : 'n/a', 'Χρόνος παραμονής (εκτ.)', it.pct.dwellMin),
      kpi(n(m.concurrent, 1), 'Ταυτόχρονα παρόντες', it.pct.concurrent),
      kpi(sign(m.trendPct), 'Τάση 30 ημερών', it.pct.trendPct),
      kpi(m.weekendRatio ? '×' + n(m.weekendRatio, 2) : 'n/a', 'Σαββατοκύριακο/καθημερινή', it.pct.weekendRatio),
      kpi(m.nightShare !== null && m.nightShare !== undefined ? n(m.nightShare, 1) + '%' : 'n/a', 'Νυχτερινή κίνηση (22 έως 06)', it.pct.nightShare),
    ].join('');
    let why = p.why;
    if (it.link) why += ` <a href="${it.link}" target="_blank" rel="noopener">Η γειτονιά στο citizenhub</a>`;
    $('#d-why').innerHTML = why;

    // Ημερήσια σειρά (για γειτονιά: άθροισμα σταθμών)
    const ids = it.kind === 'nb' ? it.stations.map((s) => s.id) : [it.id];
    const all = await Promise.all(ids.map((id) => fetch(`api/stations/${id}/series`).then((r) => r.json())));
    if (state.selected !== it) return;
    const dates = all[0].dates;
    const vis = dates.map((_, i) => { const v = all.map((s) => s.visitors[i]).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) : null; });
    const accent = css('--accent');
    const grid = css('--line');
    const muted = css('--muted');
    chDaily?.destroy();
    chDaily = new Chart($('#c-daily'), {
      type: 'line',
      data: { labels: dates.map((d) => new Date(d + 'T12:00:00').toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })), datasets: [{ data: vis, borderColor: accent, backgroundColor: accent + '22', fill: true, pointRadius: 0, borderWidth: 2, tension: 0.3, spanGaps: true }] },
      options: chartOpts(grid, muted, 6),
    });
    chHourly?.destroy();
    if (it.profile) {
      $('#d-hourly-wrap').hidden = false;
      chHourly = new Chart($('#c-hourly'), {
        type: 'bar',
        data: { labels: it.profile.map((_, i) => String(i * 2).padStart(2, '0')), datasets: [{ data: it.profile, backgroundColor: it.profile.map((_, i) => (i * 2 >= 22 || i * 2 < 6 ? css('--s4') : css('--s2'))), borderRadius: 4 }] },
        options: chartOpts(grid, muted, 12),
      });
    } else {
      $('#d-hourly-wrap').hidden = true;
    }
  }

  function chartOpts(grid, muted, ticks) {
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmt.format(Math.round(c.raw)) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: muted, maxTicksLimit: ticks, font: { family: 'Commissioner', size: 11 } } },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { family: 'Commissioner', size: 11 }, callback: (v) => fmt.format(v) } },
      },
    };
  }

  /* ---------- Γεγονότα ---------- */
  function refresh() {
    state.items = buildItems();
    if (state.selected) state.selected = state.items.find((i) => i.key === state.selected.key) || null;
    drawRanking();
    drawMap();
    if (state.selected) select(state.selected); else $('#detail').hidden = true;
  }

  document.querySelectorAll('.profiles button').forEach((b) => b.addEventListener('click', () => {
    state.profile = b.dataset.profile;
    document.querySelectorAll('.profiles button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    refresh();
  }));
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    state.level = b.dataset.level;
    state.selected = null;
    document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    refresh();
  }));
  $('#search').addEventListener('input', (e) => { state.q = e.target.value; drawRanking(); });
  const pick = (e) => {
    const li = e.target.closest('li[data-key]');
    if (!li) return;
    const it = state.items.find((i) => i.key === li.dataset.key);
    if (it) { select(it); if (map && it.coords) map.panTo(it.coords); }
  };
  $('#ranking').addEventListener('click', pick);
  $('#ranking').addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(e); });
  $('#close').addEventListener('click', () => { state.selected = null; $('#detail').hidden = true; drawRanking(); drawMap(); });

  /* ---------- Εκκίνηση ---------- */
  fetch('api/stations')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => {
      state.data = d;
      const m = d.meta;
      const st = $('#status');
      st.classList.toggle('warn', m.stale || m.mock);
      st.innerHTML = `<span class="dot"></span>${m.mock ? 'Δοκιμαστικά δεδομένα · ' : ''}Δεδομένα έως ${fmtDate(m.latest)}${m.stale ? ` (πριν από ${m.ageDays} ημέρες)` : ''} · ${m.stations} σταθμοί`;
      st.title = `Τελευταία ανάκτηση από το API: ${new Date(m.fetchedAt).toLocaleString('el-GR')}`;
      $('#sources').innerHTML = 'Πηγές: ' + m.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>`).join(' · ');
      initMap();
      refresh();
    })
    .catch(() => {
      $('#status').classList.add('warn');
      $('#status').innerHTML = '<span class="dot"></span>Τα ανοιχτά δεδομένα δεν απαντούν αυτή τη στιγμή. Δοκίμασε ξανά σε λίγο.';
    });
})();
