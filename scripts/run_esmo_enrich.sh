#!/usr/bin/env bash
# 슬립/크래시에도 멈추지 않는 ESMO LLM 보강 감시 실행.
#  - 캐시(10건마다 원자적 저장)로 항상 이어서 진행 → 어떤 이유로 죽어도 재시작하면 이어감.
#  - Ollama가 죽었으면 Flash Attention 켜서 재시작.
#  - 남은 ESMO 초록이 0이 될 때까지 반복.
# 사용: caffeinate -i -m -s -d bash scripts/run_esmo_enrich.sh
set -u
cd "$(dirname "$0")/.."
export LLM_MODEL="${LLM_MODEL:-qwen3:30b-a3b-q4_K_M}"
export LLM_NUM_GPU="${LLM_NUM_GPU:-45}"

remaining() {
  python3 - <<'PY'
import json, glob, os
p = 'data/cache/llm_abstract_cache.json'
cache = set(json.load(open(p))) if os.path.exists(p) else set()
n = sum(1 for fp in glob.glob('data/parsed/abstracts_esmo*.json')
        for a in json.load(open(fp))['abstracts'] if a['uid'] not in cache)
print(n)
PY
}

attempt=0
while true; do
  attempt=$((attempt + 1))
  # Ollama 살아있는지 확인, 없으면 FA로 재시작
  if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "[$(date '+%F %T')] Ollama 미응답 → FA=1로 재시작"
    OLLAMA_FLASH_ATTENTION=1 nohup ollama serve >/tmp/ollama_fa.log 2>&1 &
    sleep 10
  fi

  echo "[$(date '+%F %T')] enrich 시도 #$attempt (남은: $(remaining))"
  python3 scripts/llm_enrich.py --mode abstracts || echo "[$(date '+%F %T')] enrich 비정상 종료 — 재시도"

  rem=$(remaining)
  echo "[$(date '+%F %T')] 라운드 종료, 남은 ESMO: $rem"
  if [ "$rem" -eq 0 ]; then
    echo "[$(date '+%F %T')] ✅ ESMO 보강 완료"
    break
  fi
  sleep 10
done
