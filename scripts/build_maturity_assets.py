#!/usr/bin/env python3
"""
Build frontend assets for the Target Maturity tab.
=================================================
전임상(학회 초록) 프로그램 집계를 프론트에서 '기존 필터 그대로' 할 수 있게,
두 개의 경량 매핑 에셋을 생성한다.

  data/frontend/maturity_drug_targets.json
     { "<drug lower>": {"t": <canonical target>, "n": <display drug>, "m": <modality>} }
     - llm_drug_cache 기반. 초록 drugs_mentioned 를 이걸로 조회 → 세포주 자동 배제 +
       약물의 실제 target(정규화) 매핑. 프론트 전임상 프로그램 집계에 사용.

  data/frontend/maturity_target_canon.json
     { "<raw pipeline target>": <canonical target> }
     - pipeline.json 의 raw target 을 정규화된 대표형으로. 프론트 임상 집계 + 필터 역매핑에 사용.

정규화 로직은 analysis/crc_target_maturity/build_matrix.py 를 그대로 재사용(단일 소스).
"""
import json, os, sys, glob, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
ANALYSIS = os.path.join(ROOT, "analysis", "crc_target_maturity")
sys.path.insert(0, ANALYSIS)

# build_matrix 의 정규화 재사용 (import 시 main() 실행 안 됨)
from build_matrix import norm_target, build_format_canon  # noqa: E402

OUT = os.path.join(ROOT, "data", "frontend")


def main():
    pipeline = json.load(open(os.path.join(ROOT, "data/frontend/pipeline.json")))["drugs"]
    cache = json.load(open(os.path.join(ROOT, "data/cache/llm_drug_cache.json")))

    # 학회 초록 target_list 도 수집 (Opportunity Map 이 초록 타깃을 정규화해야 함)
    abstract_targets = set()
    for f in glob.glob(os.path.join(ROOT, "data/parsed/abstracts_*.json")):
        for a in json.load(open(f)).get("abstracts", []):
            for t in (a.get("target_list") or []):
                if t:
                    abstract_targets.add(t)

    # 1) 코퍼스 전체 정규화 이름 빈도 -> 포맷 대표형 맵 (pipeline + cache + 초록 target)
    norm_counts = collections.Counter()
    for d in pipeline:
        n = norm_target(d.get("target"))
        if n:
            norm_counts[n] += 1
    for ent in cache.values():
        n = norm_target(ent.get("target"))
        if n:
            norm_counts[n] += 1
    for t in abstract_targets:
        n = norm_target(t)
        if n:
            norm_counts[n] += 1
    fmt_canon, _ = build_format_canon(norm_counts)

    def canon(raw):
        n = norm_target(raw)
        if not n:
            return None
        return fmt_canon.get(n, n)

    # 2) raw target(pipeline + 학회 초록) -> canonical
    target_canon = {}
    for d in pipeline:
        t = d.get("target")
        if t and t not in target_canon:
            c = canon(t)
            if c:
                target_canon[t] = c
    for t in abstract_targets:
        if t not in target_canon:
            c = canon(t)
            if c:
                target_canon[t] = c

    # 3) drug(lower) -> {t: canonical target, n: display, m: modality}
    drug_targets = {}
    for key, ent in cache.items():
        c = canon(ent.get("target"))
        if not c:
            continue
        drug_targets[key] = {
            "t": c,
            "n": ent.get("_drug_name") or key,
            "m": ent.get("modality") or "Unknown",
        }

    with open(os.path.join(OUT, "maturity_target_canon.json"), "w") as f:
        json.dump(target_canon, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "maturity_drug_targets.json"), "w") as f:
        json.dump(drug_targets, f, ensure_ascii=False, separators=(",", ":"))

    print(f"maturity_target_canon.json : {len(target_canon)} raw targets")
    print(f"maturity_drug_targets.json : {len(drug_targets)} drugs")
    # 정규화 예시
    for t in ("K-RAS", "ERBB2", "CEACAM5", "Topoisomerase I", "HT-29"):
        print(f"   canon({t!r}) = {canon(t)!r}")


if __name__ == "__main__":
    main()
