"""
target / biomarker 값 정규화 (데이터 클리닝).

문제:
  - LLM target에 서술문 유입 (Bortezomib... "is a proteasome inhibitor...")
  - 표기 중복 (BCR-ABL / BCR::ABL / Bcr-Abl / BCR-ABL1)
  - 긴 풀네임 ("Vascular Endothelial Growth Factor Receptor (VEGFR)")
  - biomarker 동의어 (MSI / MSI-H / microsatellite instability)

방침: 괄호 약어 추출 → 서술문 정제 → **최종 target canonical은 단일 소스에 위임**.
  - target canonical 권위 = analysis/crc_target_maturity/build_matrix.py::norm_target
    이 모듈은 LLM 출력의 '정제'(문장/약물명/약어)만 담당하고, 유전자 심볼 통일은
    norm_target에 넘긴다. 하위 TARGET_CANON은 정제용 보조 별칭표일 뿐, 최종 표준형은
    항상 norm_target()가 결정한다(멱등). make_frontend_data가 하류에서 다시 norm_target을
    적용하므로 parsed==frontend 일관성이 보장된다.
  - biomarker canonical은 하류 make_frontend_data가 normalize_biomarkers.py로 최종
    정규화하므로 여기 BIOMARKER_CANON은 parsed 중간표현 정리에만 관여한다.
"""

import os
import re
import sys

# 단일 소스 target canonical 정규화기 (make_frontend_data와 동일 import 경로)
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "analysis", "crc_target_maturity"))
from build_matrix import norm_target as _canon_target  # noqa: E402

# ── target 표준화 ─────────────────────────────────────────────────────────────
# 키: 영숫자만 소문자화한 형태 → 표준 심볼
TARGET_CANON = {
    "bcrabl": "BCR-ABL", "bcrabl1": "BCR-ABL", "abl": "BCR-ABL", "abl1": "BCR-ABL",
    "her2": "HER2", "her2neu": "HER2", "erbb2": "HER2",
    "her3": "HER3", "erbb3": "HER3",
    "pdl1": "PD-L1", "pd1": "PD-1", "pdl2": "PD-L2",
    "ctla4": "CTLA-4",
    "vegf": "VEGF/VEGFR", "vegfr": "VEGF/VEGFR", "vegfr2": "VEGF/VEGFR",
    "vegfvegfr": "VEGF/VEGFR", "kdr": "VEGF/VEGFR",
    "egfr": "EGFR", "met": "MET", "cmet": "MET", "alk": "ALK", "ros1": "ROS1",
    "ret": "RET", "ntrk": "NTRK", "trk": "NTRK",
    "kras": "KRAS", "krasg12c": "KRAS G12C", "nras": "NRAS", "hras": "HRAS", "ras": "RAS",
    "braf": "BRAF", "brafv600e": "BRAF V600E",
    "cdk46": "CDK4/6", "cdk4": "CDK4/6", "cdk6": "CDK4/6", "cdk7": "CDK7", "cdk9": "CDK9",
    "parp": "PARP", "parp1": "PARP", "btk": "BTK", "bcl2": "BCL2",
    "fgfr": "FGFR", "fgfr2": "FGFR2", "fgfr3": "FGFR3", "fgfr2b": "FGFR2b",
    "pi3k": "PI3K", "pik3ca": "PIK3CA", "akt": "AKT", "akt1": "AKT", "mtor": "mTOR",
    "idh1": "IDH1", "idh2": "IDH2", "idh12": "IDH1/2", "idh1idh2": "IDH1/2",
    "tp53": "TP53", "p53": "TP53", "mdm2": "MDM2", "mdmx": "MDMX",
    "trop2": "TROP2", "cldn182": "CLDN18.2", "claudin182": "CLDN18.2",
    "bcma": "BCMA", "cd19": "CD19", "cd20": "CD20", "cd22": "CD22", "cd3": "CD3",
    "cd30": "CD30", "cd33": "CD33", "cd38": "CD38", "cd123": "CD123",
    "psma": "PSMA", "fap": "FAP", "dll3": "DLL3", "muc16": "MUC16", "msln": "Mesothelin",
    "mesothelin": "Mesothelin", "nectin4": "Nectin-4", "gd2": "GD2", "cea": "CEA",
    "tigit": "TIGIT", "lag3": "LAG-3", "tim3": "TIM-3", "ar": "AR",
    "topoisomeraseii": "Topoisomerase II", "topoisomerasei": "Topoisomerase I",
    "topoisomerase": "Topoisomerase", "proteasome": "Proteasome", "26sproteasome": "Proteasome",
    "farnesyltransferase": "Farnesyltransferase", "imid": "Cereblon (IMiD)", "crbn": "Cereblon (IMiD)",
    "hdac": "HDAC", "hsp90": "HSP90", "mek": "MEK", "raf": "RAF", "kit": "KIT",
    "csf1r": "CSF1R", "jak": "JAK", "jak12": "JAK1/2", "jak2": "JAK2",
    "her2low": "HER2", "estrogenreceptor": "ER", "er": "ER", "pr": "PR",
}

# LLM이 약물명을 target으로 반환한 경우 → 실제 표적으로 매핑
DRUG_AS_TARGET = {
    "bortezomib": "Proteasome", "carfilzomib": "Proteasome", "ixazomib": "Proteasome",
    "marizomib": "Proteasome", "oprozomib": "Proteasome",
    "lenalidomide": "Cereblon (IMiD)", "pomalidomide": "Cereblon (IMiD)",
    "thalidomide": "Cereblon (IMiD)", "iberdomide": "Cereblon (IMiD)",
    "azacitidine": "DNMT", "decitabine": "DNMT", "everolimus": "mTOR", "temsirolimus": "mTOR",
    "venetoclax": "BCL2", "vismodegib": "Hedgehog (SMO)", "sonidegib": "Hedgehog (SMO)",
}

