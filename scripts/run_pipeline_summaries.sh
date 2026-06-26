#!/usr/bin/env bash
# pipeline 한국어 요약(LLM) — 슬립에 강건한 무인 실행 래퍼.
#
# macOS는 실제 슬립에 들어가면 CPU/GPU가 정지해 그동안은 추론이 멈춘다(물리적 한계).
# 그래서 두 방어선을 함께 둔다:
#   1) caffeinate -ims  : 유휴/디스크/시스템 슬립을 막는다 (AC 전원 권장).
#   2) while 워치독      : 어떤 이유로 프로세스가 죽거나(슬립→깨어남 시 Ollama 끊김 등)
#                          비정상 종료해도 캐시(drug_id) 기반으로 자동 재시작 → 끝까지 진행.
# 캐시는 10건마다 원자적 저장되므로 중단 시 손실은 최대 10건.
#
# 사용:  nohup bash scripts/run_pipeline_summaries.sh > /dev/null 2>&1 &
set -u
cd "$(dirname "$0")/.."

LOG="logs/enrich_pipeline_$(date +%Y%m%d_%H%M%S).log"
echo "LOG=$LOG" | tee logs/.enrich_pipeline_current

# 이 스크립트가 사는 동안 슬립 방지 (-w: 지정 PID 종료까지 단언 유지)
caffeinate -ims -w $$ &

ensure_ollama() {
  curl -s http://localhost:11434/api/tags >/dev/null 2>&1 && return 0
  open -a Ollama 2>/dev/null || nohup ollama serve >> logs/ollama_serve.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -s http://localhost:11434/api/tags >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "[watchdog] attempt #$attempt $(date)" >> "$LOG"
  ensure_ollama || echo "[watchdog] Ollama 미응답 — 그래도 시도(스크립트가 연결 재시도함)" >> "$LOG"

  LLM_MODEL="qwen3:30b-a3b-q4_K_M" LLM_NUM_GPU=44 \
    python3 scripts/llm_enrich.py --mode pipeline >> "$LOG" 2>&1

  # 정상 완료 판정 — run_pipeline_summaries() 가 마지막에 "완료. 캐시 총 N" 출력
  if tail -5 "$LOG" | grep -q "완료. 캐시 총"; then
    echo "[watchdog] 완료 감지 — 종료 $(date)" >> "$LOG"
    break
  fi
  echo "[watchdog] 비정상 중단 — 10s 후 캐시에서 재개 $(date)" >> "$LOG"
  sleep 10
done
