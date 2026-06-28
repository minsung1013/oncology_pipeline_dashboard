"""모달리티 분류체계 갭 후처리 교정 (비항체 생물의약품 + 암백신).

LLM/xref 분류에 해당 옵션이 없던 시절의 오분류를 규칙으로 바로잡는다. 고정밀 원칙:
대표(첫) 약물명만 매칭(콤보·보조요법 오염 차단), 카테고리별로 '명백히 틀린' modality만 교정.

- Fusion/Recombinant Protein: aflibercept·luspatercept(융합단백)·IL-2/IFN(사이토카인) 등이
  Small Molecule/mAb로 분류된 것. anti-사이토카인 항체(siltuximab)는 제외.
- Vaccine: 능동면역 암백신(펩타이드/DNA/네오항원)이 Peptide/mRNA/Small Molecule로 분류된 것.
  수지상세포·종양세포 백신(Cell Therapy)·종양용해바이러스(Oncolytic Virus)·CAR-T는 그대로 둠
  (그 분류가 더 구체적이라 정답). 코드명 백신은 소수만 큐레이션.

용법: python scripts/fix_protein_modality.py [--write]
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_fields import MODALITY_KEYWORDS  # noqa: E402

PIPELINE = "data/parsed/pipeline.json"

PROTEIN_MODS = ["Fusion Protein", "Recombinant Protein"]
# 단백질: 콤보에 항체가 섞여도 대표가 항체일 수 있으니 보수적으로 이 값들만 교정.
PROTEIN_OVERRIDABLE = {"Small Molecule", "Unknown", "Peptide", "Monoclonal Antibody", None, ""}
# 백신: Cell Therapy·Oncolytic Virus·CAR-T는 보존(더 구체적). 그 외 비면역 분류만 교정.
VAC_OVERRIDABLE = {"Unknown", "mRNA", "Peptide", "Small Molecule",
                   "Monoclonal Antibody", "ADC", "Bispecific Antibody", None, ""}
# 이름에 'vaccine'이 없는 잘 알려진 코드명 암백신 (소수, 고신뢰).
VACCINE_CODES = ["neo-pv-01", "vb10.neo", "vb10", "gx-188e", "ose2101", "gen-009", "pgv-001"]

_SPLIT = re.compile(r"\s*(?:,|\+|/|\bplus\b|\band\b|\bwith\b)\s*", re.I)
# 사이토카인을 '표적하는 항체'(anti-IL-6 mAb 등)는 사이토카인 자체가 아니므로 제외.
_ANTI_CYTOKINE = re.compile(r"\banti-?\s*(inter(leukin|feron)|il-?\d|ifn)", re.I)
# 예방용 감염병 백신(보조/대조군) 제외 — 암 치료백신 아님. BCG(방광암)·HPV/EBV 치료백신은 유지.
_PROPHYLACTIC = re.compile(
    r"covid|sars-cov|influenza|\bflu\b|pneumococc|pneumonia|hepatitis|zoster|shingles|"
    r"tetanus|diphther|pertussis|meningococc|\brabies\b|yellow fever|varicella|mrna-127", re.I)


def primary_drug(name):
    """다약물 이름의 대표(첫) 약물만 — 콤보·보조요법 약물 오염 방지."""
    parts = [p for p in _SPLIT.split(name or "") if p.strip()]
    return parts[0] if parts else (name or "")


def _match(prim_low, mods):
    for mod in mods:
        for kw in MODALITY_KEYWORDS[mod]:
            if kw.lower() in prim_low:
                return mod, kw
    return None, None


def classify(prim):
    """대표약물명 → (목표 modality, overridable 집합, 매칭근거) 또는 (None, ...)."""
    low = prim.lower()
    if _PROPHYLACTIC.search(prim):
        return None, None, None  # 예방용 감염병 백신 — 암 치료백신 아님
    # 1) 백신 우선 (이름 키워드 또는 코드명)
    if any(c in low for c in VACCINE_CODES):
        return "Vaccine", VAC_OVERRIDABLE, "code"
    vmod, vkw = _match(low, ["Vaccine"])
    if vmod:
        return "Vaccine", VAC_OVERRIDABLE, vkw
    # 2) 단백질 (anti-사이토카인 항체 제외)
    if _ANTI_CYTOKINE.search(prim):
        return None, None, None
    pmod, pkw = _match(low, PROTEIN_MODS)
    if pmod:
        return pmod, PROTEIN_OVERRIDABLE, pkw
    return None, None, None


def main(write):
    data = json.load(open(PIPELINE, encoding="utf-8"))
    drugs = data["drugs"]
    fixed = {"Vaccine": 0, "Fusion Protein": 0, "Recombinant Protein": 0}
    samples = []
    for x in drugs:
        prim = primary_drug(x.get("drug_name"))
        mod, ovr, kw = classify(prim)
        if not mod:
            continue
        cur = x.get("modality")
        if cur == mod or cur not in ovr:
            continue
        x.setdefault("modality_pre_gapfix", cur)
        x["modality"] = mod
        x["modality_src"] = "rule_modality_fix"
        nt = x.get("target")
        if nt and nt != "Unknown":
            x["moa"] = f"{mod} targeting {nt}"
        fixed[mod] += 1
        if len(samples) < 18:
            samples.append(f"  {(x.get('drug_name') or '')[:32]:32} {cur} -> {mod}  (kw: {kw})")
    total = sum(fixed.values())
    print(f"교정 대상: {total}건 — {dict(fixed)}")
    print("\n".join(samples))
    if write:
        json.dump(data, open(PIPELINE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"\n저장 완료 -> {PIPELINE}")
    else:
        print("\n(dry-run — 반영하려면 --write)")


if __name__ == "__main__":
    main("--write" in sys.argv)
