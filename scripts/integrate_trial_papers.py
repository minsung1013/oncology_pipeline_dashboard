"""임상시험 참조논문을 publications 코퍼스에 통합.

재파싱 후 pipeline.json의 정제된 pubmed_links(referencesModule RESULT/DERIVED +
EPMC 제목매칭)에서 PMID를 모아, 코퍼스에 없는 것만 PubMed efetch로 받아 publication
스키마(parse_article)로 변환해 publications_{year}.json에 병합한다. NCT는 pipeline
링크에서 부착. 무거운 LLM 보강은 하지 않음(규칙기반 enrich만; 한국어 요약은 추후).
멱등 — 이미 있는 PMID는 건너뜀.

용법: python scripts/integrate_trial_papers.py
"""
import glob
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(__file__))
from fetch_publications import parse_article, EUTILS, MAILTO, TOOL, SLEEP  # noqa: E402

PIPELINE = "data/parsed/pipeline.json"


def efetch_ids(pmids):
    params = {"db": "pubmed", "id": ",".join(pmids), "retmode": "xml", "tool": TOOL, "email": MAILTO}
    url = f"{EUTILS}/efetch.fcgi?" + urllib.parse.urlencode(params)
    for _ in range(3):
        try:
            return urllib.request.urlopen(url, timeout=60).read()
        except Exception:
            time.sleep(3)
    return b""


def article_year(art):
    mc = art.find("MedlineCitation")
    if mc is None:
        return "unknown"
    y = mc.findtext(".//Article/Journal/JournalIssue/PubDate/Year")
    if not y:
        md = mc.findtext(".//Article/Journal/JournalIssue/PubDate/MedlineDate") or ""
        m = re.search(r"(19|20)\d\d", md)
        y = m.group(0) if m else None
    if not y:
        ad = mc.findtext(".//Article/ArticleDate/Year")
        y = ad
    return y or "unknown"


def main():
    drugs = json.load(open(PIPELINE, encoding="utf-8"))["drugs"]
    pmid_nct = {}
    skipped_epmc = 0
    for d in drugs:
        dn = re.sub(r"\s+", " ", (d.get("drug_name") or "").strip().lower())
        for p in d.get("pubmed_links") or []:
            pid = str(p.get("pmid", ""))
            if not pid.isdigit():
                continue
            # EPMC분은 약물명이 제목에 있을 때만 통합(정밀도). clinicaltrials(referencesModule)는
            # 재파싱에서 BACKGROUND가 이미 걸러진 RESULT/DERIVED라 그대로 통합.
            if p.get("source") == "europepmc_nct":
                title = (p.get("title") or "").lower()
                if dn and len(dn) >= 4 and dn not in title:
                    skipped_epmc += 1
                    continue
            pmid_nct.setdefault(pid, set()).update(d.get("nct_ids") or [])
    print(f"EPMC 제목 미매칭 제외: {skipped_epmc}건")

    existing = set()
    for fp in sorted(glob.glob("data/parsed/publications_*.json")):
        for a in json.load(open(fp, encoding="utf-8"))["abstracts"]:
            if a.get("pmid"):
                existing.add(str(a["pmid"]))

    new_pmids = [p for p in pmid_nct if p not in existing]
    print(f"pipeline PMID {len(pmid_nct)} · 코퍼스 기존 {len(existing)} · 신규 {len(new_pmids)}")
    if not new_pmids:
        print("신규 없음 — 종료")
        return

    added_by_year = {}
    B = 200
    for i in range(0, len(new_pmids), B):
        batch = new_pmids[i:i + B]
        xml = efetch_ids(batch)
        if xml:
            try:
                root = ET.fromstring(xml)
            except Exception:
                root = None
            if root is not None:
                for art in root.findall("PubmedArticle"):
                    y = article_year(art)
                    rec = parse_article(art, y)
                    if not rec:
                        continue
                    pid = rec["pmid"]
                    rec["nct_ids"] = list(dict.fromkeys((rec.get("nct_ids") or []) + sorted(pmid_nct.get(pid, []))))
                    if rec["nct_ids"]:
                        rec["clinicaltrials_url"] = f"https://clinicaltrials.gov/study/{rec['nct_ids'][0]}"
                    rec["source_origin"] = "trial_ref"  # 통합 출처 표시
                    added_by_year.setdefault(str(y), []).append(rec)
        time.sleep(SLEEP)
        if (i // B) % 5 == 0:
            print(f"  efetch {min(i + B, len(new_pmids))}/{len(new_pmids)}", flush=True)

    total = 0
    for year, recs in sorted(added_by_year.items()):
        year_file = (f"data/parsed/publications_{year}.json"
                     if year != "unknown" else "data/parsed/publications_unknown.json")
        data = json.load(open(year_file, encoding="utf-8")) if os.path.exists(year_file) else {"abstracts": []}
        have = set(str(a.get("pmid")) for a in data["abstracts"])
        n = 0
        for r in recs:
            if str(r["pmid"]) not in have:
                data["abstracts"].append(r)
                have.add(str(r["pmid"]))
                n += 1
        json.dump(data, open(year_file, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        total += n
        print(f"  {year_file}: +{n}")
    print(f"통합 완료: 신규 {total}편 코퍼스 추가 (규칙기반 enrich; 한국어 요약은 추후)")


if __name__ == "__main__":
    main()
