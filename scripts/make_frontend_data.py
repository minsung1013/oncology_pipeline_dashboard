"""
프론트엔드용 lite 페이로드 생성 (옵션 D).

- 전 학회/연도 초록을 병합하고 **본문(abstract_text) 제거** → data/frontend/abstracts.json
  (본문은 용량의 ~80%. 테이블·필터·검색엔 불필요. 전문은 source.doi 링크/R2 전체파일로.)
- pipeline.json에서 프론트가 안 쓰는 장문 필드 제거 → data/frontend/pipeline.json

전체(본문 포함) 파일은 R2에 업로드, lite 파일은 프론트가 fetch.

용법: python scripts/make_frontend_data.py
"""

import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_biomarkers import normalize_biomarker_list  # noqa: E402

OUT = "data/frontend"

# 초록 lite에 보존할 필드 (본문 제외)
ABS_KEEP = [
    "uid", "conference", "year", "abstract_id", "is_lba", "status", "presentation_type",
    "cancer_category", "title", "authors", "author_raw", "phase", "phases",
    "modality_list", "target_list", "biomarker_list", "biomarker_mentioned",
    "nct_ids", "companies_normalized", "drugs_mentioned", "source",
    "summary_ko", "enrich_src", "llm_confidence",
]
# 퍼블리케이션 lite 보존 필드 (초록 + 저널/PMID/출판유형)
PUB_KEEP = ABS_KEEP + ["journal", "pmid", "publication_type"]

# 저자는 첫 저자의 표시용 필드만
AUTHOR_KEEP = ["name", "affiliation", "country"]

# pipeline lite 보존 필드 (프론트 테이블·필터·검색·배지에서 실제 사용)
DRUG_KEEP = [
    "drug_name", "combo_drugs", "company", "company_normalized", "collaborators",
    "partnership_status", "condition", "cancer_category", "phase", "phases",
    "overall_status", "primary_completion_date", "start_date",
    "modality", "modality_src", "modality_rule", "target", "target_src", "target_rule",
    "moa", "biomarker_mentioned", "biomarker_list", "nct_ids", "clinicaltrials_url",
    "official_title", "brief_title", "primary_outcomes", "pubmed_links",
    "is_combination", "data_flags",
]


def _lite_record(a, keep=ABS_KEEP):
    rec = {k: a.get(k) for k in keep if k in a}
    # 바이오마커 유전자 기준 정규화 (변이형/표기변형 합치기, 항목 제거는 안 함)
    if "biomarker_list" in rec:
        rec["biomarker_list"] = normalize_biomarker_list(rec.get("biomarker_list"))
    if rec.get("authors"):
        rec["authors"] = [{k: au.get(k) for k in AUTHOR_KEEP} for au in rec["authors"][:1]]
    # source는 doi/pmid만 (url 제거 — 용량)
    if rec.get("source"):
        s = rec["source"]
        rec["source"] = {k: s.get(k) for k in ("doi", "pmid") if s.get(k)}
    rec["has_body"] = bool(a.get("abstract_text"))
    return rec


