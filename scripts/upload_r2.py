"""
Cloudflare R2 업로더 (S3 SigV4, 의존성 없음).

data/frontend/ 의 lite 파일을 R2 버킷에 업로드한다.
자격증명은 .env.r2 (gitignore됨)에서 읽음:

    R2_ACCOUNT_ID=xxxxxxxx
    R2_ACCESS_KEY_ID=xxxx
    R2_SECRET_ACCESS_KEY=xxxx
    R2_BUCKET=oncology-data

R2 API 토큰: Cloudflare 대시보드 > R2 > Manage R2 API Tokens >
  "Object Read & Write" 권한으로 발급 → Access Key ID / Secret 사용.

용법: python scripts/upload_r2.py
"""

import datetime
import glob
import hashlib
import hmac
import os
import sys
import urllib.request


def load_env(path=".env.r2"):
    env = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        env.setdefault(k, os.environ.get(k, ""))
    missing = [k for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET") if not env.get(k)]
    if missing:
        sys.exit(f"누락된 설정: {missing} (.env.r2 또는 환경변수)")
    return env


def _sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def put_object(env, key, body: bytes, content_type="application/json"):
    host = f"{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    region, service = "auto", "s3"
    now = datetime.datetime.now(datetime.timezone.utc)
    amzdate = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_uri = f"/{env['R2_BUCKET']}/{key}"

    canonical_headers = (
        f"content-type:{content_type}\n"
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amzdate}\n"
    )
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_request = f"PUT\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"

    scope = f"{datestamp}/{region}/{service}/aws4_request"
    string_to_sign = (
        f"AWS4-HMAC-SHA256\n{amzdate}\n{scope}\n"
        f"{hashlib.sha256(canonical_request.encode()).hexdigest()}"
    )
    k_date = _sign(("AWS4" + env["R2_SECRET_ACCESS_KEY"]).encode(), datestamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    k_signing = _sign(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

    authorization = (
        f"AWS4-HMAC-SHA256 Credential={env['R2_ACCESS_KEY_ID']}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    req = urllib.request.Request(
        f"https://{host}{canonical_uri}", data=body, method="PUT",
        headers={
            "Host": host, "Content-Type": content_type, "x-amz-date": amzdate,
            "x-amz-content-sha256": payload_hash, "Authorization": authorization,
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


def main():
    env = load_env()
    files = ["data/frontend/index.json", "data/frontend/pipeline.json"]
    files += sorted(glob.glob("data/frontend/abstracts/*.json"))
    print(f"[R2] {env['R2_BUCKET']} 에 {len(files)}개 업로드")
    for fp in files:
        key = os.path.relpath(fp, "data/frontend").replace(os.sep, "/")
        body = open(fp, "rb").read()
        status = put_object(env, key, body)
        print(f"  {status}  {key}  ({len(body)/1024/1024:.1f} MB)")
    print(f"\n완료. 공개 URL 베이스: https://<r2.dev 또는 커스텀도메인>/  (각 파일: /{{key}})")


if __name__ == "__main__":
    main()
