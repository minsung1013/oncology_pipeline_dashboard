"""파싱 품질 확인 스크립트."""
import sys, json
sys.path.insert(0, 'scripts')
from parse_fields import parse_raw_file
from flag_cdx import flag_all

records = parse_raw_file('data/raw/full_2026-06-06.json')
total = len(records)
records = flag_all(records)

# 모달리티 분포
by_modality = {}
for r in records:
    m = r['modality']
    by_modality[m] = by_modality.get(m, 0) + 1

print('=== Modality distribution ===')
for k, v in sorted(by_modality.items(), key=lambda x: -x[1]):
    print(f'  {k:<30s}: {v:4d} ({v/total*100:.1f}%)')

# 타겟 분포 Top 15
by_target = {}
for r in records:
    t = r['target']
    by_target[t] = by_target.get(t, 0) + 1

print('\n=== Target distribution (top 15) ===')
for k, v in sorted(by_target.items(), key=lambda x: -x[1])[:15]:
    print(f'  {k:<20s}: {v:4d} ({v/total*100:.1f}%)')

# Unknown 샘플 5건
unknowns = [r for r in records if r['modality'] == 'Unknown']
print(f'\n=== Unknown modality samples ({len(unknowns)} total) ===')
for r in unknowns[:8]:
    print(f'  {r["drug_name"][:40]:<40s} | {r["company"][:30]}')

# CDx 분포
by_cdx = {}
for r in records:
    lvl = r['cdx_opportunity_level']
    by_cdx[lvl] = by_cdx.get(lvl, 0) + 1

print('\n=== CDx opportunity distribution ===')
for k in ['high', 'medium', 'low']:
    v = by_cdx.get(k, 0)
    print(f'  {k:<10s}: {v:4d} ({v/total*100:.1f}%)')

# High CDx 샘플
highs = [r for r in records if r['cdx_opportunity_level'] == 'high']
print(f'\n=== High CDx samples ({len(highs)} total) ===')
for r in highs[:5]:
    print(f'  {r["drug_name"][:35]:<35s} | {r["company"][:25]:<25s} | {r["target"]:<12} | score={r["cdx_opportunity_score"]}')
    print(f'    flags: {r["cdx_flags"]}')
