"""
CDx 기회 플래그 계산 스크립트.
파싱된 레코드에 cdx_opportunity_score / cdx_opportunity_level / cdx_flags 추가.
"""

from datetime import datetime, timezone, date


def _parse_date(date_str: str) -> date | None:
    if not date_str:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            return datetime.strptime(date_str[:len(fmt.replace("%Y", "YYYY").replace("%m", "MM").replace("%d", "DD"))], fmt).date()
        except ValueError:
            continue
    return None


def is_completion_within_months(date_str: str, months: int = 6) -> bool:
    d = _parse_date(date_str)
    if d is None:
        return False
    today = datetime.now(timezone.utc).date()
    # 남은 일수가 0 ~ months*30 이내
    delta = (d - today).days
    return 0 <= delta <= months * 30


PRIORITY_CANCERS = [
    "colorectal", "gastric", "stomach", "colon", "rectal",
    "gastrointestinal", "GI", "CRC", "GC",
]


def calculate_cdx_opportunity(trial: dict) -> dict:
    score = 0
    flags = []

    # 1. Phase 1 완료 임박 (6개월 이내)
    if is_completion_within_months(trial.get("primary_completion_date", ""), months=6):
        score += 3
        flags.append("phase2_entry_imminent")

    # 2. 바이오마커 언급 있음
    if trial.get("biomarker_mentioned"):
        score += 2
        flags.append("biomarker_relevant")

    # 3. CDx 전략이 탐색적 또는 미정
    cdx_strategy = trial.get("cdx_strategy", "none")
    if cdx_strategy == "exploratory":
        score += 2
        flags.append("cdx_strategy_open")
    elif cdx_strategy == "none":
        score += 1
        flags.append("cdx_strategy_undefined")

    # 4. 우선 타겟 암종 (대장암 / 위암)
    condition = trial.get("condition", "").lower()
    if any(c.lower() in condition for c in PRIORITY_CANCERS):
        score += 2
        flags.append("priority_indication")

    # 5. 파트너십 없는 단독 개발
    if not trial.get("collaborators"):
        score += 1
        flags.append("no_partner")

    # 6. 타겟 Unknown → 수동 검토 필요
    if trial.get("target") == "Unknown":
        flags.append("needs_review")

    level = "high" if score >= 7 else "medium" if score >= 4 else "low"

    return {
        "cdx_opportunity_score": score,
        "cdx_opportunity_level": level,
        "cdx_flags": flags,
    }


def flag_all(records: list[dict]) -> list[dict]:
    for rec in records:
        opportunity = calculate_cdx_opportunity(rec)
        rec.update(opportunity)
    return records


def print_summary(records: list[dict]) -> None:
    levels = {"high": 0, "medium": 0, "low": 0}
    for r in records:
        lvl = r.get("cdx_opportunity_level", "low")
        levels[lvl] = levels.get(lvl, 0) + 1

    total = len(records)
    print(f"CDx Opportunity Summary ({total} records):")
    print(f"  High:   {levels['high']:4d} ({levels['high']/total*100:.1f}%)")
    print(f"  Medium: {levels['medium']:4d} ({levels['medium']/total*100:.1f}%)")
    print(f"  Low:    {levels['low']:4d} ({levels['low']/total*100:.1f}%)")

    needs_review = sum(1 for r in records if "needs_review" in r.get("cdx_flags", []))
    print(f"  Needs manual review (Unknown target): {needs_review}")


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Flag CDx opportunities in parsed records")
    parser.add_argument("parsed_path", help="파싱된 레코드 JSON 경로")
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    with open(args.parsed_path, encoding="utf-8") as f:
        records = json.load(f)

    flagged = flag_all(records)
    print_summary(flagged)

    if args.output:
        import os
        os.makedirs(os.path.dirname(args.output), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(flagged, f, ensure_ascii=False, indent=2)
        print(f"Saved -> {args.output}")
