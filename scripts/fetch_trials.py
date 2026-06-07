"""
ClinicalTrials.gov API v2 수집 스크립트.
full 모드: 전체 수집 → data/raw/full_YYYY-MM-DD.json
delta 모드: lastUpdatePostDate 이후 변경분 → data/raw/delta_YYYY-MM-DD.json
"""

import json
import os
import time
from datetime import datetime, timezone

import requests
from tqdm import tqdm

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"

FIELDS = [
    "NCTId",
    "BriefTitle",
    "OfficialTitle",
    "Condition",
    "InterventionName",
    "InterventionDescription",
    "InterventionType",
    "Phase",
    "OverallStatus",
    "LeadSponsorName",
    "CollaboratorName",
    "PrimaryCompletionDate",
    "StartDate",
    "EligibilityCriteria",
    "BriefSummary",
    "DetailedDescription",
    "LastUpdatePostDate",
    "StudyFirstPostDate",
    "EnrollmentCount",
    "ArmGroupLabel",
    "ArmGroupDescription",
    "PrimaryOutcomeMeasure",
    "SecondaryOutcomeMeasure",
]

BASE_PARAMS = {
    "query.cond": (
        "cancer OR carcinoma OR tumor OR neoplasm OR lymphoma "
        "OR leukemia OR sarcoma OR melanoma"
    ),
    # phase 필터 제거 → 전체 Phase 수집 (UI에서 필터링)
    "aggFilters": "studyType:int,funderType:industry",
    "fields": ",".join(FIELDS),
    "countTotal": "true",
    "pageSize": 100,
}


def fetch_all_studies(extra_params: dict = None) -> list:
    params = {**BASE_PARAMS}
    if extra_params:
        params.update(extra_params)

    all_studies = []
    next_token = None
    page = 0

    with tqdm(desc="Fetching studies", unit="page") as pbar:
        while True:
            if next_token:
                params["pageToken"] = next_token
            elif "pageToken" in params:
                del params["pageToken"]

            resp = requests.get(BASE_URL, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            batch = data.get("studies", [])
            all_studies.extend(batch)
            page += 1
            pbar.update(1)
            pbar.set_postfix(total=len(all_studies))

            next_token = data.get("nextPageToken")
            if not next_token:
                break

            # API rate limit 대응
            time.sleep(0.5)

    return all_studies


def save_json(obj: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print(f"Saved -> {path}  ({os.path.getsize(path) / 1024 / 1024:.1f} MB)")


def run_full(output_dir: str = "data/raw") -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"[full] Fetching all Phase 1 oncology trials as of {today}...")

    studies = fetch_all_studies()

    payload = {
        "fetch_date": datetime.now(timezone.utc).isoformat(),
        "fetch_type": "full",
        "total_count": len(studies),
        "studies": studies,
    }

    path = os.path.join(output_dir, f"full_{today}.json")
    save_json(payload, path)
    print(f"[full] Done - {len(studies)} studies collected.")
    return path


def run_delta(last_run_date: str, output_dir: str = "data/raw") -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"[delta] Fetching studies updated since {last_run_date}...")

    # v2 API는 filter.lastUpdatePostDate 미지원 → query.term AREA 구문 사용
    studies = fetch_all_studies({
        "query.term": f"AREA[LastUpdatePostDate]RANGE[{last_run_date},MAX]"
    })

    payload = {
        "fetch_date": datetime.now(timezone.utc).isoformat(),
        "fetch_type": "delta",
        "since_date": last_run_date,
        "total_count": len(studies),
        "studies": studies,
    }

    path = os.path.join(output_dir, f"delta_{today}.json")
    save_json(payload, path)
    print(f"[delta] Done - {len(studies)} studies collected.")
    return path


def get_latest_full_date(raw_dir: str = "data/raw") -> str | None:
    """data/raw/ 에서 가장 최근 full_*.json 의 날짜를 반환."""
    if not os.path.isdir(raw_dir):
        return None
    files = [
        f for f in os.listdir(raw_dir)
        if f.startswith("full_") and f.endswith(".json")
    ]
    if not files:
        return None
    files.sort(reverse=True)
    # full_YYYY-MM-DD.json → YYYY-MM-DD
    return files[0][5:15]


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Fetch ClinicalTrials.gov Phase 1 data")
    parser.add_argument(
        "--mode",
        choices=["full", "delta", "auto"],
        default="auto",
        help="full=전체수집, delta=변경분, auto=full없으면full 아니면delta",
    )
    parser.add_argument("--since", default=None, help="delta 기준 날짜 (YYYY-MM-DD)")
    parser.add_argument("--output-dir", default="data/raw")
    args = parser.parse_args()

    if args.mode == "full":
        run_full(args.output_dir)
    elif args.mode == "delta":
        since = args.since or get_latest_full_date(args.output_dir)
        if not since:
            raise ValueError("--since 날짜를 지정하거나 full dump가 먼저 있어야 합니다.")
        run_delta(since, args.output_dir)
    else:  # auto
        latest = get_latest_full_date(args.output_dir)
        if latest:
            run_delta(latest, args.output_dir)
        else:
            run_full(args.output_dir)
