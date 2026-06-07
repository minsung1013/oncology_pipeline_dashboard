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

# ---------------------------------------------------------------------------
# 대표 약물 선택용 분류 (병용요법에서 주연 약물 식별)
# ---------------------------------------------------------------------------

# 지지요법/비치료 약물 — 대표가 될 수 없음 (단독일 때만 예외)
SUPPORTIVE_AGENTS = {
    "dexamethasone", "prednisone", "prednisolone", "methylprednisolone",
    "hydrocortisone", "anticoagulant", "anticoagulants", "enoxaparin",
    "aspirin", "warfarin", "filgrastim", "pegfilgrastim", "g-csf",
    "ondansetron", "allopurinol", "folic acid", "folinic acid", "leucovorin",
    "vitamin b12", "placebo", "saline", "normal saline", "loperamide",
    "antihistamine", "acetaminophen", "paracetamol",
}

# 화학요법 백본 — 표적/신약이 있으면 후순위
CHEMO_BACKBONE = {
    "carboplatin", "cisplatin", "oxaliplatin", "cyclophosphamide", "ifosfamide",
    "docetaxel", "paclitaxel", "nab-paclitaxel", "abraxane",
    "doxorubicin", "epirubicin", "daunorubicin", "liposomal doxorubicin",
    "gemcitabine", "pemetrexed", "fluorouracil", "5-fu", "5-fluorouracil",
    "capecitabine", "etoposide", "vincristine", "vinblastine", "vinorelbine",
    "irinotecan", "topotecan", "methotrexate", "cytarabine", "bendamustine",
    "mitomycin", "temozolomide", "dacarbazine", "fludarabine", "melphalan",
    "busulfan", "oxaliplatin", "nab paclitaxel",
}

# 표적/신약을 시사하는 약물명 패턴 (suffix)
_TARGETED_SUFFIXES = (
    "mab", "nib", "tinib", "ciclib", "parib", "lisib", "degib", "rafenib",
    "sertib", "metinib", "demcizumab", "ndb", "dxd",
)


def _clean_drug_name(name: str) -> str:
    """용량/스케줄 토큰 제거로 약물명 정규화 (병용 표시·dedup용)."""
    s = name.strip()
    # "Drug 100mg", "Drug 30 mg", "Drug Q3W", "Drug QD/BID" 등 제거
    s = re.sub(r"\s+\d+(\.\d+)?\s?(mg|mcg|g|ml|mg/kg|mg/m2)\b.*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+(q\d?w|q\dd|qd|bid|tid|qw|iv|po|sc)\b.*", "", s, flags=re.IGNORECASE)
    return s.strip()


def _drug_score(name: str) -> int:
    """대표 약물 점수: 높을수록 주연. 3=표적/신약, 2=일반, 1=화학백본, 0=지지요법."""
    n = _clean_drug_name(name).lower()
    if n in SUPPORTIVE_AGENTS:
        return 0
    if n in CHEMO_BACKBONE:
        return 1
    if n.endswith(_TARGETED_SUFFIXES):
        return 3
    # 코드명 패턴 (영문+숫자 조합, 예: NGM120, BL-M07D1, 7MW3711)
    if re.search(r"[A-Za-z]+[-]?\d", name) and not n.endswith(("platin", "rubicin")):
        return 3
    return 2


def select_primary_drug(drug_names: list[str]) -> tuple[str, list[str]]:
    """
    병용 약물 리스트에서 (대표 약물, 병용 약물 리스트) 반환.
    점수 최고를 대표로, 동점이면 원래 순서 우선.
    """
    # 정규화 + 중복 제거 (순서 유지)
    seen = set()
    cleaned = []
    for nm in drug_names:
        c = _clean_drug_name(nm)
        key = c.lower()
        if c and key not in seen:
            seen.add(key)
            cleaned.append(c)
    if not cleaned:
        return "Unknown", []

    # 점수 최고 (동점 시 첫 등장 우선)
    best_idx = max(range(len(cleaned)), key=lambda i: (_drug_score(cleaned[i]), -i))
    primary = cleaned[best_idx]
    combo = [c for i, c in enumerate(cleaned) if i != best_idx]
    return primary, combo

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



