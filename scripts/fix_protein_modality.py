"""비항체 생물의약품 모달리티 후처리 교정 (분류체계 갭 보정).

xref/LLM 분류에 'Fusion Protein'·'Recombinant Protein' 옵션이 없던 시절, aflibercept/
luspatercept(융합단백·리간드트랩)·G-CSF(-stim) 등이 Small Molecule로 잘못 분류됐다.
parse_fields의 신규 키워드로 약물명을 다시 보고, 명백한 생물의약품인데 modality가
Small Molecule/Monoclonal Antibody/Unknown인 경우만 보수적으로 교정한다(고정밀, 약물명 매칭).

용법: python scripts/fix_protein_modality.py [--write]
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_fields import MODALITY_KEYWORDS  # noqa: E402

PIPELINE = "data/parsed/pipeline.json"
NEW_MODS = ["Fusion Protein", "Recombinant Protein"]
# 교정 대상 modality만 (명백히 틀린 것). ADC/Bispecific/CAR-T/mAb는 건드리지 않음 — 콤보에
# 항체가 섞여도 대표가 항체일 수 있으니 보수적으로 Small Molecule/Peptide/Unknown만 교정.
OVERRIDABLE = {"Small Molecule", "Unknown", "Peptide", "Monoclonal Antibody", None, ""}
_SPLIT = re.compile(r"\s*(?:,|\+|/|\bplus\b|\band\b|\bwith\b)\s*", re.I)
# 사이토카인을 '표적하는 항체'(anti-IL-6 mAb 등)는 사이토카인 자체가 아니므로 제외.
_ANTI_CYTOKINE = re.compile(r"\banti-?\s*(inter(leukin|feron)|il-?\d|ifn)", re.I)


def primary_drug(name):
    """다약물 이름의 대표(첫) 약물만 — 콤보·보조요법 약물 오염 방지."""
    parts = [p for p in _SPLIT.split(name or "") if p.strip()]
    return parts[0] if parts else (name or "")


def match_modality(text):
    low = (text or "").lower()
    for mod in NEW_MODS:
        for kw in MODALITY_KEYWORDS[mod]:
            if kw.lower() in low:
                return mod, kw
    return None, None


def main(write):
    data = json.load(open(PIPELINE, encoding="utf-8"))
    drugs = data["drugs"]
    fixed, samples = 0, []
    for x in drugs:
        # 대표 약물명만 매칭 (combo_drugs·2차 토큰 제외) — pembrolizumab+pegfilgrastim 류 오탐 차단
        prim = primary_drug(x.get("drug_name"))
        if _ANTI_CYTOKINE.search(prim):
            continue  # anti-IL/IFN 항체는 사이토카인이 아님 (siltuximab 등)
        mod, kw = match_modality(prim)
        if not mod:
            continue
        cur = x.get("modality")
        if cur == mod or cur not in OVERRIDABLE:
            continue
        x.setdefault("modality_pre_fusionfix", cur)
        x["modality"] = mod
        x["modality_src"] = "rule_protein_fix"
        nt = x.get("target")
        if nt and nt != "Unknown":
            x["moa"] = f"{mod} targeting {nt}"
        fixed += 1
        if len(samples) < 15:
            samples.append(f"  {(x.get('drug_name') or '')[:30]:30} {cur} -> {mod}  (kw: {kw})")
    print(f"교정 대상: {fixed}건")
    print("\n".join(samples))
    if write:
        json.dump(data, open(PIPELINE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"\n저장 완료 -> {PIPELINE}")
    else:
        print("\n(dry-run — 반영하려면 --write)")


if __name__ == "__main__":
    main("--write" in sys.argv)
