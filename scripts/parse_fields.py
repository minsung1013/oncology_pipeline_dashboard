"""
키워드 기반 파싱 스크립트.
raw JSON → 구조화된 필드 추출 (모달리티, 타겟, 바이오마커, CDx 전략, dedup)
"""

import json
import re
import uuid
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# 키워드 사전
# ---------------------------------------------------------------------------

MODALITY_KEYWORDS: dict[str, list[str]] = {
    "ADC": [
        "antibody-drug conjugate", "ADC", "DXd", "vc-MMAE", "SMCC", "conjugate"
    ],
    "Bispecific Antibody": [
        "bispecific", "bsAb", "bispecific antibody", "tandem",
        "dual targeting", "CrossMAb",
    ],
    "CAR-T": [
        "CAR-T", "CAR T-cell", "chimeric antigen receptor", "CAR T cell therapy"
    ],
    "Monoclonal Antibody": [
        "monoclonal antibody", "mAb",
        # mAb suffix patterns (no hyphen — matched as substring)
        "umab", "zumab", "ximab", "limab", "lumab", "tumab", "mumab",
    ],
    "Small Molecule": [
        "inhibitor", "tyrosine kinase inhibitor", "TKI", "small molecule",
        "kinase inhibitor", "antagonist",
        # common small molecule drug name suffixes (no hyphen)
        "inib", "afib", "rafenib", "citinib", "alanib",
        # nucleoside/nucleotide analogs
        "nucleoside", "nucleotide analog", "azacitidine", "decitabine",
        # other common patterns
        "olomide", "mustard",
    ],
    "mRNA": ["mRNA", "messenger RNA", "mRNA vaccine", "mRNA therapy"],
    "Peptide": ["peptide", "cyclic peptide", "stapled peptide"],
    "Cell Therapy": [
        "cell therapy", "NK cell", "TIL", "tumor infiltrating lymphocyte", "TCR-T",
        "cell injection", "cell infusion", "dendritic cell", "T cell therapy",
    ],
    "Oncolytic Virus": ["oncolytic", "oncolytic virus", "oncolytic therapy"],
    "Radiopharmaceutical": [
        "radiopharmaceutical", "radioligand", "PSMA", "lutetium", "actinium"
    ],
}

# 중복 매칭 시 우선순위 순서
MODALITY_PRIORITY = [
    "ADC", "Bispecific Antibody", "CAR-T", "Monoclonal Antibody",
    "Small Molecule", "mRNA", "Peptide", "Cell Therapy",
    "Oncolytic Virus", "Radiopharmaceutical",
]

# 단순 substring 매칭 (긴 문자열 / 약물명)
TARGET_KEYWORDS: dict[str, list[str]] = {
    "PD-1":       ["anti-PD-1", "PD-1", "PD1", "pembrolizumab", "nivolumab", "tislelizumab",
                   "sintilimab", "camrelizumab", "zimberelimab"],
    "PD-L1":      ["anti-PD-L1", "PD-L1", "PDL1", "atezolizumab", "durvalumab", "avelumab"],
    "HER2":       ["HER2", "HER-2", "ErbB2", "trastuzumab", "pertuzumab", "tucatinib"],
    "EGFR":       ["EGFR", "epidermal growth factor receptor", "osimertinib", "erlotinib",
                   "gefitinib", "afatinib", "lazertinib"],
    "VEGF/VEGFR": ["VEGF", "VEGFR", "bevacizumab", "anti-angiogenic", "ramucirumab",
                   "axitinib", "lenvatinib", "sunitinib"],
    "TROP2":      ["TROP2", "TROP-2", "trophoblast cell surface antigen"],
    "CLDN18.2":   ["Claudin 18.2", "CLDN18.2", "Claudin18.2", "zolbetuximab"],
    "CTLA-4":     ["CTLA-4", "CTLA4", "ipilimumab", "tremelimumab"],
    "CD19":       ["CD19", "anti-CD19"],
    "CD20":       ["CD20", "anti-CD20", "rituximab", "obinutuzumab", "ofatumumab"],
    "BCMA":       ["BCMA", "B-cell maturation antigen"],
    "MET":        ["c-MET", "anti-MET", "MET amplification", "MET exon 14",
                   "MET inhibitor", "crizotinib", "capmatinib", "tepotinib", "savolitinib"],
    "KRAS":       ["KRAS", "KRAS G12C", "sotorasib", "adagrasib"],
    "ALK":        ["anaplastic lymphoma kinase", "ALK inhibitor", "ALK fusion",
                   "ALK rearrangement", "alectinib", "brigatinib", "lorlatinib"],
    "FGFR":       ["FGFR", "fibroblast growth factor receptor", "erdafitinib", "pemigatinib"],
    "IDH1/2":     ["IDH1", "IDH2", "isocitrate dehydrogenase", "enasidenib", "ivosidenib"],
    "CDK4/6":     ["CDK4/6", "CDK 4/6", "palbociclib", "ribociclib", "abemaciclib"],
    "PARP":       ["PARP inhibitor", "poly ADP-ribose", "olaparib", "niraparib", "rucaparib"],
    "RET":        ["RET fusion", "RET mutation", "RET inhibitor", "selpercatinib", "pralsetinib"],
    "NTRK":       ["NTRK", "TRK fusion", "tropomyosin receptor kinase", "larotrectinib", "entrectinib"],
    "BTK":        ["BTK", "Bruton", "ibrutinib", "acalabrutinib", "zanubrutinib"],
    "BCL2":       ["BCL-2", "BCL2", "venetoclax", "navitoclax"],
}

