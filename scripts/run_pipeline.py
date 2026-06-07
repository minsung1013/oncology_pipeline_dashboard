"""
전체 파이프라인 실행 스크립트.
fetch -> parse -> pubmed -> pipeline.json 생성
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# 프로젝트 루트의 .env 자동 로드
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

sys.path.insert(0, os.path.dirname(__file__))

from fetch_trials import run_full, run_delta, get_latest_full_date
from parse_fields import parse_raw_file
from fetch_pubmed import enrich_with_pubmed

RAW_DIR = "data/raw"
PARSED_DIR = "data/parsed"
OUTPUT_PATH = os.path.join(PARSED_DIR, "pipeline.json")


def _entry_key(d: dict) -> tuple:
    """약물명+회사+phase+적응증 기준 식별 키."""
    return (
        (d.get("drug_name", "") or "").strip().lower(),
        (d.get("company", "") or "").strip().lower(),
        d.get("phase", ""),
        d.get("cancer_category", ""),
    )


def merge_existing_papers(records: list[dict], path: str) -> tuple[int, set]:
    """
    기존 pipeline.json에서 논문 링크를 가져와 보존 (증분 매칭).
    반환: (보존된 항목 수, 기존에 존재했던 키 집합)
    - 기존에 논문이 있던 항목 → 그대로 복사 (재검색 안 함)
    - 기존에 있었으나 논문이 0이던 항목 → 키만 기록 (재검색 스킵용)
    """
    if not os.path.exists(path):
        return 0, set()
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except Exception:
        return 0, set()

    links_map = {}
    known_keys = set()
    for d in old.get("drugs", []):
        k = _entry_key(d)
        known_keys.add(k)
        if d.get("pubmed_links"):
            links_map[k] = d["pubmed_links"]

    preserved = 0
    for rec in records:
        if not rec.get("pubmed_links"):
            k = _entry_key(rec)
            if k in links_map:
                rec["pubmed_links"] = links_map[k]
                preserved += 1
    return preserved, known_keys


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
    parser.add_argument("--skip-pubmed", action="store_true", help="논문 매칭 건너뜀 (빠른 테스트용)")
    parser.add_argument("--full-rematch", action="store_true", help="기존 키 무시하고 비어있는 모든 항목 재검색")
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

    # 2.5 증분 병합: 기존 pipeline.json의 논문 데이터 보존
    print()
    print("=" * 60)
    print("STEP 2.5: Merge existing papers (incremental)")
    print("=" * 60)
    preserved, known_keys = merge_existing_papers(records, OUTPUT_PATH)
    print(f"  Preserved papers from existing: {preserved}")
    print(f"  Known keys: {len(known_keys)}")

    # 3. 논문 매칭 — 신규 항목만 (기존에 검색한 키는 스킵)
    if not args.skip_pubmed:
        print()
        print("=" * 60)
        print("STEP 3: Enrich NEW entries with paper links")
        print("=" * 60)
        if args.full_rematch:
            new_records = [r for r in records if not r.get("pubmed_links")]
            print(f"  [full-rematch] Searching all {len(new_records)} empty entries")
        else:
            new_records = [
                r for r in records
                if not r.get("pubmed_links") and _entry_key(r) not in known_keys
            ]
            print(f"  New entries to search: {len(new_records)} (incremental)")
        enrich_with_pubmed(new_records)
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
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    size_mb = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
    print(f"Saved -> {OUTPUT_PATH}  ({size_mb:.1f} MB)")
    print(f"  total_drugs:     {payload['metadata']['total_drugs']}")
    print(f"  total_companies: {payload['metadata']['total_companies']}")
    print()
    print("Pipeline update complete.")


if __name__ == "__main__":
    main()
