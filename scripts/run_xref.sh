#!/usr/bin/env bash
# 크로스소스 보완 자동 런 (Option A: 전자동).
# 요약 런 + finalize(요약 배포)가 끝날 때까지 기다렸다가 → xref 보강(27b 품질) →
# 병합(채움/교정) → 프론트 재생성 → R2 배포 → 캐시 커밋/push 까지 무인 수행.
# detached 실행:  nohup bash scripts/run_xref.sh >/dev/null 2>&1 &
set -u
cd "$(dirname "$0")/.."
LOG="logs/xref_$(date +%Y%m%d_%H%M%S).log"
echo "LOG=$LOG" | tee logs/.xref_current
exec >> "$LOG" 2>&1
echo "[xref] 대기 시작 $(date) — 요약 런/finalize 완료 후 실행"

caffeinate -ims -w $$ &
set -a; [ -f .env.r2 ] && . ./.env.r2; set +a

# 선행 작업(요약 런·finalize) 종료까지 대기 — pipeline.json에 요약 반영되고 안정된 뒤 시작
while pgrep -f "run_pipeline_summaries.sh" >/dev/null || pgrep -f "finalize_pipeline_deploy.sh" >/dev/null; do
  sleep 120
done
sleep 30
git pull --rebase || true
echo "[xref] 선행 완료 감지 $(date) — 크로스소스 보강 시작 (27b)"

ensure_ollama() {
  curl -s http://localhost:11434/api/tags >/dev/null 2>&1 && return 0
  open -a Ollama 2>/dev/null || nohup ollama serve >> logs/ollama_serve.log 2>&1 &
  for _ in $(seq 1 30); do curl -s http://localhost:11434/api/tags >/dev/null 2>&1 && return 0; sleep 2; done
}
retry() { local n=0; until "$@"; do n=$((n+1)); [ $n -ge 3 ] && return 1; echo "[xref] 재시도 $n/3: $*"; sleep 20; done; }

# 품질용 dense 27b (부분 오프로드 기본 NUM_GPU=32). 워치독: 죽어도 캐시에서 재개.
export LLM_MODEL="qwen3.5:27b"
while true; do
  ensure_ollama || echo "[xref] Ollama 미응답 — 그래도 시도"
  python3 scripts/llm_enrich.py --mode xref
  if tail -5 "$LOG" | grep -q "완료. 캐시 총"; then
    echo "[xref] 보강 완료 감지 $(date)"; break
  fi
  echo "[xref] 비정상 중단 — 10s 후 캐시에서 재개 $(date)"; sleep 10
done

# 병합(채움/교정, 리뷰리포트) + 재배포
python3 scripts/llm_merge.py --mode xref --write
python3 scripts/make_frontend_data.py --only pipeline
python3 scripts/make_frontend_data.py --only facets
retry python3 scripts/upload_r2.py

# 캐시 git 보존 (CI 재적용 + 다음 증분 베이스)
git add data/cache/llm_xref_cache.json 2>/dev/null || true
git diff --staged --quiet || git commit -m "feat: cross-source reconciliation applied $(date +%Y-%m-%d)"
git push || true

# 메모리 회수 + 알림
osascript -e 'tell application "Ollama" to quit' 2>/dev/null || true
pkill -9 -f "ollama runner" 2>/dev/null || true
FILLED=$(python3 -c "import json;r=json.load(open('data/parsed/xref_review.json'));print(sum(1 for x in r if x['action']=='filled'))" 2>/dev/null || echo "?")
CORR=$(python3 -c "import json;r=json.load(open('data/parsed/xref_review.json'));print(sum(1 for x in r if x['action']=='corrected'))" 2>/dev/null || echo "?")
osascript -e "display notification \"채움 ${FILLED} · 교정 ${CORR} — xref_review.json 확인\" with title \"크로스소스 보완 완료\" sound name \"Glass\"" || true
echo "[xref] 전체 완료 $(date) — 채움 ${FILLED} 교정 ${CORR}"