# word-boundary 매칭이 필요한 짧은 약어 (오매칭 방지)
TARGET_EXACT_KEYWORDS: dict[str, list[str]] = {
    "MET":     ["MET"],
    "ALK":     ["ALK"],
    "CDK4/6":  ["CDK4", "CDK6"],
    "PARP":    ["PARP"],
    "RET":     ["RET"],
    "BTK":     ["BTK"],
    "BCL2":    ["BCL-2", "BCL2"],
}

# 단순 substring 매칭 바이오마커 (충분히 구체적)
BIOMARKER_KEYWORDS: list[str] = [
    "PD-L1", "HER2", "TROP2", "CLDN18.2",
    "tumor mutational burden",
    "MSI-H", "microsatellite instability",
    "mismatch repair", "dMMR",
    "EGFR mutation", "KRAS", "BRAF", "ROS1", "NTRK",
    "biomarker", "biomarker-selected", "biomarker analysis",
    "companion diagnostic", "CDx",
    "genomic", "molecular profiling",
]

# word-boundary 매칭 바이오마커 (짧은 약어)
BIOMARKER_EXACT_KEYWORDS: list[str] = [
    "RET", "MET", "ALK", "TMB", "MSI", "TMB", "ER", "PR", "AR",
]

CANCER_CATEGORY_MAP: dict[str, list[str]] = {
    "Lung":          ["lung", "NSCLC", "SCLC", "non-small cell", "small cell lung"],
    "Colorectal":    ["colorectal", "colon", "rectal", "rectum", "CRC"],
    "Gastric":       ["gastric", "stomach", "GC", "gastroesophageal"],
    "Breast":        ["breast"],
    "Hematologic":   ["lymphoma", "leukemia", "myeloma", "AML", "CLL", "CML", "NHL", "ALL"],
    "Liver":         ["hepatocellular", "liver", "HCC", "cholangiocarcinoma", "biliary"],
    "Pancreatic":    ["pancreatic", "pancreas"],
    "Prostate":      ["prostate"],
    "Ovarian":       ["ovarian", "ovary"],
    "Bladder":       ["bladder", "urothelial"],
    "Melanoma":      ["melanoma"],
    "Head & Neck":   ["head and neck", "HNSCC", "nasopharyngeal", "thyroid"],
    "Esophageal":    ["esophageal", "esophagus"],
    "Endometrial":   ["endometrial", "uterine", "cervical"],
    "Renal":         ["renal", "kidney", "RCC"],
    "Sarcoma":       ["sarcoma"],
    "Glioma":        ["glioma", "glioblastoma", "GBM", "brain"],
}


# ---------------------------------------------------------------------------
# 파싱 헬퍼
# ---------------------------------------------------------------------------

def _ci_contains(text: str, keyword: str) -> bool:
    return keyword.lower() in text.lower()


def infer_modality(intervention_name: str, intervention_desc: str) -> str:
    combined = f"{intervention_name} {intervention_desc}"
    for modality in MODALITY_PRIORITY:
        for kw in MODALITY_KEYWORDS[modality]:
            if _ci_contains(combined, kw):
                return modality
    return "Unknown"


def _word_boundary_match(text: str, keyword: str) -> bool:
    """대소문자 무시 + word boundary 매칭 (짧은 약어용)."""
    pattern = r'(?<![A-Za-z0-9])' + re.escape(keyword) + r'(?![A-Za-z0-9])'
    return bool(re.search(pattern, text, re.IGNORECASE))