# 서술문 구제 키워드 (target이 문장으로 들어온 경우)
_RESCUE = [
    ("proteasome", "Proteasome"), ("topoisomerase ii", "Topoisomerase II"),
    ("topoisomerase", "Topoisomerase"), ("farnesyltransferase", "Farnesyltransferase"),
    ("glucocorticoid", "Glucocorticoid receptor"), ("microtubule", "Microtubule"),
    ("dna methyltransferase", "DNMT"), ("dnmt", "DNMT"), ("cereblon", "Cereblon (IMiD)"),
    ("histone deacetylase", "HDAC"), ("aurora", "Aurora kinase"),
]


def _key(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _canon(s: str) -> str:
    """정제된 토큰의 최종 표준형을 단일 소스(norm_target)에 위임. 멱등."""
    return _canon_target(s) or s


def normalize_target(t: str) -> str:
    if not t:
        return "Unknown"
    s = t.strip().strip(".")
    low = s.lower()
    if low in ("unknown", "", "n/a", "none"):
        return "Unknown"

    # 약물명이 target으로 들어온 경우
    if _key(s) in DRUG_AS_TARGET:
        return _canon(DRUG_AS_TARGET[_key(s)])

    # 서술문/장황 (문장형) → 키워드 구제 또는 Unknown
    is_sentence = len(s) > 40 and (
        " is a " in low or "therefore" in low or "does not have" in low
        or "inhibitor" in low or "not a single" in low or ";" in s or ":" in s
    )
    if is_sentence:
        for kw, canon in _RESCUE:
            if kw in low:
                return _canon(canon)
        m = re.search(r"\(([A-Za-z0-9/\-]{2,14})\)", s)
        if m:
            return _canon(TARGET_CANON.get(_key(m.group(1)), m.group(1)))
        return "Unknown"

    # "Long Name (ABBR)" → ABBR
    m = re.search(r"\(([A-Za-z0-9/\-]{2,14})\)\s*$", s)
    if m:
        s = m.group(1)

    k = _key(s)
    if k in TARGET_CANON:
        return _canon(TARGET_CANON[k])
    # 너무 길면(여전히 풀네임/구문) 약어 구제, 없으면 그대로
    if len(s) > 28 and " " in s:
        for kw, canon in _RESCUE:
            if kw in s.lower():
                return _canon(canon)
        return "Unknown"
    return _canon(s)


# ── biomarker 표준화 (동의어 병합) ────────────────────────────────────────────
BIOMARKER_CANON = {
    "msi": "MSI-H", "msih": "MSI-H", "microsatelliteinstability": "MSI-H",
    "dmmr": "dMMR", "mismatchrepair": "dMMR", "mmrd": "dMMR",
    "tmb": "TMB", "tumormutationalburden": "TMB", "tmbhigh": "TMB",
    "pdl1": "PD-L1", "her2": "HER2", "egfrmutation": "EGFR mutation",
    "hrd": "HRD",
}
# 비특이적(generic) — 구체 바이오마커가 아님 → 제거
BIOMARKER_DROP = {
    "biomarker", "biomarker analysis", "biomarker-selected", "genomic",
    "molecular profiling", "oncology", "ngs",
}


def normalize_biomarker(b: str) -> str | None:
    if not b:
        return None
    s = b.strip()
    if s.lower() in BIOMARKER_DROP:
        return None
    return BIOMARKER_CANON.get(_key(s), s)


def normalize_biomarker_list(lst) -> list[str]:
    out = []
    for b in lst or []:
        nb = normalize_biomarker(b)
        if nb and nb not in out:
            out.append(nb)
    return out


def normalize_target_list(lst) -> list[str]:
    out = []
    for t in lst or []:
        nt = normalize_target(t)
        if nt and nt not in out:
            out.append(nt)
    return out or ["Unknown"]


# ── 적용 ──────────────────────────────────────────────────────────────────────
def _apply(write: bool) -> None:
    import json

    # pipeline: target(단일) + biomarker_list
    d = json.load(open("data/parsed/pipeline.json", encoding="utf-8"))
    for x in d["drugs"]:
        nt = normalize_target(x.get("target"))
        names = {(x.get("drug_name") or "").lower()} | {c.lower() for c in (x.get("combo_drugs") or [])}
        if nt.lower() in names:
            nt = "Unknown"
        x["target"] = nt
        x["biomarker_list"] = normalize_biomarker_list(x.get("biomarker_list"))
        x["biomarker_mentioned"] = len(x["biomarker_list"]) > 0
        x["moa"] = f"{x.get('modality')} targeting {nt}" if nt != "Unknown" else x.get("modality")

    # abstracts: target_list + biomarker_list
    a = json.load(open("data/parsed/abstracts_asco2026.json", encoding="utf-8"))
    for x in a["abstracts"]:
        x["target_list"] = normalize_target_list(x.get("target_list"))
        x["biomarker_list"] = normalize_biomarker_list(x.get("biomarker_list"))
        x["biomarker_mentioned"] = len(x["biomarker_list"]) > 0

    from collections import Counter
    tt = Counter(x["target"] for x in d["drugs"] if x["target"] != "Unknown")
    bb = Counter(b for x in d["drugs"] for b in x["biomarker_list"])
    print(f"pipeline distinct target: {len(tt)} | biomarker: {len(bb)}")
    if write:
        json.dump(d, open("data/parsed/pipeline.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        json.dump(a, open("data/parsed/abstracts_asco2026.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("saved.")
    else:
        print("(preview — use --write)")


if __name__ == "__main__":
    import sys
    _apply("--write" in sys.argv)
