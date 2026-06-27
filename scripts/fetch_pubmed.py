"""
논문 수집 — 정밀도 우선 전략.

Stage 1 (parse_fields.py): ClinicalTrials.gov referencesModule (연구자 큐레이션)
Stage 2 (이 파일):        Europe PMC를 NCT ID로 검색
                          쿼리: "<NCT>" AND "<drug>" NOT review
                          → 그 시험을 직접 보고한 1차 연구만, 리뷰/노이즈 배제
                          관련 논문이 명확하지 않으면 빈 결과 (노이즈보다 공백 선호)
"""

import time
import requests

EPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
_EPMC_SLEEP = 0.2  # 초당 5회

# 항목당 검색할 최대 NCT 수 (대표 시험 위주)
_MAX_NCT_PER_ENTRY = 3
# 항목당 최종 논문 링크 수
_MAX_LINKS = 3


def fetch_papers_by_nct(nct_id: str, drug_name: str, max_results: int = 5) -> list[dict]:
    """
    정밀도 우선: 해당 NCT를 직접 언급하고 약물명도 포함하는 1차 연구 논문.
    리뷰/메타분석 제외. 결과 없으면 빈 리스트 (노이즈 회피).
    """
    if not nct_id or not drug_name or drug_name == "Unknown":
        return []

    # 약물명은 제목(TITLE)에서만 매칭 — 본문에 약물명만 스친 광범위 논문을 배제(정밀도↑).
    # NCT 직접 언급 + 약물명이 제목에 있는 1차 연구만.
    query = f'"{nct_id}" AND TITLE:"{drug_name}" NOT (PUB_TYPE:"review")'
    params = {
        "query": query,
        "resultType": "lite",
        "pageSize": max_results,
        "format": "json",
        "sort": "CITED desc",
    }
    try:
        resp = requests.get(EPMC_BASE, params=params, timeout=15)
        resp.raise_for_status()
        results = resp.json().get("resultList", {}).get("result", [])
    except Exception as e:
        print(f"  [EPMC] {nct_id}/{drug_name}: {e}")
        return []

    links = []
    for r in results:
        title = r.get("title", "")
        if not title:
            continue
        pmid = r.get("pmid", "")
        if pmid:
            url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}"
        else:
            url = f"https://europepmc.org/article/{r.get('source','PPR')}/{r.get('id','')}"
        links.append({
            "pmid": pmid or r.get("id", ""),
            "title": title,
            "url": url,
            "source": "europepmc_nct",
            "nct": nct_id,
        })
    return links


def fetch_links_for_entry(record: dict) -> list[dict]:
    """한 약물 항목의 NCT들을 검색해 논문 링크를 합침 (PMID 중복 제거)."""
    drug_name = record.get("drug_name", "")
    ncts = record.get("nct_ids", [])[:_MAX_NCT_PER_ENTRY]

    seen = set()
    merged = []
    for nct in ncts:
        for link in fetch_papers_by_nct(nct, drug_name):
            pmid = link.get("pmid", "")
            if pmid and pmid not in seen:
                seen.add(pmid)
                merged.append(link)
        time.sleep(_EPMC_SLEEP)
    return merged[:_MAX_LINKS]


def enrich_with_pubmed(records: list[dict], delay: float = None) -> list[dict]:
    """
    Stage 2: Stage 1(referencesModule)에서 논문을 못 찾은 항목만
    Europe PMC NCT 검색으로 보강. 정밀도 우선.
    """
    targets = [r for r in records if not r.get("pubmed_links")]
    stage1 = len(records) - len(targets)
    print(f"  Stage 1 filled: {stage1}  |  Stage 2 (EPMC by NCT): {len(targets)}")

    found = 0
    for i, rec in enumerate(targets):
        links = fetch_links_for_entry(rec)
        if links:
            rec["pubmed_links"] = links
            found += 1
        if (i + 1) % 200 == 0:
            print(f"  Stage 2 progress: {i + 1}/{len(targets)}  (found {found})")

    print(f"  Stage 2 done: {found} entries newly matched")
    return records


if __name__ == "__main__":
    import argparse, json

    parser = argparse.ArgumentParser(description="Test precision-first paper search")
    parser.add_argument("nct_id")
    parser.add_argument("drug_name")
    args = parser.parse_args()

    links = fetch_papers_by_nct(args.nct_id, args.drug_name)
    print(json.dumps(links, ensure_ascii=False, indent=2))
