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
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_biomarkers import normalize_biomarker_list  # noqa: E402
from normalize_entities import normalize_companies  # noqa: E402

OUT = "data/frontend"

_co_cache = {}


def drug_companies(d):
    """약물의 전체 관여 회사 = 메인 스폰서 + 정규화된 협력사(collaborators).
    파트너사를 메인과 동등하게 다루기 위함. 학술기관은 normalize_companies가 제외."""
    out = []
    main = d.get("company_normalized")
    if main:
        out.append(main)
    for c in d.get("collaborators") or []:
        norm = _co_cache.get(c)
        if norm is None:
            norm = normalize_companies(c) or []
            _co_cache[c] = norm
        for n in norm:
            if n and n not in out:
                out.append(n)
    return out

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

# 저자는 대표 저자(학회=제1, 논문=교신/책임)의 표시용 필드 + 다중소속(토글용)
AUTHOR_KEEP = ["name", "affiliation", "affiliations", "country", "role"]

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
    files = sorted(glob.glob("data/parsed/abstracts_*.json"))
    if not files:  # 안전장치: parsed 없으면 index 미생성(R2 기존 보존) — CI 번들 누락 시 라이브 보호
        print("abstracts parsed 없음 — index 보존(스킵)")
        return
    os.makedirs(f"{OUT}/abstracts", exist_ok=True)
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
    if not glob.glob("data/parsed/abstracts_*.json") and not glob.glob("data/parsed/publications_*.json"):
        print("abstracts/publications parsed 없음 — nct_index 보존(스킵)")
        return
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
    """랜딩 통합 필터용 경량 옵션 파일. pipeline(drugs)+abstracts+publications 합집합."""
    from collections import Counter
    if not glob.glob("data/parsed/abstracts_*.json") and not glob.glob("data/parsed/publications_*.json"):
        print("abstracts/publications parsed 없음 — facets 보존(스킵)")
        return

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
            for co in drug_companies(d):  # 메인 + 협력사(정규화) 동등 집계
                companies[co] += 1

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
        "generated_at": datetime.now(timezone.utc).isoformat(),
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


def build_whatsnew(window_days=8):
    """이번 주(window) 신규/갱신 trial + 신규 논문 + 새 타겟 → whatsnew.json.
    trial은 first_post/last_update 날짜로, 논문은 직전 스냅샷(snapshot.json) 대비 PMID 차이로 산정.
    새 타겟 = 신규 항목에 등장하면서 전체 코퍼스에서 희소한(=막 진입한) 타겟."""
    from datetime import timedelta
    from collections import Counter
    cutoff = (datetime.now(timezone.utc) - timedelta(days=window_days)).strftime("%Y-%m-%d")

    # 전체 코퍼스 타겟 빈도 (희소성 판단용)
    tfreq = Counter()
    pl_path = "data/parsed/pipeline.json"
    drugs = json.load(open(pl_path, encoding="utf-8"))["drugs"] if os.path.exists(pl_path) else []
    for d in drugs:
        t = d.get("target")
        if t and t != "Unknown":
            tfreq[t] += 1
    for pat in ("data/parsed/abstracts_*.json", "data/parsed/publications_*.json"):
        for fp in glob.glob(pat):
            for a in json.load(open(fp, encoding="utf-8"))["abstracts"]:
                for t in a.get("target_list") or []:
                    if t and t != "Unknown":
                        tfreq[t] += 1

    def trial_row(d):
        return {"nct": (d.get("nct_ids") or [None])[0], "drug": d.get("drug_name"),
                "company": d.get("company_normalized"), "target": d.get("target"),
                "modality": d.get("modality"), "phase": d.get("phase"),
                "cancer": d.get("cancer_category"), "status": d.get("overall_status"),
                "date": d.get("first_post_date") or d.get("last_update_date")}

    new_trials = [trial_row(d) for d in drugs if (d.get("first_post_date") or "") >= cutoff]
    updated_trials = [trial_row(d) for d in drugs
                      if (d.get("last_update_date") or "") >= cutoff
                      and (d.get("first_post_date") or "") < cutoff]

    # 논문: 직전 스냅샷 대비 신규 PMID
    snap_path = f"{OUT}/snapshot.json"
    prev = json.load(open(snap_path, encoding="utf-8")) if os.path.exists(snap_path) else {}
    prev_pmids = set(prev.get("pmids", []))
    cur_pmids, new_pubs = [], []
    for fp in sorted(glob.glob("data/parsed/publications_*.json")):
        for a in json.load(open(fp, encoding="utf-8"))["abstracts"]:
            pmid = (a.get("source") or {}).get("pmid")
            if not pmid:
                continue
            cur_pmids.append(pmid)
            if prev_pmids and pmid not in prev_pmids:
                au = (a.get("authors") or [{}])[0]
                new_pubs.append({"pmid": pmid, "title": a.get("title"), "journal": a.get("conference"),
                                 "target": a.get("target_list") or [], "company": a.get("companies_normalized") or [],
                                 "cancer": a.get("cancer_category") or [], "year": a.get("year")})

    # 새 타겟: 이번 주 신규/갱신 trial + 신규 논문에 등장 + 코퍼스 희소
    week_targets = Counter()
    for r in new_trials + updated_trials:
        if r["target"] and r["target"] != "Unknown":
            week_targets[r["target"]] += 1
    for p in new_pubs:
        for t in p["target"]:
            if t and t != "Unknown":
                week_targets[t] += 1
    emerging = sorted(
        ({"target": t, "this_week": n, "corpus_total": tfreq.get(t, 0)} for t, n in week_targets.items()),
        key=lambda x: (x["corpus_total"], -x["this_week"]),
    )[:40]  # 코퍼스에서 희소한 순(=신규 진입)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(), "since": cutoff,
        "counts": {"new_trials": len(new_trials), "updated_trials": len(updated_trials),
                   "new_publications": len(new_pubs), "emerging_targets": len(emerging)},
        "new_trials": sorted(new_trials, key=lambda x: x["date"] or "", reverse=True)[:150],
        "updated_trials": sorted(updated_trials, key=lambda x: x["date"] or "", reverse=True)[:150],
        "new_publications": new_pubs[:150],
        "emerging_targets": emerging,
    }
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(f"{OUT}/whatsnew.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"pmids": cur_pmids, "ncts": [r["nct"] for r in (new_trials + updated_trials) if r["nct"]]},
              open(snap_path, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"whatsnew -> {OUT}/whatsnew.json  (신규시험 {len(new_trials)}, 갱신 {len(updated_trials)}, "
          f"신규논문 {len(new_pubs)}, 새타겟 {len(emerging)})")


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
        x["companies_all"] = drug_companies(x)  # 메인 + 협력사(정규화) — 필터/사이드바 동등 처리
    out = {"metadata": d.get("metadata", {}), "drugs": drugs}
    os.makedirs(OUT, exist_ok=True)
    path = f"{OUT}/pipeline.json"
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"pipeline lite: {len(drugs)} -> {path} "
          f"({os.path.getsize(src)/1024/1024:.0f}MB -> {os.path.getsize(path)/1024/1024:.0f}MB)")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["abstracts", "pipeline", "facets", "publications", "whatsnew"], default=None,
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
    if only in (None, "whatsnew"):
        build_whatsnew()