def infer_target(intervention_name: str, brief_summary: str) -> str:
    combined = f"{intervention_name} {brief_summary}"
    for target, keywords in TARGET_KEYWORDS.items():
        for kw in keywords:
            if _ci_contains(combined, kw):
                return target
    # word-boundary 필요한 짧은 약어 (substring 오매칭 방지)
    for target, keywords in TARGET_EXACT_KEYWORDS.items():
        for kw in keywords:
            if _word_boundary_match(combined, kw):
                return target
    return "Unknown"


def infer_biomarkers(eligibility_text: str, brief_summary: str) -> tuple[bool, list[str]]:
    combined = f"{eligibility_text} {brief_summary}"
    combined_lower = combined.lower()
    found = [b for b in BIOMARKER_KEYWORDS if b.lower() in combined_lower]
    for b in BIOMARKER_EXACT_KEYWORDS:
        if b not in found and _word_boundary_match(combined, b):
            found.append(b)
    return bool(found), found


def infer_cdx_strategy(eligibility_text: str) -> str:
    text = eligibility_text.lower()

    confirmed_patterns = [
        "positive", "overexpression", "amplification",
        "mutation", "high expression", "selected",
        "must have", "required", "documented",
    ]
    exploratory_patterns = [
        "exploratory", "optional", "tissue sample",
        "correlative", "biomarker analysis", "translational",
    ]

    has_biomarker = (
        any(b.lower() in text for b in BIOMARKER_KEYWORDS)
        or any(_word_boundary_match(eligibility_text, b) for b in BIOMARKER_EXACT_KEYWORDS)
    )

    if has_biomarker:
        if any(p in text for p in confirmed_patterns):
            return "confirmed"
        return "exploratory"
    return "none"


def normalize_cancer_category(condition: str) -> tuple[str, str]:
    """(cancer_category, condition_normalized) 반환."""
    text = condition.lower()
    for category, keywords in CANCER_CATEGORY_MAP.items():
        for kw in keywords:
            if kw.lower() in text:
                return category, condition
    return "Other", condition


# ---------------------------------------------------------------------------
# ClinicalTrials.gov 응답 → 구조화 필드 추출
# ---------------------------------------------------------------------------

def _safe_get(obj: dict, *keys, default=""):
    for key in keys:
        if not isinstance(obj, dict):
            return default
        obj = obj.get(key, default)
        if obj == default:
            return default
    return obj if obj is not None else default


