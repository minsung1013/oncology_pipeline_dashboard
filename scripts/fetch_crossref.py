"""
학회 초록 수집 (Crossref API) — ASCO·AACR 공통, 동일 스키마.

Crossref가 학회 초록 DOI를 등록 → 제목·저자·본문(JATS)·DOI 제공.
PDF·스크래핑 불필요. conference-agnostic 추론(parse_fields)을 재사용.

용법:
  python scripts/fetch_crossref.py --conf asco --years 2022 2023 2024 2025 2026
  python scripts/fetch_crossref.py --conf aacr --years 2022 2023 2024 2025 2026
출력: data/parsed/abstracts_{conf}{year}.json
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from parse_asco import (  # noqa: E402
    infer_modality_list, infer_target_list, infer_biomarker_list,
    extract_drugs, retag_cancer, extract_nct_ids, extract_phases,
    parse_author, clean_text,
)
from normalize_entities import normalize_companies  # noqa: E402

MAILTO = "oncology-pipeline-dashboard@example.com"

# 학회별 설정: ISSN, DOI에서 (year, number) 추출 정규식, 날짜창
CONFS = {
    "asco": {
        "issn": "1527-7755", "name": "ASCO",  # Journal of Clinical Oncology
        # 10.1200/jco.2026.44.16_suppl.e16495  (16_suppl=정규, 17_suppl=LBA)
        "doi_re": re.compile(r"jco\.(\d{4})\.\d+\.(1[67]_suppl)\.([A-Za-z0-9]+)", re.I),
        "lba_suppl": "17_suppl",
        # ASCO Annual Meeting는 5~6월 발행
        "window": ("{y}-05-01", "{y}-07-15"),
    },
    "aacr": {
        "issn": "1538-7445", "name": "AACR",  # Cancer Research
        # 10.1158/1538-7445.am2026-4956
        "doi_re": re.compile(r"\.am(\d{4})-([A-Za-z0-9]+)", re.I),
        "lba_suppl": None,
        "window": ("{y}-01-01", "{y}-12-31"),
    },
}

_TAG_RE = re.compile(r"<[^>]+>")
_NUMPREFIX_RE = re.compile(r"^\s*\d+\s*")


def jats_strip(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"<jats:title>.*?</jats:title>", " ", s, flags=re.S)
    s = _TAG_RE.sub(" ", s)
    for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&#x2009;", " "), ("&#xa0;", " ")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def author_raw_from(authors):
    if not authors:
        return ""
    a = authors[0]
    name = f"{a.get('given','')} {a.get('family','')}".strip()
    aff = ""
    if a.get("affiliation"):
        aff = _NUMPREFIX_RE.sub("", a["affiliation"][0].get("name", "")).strip().rstrip(";")
    return f"{name}, {aff}" if aff else name


def crossref_page(issn, frm, until, cursor):
    params = {
        "filter": f"from-pub-date:{frm},until-pub-date:{until},type:journal-article",
        "rows": "500", "cursor": cursor, "mailto": MAILTO,
        "select": "DOI,title,author,abstract,published",
    }
    url = f"https://api.crossref.org/journals/{issn}/works?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": f"OncologyDashboard/1.0 (mailto:{MAILTO})"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())["message"]


def build_record(work, conf, year):
    cfg = CONFS[conf]
    doi = work.get("DOI", "")
    m = cfg["doi_re"].search(doi)
    if not m or int(m.group(1)) != year:
        return None
    groups = m.groups()
    suppl = groups[1] if len(groups) == 3 else None
    num = groups[-1]
    is_lba = num.upper().startswith("LB") or (cfg["lba_suppl"] and suppl == cfg["lba_suppl"])
    abstract_id = num.upper() if num[:2].upper() in ("LB", "TP") else num
    uid = f"{conf}-{year}-{abstract_id.lower()}"

    raw_title = (work.get("title") or [""])[0]
    title = clean_text(re.sub(r"^Abstract\s+[A-Za-z0-9]+:\s*", "", raw_title))
    body = jats_strip(work.get("abstract", ""))
    author_raw = author_raw_from(work.get("author"))
    author = parse_author(author_raw) if author_raw else None

    full = f"{title} {body}"
    # 단어경계 매칭으로 약어 오탐(ALL/AML 등) 제거됨 → title+body 스캔 가능
    cancer_category = retag_cancer(None, full)
    nct_ids = extract_nct_ids(full)
    phases = extract_phases(full)
    biomarker_list = infer_biomarker_list(full)
    pres = "e-abstract" if abstract_id.lower().startswith("e") else None

    return {
        "uid": uid, "conference": cfg["name"], "year": year, "abstract_id": abstract_id,
        "is_lba": is_lba, "status": "available" if body else "title_only",
        "presentation_type": pres, "track": None, "cancer_category": cancer_category,
        "title": title, "authors": [author] if author else [], "author_raw": author_raw,
        "abstract_text": body or None, "phase": phases[0] if phases else None, "phases": phases,
        "modality_list": infer_modality_list(full), "target_list": infer_target_list(full),
        "biomarker_list": biomarker_list, "biomarker_mentioned": len(biomarker_list) > 0,
        "nct_ids": nct_ids,
        "clinicaltrials_url": f"https://clinicaltrials.gov/study/{nct_ids[0]}" if nct_ids else None,
        "companies": [],
        "companies_normalized": normalize_companies(author.get("affiliation", "") if author else "", body),
        "drugs_mentioned": extract_drugs(full), "research_sponsor": None,
        "source": {"url": f"https://doi.org/{doi}", "doi": doi, "page": None},
        "keyword_parsed": True, "enrichment_status": "dictionary_v1",
    }


def fetch(conf, year):
    cfg = CONFS[conf]
    frm = cfg["window"][0].format(y=year)
    until = cfg["window"][1].format(y=year)
    print(f"[{cfg['name']} {year}] Crossref {frm}~{until}...")
    cursor, records, seen = "*", [], set()
    t0 = time.time()
    while True:
        msg = crossref_page(cfg["issn"], frm, until, cursor)
        items = msg.get("items", [])
        if not items:
            break
        for w in items:
            rec = build_record(w, conf, year)
            if rec and rec["abstract_id"] not in seen:
                seen.add(rec["abstract_id"])
                records.append(rec)
        cursor = msg.get("next-cursor")
        print(f"  ...{len(records)}  {time.time()-t0:.0f}s", flush=True)
        if not cursor or len(items) < 500:
            break
        time.sleep(0.3)

    available = sum(1 for r in records if r["status"] == "available")
    out = {
        "metadata": {
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "conference": cfg["name"], "year": year, "total_abstracts": len(records),
            "available": available, "source": "crossref", "issn": cfg["issn"],
        },
        "abstracts": records,
    }
    os.makedirs("data/parsed", exist_ok=True)
    path = f"data/parsed/abstracts_{conf}{year}.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"[{cfg['name']} {year}] {len(records)} ({available} avail) -> {path} ({os.path.getsize(path)/1024/1024:.1f} MB)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--conf", choices=list(CONFS), required=True)
    ap.add_argument("--years", type=int, nargs="+", default=[2022, 2023, 2024, 2025, 2026])
    args = ap.parse_args()
    for y in args.years:
        fetch(args.conf, y)