def _extract_references(refs_mod: dict) -> list[dict]:
    """referencesModule에서 PMID가 있는 논문 링크 추출."""
    links = []
    seen = set()
    for ref in refs_mod.get("references", []):
        pmid = ref.get("pmid", "").strip()
        if not pmid or pmid in seen:
            continue
        seen.add(pmid)
        citation = ref.get("citation", "")
        # citation 첫 문장을 title로 사용
        title = citation.split(".")[0].strip() if citation else ""
        links.append({
            "pmid": pmid,
            "title": title,
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}",
            "source": "clinicaltrials",
        })
    return links


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
    refs_mod = proto.get("referencesModule", {})

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

    # 대표 약물 선택 (병용요법에서 주연 식별) + 병용 약물 보존
    all_names = [i.get("name", "") for i in drug_interventions if i.get("name")]
    drug_name, combo_drugs = select_primary_drug(all_names)
    is_combination = len(combo_drugs) > 0
    all_drugs = [drug_name] + combo_drugs

    # 모달리티 추론용 설명: 대표 약물의 intervention description 우선
    primary_desc = ""
    for i in drug_interventions:
        if _clean_drug_name(i.get("name", "")).lower() == drug_name.lower():
            primary_desc = i.get("description", "")
            break
    intervention_desc = primary_desc or " ".join(
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
    phase = "/".join(phase_list) if phase_list else "UNKNOWN"

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
    cancer_category, condition_normalized = normalize_cancer_category(condition)

    partnership_status = "partnered" if collaborators else "solo"
    moa = f"{modality} targeting {target}" if target != "Unknown" else modality

    # Stage 1: referencesModule에서 논문 직접 추출
    pubmed_links = _extract_references(refs_mod)

    return {
        "drug_name": drug_name,
        "combo_drugs": combo_drugs,
        "all_drugs": all_drugs,
        "is_combination": is_combination,
        "company": lead_sponsor,
        "collaborators": collaborators,
        "partnership_status": partnership_status,
        "condition": condition,
        "condition_normalized": condition_normalized,
        "cancer_category": cancer_category,
        "phase": phase,
        "phases": phase_list,
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
        "nct_ids": [nct_id] if nct_id else [],
        "clinicaltrials_url": (
            f"https://clinicaltrials.gov/study/{nct_id}" if nct_id else ""
        ),
        "brief_title": brief_title,
        "official_title": official_title,
        "primary_outcomes": primary_outcomes,
        "secondary_outcomes": secondary_outcomes,
        "pubmed_links": pubmed_links,
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
    약물명 + 회사 + Phase + 적응증 기준으로 그룹핑.
    같은 약물이라도 Phase/적응증이 다르면 별도 행으로 유지.
    완전히 동일한 조합만 합침 (NCT ID 리스트로 보존).
    """
    groups: dict[str, list[dict]] = {}
    for rec in records:
        key = (
            _normalize_drug_name(rec["drug_name"]),
            rec["company"].strip().lower(),
            rec.get("phase", ""),
            rec.get("cancer_category", ""),
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

        # 그룹 내 모든 NCT ID 합치기
        all_ncts = []
        for r in group:
            all_ncts.extend(r.get("nct_ids", []))
        rep["nct_ids"] = list(dict.fromkeys(all_ncts))

        # Stage 1: 그룹 내 모든 trial의 references 합치기
        seen_pmids = set()
        merged_links = []
        for r in group:
            for link in r.get("pubmed_links", []):
                pmid = link.get("pmid", "")
                if pmid and pmid not in seen_pmids:
                    seen_pmids.add(pmid)
                    merged_links.append(link)
        rep["pubmed_links"] = merged_links

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
