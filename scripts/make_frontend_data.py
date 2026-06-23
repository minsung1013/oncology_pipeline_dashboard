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

OUT = "data/frontend"

# 초록 lite에 보존할 필드 (본문 제외)
ABS_KEEP = [
    "uid", "conference", "year", "abstract_id", "is_lba", "status", "presentation_type",
    "cancer_category", "title", "authors", "author_raw", "phase", "phases",
    "modality_list", "target_list", "biomarker_list", "biomarker_mentioned",
    "nct_ids", "companies_normalized", "drugs_mentioned", "source",
    "summary_ko", "enrich_src", "llm_confidence",
]
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


def _lite_record(a):
    rec = {k: a.get(k) for k in ABS_KEEP if k in a}
    if rec.get("authors"):
        rec["authors"] = [{k: au.get(k) for k in AUTHOR_KEEP} for au in rec["authors"][:1]]
    # source는 doi만 (url 제거 — 용량)
    if rec.get("source"):
        rec["source"] = {"doi": rec["source"].get("doi")}
    rec["has_body"] = bool(a.get("abstract_text"))
    return rec


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
    """NCT → [{uid, conference, year}] (Pipeline→Conferences 크로스링크용)."""
    idx = {}
    for fp in sorted(glob.glob("data/parsed/abstracts_*.json")):
        d = json.load(open(fp, encoding="utf-8"))
        for a in d["abstracts"]:
            for nct in a.get("nct_ids", []):
                idx.setdefault(nct, []).append(
                    {"uid": a["uid"], "conference": a["conference"], "year": a["year"]})
    os.makedirs(OUT, exist_ok=True)
    path = f"{OUT}/nct_index.json"
    json.dump(idx, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"nct_index: {len(idx)} NCT IDs -> {path} ({os.path.getsize(path)/1024/1024:.1f} MB)")


def build_facets():
    """랜딩 통합 필터용 경량 옵션 파일. pipeline(drugs)+abstracts 합집합."""
    from collections import Counter

    cancers, modalities = set(), set()
    targets, biomarkers, companies = Counter(), Counter(), Counter()
    n_drugs = n_abstracts = 0

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
            for b in d.get("biomarker_list") or []:
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
            for b in a.get("biomarker_list") or []:
                biomarkers[b] += 1
            for co in a.get("companies_normalized") or []:
                companies[co] += 1

    def top(counter, n):
        return [k for k, _ in counter.most_common(n)]

    facets = {
        "counts": {"drugs": n_drugs, "abstracts": n_abstracts,
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
    out = {"metadata": d.get("metadata", {}), "drugs": drugs}
    os.makedirs(OUT, exist_ok=True)
    path = f"{OUT}/pipeline.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"pipeline lite: {len(drugs)} -> {path} "
          f"({os.path.getsize(src)/1024/1024:.0f}MB -> {os.path.getsize(path)/1024/1024:.0f}MB)")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["abstracts", "pipeline", "facets"], default=None,
                    help="일부만 빌드 (CI에서 pipeline만 갱신 등)")
    only = ap.parse_args().only
    if only != "pipeline" and only != "facets":
        build_abstracts()
        build_nct_index()
    if only != "abstracts" and only != "facets":
        build_pipeline()
    if only != "abstracts" and only != "pipeline":
        build_facets()
