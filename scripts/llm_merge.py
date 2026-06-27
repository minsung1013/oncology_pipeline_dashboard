"""
LLM 캐시(data/cache/llm_drug_cache.json) → pipeline.json 병합 (하이브리드).

정책:
  - 규칙=Unknown & LLM=값 & conf>=0.6  → LLM 채택 (src=llm)
  - 규칙=값 & LLM=값 & 서로 다름:
      conf>=0.85 → LLM 채택 (src=llm, flag '..._conflict_resolved') — 고신뢰 충돌은 LLM이 대개 정확
      0.8<=conf<0.85 → 규칙 유지 + 충돌 플래그(검토 필요)
  - 그 외 → 규칙 유지 (src=rule)

원본 규칙값은 modality_rule / target_rule 에 보존 → 재실행 안전(idempotent).
출처/신뢰도/플래그를 함께 기록해 대시보드 품질 배지로 활용 가능.

용법: python scripts/llm_merge.py            # 병합 미리보기(통계만)
      python scripts/llm_merge.py --write    # pipeline.json 갱신
"""

import argparse
import json
import re

PIPELINE = "data/parsed/pipeline.json"
DRUG_CACHE = "data/cache/llm_drug_cache.json"
ABSTRACTS = "data/parsed/abstracts_asco2026.json"
ABSTRACT_CACHE = "data/cache/llm_abstract_cache.json"
PIPELINE_CACHE = "data/cache/llm_pipeline_cache.json"  # 임상시험 엔트리 한국어 요약
XREF_CACHE = "data/cache/llm_xref_cache.json"          # 크로스소스 보완(modality/target/bio)
XREF_REVIEW = "data/parsed/xref_review.json"           # 채움·교정 리뷰 리포트
XREF_FILL_CONF = 0.7     # Unknown 채움 최소 신뢰도
XREF_CORRECT_CONF = 0.85 # 기존값 교정(충돌) 최소 신뢰도 — 더 보수적
ABS_CONF = 0.6  # 초록: LLM 리스트 채택 최소 신뢰도

FILL_CONF = 0.6       # Unknown 채우기 최소 신뢰도
CONFLICT_CONF = 0.8   # 충돌 인식 최소 신뢰도
ADOPT_CONF = 0.85     # 충돌 시 LLM 채택 최소 신뢰도 (이 미만은 규칙 유지+검토 플래그)


def _norm_name(n: str) -> str:
    return re.sub(r"\s+", " ", (n or "").strip().lower())


def _tgt_match(a: str, b: str) -> bool:
    """타겟 느슨한 일치 (HER2 vs HER-2, 부분포함)."""
    def c(x):
        return re.sub(r"[^a-z0-9]", "", (x or "").lower())
    ca, cb = c(a), c(b)
    if not ca or not cb:
        return ca == cb
    return ca == cb or ca in cb or cb in ca


