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
    }

    for d in drugs:
        llm = cache.get(_norm_name(d["drug_name"]))
        # 원본 규칙값 보존
        rule_mod = d.setdefault("modality_rule", d.get("modality", "Unknown"))
        rule_tgt = d.setdefault("target_rule", d.get("target", "Unknown"))
        flags = []
        mod_src = tgt_src = "rule"
        final_mod, final_tgt = rule_mod, rule_tgt

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

        d["modality"] = final_mod
        d["target"] = final_tgt
        d["modality_src"] = mod_src
        d["target_src"] = tgt_src
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


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    merge(args.write)
