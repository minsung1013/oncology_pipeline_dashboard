"""
PubMed E-utilities API 연동.
약물명 기준으로 관련 논문 최대 3건 링크 반환.
"""

import os
import time
import requests

BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
NCBI_API_KEY = os.environ.get("NCBI_API_KEY")

# API key 없으면 초당 3회, 있으면 초당 10회
_SLEEP = 0.34 if not NCBI_API_KEY else 0.1


def fetch_pubmed_links(drug_name: str, max_results: int = 3) -> list[dict]:
    """
    drug_name 기준으로 PubMed 논문 검색.
    반환: [{"pmid": str, "title": str, "url": str}]
    """
    pmids = _esearch(drug_name, max_results)
    if not pmids:
        return []
    time.sleep(_SLEEP)
    return _efetch(pmids)


def _esearch(drug_name: str, max_results: int) -> list[str]:
    params = {
        "db": "pubmed",
        "term": f"{drug_name}[Title/Abstract] AND clinical trial[PT]",
        "retmax": max_results,
        "retmode": "json",
        "sort": "relevance",
    }
    if NCBI_API_KEY:
        params["api_key"] = NCBI_API_KEY

    try:
        resp = requests.get(f"{BASE_URL}esearch.fcgi", params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        return data.get("esearchresult", {}).get("idlist", [])
    except Exception as e:
        print(f"  [PubMed esearch] {drug_name}: {e}")
        return []


def _efetch(pmids: list[str]) -> list[dict]:
    params = {
        "db": "pubmed",
        "id": ",".join(pmids),
        "retmode": "json",
        "rettype": "abstract",
    }
    if NCBI_API_KEY:
        params["api_key"] = NCBI_API_KEY

    try:
        resp = requests.get(f"{BASE_URL}esummary.fcgi", params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        result_data = data.get("result", {})

        links = []
        for pmid in pmids:
            article = result_data.get(pmid, {})
            title = article.get("title", "")
            if title:
                links.append({
                    "pmid": pmid,
                    "title": title,
                    "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}",
                })
        return links
    except Exception as e:
        print(f"  [PubMed efetch] {pmids}: {e}")
        return []


def enrich_with_pubmed(records: list[dict], delay: float = None) -> list[dict]:
    """
    파싱된 레코드 리스트에 pubmed_links 필드를 채움.
    rate limit 대응을 위해 각 호출 사이에 sleep.
    """
    sleep_interval = delay if delay is not None else _SLEEP

    for i, rec in enumerate(records):
        drug_name = rec.get("drug_name", "")
        if not drug_name or drug_name == "Unknown":
            continue

        links = fetch_pubmed_links(drug_name)
        rec["pubmed_links"] = links

        if (i + 1) % 50 == 0:
            print(f"  PubMed enriched: {i + 1}/{len(records)}")

        time.sleep(sleep_interval)

    return records


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Test PubMed fetch for a drug name")
    parser.add_argument("drug_name", help="e.g. 'Tislelizumab'")
    args = parser.parse_args()

    links = fetch_pubmed_links(args.drug_name)
    print(json.dumps(links, ensure_ascii=False, indent=2))
