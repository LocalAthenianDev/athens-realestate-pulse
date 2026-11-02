// Συνθετικά δεδομένα για τοπική ανάπτυξη (MOCK=1). Ίδιο σχήμα με το fetchRecent().
const STATIONS = [
  [113, 'Φωκίωνος Νέγρη', 'ΦΩΚΙΩΝΟΣ ΝΕΓΡΗ', 38.0005, 23.7385, 1.6],
  [89, 'Πολιτιστικό κέντρο Κυψέλη', 'ΠΛΑΤΕΙΑ ΚΑΝΑΡΗ', 37.9985, 23.7430, 1.1],
  [77, 'Πλατεία Σταθμού Λαρίσης', 'ΙΟΥΛΙΑΝΟΥ-ΦΙΛΑΔΕΛΦΕΙΑΣ', 37.9920, 23.7210, 2.2],
  [78, 'Πλατεία Αττικής', 'ΠΛΑΤΕΙΑ ΑΤΤΙΚΗΣ', 38.0005, 23.7225, 1.4],
  [3, 'Αθλητικό Κέντρο Μετς', 'ΜΕΤΣ', 37.9655, 23.7400, 0.7],
  [28, 'Πλατεία Μεσολογγίου', 'ΠΑΓΚΡΑΤΙ', 37.9670, 23.7520, 1.0],
  [72, 'Κέντρο Δημιουργικής Μάθησης Εξαρχείων', 'ΕΞΑΡΧΕΙΑ', 37.9860, 23.7330, 1.3],
  [81, 'Κεντρική Δημοτική Βιβλιοθήκη', 'ΜΕΤΑΞΟΥΡΓΕΙΟ', 37.9850, 23.7215, 1.8],
  [109, 'Πλατεία Παπαδιαμάντη', 'ΠΛΑΤΕΙΑ ΠΑΠΑΔΙΑΜΑΝΤΗ', 38.0115, 23.7335, 0.6],
  [8, 'Λόφος Αθλητικό Κέντρο Λαμπράκη', 'ΚΟΛΩΝΟΣ', 37.9945, 23.7085, 0.8],
  [12, 'Πλατεία και Αθλητικό Κέντρο Κεδρηνού', 'ΣΕΠΟΛΙΑ', 38.0030, 23.7120, 0.9],
  [108, 'Αθλητικό Κέντρο Μητσάκη και Πάρκο Τσέπης', 'ΚΥΠΡΙΑΔΟΥ', 38.0170, 23.7380, 0.5],
  [6, 'Αθλητικό Κέντρο Παιδική Χαρά Λαγουμιτζή', 'ΚΟΥΚΑΚΙ', 37.9600, 23.7230, 1.2],
];

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export const mockCoords = Object.fromEntries(STATIONS.map((s) => [s[0], [s[3], s[4]]]));

export function mockFetch(kind, intervalType, days) {
  const latest = new Date();
  latest.setUTCDate(latest.getUTCDate() - 1);
  const latestStr = latest.toISOString().slice(0, 10);
  const base = { cumulative: 6000, highest: 120, active: 65 }[kind];
  const records = [];
  for (const [id, name, nb, , , mult] of STATIONS) {
    const r = rng(id * 97 + kind.length);
    const growth = 0.85 + r() * 0.4;
    for (let i = 0; i < days; i++) {
      const d = new Date(latest);
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const wd = d.getUTCDay();
      const weekend = wd === 0 || wd === 6 ? 0.75 + r() * 0.6 : 1;
      const trend = 1 + ((days - i) / days - 0.5) * (growth - 1);
      if (intervalType === 'OneDay') {
        records.push({ station_id: id, station_name: name, neighbourhood: nb, date, period_start: date + 'T00:00:00+02:00', value: Math.round(base * mult * weekend * trend * (0.85 + r() * 0.3)) });
      } else {
        const night = 0.15 + r() * 0.5;
        for (let h = 0; h < 24; h += 2) {
          const shape = h < 6 ? night * 0.4 : h < 10 ? 0.6 : h < 18 ? 1 : h < 22 ? 1.1 : night;
          const ps = `${date}T${String(h).padStart(2, '0')}:00:00+02:00`;
          records.push({ station_id: id, station_name: name, neighbourhood: nb, date, period_start: ps, value: Math.round(base * mult * shape * (0.8 + r() * 0.4)) });
        }
      }
    }
  }
  const c = new Date(latestStr + 'T00:00:00Z');
  c.setUTCDate(c.getUTCDate() - days + 1);
  return { metric: kind, latest: latestStr, cutoff: c.toISOString().slice(0, 10), records };
}
