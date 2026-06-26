#!/usr/bin/env bash
# pipeline 요약 LLM 런 완료를 기다렸다가 자동으로 병합→재생성→R2 배포까지 수행.
# 워치독(run_pipeline_summaries.sh)이 "완료" 감지 시 종료되므로, 그 프로세스가 사라지면 완료로 본다.
# detached 실행 권장:  nohup bash scripts/finalize_pipeline_deploy.sh >/dev/null 2>&1 &
set -u
cd "$(dirname "$0")/.."
LOG="logs/finalize_$(date +%Y%m%d_%H%M%S).log"
echo "LOG=$LOG" | tee logs/.finalize_current

exec >> "$LOG" 2>&1
echo "[finalize] 대기 시작 $(date) — 요약 워치독 종료 감지 시 배포"

# 요약 런(워치독) 종료까지 대기
while pgrep -f "run_pipeline_summaries.sh" >/dev/null; do sleep 120; done
# 워치독이 막 끝났어도 python이 캐시 마지막 저장 중일 수 있으니 잠깐 여유
sleep 15
echo "[finalize] 요약 런 완료 감지 $(date)"

retry() {  # $@ 명령을 최대 3회 재시도 (R2 SSL 일시 오류 대응)
  local n=0
  until "$@"; do
    n=$((n+1)); [ $n -ge 3 ] && return 1
    echo "[finalize] 재시도 $n/3: $*"; sleep 20
  done
}

python3 scripts/llm_merge.py --mode pipeline --write
python3 scripts/make_frontend_data.py --only pipeline
retry python3 scripts/upload_r2.py

# 요약 캐시를 git에 보존(추후 CI 재적용용) — 실패해도 배포 자체엔 영향 없음
git add data/cache/llm_pipeline_cache.json 2>/dev/null || true
git diff --staged --quiet || git commit -m "feat: pipeline Korean summaries (LLM, MoE@44) — cache" || true
git push || true

# 메모리 회수 — 요약 끝났으니 Ollama 내림
osascript -e 'tell application "Ollama" to quit' 2>/dev/null || true
pkill -9 -f "ollama runner" 2>/dev/null || true
pkill -9 -f "ollama serve" 2>/dev/null || true

echo "[finalize] 배포 완료 $(date) — pipeline.json(요약 포함) R2 반영, Ollama 종료"
