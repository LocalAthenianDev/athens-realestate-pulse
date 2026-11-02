"""Ανάλυση των WiFi δεδομένων επισκεψιμότητας του Δήμου Αθηναίων.

Διαβάζει analysis/data/daily.csv και stations.csv (από fetch_history.py) και τυπώνει
τα νούμερα του εγγράφου ανάλυσης: ποιότητα, κατατάξεις, εποχικότητα, τάσεις, τύποι περιοχών.

Χρήση:  python3 analysis/analyze.py
Απαιτεί: pandas, numpy, scikit-learn
"""
import pathlib

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

DATA = pathlib.Path(__file__).parent / 'data'
BASE = ('2026-09-07', '2026-11-01')      # καθαρή περίοδος αναφοράς, όλοι οι σταθμοί ενεργοί
AUG = ('2026-08-10', '2026-08-23')
AUTUMN = ('2026-09-07', '2026-10-04')


def load():
    w = pd.read_csv(DATA / 'daily.csv', parse_dates=['date'])
    st = pd.read_csv(DATA / 'stations.csv')
    w = w.merge(st, on='station_id', how='left')
    peak = w.visitors.replace(0, np.nan)
    # Κανόνες ποιότητας (ίδιοι με τον server της εφαρμογής)
    w['T'] = w.traffic.where((w.traffic > 0) & (w.traffic / peak >= 15))
    w['C'] = w.concurrent.where((w.concurrent > 0) & (w.concurrent / peak >= 0.25) & (w.date >= '2026-07-08'))
    med = w.groupby('station_id').visitors.transform(lambda s: s[s > 0].median())
    w['V'] = w.visitors.where((w.visitors > 0) & (w.visitors <= 4 * med))
    w['weekend'] = w.date.dt.dayofweek >= 5
    return w


def between(w, a, b):
    return w[(w.date >= a) & (w.date <= b)]


def main():
    w = load()
    print('Ημέρες σταθμού:', len(w), '| έγκυρη κίνηση:', round(w['T'].notna().mean() * 100, 1), '% | έγκυρη κορυφή:', round(w['V'].notna().mean() * 100, 1), '%')

    base = between(w, *BASE)
    st = base.groupby(['station_id', 'station_name', 'neighbourhood', 'district'])[['T', 'V', 'C']].mean().reset_index()
    st['we_ratio'] = st.station_id.map(base[base.weekend].groupby('station_id')['T'].mean() / base[~base.weekend].groupby('station_id')['T'].mean())
    print('\nΚορυφαίοι 15 σταθμοί (μέση κίνηση/ημέρα):')
    print(st.sort_values('T', ascending=False).head(15)[['station_name', 'neighbourhood', 'T']].round(0).to_string(index=False))
    print('Διάμεσος:', round(st['T'].median()), '| p90/p10:', round(st['T'].quantile(.9) / st['T'].quantile(.1), 1))
    print('Συσχέτιση δεικτών:\n', st[['T', 'V', 'C']].corr().round(2))

    dip = between(w, *AUG).groupby('station_id')['T'].mean() / between(w, *AUTUMN).groupby('station_id')['T'].mean() - 1
    print('\nΠτώση Αυγούστου: διάμεσος', round(dip.median() * 100), '% | p10', round(dip.quantile(.1) * 100), '% | p90', round(dip.quantile(.9) * 100), '%')

    ref = base.groupby('station_id')['T'].mean()
    w['Ti'] = w['T'] / w.station_id.map(ref)
    print('Δείκτης ημέρας εβδομάδας:', base.assign(Ti=base['T'] / base.station_id.map(ref)).groupby(base.date.dt.dayofweek).Ti.median().round(3).to_dict())

    orig = w[w.date < '2025-11-05'].station_id.unique()
    o = w[w.station_id.isin(orig)]
    ch = between(o, '2026-10-05', '2026-11-01').groupby('station_id')['T'].mean() / between(o, '2025-11-03', '2025-11-30').groupby('station_id')['T'].mean() - 1
    print('37 αρχικοί σταθμοί, Οκτ 2026 έναντι Νοε 2025:', round(ch.median() * 100), '% (ανέβηκαν', round((ch > 0).mean() * 100), '%)')
    growth = between(w, '2026-10-05', '2026-11-01').groupby('station_id')['T'].mean() / between(w, '2026-02-16', '2026-03-01').groupby('station_id')['T'].mean() - 1

    st['aug_dip'] = st.station_id.map(dip)
    st['growth'] = st.station_id.map(growth)
    f = st.dropna(subset=['T', 'aug_dip', 'we_ratio']).copy()
    X = StandardScaler().fit_transform(np.column_stack([np.log(f['T']), f.aug_dip, f.we_ratio]))
    f['seg'] = KMeans(4, n_init=50, random_state=1).fit(X).labels_
    print('\nΤύποι περιοχών:')
    print(f.groupby('seg').agg(n=('station_id', 'count'), T=('T', 'median'), dip=('aug_dip', 'median'), we=('we_ratio', 'median'), growth=('growth', 'median')).round(2))
    print('\nΑνά δημοτικό διαμέρισμα:')
    print(st.groupby('district').agg(n=('station_id', 'count'), T=('T', 'median'), dip=('aug_dip', 'median'), growth=('growth', 'median')).round(2))


if __name__ == '__main__':
    main()
