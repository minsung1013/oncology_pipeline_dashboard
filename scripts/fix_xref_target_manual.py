"""conf-0.9 xref 타겟 교정 중 수기 검증으로 확인된 오류 보정 (고신뢰만).

36건 전수 검토 결과 명백히 틀린 타겟만 바로잡는다. 대표(첫) 약물명 + 현재 타겟이
지정값과 일치할 때만 적용(과적용 방지). target_pre_manualfix에 원본 보존, target_src=manual.

용법: python scripts/fix_xref_target_manual.py [--write]
"""
import json
import os
import re
import sys

PIPELINE = "data/parsed/pipeline.json"

# (대표약물명 소문자 prefix, {틀린 타겟: 올바른 타겟}, 근거)
FIXES = [
    ("l19il2",       {"L19": "Fibronectin EDB"},
     "L19은 항체명이지 타겟이 아님 — L19 항체는 fibronectin EDB 도메인 표적"),
    ("tp-0903",      {"TP53": "AXL"},
     "TP-0903(dubermatinib)은 AXL 키나아제 억제제"),
    ("imp321",       {"MHC class II": "LAG-3"},
     "IMP321(eftilagimod)은 통상 LAG-3로 분류(soluble LAG-3Ig)"),
    ("lurbinectedin", {"XPO1": "RNA Pol II"},
     "lurbinectedin은 XPO1 억제제 아님 — 종양전사(RNA Pol II) 억제"),
    ("ziftomenib",   {"KMT2A": "Menin"},
     "ziftomenib의 분자 표적은 Menin (KMT2A는 질환 드라이버)"),
    ("sar444245",    {"IL-2R alpha": "IL-2R"},
     "pegenzileukin은 α-비의존 IL-2 — IL-2R alpha 아님"),
    ("nivolumab",    {"LAG-3": "PD-1"},
     "nivolumab은 항-PD-1 (콤보의 relatlimab을 잘못 귀속)"),
]
_SPLIT = re.compile(r"\s*(?:,|\+|/|\bplus\b|\band\b|\bwith\b)\s*", re.I)


def primary(name):
    parts = [p for p in _SPLIT.split(name or "") if p.strip()]
    return (parts[0] if parts else (name or "")).strip().lower()


def main(write):
    data = json.load(open(PIPELINE, encoding="utf-8"))
    n = 0
    for x in data["drugs"]:
        prim = primary(x.get("drug_name"))
        for pref, mapping, why in FIXES:
            if not prim.startswith(pref):
                continue
            cur = x.get("target")
            if cur in mapping:
                x["target_pre_manualfix"] = cur
                x["target"] = mapping[cur]
                x["target_src"] = "manual"
                nt = x["target"]
                if x.get("modality") and x.get("modality") != "Unknown":
                    x["moa"] = f"{x['modality']} targeting {nt}"
                print(f"  {(x.get('drug_name') or '')[:34]:34} {cur:14} -> {nt:18} | {why}")
                n += 1
            break
    print(f"\n수기 보정: {n}건")
    if write:
        json.dump(data, open(PIPELINE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"저장 완료 -> {PIPELINE}")
    else:
        print("(dry-run — 반영하려면 --write)")


if __name__ == "__main__":
    main("--write" in sys.argv)