def merge(write: bool) -> None:
    data = json.load(open(PIPELINE, encoding="utf-8"))
    drugs = data["drugs"]
    cache = json.load(open(DRUG_CACHE, encoding="utf-8"))

    stats = {
        "rows": len(drugs), "have_llm": 0,
        "mod_filled": 0, "mod_resolved": 0, "mod_conflict": 0,
        "tgt_filled": 0, "tgt_resolved": 0, "tgt_conflict": 0,
        "bio_filled": 0,
    }

    for d in drugs:
        llm = cache.get(_norm_name(d["drug_name"]))
        # 원본 규칙값 보존
        rule_mod = d.setdefault("modality_rule", d.get("modality", "Unknown"))
        rule_tgt = d.setdefault("target_rule", d.get("target", "Unknown"))
        rule_bio = d.setdefault("biomarker_list_rule", d.get("biomarker_list") or [])
        flags = []
        mod_src = tgt_src = bio_src = "rule"
        final_mod, final_tgt = rule_mod, rule_tgt
        final_bio = rule_bio

        if llm:
            stats["have_llm"] += 1
            conf = llm.get("confidence", 0.0)
            lm, lt = llm.get("modality", "Unknown"), llm.get("target", "Unknown")

            # modality
            if rule_mod == "Unknown" and lm != "Unknown" and conf >= FILL_CONF:
                final_mod, mod_src = lm, "llm"
                stats["mod_filled"] += 1
            elif rule_mod != "Unknown" and lm != "Unknown" and lm != rule_mod and conf >= CONFLICT_CONF:
                if conf >= ADOPT_CONF:
                    final_mod, mod_src = lm, "llm"
                    flags.append("modality_conflict_resolved")
                    stats["mod_resolved"] += 1
                else:
                    flags.append("modality_conflict")
                    stats["mod_conflict"] += 1

            # target
            if rule_tgt == "Unknown" and lt != "Unknown" and conf >= FILL_CONF:
                final_tgt, tgt_src = lt, "llm"
                stats["tgt_filled"] += 1
            elif rule_tgt != "Unknown" and lt != "Unknown" and not _tgt_match(rule_tgt, lt) and conf >= CONFLICT_CONF:
                if conf >= ADOPT_CONF:
                    final_tgt, tgt_src = lt, "llm"
                    flags.append("target_conflict_resolved")
                    stats["tgt_resolved"] += 1
                else:
                    flags.append("target_conflict")
                    stats["tgt_conflict"] += 1

            # biomarkers — LLM 환자선택 바이오마커를 규칙 추출분과 합집합(둘 다 보존).
            # 규칙(eligibility 정규식)과 LLM이 상호보완적이라 union이 회수율이 가장 높다.
            lbio = llm.get("biomarkers") if isinstance(llm.get("biomarkers"), list) else []
            lbio = [b.strip() for b in lbio if isinstance(b, str) and b.strip()]
            if lbio and conf >= FILL_CONF:
                merged = list(dict.fromkeys([*rule_bio, *lbio]))
                if merged != rule_bio:
                    stats["bio_filled"] += 1
                final_bio, bio_src = merged, "llm" if not rule_bio else "llm+rule"

        d["modality"] = final_mod
        d["target"] = final_tgt
        d["modality_src"] = mod_src
        d["target_src"] = tgt_src
        d["biomarker_list"] = final_bio
        d["biomarker_mentioned"] = len(final_bio) > 0
        d["biomarker_src"] = bio_src
        d["biomarkers_llm"] = llm.get("biomarkers") if llm else None
        d["llm_confidence"] = llm.get("confidence") if llm else None
        d["modality_llm"] = llm.get("modality") if llm else None
        d["target_llm"] = llm.get("target") if llm else None
        d["data_flags"] = flags
        # moa 재계산
        d["moa"] = f"{final_mod} targeting {final_tgt}" if final_tgt != "Unknown" else final_mod

    print("=== 병합 통계 ===")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    unk_before = sum(1 for d in drugs if d["modality_rule"] == "Unknown")
    unk_after = sum(1 for d in drugs if d["modality"] == "Unknown")
    print(f"\n  modality Unknown: {unk_before} -> {unk_after}  (회수 {unk_before - unk_after})")
    tunk_before = sum(1 for d in drugs if d["target_rule"] == "Unknown")
    tunk_after = sum(1 for d in drugs if d["target"] == "Unknown")
    print(f"  target Unknown:   {tunk_before} -> {tunk_after}  (회수 {tunk_before - tunk_after})")

    if write:
        with open(PIPELINE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        print(f"\n저장 완료 -> {PIPELINE}")
    else:
        print("\n(미리보기 — 저장하려면 --write)")


def merge_abstracts(write: bool) -> None:
    import glob
    # 학회 초록 + 저널 논문 둘 다 (동일 uid 캐시 적용)
    files = sorted(glob.glob("data/parsed/abstracts_*.json") + glob.glob("data/parsed/publications_*.json"))
    cache = json.load(open(ABSTRACT_CACHE, encoding="utf-8"))
    total_stats = {"total": 0, "have_llm": 0, "applied": 0, "summary_ko": 0}

    for fp in files:
        data = json.load(open(fp, encoding="utf-8"))
        abstracts = data["abstracts"]
        stats = {"total": len(abstracts), "have_llm": 0, "applied": 0}

        for a in abstracts:
            a.setdefault("modality_list_rule", a.get("modality_list", []))
            a.setdefault("target_list_rule", a.get("target_list", []))
            a.setdefault("biomarker_list_rule", a.get("biomarker_list", []))
            llm = cache.get(a["uid"])
            src = "rule"
            if llm and llm.get("confidence", 0) >= ABS_CONF:
                stats["have_llm"] += 1
                a["modality_list"] = llm.get("modality_list") or ["Unknown"]
                a["target_list"] = llm.get("target_list") or ["Unknown"]
                a["biomarker_list"] = llm.get("biomarkers") or []
                a["biomarker_mentioned"] = len(a["biomarker_list"]) > 0
                src = "llm"
                stats["applied"] += 1
            if llm and llm.get("summary_ko"):
                a["summary_ko"] = llm["summary_ko"]
                total_stats["summary_ko"] += 1
            a["enrich_src"] = src
            a["llm_confidence"] = llm.get("confidence") if llm else None

        for k in stats:
            total_stats[k] = total_stats.get(k, 0) + stats[k]

        if write:
            with open(fp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            bm = sum(1 for a in abstracts if a.get("biomarker_mentioned"))
            print(f"  저장 -> {fp}  ({len(abstracts)}건, biomarker {bm}, summary_ko {stats['applied']})")

    print("=== 초록 병합 통계 (전체) ===")
    for k, v in total_stats.items():
        print(f"  {k}: {v}")
    if not write:
        print("\n(미리보기 — 저장하려면 --write)")


def merge_pipeline(write: bool) -> None:
    """pipeline 요약 캐시(llm_pipeline_cache.json) → pipeline.json 의 summary_ko 병합 (drug_id 키)."""
    data = json.load(open(PIPELINE, encoding="utf-8"))
    drugs = data["drugs"]
    cache = json.load(open(PIPELINE_CACHE, encoding="utf-8"))

    applied = 0
    for d in drugs:
        res = cache.get(d.get("drug_id"))
        if res and res.get("summary_ko"):
            d["summary_ko"] = res["summary_ko"]
            d["summary_confidence"] = res.get("confidence")
            applied += 1
    print(f"=== pipeline 요약 병합 ===\n  엔트리 {len(drugs)} · summary_ko 적용 {applied} (캐시 {len(cache)})")

    if write:
        with open(PIPELINE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        print(f"저장 완료 -> {PIPELINE}")
    else:
        print("\n(미리보기 — 저장하려면 --write)")


def merge_xref(write: bool) -> None:
    """크로스소스 보완 캐시(llm_xref_cache.json) → pipeline.json.
    Unknown은 채우고(conf>=0.7), 기존값과의 충돌은 보수적으로 교정(conflict & conf>=0.85).
    원본은 *_pre_xref 에 보존하고 리뷰 리포트(xref_review.json)를 남긴다."""
    data = json.load(open(PIPELINE, encoding="utf-8"))
    drugs = data["drugs"]
    cache = json.load(open(XREF_CACHE, encoding="utf-8"))

    report, n_fill, n_corr = [], 0, 0
    for d in drugs:
        res = cache.get(d.get("drug_id"))
        if not res:
            continue
        conf = res.get("confidence", 0.0)
        new_mod = res.get("modality", "Unknown")
        new_tgt = res.get("target", "Unknown")
        cur_mod, cur_tgt = d.get("modality"), d.get("target")
        before = (cur_mod, cur_tgt)
        action, changed = None, False

        if (cur_mod == "Unknown" or cur_tgt == "Unknown") and conf >= XREF_FILL_CONF:
            if cur_mod == "Unknown" and new_mod != "Unknown":
                d["modality"], d["modality_src"], changed = new_mod, "xref", True
            if cur_tgt == "Unknown" and new_tgt != "Unknown":
                d["target"], d["target_src"], changed = new_tgt, "xref", True
            if changed:
                action, n_fill = "filled", n_fill + 1
        elif res.get("conflict") and conf >= XREF_CORRECT_CONF and (new_mod != "Unknown" or new_tgt != "Unknown"):
            d.setdefault("modality_pre_xref", cur_mod)
            d.setdefault("target_pre_xref", cur_tgt)
            if new_mod != "Unknown" and new_mod != cur_mod:
                d["modality"], d["modality_src"], changed = new_mod, "xref", True
            if new_tgt != "Unknown" and not _tgt_match(cur_tgt, new_tgt):
                d["target"], d["target_src"], changed = new_tgt, "xref", True
            if changed:
                action, n_corr = "corrected", n_corr + 1
                d.setdefault("data_flags", []).append("xref_corrected")

        if changed:
            if res.get("biomarkers"):
                d["biomarker_list"] = list(dict.fromkeys((d.get("biomarker_list") or []) +
                                                         [b for b in res["biomarkers"] if b]))
                d["biomarker_mentioned"] = len(d["biomarker_list"]) > 0
            d["xref_evidence"] = res.get("evidence_uids")
            d["xref_confidence"] = conf
            d["xref_note"] = res.get("note")
            d["moa"] = f"{d['modality']} targeting {d['target']}" if d["target"] != "Unknown" else d["modality"]
            report.append({"drug": d["drug_name"], "action": action, "before": before,
                           "after": (d["modality"], d["target"]), "conf": conf,
                           "evidence": res.get("evidence_uids"), "note": res.get("note")})

    print(f"=== 크로스소스 병합 ===\n  채움 {n_fill} · 교정 {n_corr} (캐시 {len(cache)})")
    if write:
        json.dump(data, open(PIPELINE, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        json.dump(report, open(XREF_REVIEW, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"저장 -> {PIPELINE}\n리뷰 리포트 -> {XREF_REVIEW} ({len(report)}건)")
    else:
        print("\n(미리보기 — 저장하려면 --write)")
        for r in report[:20]:
            print(f"  [{r['action']}] {r['drug'][:26]:26} {r['before']} -> {r['after']} "
                  f"conf={r['conf']} | {(r['note'] or '')[:50]}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["drugs", "abstracts", "pipeline", "xref"], default="drugs")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    if args.mode == "abstracts":
        merge_abstracts(args.write)
    elif args.mode == "pipeline":
        merge_pipeline(args.write)
    elif args.mode == "xref":
        merge_xref(args.write)
    else:
        merge(args.write)
