"""
저널 논문 수집 (PubMed) — NCT 연결 종양 논문.

학회 초록(ASCO/AACR/ESMO)·임상시험에 이어 '퍼블리케이션' 축.
PubMed에서 ClinicalTrials.gov 등록(NCT)이 있는 종양 논문을 받아 초록 스키마로 변환
→ 기존 프론트/NCT 크로스링크 재사용.

용법:
  python scripts/fetch_publications.py --years 2020 2021 2022 2023 2024 2025
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from parse_asco import (  # noqa: E402
    infer_modality_list, infer_target_list, infer_biomarker_list,
    extract_drugs, retag_cancer, extract_nct_ids, extract_phases,
    parse_author, clean_text,
)
from normalize_entities import normalize_companies  # noqa: E402

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
MAILTO = "oncology-dashboard@example.com"
TOOL = "OncologyDashboard"
SLEEP = 0.34  # NCBI: API키 없이 ~3 req/s

ONCO = "(cancer OR neoplasm OR tumor OR oncology OR carcinoma)"
NCT_RE = re.compile(r"NCT\d{8}")

# 표시용 publication_type 우선순위 (구체적 임상 유형 우선)
_PTYPE_PRIORITY = [
    ("Randomized Controlled Trial", "RCT"),
    ("Clinical Trial, Phase III", "Phase III Trial"),
    ("Clinical Trial, Phase II", "Phase II Trial"),
    ("Clinical Trial, Phase I", "Phase I Trial"),
    ("Clinical Trial, Phase IV", "Phase IV Trial"),
    ("Controlled Clinical Trial", "Controlled Trial"),
    ("Clinical Trial", "Clinical Trial"),
    ("Meta-Analysis", "Meta-Analysis"),
    ("Systematic Review", "Systematic Review"),
    ("Observational Study", "Observational"),
    ("Multicenter Study", "Multicenter"),
    ("Comparative Study", "Comparative"),
    ("Review", "Review"),
    ("Case Reports", "Case Report"),
]


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": f"{TOOL} (mailto:{MAILTO})"})
    return urllib.request.urlopen(req, timeout=90).read()


def esearch(year):
    term = f"ClinicalTrials.gov[si] AND {ONCO} AND {year}[pdat]"
    params = {"db": "pubmed", "term": term, "retmax": "0", "usehistory": "y",
              "retmode": "json", "tool": TOOL, "email": MAILTO}
    d = json.loads(_get(f"{EUTILS}/esearch.fcgi?" + urllib.parse.urlencode(params)))["esearchresult"]
    return int(d["count"]), d["webenv"], d["querykey"]


def efetch(webenv, qkey, retstart, retmax=200):
    params = {"db": "pubmed", "query_key": qkey, "WebEnv": webenv,
              "retstart": str(retstart), "retmax": str(retmax), "retmode": "xml",
              "tool": TOOL, "email": MAILTO}
    return _get(f"{EUTILS}/efetch.fcgi?" + urllib.parse.urlencode(params))


def _text(el):
    return clean_text("".join(el.itertext())) if el is not None else ""


def _pick_ptype(types):
    s = set(types)
    for full, label in _PTYPE_PRIORITY:
        if full in s:
            return label
    return "Journal Article"


def parse_article(art, year):
    mc = art.find("MedlineCitation")
    if mc is None:
        return None
    pmid = (mc.findtext("PMID") or "").strip()
    article = mc.find("Article")
    if not pmid or article is None:
        return None

    title = _text(article.find("ArticleTitle"))
    # 초록 (섹션별 합치기)
    abs_parts = []
    for ab in article.findall("./Abstract/AbstractText"):
        lbl = ab.get("Label")
        t = _text(ab)
        if t:
            abs_parts.append(f"{lbl}: {t}" if lbl else t)
    body = " ".join(abs_parts)

    journal = article.find("Journal")
    jiso = (journal.findtext("ISOAbbreviation") if journal is not None else "") or ""
    jfull = (journal.findtext("Title") if journal is not None else "") or ""
    jiso = clean_text(jiso) or clean_text(jfull) or "Journal"

    # 발표(출판) 유형
    ptypes = [pt.text for pt in article.findall("./PublicationTypeList/PublicationType") if pt.text]
    pub_type = _pick_ptype(ptypes)

    # DOI
    doi = ""
    for aid in art.findall("./PubmedData/ArticleIdList/ArticleId"):
        if aid.get("IdType") == "doi":
            doi = (aid.text or "").strip().lower()
    if not doi:
        for el in article.findall("./ELocationID"):
            if el.get("EIdType") == "doi":
                doi = (el.text or "").strip().lower()

    # 제1저자 + 소속
    author_raw = ""
    author = None
    au = article.find("./AuthorList/Author")
    if au is not None:
        last = au.findtext("LastName") or ""
        fore = au.findtext("ForeName") or au.findtext("Initials") or ""
        name = clean_text(f"{fore} {last}")
        aff = clean_text(au.findtext("./AffiliationInfo/Affiliation") or "")
        author_raw = f"{name}, {aff}" if aff else name
        if author_raw:
            author = parse_author(author_raw)

    # NCT: DataBank + 본문/제목 정규식
    ncts = []
    for acc in art.findall(".//DataBankList/DataBank"):
        if (acc.findtext("DataBankName") or "") == "ClinicalTrials.gov":
            for an in acc.findall("./AccessionNumberList/AccessionNumber"):
                if an.text and NCT_RE.fullmatch(an.text.strip()):
                    ncts.append(an.text.strip())
    ncts += extract_nct_ids(f"{title} {body}")
    ncts = list(dict.fromkeys(ncts))  # 순서보존 dedup

    full = f"{title} {body}"
    cancer_category = retag_cancer(None, full)
    phases = extract_phases(full)
    biomarker_list = infer_biomarker_list(full)

    return {
        "uid": f"pub-{year}-{pmid}", "conference": jiso, "year": year, "abstract_id": pmid,
        "is_lba": False, "status": "available" if body else "title_only",
        "presentation_type": pub_type, "track": None, "cancer_category": cancer_category,
        "title": title, "authors": [author] if author else [], "author_raw": author_raw,
        "abstract_text": body or None, "phase": phases[0] if phases else None, "phases": phases,
        "modality_list": infer_modality_list(full), "target_list": infer_target_list(full),
        "biomarker_list": biomarker_list, "biomarker_mentioned": len(biomarker_list) > 0,
        "nct_ids": ncts,
        "clinicaltrials_url": f"https://clinicaltrials.gov/study/{ncts[0]}" if ncts else None,
        "companies": [],
        "companies_normalized": normalize_companies(author.get("affiliation", "") if author else "", body),
        "drugs_mentioned": extract_drugs(full), "research_sponsor": None,
        "journal": clean_text(jfull) or jiso, "pmid": pmid, "publication_type": pub_type,
        "source": {"url": f"https://doi.org/{doi}" if doi else f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                   "doi": doi or None, "pmid": pmid},
        "keyword_parsed": True, "enrichment_status": "dictionary_v1",
    }


def fetch_year(year):
    count, webenv, qkey = esearch(year)
    print(f"[Pub {year}] esearch: {count}편", flush=True)
    time.sleep(SLEEP)
    records, seen = [], set()
    for start in range(0, count, 200):
        xml = efetch(webenv, qkey, start)
        try:
            root = ET.fromstring(xml)
        except ET.ParseError as e:
            print(f"  XML 파싱오류 @{start}: {e}", flush=True)
            time.sleep(SLEEP)
            continue
        for art in root.findall("PubmedArticle"):
            rec = parse_article(art, year)
            if rec and rec["uid"] not in seen:
                seen.add(rec["uid"])
                records.append(rec)
        print(f"  ...{min(start + 200, count)}/{count}  (records {len(records)})", flush=True)
        time.sleep(SLEEP)

    out = {
        "metadata": {"last_updated": datetime.now(timezone.utc).isoformat(),
                     "source": "pubmed", "axis": "publication", "year": year,
                     "total": len(records)},
        "abstracts": records,
    }
    os.makedirs("data/parsed", exist_ok=True)
    path = f"data/parsed/publications_{year}.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"[Pub {year}] {len(records)} -> {path} ({os.path.getsize(path)/1024/1024:.1f} MB)", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", nargs="+", type=int, required=True)
    for y in ap.parse_args().years:
        fetch_year(y)
