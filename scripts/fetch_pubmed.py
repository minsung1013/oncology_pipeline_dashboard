"""
논문 수집 스크립트.
Stage 2: PubMed E-utilities (약물명 검색)
Stage 3: Europe PMC (ASCO/ESMO 학회 초록 포함)
"""

import os
import time
import requests

# ── PubMed ──────────────────────────────────────────────────────────────────

PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
NCBI_API_KEY = os.environ.get("NCBI_API_KEY")
_PUBMED_SLEEP = 0.34 if not NCBI_API_KEY else 0.1

# ── Europe PMC ───────────────────────────────────────────────────────────────

EPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
_EPMC_SLEEP = 0.2  # 초당 5회 권장


# ---------------------------------------------------------------------------
# Stage 2: PubMed
# ---------------------------------------------------------------------------

def fetch_pubmed_links(drug_name: str, max_results: int = 3) -> list[dict]:
    pmids = _esearch(drug_name, max_results)
    if not pmids:
        return []
    time.sleep(_PUBMED_SLEEP)
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
        resp = requests.get(f"{PUBMED_BASE}esearch.fcgi", params=params, timeout=15)
        resp.raise_for_status()
        return resp.json().get("esearchresult", {}).get("idlist", [])
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
        resp = requests.get(f"{PUBMED_BASE}esummary.fcgi", params=params, timeout=15)
        resp.raise_for_status()
        result = resp.json().get("result", {})
        links = []
        for pmid in pmids:
            title = result.get(pmid, {}).get("title", "")
            if title:
                links.append({
                    "pmid": pmid,
                    "title": title,
                    "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}",
                    "source": "pubmed_search",
                })
        return links
    except Exception as e:
        print(f"  [PubMed efetch] {pmids}: {e}")
        return []


# ---------------------------------------------------------------------------
# Stage 3: Europe PMC (ASCO/ESMO/AACR/ASH 초록 포함)
# ---------------------------------------------------------------------------

def fetch_europepmc_links(drug_name: str, max_results: int = 3) -> list[dict]:
    """
    Europe PMC 검색 — PubMed보다 넓은 범위 (학회 초록, preprint 포함).
    ASCO/ESMO/AACR/ASH 초록도 커버.
    """
    params = {
        "query": f'TITLE:"{drug_name}" AND (SRC:MED OR SRC:PPR)',
        "resultType": "lite",
        "pageSize": max_results,
        "format": "json",
        "sort": "P_PDATE_D desc",  # 최신순
    }
    try:
        resp = requests.get(EPMC_BASE, params=params, timeout=15)
        resp.raise_for_status()
        results = resp.json().get("resultList", {}).get("result", [])
        links = []
        for r in results:
            pmid = r.get("pmid", "")
            title = r.get("title", "")
            if not title:
                continue
            # PMID 있으면 PubMed URL, 없으면 Europe PMC URL
            if pmid:
                url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}"
            else:
                epmc_id = r.get("id", "")
                source = r.get("source", "PPR")
                url = f"https://europepmc.org/article/{source}/{epmc_id}"

            links.append({
                "pmid": pmid or r.get("id", ""),
                "title": title,
                "url": url,
                "source": "europepmc",
            })
        return links
    except Exception as e:
        print(f"  [Europe PMC] {drug_name}: {e}")
        return []


# ---------------------------------------------------------------------------
# 통합 enrich
# ---------------------------------------------------------------------------

def enrich_with_pubmed(records: list[dict], delay: float = None) -> list[dict]:
    """
    Stage 2: pubmed_links 비어있는 것만 PubMed 검색.
    Stage 3: Stage 2 후에도 비어있는 것만 Europe PMC 검색.
    """
    pubmed_sleep = delay if delay is not None else _PUBMED_SLEEP

    # Stage 2: PubMed
    stage2_targets = [r for r in records if not r.get("pubmed_links")]
    stage1_count = len(records) - len(stage2_targets)
    print(f"  Stage 1 filled: {stage1_count}  |  Stage 2 (PubMed): {len(stage2_targets)}")

    for i, rec in enumerate(stage2_targets):
        drug_name = rec.get("drug_name", "")
        if not drug_name or drug_name == "Unknown":
            continue
        links = fetch_pubmed_links(drug_name)
        rec["pubmed_links"] = links
        if (i + 1) % 200 == 0:
            print(f"  Stage 2 progress: {i + 1}/{len(stage2_targets)}")
        time.sleep(pubmed_sleep)

    # Stage 3: Europe PMC (Stage 2 후에도 비어있는 것)
    stage3_targets = [r for r in records if not r.get("pubmed_links")]
    print(f"  Stage 3 (Europe PMC): {len(stage3_targets)}")

    for i, rec in enumerate(stage3_targets):
        drug_name = rec.get("drug_name", "")
        if not drug_name or drug_name == "Unknown":
            continue
        links = fetch_europepmc_links(drug_name)
        rec["pubmed_links"] = links
        if (i + 1) % 200 == 0:
            print(f"  Stage 3 progress: {i + 1}/{len(stage3_targets)}")
        time.sleep(_EPMC_SLEEP)

    return records


if __name__ == "__main__":
    import argparse, json

    parser = argparse.ArgumentParser()
    parser.add_argument("drug_name")
    parser.add_argument("--stage", choices=["pubmed", "epmc", "both"], default="both")
    args = parser.parse_args()

    if args.stage in ("pubmed", "both"):
        print("=== PubMed ===")
        print(json.dumps(fetch_pubmed_links(args.drug_name), ensure_ascii=False, indent=2))
    if args.stage in ("epmc", "both"):
        print("=== Europe PMC ===")
        print(json.dumps(fetch_europepmc_links(args.drug_name), ensure_ascii=False, indent=2))
