#!/usr/bin/env bash
# 오늘 보류된 OpenAlex 보강 작업을 한 번에 수행:
#  1) conference 초록 회사 보정 (institution type 기반, 본문오염 제거 + 교신저자)
#  2) 2026 논문 교신저자 보강
#  3) 프론트 재생성 + 변경분 R2 업로드 + parsed 번들 재업로드
# OpenAlex 스로틀이 풀렸다는 가정. 실패해도 로그에 남기고 진행.
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)"
LOG="logs/deferred_enrich.log"
mkdir -p logs
echo "==== [$(date '+%F %T')] 보류작업 시작 ====" >> "$LOG"

run() { echo ">> $*" >> "$LOG"; "$@" >> "$LOG" 2>&1; }

# 1) conference 회사/교신저자 보정 (72k, OpenAlex)
run python3 scripts/enrich_pub_authors.py --glob 'data/parsed/abstracts_*.json'
# 2) 2026 논문 교신저자
run python3 scripts/enrich_pub_authors.py --glob 'data/parsed/publications_2026.json'

# 3) 프론트 재생성 (전체)
run python3 scripts/make_frontend_data.py

# 4) 변경분 업로드: 학회 초록 전체 + 2026 논문 + facets
echo ">> R2 업로드" >> "$LOG"
for f in data/frontend/abstracts/*.json data/frontend/publications/2026.json data/frontend/facets.json; do
  [ -f "$f" ] || continue
  key="${f#data/frontend/}"
  gzip -9 -c "$f" > /tmp/dz.gz
  npx --yes wrangler r2 object put "oncology-data/$key" --file /tmp/dz.gz \
    --content-type application/json --content-encoding gzip --remote >> "$LOG" 2>&1 \
    && echo "   ✓ $key" >> "$LOG"
done

# 5) parsed 번들 재업로드 (학회 초록 변경 반영 — 주간 Action이 받아씀)
run python3 scripts/sync_parsed.py upload

echo "==== [$(date '+%F %T')] 보류작업 완료 ====" >> "$LOG"
