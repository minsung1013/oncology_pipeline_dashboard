#!/usr/bin/env bash
# 프론트엔드 lite 데이터(data/frontend/)를 Cloudflare R2에 업로드.
#
# 사전 준비 (1회):
#   1) Cloudflare 대시보드 > R2 > 버킷 생성 (예: oncology-data)
#   2) 그 버킷에 Public access 활성화 (R2.dev 서브도메인) 또는 커스텀 도메인 연결
#   3) npx wrangler login  (Cloudflare 계정 인증)
#
# 사용:
#   R2_BUCKET=oncology-data bash scripts/upload_r2.sh
#
# 업로드 대상: data/frontend/index.json, abstracts/*.json, pipeline.json
# 공개 URL 예: https://<버킷>.<account>.r2.dev/index.json  (또는 커스텀 도메인)

set -euo pipefail
BUCKET="${R2_BUCKET:?R2_BUCKET 환경변수 필요 (예: R2_BUCKET=oncology-data)}"
SRC="data/frontend"

upload() {  # $1 = 로컬경로(상대 SRC)
  local rel="$1"
  # gzip + Content-Encoding: gzip 으로 업로드 → 전송량 ~5배 감소(브라우저 자동 해제).
  # R2 dev URL은 자동 압축을 안 하므로 직접 압축 저장한다.
  local gz; gz="$(mktemp)"
  gzip -9 -c "$SRC/$rel" > "$gz"
  echo "  -> $rel ($(du -h "$gz" | cut -f1) gz)"
  npx --yes wrangler r2 object put "$BUCKET/$rel" \
    --file "$gz" --content-type "application/json" \
    --content-encoding gzip --remote
  rm -f "$gz"
}

echo "[R2] uploading data/frontend/ to bucket: $BUCKET"
upload "index.json"
upload "pipeline.json"
for f in "$SRC"/abstracts/*.json; do
  upload "abstracts/$(basename "$f")"
done
echo "[R2] done. 공개 URL을 프론트 .env(VITE_DATA_BASE_URL)에 설정하세요."