def extract_study_fields(study: dict) -> dict | None:
    """단일 study 원본 → 파싱된 필드 dict. 약물명 없으면 None."""
    proto = study.get("protocolSection", {})
    id_mod = proto.get("identificationModule", {})
    status_mod = proto.get("statusModule", {})
    sponsor_mod = proto.get("sponsorCollaboratorsModule", {})
    desc_mod = proto.get("descriptionModule", {})
    eligibility_mod = proto.get("eligibilityModule", {})
    arms_mod = proto.get("armsInterventionsModule", {})
    outcomes_mod = proto.get("outcomesModule", {})
    conditions_mod = proto.get("conditionsModule", {})

    # 약물명 추출 (InterventionName)
    interventions = arms_mod.get("interventions", [])
    drug_interventions = [
        i for i in interventions
        if i.get("type", "").upper() in ("DRUG", "BIOLOGICAL", "COMBINATION_PRODUCT")
    ]
    if not drug_interventions:
        drug_interventions = interventions  # fallback: 모든 intervention

    if not drug_interventions:
        return None

    # 대표 약물명: 첫 번째 drug intervention
    drug_name = drug_interventions[0].get("name", "Unknown")
    intervention_desc = " ".join(
        i.get("description", "") for i in drug_interventions
    )

    nct_id = id_mod.get("nctId", "")
    brief_title = id_mod.get("briefTitle", "")
    official_title = id_mod.get("officialTitle", "")
    brief_summary = desc_mod.get("briefSummary", "")
    eligibility_text = eligibility_mod.get("eligibilityCriteria", "")

    conditions = conditions_mod.get("conditions", [])
    condition = conditions[0] if conditions else ""

    overall_status = status_mod.get("overallStatus", "")
    phase_list = proto.get("designModule", {}).get("phases", [])
    phase = phase_list[0] if phase_list else "Phase 1"

    lead_sponsor = sponsor_mod.get("leadSponsor", {}).get("name", "")
    collaborators = [
        c.get("name", "") for c in sponsor_mod.get("collaborators", [])
    ]

    primary_completion = status_mod.get("primaryCompletionDateStruct", {}).get("date", "")
    start_date = status_mod.get("startDateStruct", {}).get("date", "")
    last_update = status_mod.get("lastUpdatePostDateStruct", {}).get("date", "")
    first_post = status_mod.get("studyFirstPostDateStruct", {}).get("date", "")

    enrollment = proto.get("designModule", {}).get("enrollmentInfo", {}).get("count")

    primary_outcomes = [
        o.get("measure", "") for o in outcomes_mod.get("primaryOutcomes", [])
    ]
    secondary_outcomes = [
        o.get("measure", "") for o in outcomes_mod.get("secondaryOutcomes", [])
    ]

    # 파싱
    modality = infer_modality(drug_name, intervention_desc)
    target = infer_target(drug_name, brief_summary)
    biomarker_found, biomarker_list = infer_biomarkers(eligibility_text, brief_summary)
    cdx_strategy = infer_cdx_strategy(eligibility_text)
    cancer_category, condition_normalized = normalize_cancer_category(condition)

    partnership_status = "partnered" if collaborators else "solo"

    moa = f"{modality} targeting {target}" if target != "Unknown" else modality

    return {
        "drug_name": drug_name,
        "company": lead_sponsor,
        "collaborators": collaborators,
        "partnership_status": partnership_status,
        "condition": condition,
        "condition_normalized": condition_normalized,
        "cancer_category": cancer_category,
        "phase": phase,
        "overall_status": overall_status,
        "primary_completion_date": primary_completion,
        "start_date": start_date,
        "last_update_date": last_update,
        "first_post_date": first_post,
        "enrollment_count": enrollment,
        "modality": modality,
        "target": target,
        "moa": moa,
        "biomarker_mentioned": biomarker_found,
        "biomarker_list": biomarker_list,
        "cdx_strategy": cdx_strategy,
        "nct_ids": [nct_id] if nct_id else [],
        "clinicaltrials_url": (
            f"https://clinicaltrials.gov/study/{nct_id}" if nct_id else ""
        ),
        "brief_title": brief_title,
        "official_title": official_title,
        "primary_outcomes": primary_outcomes,
        "secondary_outcomes": secondary_outcomes,
        "pubmed_links": [],
        "keyword_parsed": True,
        "parse_date": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Deduplication: 약물명 기준 그룹핑
# ---------------------------------------------------------------------------

def _normalize_drug_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())


def dedup_by_drug(records: list[dict]) -> list[dict]:
    """
    같은 약물명 + 같은 회사 기준으로 그룹핑.
    대표 레코드: completion_date가 가장 최근 (Phase 2 진입 타이밍 기준).
    NCT ID는 리스트로 보존.
    """
    groups: dict[str, list[dict]] = {}
    for rec in records:
        key = (
            _normalize_drug_name(rec["drug_name"]),
            rec["company"].strip().lower(),
        )
        groups.setdefault(key, []).append(rec)

    result = []
    for group in groups.values():
        # 가장 최근 completion date를 대표로
        def sort_key(r):
            d = r.get("primary_completion_date", "") or ""
            return d

        group.sort(key=sort_key, reverse=True)
        rep = group[0].copy()

        # 모든 NCT ID 합치기
        all_ncts = []
        for r in group:
            all_ncts.extend(r.get("nct_ids", []))
        rep["nct_ids"] = list(dict.fromkeys(all_ncts))  # 순서 유지하며 중복 제거
        rep["drug_id"] = str(uuid.uuid4())

        result.append(rep)

    return result


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

def parse_raw_file(raw_path: str) -> list[dict]:
    with open(raw_path, encoding="utf-8") as f:
        raw = json.load(f)

    studies = raw.get("studies", [])
    print(f"Parsing {len(studies)} studies from {raw_path}...")

    records = []
    skipped = 0
    for study in studies:
        parsed = extract_study_fields(study)
        if parsed is None:
            skipped += 1
            continue
        records.append(parsed)

    print(f"  Parsed: {len(records)}  Skipped (no drug): {skipped}")
    deduped = dedup_by_drug(records)
    print(f"  After dedup: {len(deduped)} unique drug-company entries")
    return deduped


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Parse raw ClinicalTrials data")
    parser.add_argument("raw_path", help="data/raw/full_YYYY-MM-DD.json")
    parser.add_argument("--output", default=None, help="출력 JSON 경로 (생략 시 stdout)")
    args = parser.parse_args()

    records = parse_raw_file(args.raw_path)

    if args.output:
        import os
        os.makedirs(os.path.dirname(args.output), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
        print(f"Saved -> {args.output}")
    else:
        print(json.dumps(records[:3], ensure_ascii=False, indent=2))