def build_publications():
    """저널 논문 lite(연도별) + manifest. 레코드 conference 필드 = 저널 약어(Source 필터)."""
    files = sorted(glob.glob("data/parsed/publications_*.json"))
    if not files:
        print("publications 없음 — 스킵")
        return
    os.makedirs(f"{OUT}/publications", exist_ok=True)
    manifest = []
    for fp in files:
        d = json.load(open(fp, encoding="utf-8"))
        m = d.get("metadata", {})
        year = m.get("year")
        recs = [_lite_record(a, PUB_KEEP) for a in d["abstracts"]]
        path = f"{OUT}/publications/{year}.json"
        json.dump({"metadata": m, "abstracts": recs}, open(path, "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
        mb = os.path.getsize(path) / 1024 / 1024
        manifest.append({"year": year, "count": len(recs), "file": f"publications/{year}.json", "mb": round(mb, 1)})
        print(f"  pub {year}: {len(recs)} -> {path} ({mb:.1f} MB)")
    json.dump({"publications": manifest}, open(f"{OUT}/pub_index.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"pub manifest -> {OUT}/pub_index.json ({len(manifest)} files, "
          f"{sum(x['count'] for x in manifest)} pubs total)")


def build_abstracts():
    """연도·학회별 lite 파일 + manifest(index) 생성 → 프론트가 선택적 lazy 로드."""
    os.makedirs(f"{OUT}/abstracts", exist_ok=True)
    files = sorted(glob.glob("data/parsed/abstracts_*.json"))
    manifest = []
    for fp in files:
        d = json.load(open(fp, encoding="utf-8"))
        m = d["metadata"]
        recs = [_lite_record(a) for a in d["abstracts"]]
        key = f"{m['conference'].lower()}{m['year']}"
        path = f"{OUT}/abstracts/{key}.json"
        json.dump({"metadata": m, "abstracts": recs}, open(path, "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
        mb = os.path.getsize(path) / 1024 / 1024
        manifest.append({"conference": m["conference"], "year": m["year"],
                         "count": len(recs), "file": f"abstracts/{key}.json", "mb": round(mb, 1)})
        print(f"  {key}: {len(recs)} -> {path} ({mb:.1f} MB)")
    json.dump({"abstracts": manifest}, open(f"{OUT}/index.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"manifest -> {OUT}/index.json ({len(manifest)} files, "
          f"{sum(x['count'] for x in manifest)} abstracts total)")


def build_nct_index():
    """NCT → [{uid, axis, conference/journal, year}] (Pipeline ↔ Conferences ↔ Publications 크로스링크)."""
    idx = {}
    for fp in sorted(glob.glob("data/parsed/abstracts_*.json")):
        d = json.load(open(fp, encoding="utf-8"))
        for a in d["abstracts"]:
            for nct in a.get("nct_ids", []):
                idx.setdefault(nct, []).append(
                    {"uid": a["uid"], "axis": "conference", "conference": a["conference"], "year": a["year"]})
    for fp in sorted(glob.glob("data/parsed/publications_*.json")):
        d = json.load(open(fp, encoding="utf-8"))
        for a in d["abstracts"]:
            for nct in a.get("nct_ids", []):
                idx.setdefault(nct, []).append(
                    {"uid": a["uid"], "axis": "publication", "journal": a.get("conference"), "year": a["year"]})
    os.makedirs(OUT, exist_ok=True)
    path = f"{OUT}/nct_index.json"
    json.dump(idx, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"nct_index: {len(idx)} NCT IDs -> {path} ({os.path.getsize(path)/1024/1024:.1f} MB)")


def build_facets():
    """랜딩 통합 필터용 경량 옵션 파일. pipeline(drugs)+abstracts 합집합."""
    from collections import Counter

    cancers, modalities = set(), set()
    targets, biomarkers, companies = Counter(), Counter(), Counter()
    n_drugs = n_abstracts = n_pubs = 0

    # 파이프라인 (스칼라 필드)
    pl = "data/parsed/pipeline.json"
    if os.path.exists(pl):
        drugs = json.load(open(pl, encoding="utf-8"))["drugs"]
        n_drugs = len(drugs)
        for d in drugs:
            if d.get("cancer_category"):
                cancers.add(d["cancer_category"])
            if d.get("modality"):
                modalities.add(d["modality"])
            if d.get("target") and d["target"] != "Unknown":
                targets[d["target"]] += 1
            for b in normalize_biomarker_list(d.get("biomarker_list")):
                biomarkers[b] += 1
            if d.get("company_normalized"):
                companies[d["company_normalized"]] += 1

    # 초록 (리스트 필드)
    for fp in sorted(glob.glob("data/parsed/abstracts_*.json")):
        for a in json.load(open(fp, encoding="utf-8"))["abstracts"]:
            n_abstracts += 1
            for c in a.get("cancer_category") or []:
                cancers.add(c)
            for m in a.get("modality_list") or []:
                modalities.add(m)
            for t in a.get("target_list") or []:
                if t and t != "Unknown":
                    targets[t] += 1
            for b in normalize_biomarker_list(a.get("biomarker_list")):
                biomarkers[b] += 1
            for co in a.get("companies_normalized") or []:
                companies[co] += 1

    # 퍼블리케이션 (초록과 동일 리스트 필드)
    for fp in sorted(glob.glob("data/parsed/publications_*.json")):
        for a in json.load(open(fp, encoding="utf-8"))["abstracts"]:
            n_pubs += 1
            for c in a.get("cancer_category") or []:
                cancers.add(c)
            for m in a.get("modality_list") or []:
                modalities.add(m)
            for t in a.get("target_list") or []:
                if t and t != "Unknown":
                    targets[t] += 1
            for b in normalize_biomarker_list(a.get("biomarker_list")):
                biomarkers[b] += 1
            for co in a.get("companies_normalized") or []:
                companies[co] += 1

    def top(counter, n):
        return [k for k, _ in counter.most_common(n)]

    facets = {
        "counts": {"drugs": n_drugs, "abstracts": n_abstracts, "publications": n_pubs,
                   "companies": len(companies), "targets": len(targets),
                   "biomarkers": len(biomarkers)},
        "cancers": sorted(c for c in cancers if c),
        "modalities": sorted(m for m in modalities if m),
        "phases": ["EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"],
        "targets": top(targets, 300),
        "biomarkers": top(biomarkers, 300),
        "companies": top(companies, 500),
    }
    os.makedirs(OUT, exist_ok=True)
    path = f"{OUT}/facets.json"
    json.dump(facets, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"facets -> {path}  (cancers {len(facets['cancers'])}, modalities {len(facets['modalities'])}, "
          f"targets {len(facets['targets'])}, biomarkers {len(facets['biomarkers'])}, companies {len(facets['companies'])})")


def build_pipeline():
    src = "data/parsed/pipeline.json"
    if not os.path.exists(src):
        print("pipeline.json 없음 — 스킵")
        return
    d = json.load(open(src, encoding="utf-8"))
    drugs = [{k: x.get(k) for k in DRUG_KEEP if k in x} for x in d["drugs"]]
    for x in drugs:  # 바이오마커 유전자 기준 정규화 (초록과 동일 체계)
        if "biomarker_list" in x:
            x["biomarker_list"] = normalize_biomarker_list(x.get("biomarker_list"))
    out = {"metadata": d.get("metadata", {}), "drugs": drugs}
    os.makedirs(OUT, exist_ok=True)
    path = f"{OUT}/pipeline.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"pipeline lite: {len(drugs)} -> {path} "
          f"({os.path.getsize(src)/1024/1024:.0f}MB -> {os.path.getsize(path)/1024/1024:.0f}MB)")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["abstracts", "pipeline", "facets", "publications"], default=None,
                    help="일부만 빌드 (CI에서 pipeline만 갱신 등)")
    only = ap.parse_args().only
    if only in (None, "abstracts"):
        build_abstracts()
    if only in (None, "publications"):
        build_publications()
    if only in (None, "abstracts", "publications"):
        build_nct_index()  # conference + publication 두 축 반영
    if only in (None, "pipeline"):
        build_pipeline()
    if only in (None, "facets"):
        build_facets()
