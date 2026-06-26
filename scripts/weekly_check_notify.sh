#!/usr/bin/env bash
# 주간 체크 + 알림 (LLM 없음, 가벼움). launchd가 월요일 CI 이후 호출.
# CI가 R2에 올린 최신 데이터에서 "LLM 보강이 필요한 신규 항목" 수를 세고,
# 있으면 macOS 알림을 띄운다. 실제 보강은 사용자가 앱을 닫고 수동 실행:
#     bash scripts/weekly_local_enrich.sh
set -u
cd "$(dirname "$0")/.."
LOG="logs/weekly_check_$(date +%Y%m%d_%H%M%S).log"
exec >> "$LOG" 2>&1
echo "===== 주간 체크 $(date) ====="

set -a; [ -f .env.r2 ] && . ./.env.r2; set +a
git pull --rebase || true   # 최신 캐시 동기화

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# CI가 방금 올린 최신 데이터 받기 (가벼움: 네트워크만)
if [ -n "${R2_BASE_URL:-}" ]; then
  curl -fsSL --compressed "${R2_BASE_URL}/pipeline.json" -o "$TMP/pipeline.json" || true
  for y in 2024 2025 2026; do
    curl -fsSL --compressed "${R2_BASE_URL}/publications/${y}.json" -o "$TMP/pub_${y}.json" || true
  done
fi

# 신규(미캐시) 건수 집계 — 로컬 캐시(git) 대비
read NEW_TRIALS NEW_PUBS <<<"$(python3 - "$TMP" <<'PY'
import json, glob, os, sys
tmp = sys.argv[1]
def load(p):
    try: return json.load(open(p, encoding="utf-8"))
    except Exception: return None

# 임상시험: lite pipeline.json 의 drug_id vs 요약 캐시
pcache = set()
if os.path.exists("data/cache/llm_pipeline_cache.json"):
    pcache = set(json.load(open("data/cache/llm_pipeline_cache.json")).keys())
pl = load(os.path.join(tmp, "pipeline.json"))
new_trials = 0
if pl:
    for d in pl.get("drugs", []):
        did = d.get("drug_id")
        if did and did not in pcache and (d.get("brief_summary") or d.get("official_title") or d.get("brief_title")):
            new_trials += 1
    # brief_summary는 lite에 없으니, 캐시에 없는 drug_id 전부를 신규로 본다(보수적 상한)
    if new_trials == 0:
        new_trials = sum(1 for d in pl.get("drugs", []) if d.get("drug_id") and d["drug_id"] not in pcache)

# 논문: 최근연도 publications uid vs 초록/요약 캐시
acache = set()
if os.path.exists("data/cache/llm_abstract_cache.json"):
    acache = set(json.load(open("data/cache/llm_abstract_cache.json")).keys())
new_pubs = 0
for p in glob.glob(os.path.join(tmp, "pub_*.json")):
    data = load(p)
    if not data: continue
    for a in data.get("abstracts", []):
        if a.get("uid") and a["uid"] not in acache and (a.get("title") or a.get("abstract_text")):
            new_pubs += 1
print(new_trials, new_pubs)
PY
)"
NEW_TRIALS=${NEW_TRIALS:-0}; NEW_PUBS=${NEW_PUBS:-0}
echo "신규 임상시험 ${NEW_TRIALS} · 신규 논문 ${NEW_PUBS}"

TOTAL=$((NEW_TRIALS + NEW_PUBS))
if [ "$TOTAL" -gt 0 ]; then
  osascript -e "display notification \"신규 임상시험 ${NEW_TRIALS}건 · 논문 ${NEW_PUBS}건 — 앱 닫고 'bash scripts/weekly_local_enrich.sh' 실행\" with title \"주간 LLM 보강 대기 (${TOTAL}건)\" sound name \"Glass\"" || true
  echo "알림 발송 (${TOTAL}건)"
else
  echo "신규 없음 — 알림 생략"
fi
echo "===== 체크 완료 $(date) ====="
