#!/usr/bin/env bash
# 자동 오케스트레이션 — xref 완료 후: drug_id 안정화 → 재파싱 → 캐시 재적용 → 논문 통합
# → 프론트 재생성·배포 → (성공 시) CI 복구. 검증 게이트 + 로깅. 실패 시 안전 지점에서 중단.
# detached: nohup bash scripts/finalize_integration.sh >/dev/null 2>&1 &
set -u
cd "$(dirname "$0")/.."
LOG="logs/integration_$(date +%Y%m%d_%H%M%S).log"
echo "LOG=$LOG" | tee logs/.integration_current
exec >> "$LOG" 2>&1
echo "===== 통합 오케스트레이션 시작 $(date) ====="
caffeinate -ims -w $$ &
set -a; [ -f .env.r2 ] && . ./.env.r2; set +a

die(){ echo "[FAIL] $* $(date)"; osascript -e "display notification \"통합 중단: $*\" with title \"오케스트레이션 실패\" sound name \"Basso\"" 2>/dev/null; exit 1; }
retry(){ local n=0; until "$@"; do n=$((n+1)); [ $n -ge 3 ] && return 1; echo "재시도 $n/3: $*"; sleep 20; done; }

# 0) 선행 작업(xref) 완료 대기
echo ">> 0/8 xref 완료 대기"
while pgrep -f "run_xref.sh" >/dev/null || pgrep -f "llm_enrich.py --mode xref" >/dev/null; do sleep 120; done
sleep 20
echo "   xref 종료 감지 $(date)"

# 1) drug_id 마이그레이션 (캐시 re-key) — 요약 보존의 핵심
echo ">> 1/8 drug_id 마이그레이션"
python3 scripts/migrate_drug_id.py || die "migrate_drug_id 실패"
PIPE_CACHE=$(python3 -c "import json;print(len(json.load(open('data/cache/llm_pipeline_cache.json'))))")
echo "   pipeline 요약 캐시 $PIPE_CACHE개"

# 2) 재파싱 (안정 id + conditions + countries + brief_summary + BACKGROUND필터 referencesModule)
echo ">> 2/8 재파싱 (industry 스코프, --skip-pubmed)"
python3 scripts/run_pipeline.py --mode full --skip-pubmed || die "재파싱 실패"
# 검증: drug_id가 16자리 hex(안정 해시)인지
HEXOK=$(python3 -c "import json,re;d=json.load(open('data/parsed/pipeline.json'))['drugs'];print(sum(1 for x in d if re.fullmatch(r'[0-9a-f]{16}', x.get('drug_id','')))==len(d))")
[ "$HEXOK" = "True" ] || die "재파싱 후 drug_id가 안정 해시 아님"
echo "   재파싱 완료, drug_id 안정 해시 확인"

# 3) 캐시 재적용 + 정규화
echo ">> 3/8 캐시 재적용"
python3 scripts/llm_merge.py --write || true
python3 scripts/llm_merge.py --mode abstracts --write || true
python3 scripts/llm_merge.py --mode pipeline --write || true
python3 scripts/llm_merge.py --mode xref --write || true
python3 scripts/normalize_fields.py --write || true
# 검증: 요약 보존율
SUM=$(python3 -c "import json;d=json.load(open('data/parsed/pipeline.json'))['drugs'];print(sum(1 for x in d if x.get('summary_ko')))")
echo "   summary_ko 보존: $SUM (정지 전 ~33,891 기대)"
[ "$SUM" -gt 25000 ] || die "요약 보존율 낮음($SUM) — 마이그레이션 점검 필요"

# 4) 임상 참조논문 → 코퍼스 통합
echo ">> 4/8 논문 통합 (efetch)"
python3 scripts/integrate_trial_papers.py || echo "[warn] 통합 일부 실패 — 계속"

# 5) 프론트 재생성(full)
echo ">> 5/8 프론트 재생성"
python3 scripts/make_frontend_data.py || die "make_frontend_data 실패"

# 6) R2 업로드 + parsed 동기화
echo ">> 6/8 R2 업로드"
retry python3 scripts/upload_r2.py || die "R2 업로드 실패"
python3 scripts/sync_parsed.py upload || true

# 7) 커밋 + push (프론트 코드 + 캐시 + 데이터)
echo ">> 7/8 git push"
git add scripts/ frontend/ data/cache/llm_pipeline_cache.json data/cache/llm_xref_cache.json data/cache/llm_drug_cache.json data/cache/llm_abstract_cache.json .github/ 2>/dev/null || true
git commit -m "feat: stable drug_id + trial-paper integration + pipeline UI (auto)" || true
git push || true

# 8) CI cron 복구 (drug_id 안정화 완료 = 위험 제거)
echo ">> 8/8 CI cron 복구"
python3 - <<'PY'
p='.github/workflows/update_pipeline.yml'
s=open(p).read()
s=s.replace("  # schedule:\n  #   - cron: '0 0 * * 1'","  schedule:\n    - cron: '0 0 * * 1'")
open(p,'w').write(s)
PY
git add .github/workflows/update_pipeline.yml && git commit -m "chore(ci): restore weekly cron (drug_id now stable)" && git push || true

osascript -e "display notification \"통합 완료: 요약 $SUM 보존, 논문 통합, UI 개선, CI 복구\" with title \"오케스트레이션 완료\" sound name \"Glass\"" 2>/dev/null || true
echo "===== 통합 완료 $(date) ====="
