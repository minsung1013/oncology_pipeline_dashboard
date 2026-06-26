#!/usr/bin/env bash
# 주간 로컬 LLM 보강 + 배포 (CI 이후 신규 데이터 처리).
#
# 왜 로컬인가: LLM(Ollama/GPU)은 GitHub Actions에 없어 CI는 캐시 재적용만 한다.
# 캐시에 없는 "신규" 항목(신규 논문·약물·임상시험)의 한국어 요약/modality/target은
# 로컬 GPU에서만 만들 수 있다. 이 스크립트가 그 델타를 채우고 R2까지 배포한다.
#
# 모든 enrich 모드는 캐시(uid/약물명/drug_id) 기준 증분 — 기존 항목은 건너뛰므로
# 주간 델타(수십~수백 건)만 처리되어 보통 수 분이면 끝난다. 중단돼도 캐시로 재개.
#
# 스케줄: launchd(LaunchAgent)가 매주 월요일 CI(09:00 KST) 이후 호출 (scripts/launchd/*.plist).
# 수동 실행:  bash scripts/weekly_local_enrich.sh
set -u
cd "$(dirname "$0")/.."

LOG="logs/weekly_enrich_$(date +%Y%m%d_%H%M%S).log"
echo "LOG=$LOG" | tee logs/.weekly_enrich_current
exec >> "$LOG" 2>&1
echo "===== 주간 로컬 보강 시작 $(date) ====="

# 이 스크립트 사는 동안 슬립 방지 (-w: PID 종료까지)
caffeinate -ims -w $$ &

# R2 자격증명 + R2_BASE_URL + OPENALEX_KEY
set -a; [ -f .env.r2 ] && . ./.env.r2; set +a

git pull --rebase || true   # 최신 코드 + CI가 커밋한 캐시

# 1) CI가 만든 최신 데이터 가져오기 -----------------------------------------
#    초록·논문(full parsed, 기존 요약 포함)은 R2 번들에서.
if [ -n "${R2_BASE_URL:-}" ]; then
  python3 scripts/sync_parsed.py download "$R2_BASE_URL" || echo "(parsed 다운로드 실패 — 로컬 사본 사용)"
else
  echo "(R2_BASE_URL 없음 — parsed 다운로드 생략, 로컬 사본 사용)"
fi
#    pipeline.json은 번들 제외(매번 재생성) → full 재수집해 brief_summary 확보 후 캐시 재적용.
python3 scripts/run_pipeline.py --mode full --skip-pubmed
python3 scripts/llm_merge.py --write || true
python3 scripts/normalize_fields.py --write || true

# 2) Ollama 기동 ------------------------------------------------------------
curl -s http://localhost:11434/api/tags >/dev/null 2>&1 || { open -a Ollama 2>/dev/null || nohup ollama serve >> logs/ollama_serve.log 2>&1 & }
for _ in $(seq 1 30); do curl -s http://localhost:11434/api/tags >/dev/null 2>&1 && break; sleep 2; done

# 3) 신규 항목만 LLM 보강 (증분; 캐시된 건 자동 skip) -------------------------
export LLM_MODEL="qwen3:30b-a3b-q4_K_M" LLM_NUM_GPU=44
python3 scripts/llm_enrich.py --mode drugs --only-unknown   # 신규 약물 modality/target/biomarker
python3 scripts/llm_enrich.py --mode abstracts             # 신규 학회초록 + 논문 요약
python3 scripts/llm_enrich.py --mode pipeline              # 신규 임상시험 요약

# 4) 캐시 → 데이터 병합 + 정규화 --------------------------------------------
python3 scripts/llm_merge.py --write || true
python3 scripts/llm_merge.py --mode abstracts --write || true
python3 scripts/llm_merge.py --mode pipeline --write || true
python3 scripts/normalize_fields.py --write || true

# 5) 프론트 재생성 + R2 배포 ------------------------------------------------
python3 scripts/make_frontend_data.py
python3 scripts/upload_r2.py
python3 scripts/sync_parsed.py upload || true

# 6) 캐시를 git에 보존 (CI 재적용 + 다음 주 증분 베이스) ----------------------
git add data/cache/llm_drug_cache.json data/cache/llm_abstract_cache.json data/cache/llm_pipeline_cache.json 2>/dev/null || true
git diff --staged --quiet || git commit -m "chore: weekly local LLM enrich $(date +%Y-%m-%d)"
git push || true

# 7) 메모리 회수
osascript -e 'tell application "Ollama" to quit' 2>/dev/null || true
pkill -9 -f "ollama runner" 2>/dev/null || true

echo "===== 주간 로컬 보강 완료 $(date) ====="
