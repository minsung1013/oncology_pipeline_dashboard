"""
전체 파이프라인 실행 스크립트.
fetch -> parse -> pubmed -> pipeline.json 생성
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))

from fetch_trials import run_full, run_delta, get_latest_full_date
from parse_fields import parse_raw_file
from fetch_pubmed import enrich_with_pubmed

RAW_DIR = "data/raw"
PARSED_DIR = "data/parsed"
OUTPUT_PATH = os.path.join(PARSED_DIR, "pipeline.json")


def build_pipeline_json(records: list[dict], raw_path: str) -> dict:
    companies = list({r["company"] for r in records if r.get("company")})
    return {
        "metadata": {
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "total_drugs": len(records),
            "total_companies": len(companies),
            "source_raw": raw_path,
        },
        "drugs": records,
    }


def main():
    parser = argparse.ArgumentParser(description="Run full oncology pipeline data update")
    parser.add_argument(
        "--mode", choices=["full", "delta", "auto"], default="auto",
        help="수집 모드 (default: auto)",
    )
    parser.add_argument("--since", default=None, help="delta 기준 날짜 (YYYY-MM-DD)")
    parser.add_argument("--skip-pubmed", action="store_true", help="PubMed 연동 건너뜀 (빠른 테스트용)")
    parser.add_argument("--sample", type=int, default=None, help="파싱 샘플 수 제한 (검증용)")
    args = parser.parse_args()

    # 1. 수집
    print("=" * 60)
    print("STEP 1: Fetch ClinicalTrials.gov data")
    print("=" * 60)

    if args.mode == "full":
        raw_path = run_full(RAW_DIR)
    elif args.mode == "delta":
        since = args.since or get_latest_full_date(RAW_DIR)
        if not since:
            print("ERROR: delta 모드에는 --since 또는 기존 full dump가 필요합니다.")
            sys.exit(1)
        raw_path = run_delta(since, RAW_DIR)
    else:
        latest = get_latest_full_date(RAW_DIR)
        raw_path = run_delta(latest, RAW_DIR) if latest else run_full(RAW_DIR)

    # 2. 파싱
    print()
    print("=" * 60)
    print("STEP 2: Parse fields")
    print("=" * 60)

    records = parse_raw_file(raw_path)

    if args.sample:
        print(f"  [sample mode] Using first {args.sample} records")
        records = records[: args.sample]

    # 3. PubMed 연동
    if not args.skip_pubmed:
        print()
        print("=" * 60)
        print("STEP 3: Enrich with PubMed links")
        print("=" * 60)
        print(f"  Fetching PubMed links for {len(records)} drugs...")
        records = enrich_with_pubmed(records)
    else:
        print()
        print("STEP 3: PubMed - skipped")

    # 4. pipeline.json 저장
    print()
    print("=" * 60)
    print("STEP 4: Save pipeline.json")
    print("=" * 60)

    os.makedirs(PARSED_DIR, exist_ok=True)
    payload = build_pipeline_json(records, raw_path)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    size_mb = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
    print(f"Saved -> {OUTPUT_PATH}  ({size_mb:.1f} MB)")
    print(f"  total_drugs:     {payload['metadata']['total_drugs']}")
    print(f"  total_companies: {payload['metadata']['total_companies']}")
    print()
    print("Pipeline update complete.")


if __name__ == "__main__":
    main()
