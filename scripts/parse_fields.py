"""
키워드 기반 파싱 스크립트.
raw JSON → 구조화된 필드 추출 (모달리티, 타겟, 바이오마커, CDx 전략, dedup)
"""

import hashlib
import json
import re
import uuid  # noqa: F401  (하위호환; drug_id는 stable_drug_id 사용)
from datetime import datetime, timezone

from normalize_entities import normalize_companies

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
    # 치료용 융합단백/리간드트랩만 (고정밀). 보조요법 성장인자(G-CSF/EPO)는 제외 — 콤보 오염 방지.
    "Fusion Protein": [
        "fusion protein", "fc fusion", "fc-fusion", "ligand trap", "vegf trap", "decoy receptor",
        "immunocytokine", "aflibercept", "luspatercept", "sotatercept", "rilonacept", "eftilagimod",
    ],
    # 치료용 사이토카인만 (interferon/interleukin/aldesleukin). -stim/epoetin(보조요법) 제외.
    "Recombinant Protein": [
        "interferon", "interleukin", "aldesleukin", "denileukin",
    ],
    # 능동면역 암백신(펩타이드/DNA/네오항원). 수지상세포·종양세포 백신은 Cell Therapy,
    # 종양용해바이러스는 Oncolytic Virus가 우선(아래 PRIORITY에서 Vaccine보다 앞).
    "Vaccine": ["vaccine", "neoantigen", "neo-antigen", "neopeptide", "neo-epitope"],
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
    "Fusion Protein", "Recombinant Protein",
    # Cell Therapy·Oncolytic Virus를 Vaccine보다 앞에 두어 수지상세포/종양용해바이러스
    # 백신이 더 구체적 분류를 유지하게 함. Vaccine은 Peptide/mRNA/Small Molecule보다 앞.
    "Cell Therapy", "Oncolytic Virus", "Vaccine",
    "Small Molecule", "mRNA", "Peptide", "Radiopharmaceutical",
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
    if _is_code_name(name):
        return 3
    return 2


# 숫자를 포함하지만 신약 코드가 아닌 '화학요법 레지멘'(FOLFOX/mFOLFOX6/FOLFOX4 등).
# 코드명 오인(예: mFOLFOX6를 시험약물로) 방지. 공백 제거 후 매칭.
_CHEMO_REGIMEN_RE = re.compile(
    r"^(m|modified)?(folfox|folfiri|folfirinox|folfoxiri|xelox|cape?ox|capiri|"
    r"xeliri|gemox|folf- ?ox)\d*$",
    re.IGNORECASE,
)


def _is_code_name(name: str) -> bool:
    """미승인 신약 코드명 패턴(영문+숫자 조합: IDE-161, BL-M07D1, 7MW3711).
    승인약(platin/rubicin 계열)·화학요법 레지멘(mFOLFOX6 등)은 제외. 코드명은 거의 항상 '시험약물'."""
    n = _clean_drug_name(name).lower()
    if n in CHEMO_BACKBONE or _CHEMO_REGIMEN_RE.match(n.replace(" ", "")):
        return False
    return bool(re.search(r"[A-Za-z]+[-]?\d", name)) and not n.endswith(("platin", "rubicin"))


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


# arm 타입: 대조/비치료군 (실험약물 판별에서 제외)
_COMPARATOR_ARM_TYPES = {
    "ACTIVE_COMPARATOR", "PLACEBO_COMPARATOR", "SHAM_COMPARATOR", "NO_INTERVENTION",
}

# "Drug: Bevacizumab" → "Bevacizumab" (타입 접두어 제거)
_ARM_INTERVENTION_PREFIX = re.compile(
    r"^(drug|biological|combination product|genetic|radiation|procedure|device|"
    r"dietary supplement|behavioral|diagnostic test|other)\s*:\s*",
    re.IGNORECASE,
)


def parse_arms(arms_mod: dict, allowed_drugs: set) -> list[dict]:
    """armGroups → [{label, type, drugs:[정규화 약물명]}]. 약물 intervention만(allowed_drugs) 남긴다."""
    arms = []
    for ag in arms_mod.get("armGroups", []):
        names = []
        for iname in ag.get("interventionNames", []):
            nm = _ARM_INTERVENTION_PREFIX.sub("", iname).strip()
            c = _clean_drug_name(nm)
            if c and c.lower() in allowed_drugs and c not in names:
                names.append(c)
        arms.append({
            "label": ag.get("label", ""),
            "type": ag.get("type", ""),
            "drugs": names,
        })
    return arms


def select_arm_aware(arms: list[dict], cleaned_all: list[str]) -> dict | None:
    """arm 구조로 시험약물/백본 식별. 판별 불가 시 None(→접미사 점수 폴백).

    백본 = 모든 arm 공통 약물(표준치료). 시험약물 = 실험군에만 있고 대조군엔 없는 약물.
    예) ArmA: FOLFIRI+Bev+Pelareorep / ArmB: FOLFIRI+Bev → 백본={FOLFIRI,Bev},
        시험약물={Pelareorep}.
    """
    drug_sets = [set(d.lower() for d in a["drugs"]) for a in arms if a["drugs"]]
    if len(drug_sets) < 2:
        return None  # 단일 arm(또는 약물 arm 1개) → 비교 불가

    # 1순위: 코드네임 신약이 정확히 하나면, arm 공통(단독+병용)이어도 그게 시험약물.
    #   예) IDE-161 단독 arm + (IDE-161 + pembrolizumab) arm → IDE-161이 주인공,
    #       pembrolizumab은 병용 추가제. arm-delta만 쓰면 '변하는' pembrolizumab을
    #       오선정하므로 코드네임 규칙을 우선한다.
    code_names = [d for d in cleaned_all if _is_code_name(d)]
    if len(code_names) == 1:
        invest = {code_names[0].lower()}
    else:
        backbone0 = set.intersection(*drug_sets)
        exp, comp = set(), set()
        for a in arms:
            ds = set(d.lower() for d in a["drugs"])
            if a["type"] in _COMPARATOR_ARM_TYPES:
                comp |= ds
            else:
                exp |= ds
        invest = (exp - backbone0) - comp
        if not invest:
            # 명시적 실험/대조 구분이 없을 때: arm 간 '달라지는' 약물을 시험약물로 본다.
            invest = (set().union(*drug_sets) - backbone0) - comp
        if not invest:
            return None  # 모든 arm이 동일 → 폴백

    low2orig = {}
    for a in arms:
        for d in a["drugs"]:
            low2orig.setdefault(d.lower(), d)
    order = {d.lower(): i for i, d in enumerate(cleaned_all)}
    invest &= set(order)
    if not invest:
        return None
    invest_list = sorted((low2orig.get(d, d) for d in invest), key=lambda x: order.get(x.lower(), 10 ** 9))
    # 백본/병용 = 시험약물이 아닌 나머지 (표시는 exp/control 레지멘을 사용)
    backbone_list = [d for d in cleaned_all if d.lower() not in invest]

    # 시험약물 중 대표: 점수 최고(동점 시 레지멘 등장 순)
    primary = max(invest_list, key=lambda x: (_drug_score(x), -order.get(x.lower(), 10 ** 9)))
    combo = [d for d in cleaned_all if d != primary]

    # 실험군/대조군 레지멘: 시험약물을 포함한 arm = 실험군, 아닌 arm = 대조군
    def _arm_has_invest(a):
        return any(x.lower() in invest for x in a["drugs"])
    exp_regimen, ctrl_regimen = [], []
    seen_e, seen_c = set(), set()
    for a in arms:
        bucket, seen = (exp_regimen, seen_e) if _arm_has_invest(a) else (ctrl_regimen, seen_c)
        for d in a["drugs"]:
            if d.lower() not in seen:
                seen.add(d.lower())
                bucket.append(d)
    exp_regimen.sort(key=lambda x: (0 if x.lower() in invest else 1, order.get(x.lower(), 10 ** 9)))

    return {
        "drug_name": primary,
        "combo_drugs": combo,
        "investigational_drugs": invest_list,
        "backbone_drugs": backbone_list,
        "exp_regimen": exp_regimen,
        "control_regimen": ctrl_regimen,
    }

CANCER_CATEGORY_MAP: dict[str, list[str]] = {
    "Lung":           ["lung", "NSCLC", "SCLC", "non-small cell", "small cell lung", "pulmonary"],
    "Colorectal":     ["colorectal", "colon", "rectal", "rectum", "CRC"],
    "Gastric":        ["gastric", "stomach", "gastroesophageal", "GEJ"],
    "Breast":         ["breast"],
    "Hematologic":    [
        "lymphoma", "leukemia", "myeloma", "AML", "CLL", "CML", "NHL", "ALL",
        "myelodysplastic", "myeloproliferative", "myelofibrosis", "lymphoproliferative",
        "hematologic", "haematologic", "hematological", "haematological",
        "polycythemia", "polycythaemia", "waldenstrom",
        "aplastic anemia", "aplastic anaemia", "mastocytosis",
    ],
    "Liver":          ["hepatocellular", "liver", "HCC", "cholangiocarcinoma", "biliary", "bile duct"],
    "Pancreatic":     ["pancreatic", "pancreas"],
    "Prostate":       ["prostate", "prostatic"],
    "Ovarian":        ["ovarian", "ovary", "fallopian tube"],
    "Bladder":        ["bladder", "urothelial"],
    "Melanoma":       ["melanoma"],
    "Skin":           ["basal cell", "merkel cell", "actinic keratosis", "actinic keratoses",
                       "cutaneous squamous"],
    "Head & Neck":    ["head and neck", "HNSCC", "nasopharyngeal", "thyroid", "laryngeal",
                       "oropharyngeal", "hypopharyngeal", "salivary"],
    "Esophageal":     ["esophageal", "esophagus", "oesophag"],
    "Endometrial":    ["endometrial", "uterine", "cervical", "endometrium"],
    "Renal":          ["renal", "kidney", "RCC"],
    "Sarcoma":        ["sarcoma", "gastrointestinal stromal", "GIST"],
    "Glioma":         ["glioma", "glioblastoma", "GBM", "brain", "neuroblastoma", "medulloblastoma"],
    "Neuroendocrine": ["neuroendocrine", "carcinoid", "pheochromocytoma", "paraganglioma"],
    "Mesothelioma":   ["mesothelioma"],
    # --- 우산 카테고리: 위 특정 암종에 안 걸린 것만 (반드시 특정 카테고리 뒤) ---
    # "Advanced Solid Tumors" 류 — 부위 불문 고형암 basket 시험을 하나로 묶는다.
    "Solid Tumor":    ["solid tumor", "solid tumour", "solid neoplasm", "solid malignan", "solid cancer"],
    # 최후 폴백: 암이긴 하나 부위 미상. 광범위 키워드라 반드시 맵의 맨 끝에 둔다
    # (그래야 "Lung Cancer" 등이 여기로 새지 않는다). 비종양(Pain·Myasthenia 등)은 매칭 안 됨 → Other.
    "Cancer (NOS)":   ["cancer", "carcinoma", "neoplasm", "tumor", "tumour", "malignan", "oncolog"],
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


def infer_target(intervention_name: str, brief_summary: str, exclude_terms=None) -> str:
    """대표약물 타깃 추론. exclude_terms: 이 레지멘의 병용/백본 약물명 — 타깃이 '곁다리
    약물명' 키워드로 걸리는 누수를 막는다(예: 대표=Pelareorep인데 요약문의 bevacizumab
    때문에 VEGF/VEGFR로 잘못 잡히던 버그)."""
    exclude = {t.lower() for t in (exclude_terms or [])}
    combined = f"{intervention_name} {brief_summary}"
    for target, keywords in TARGET_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in exclude:
                continue
            if _ci_contains(combined, kw):
                return target
    # word-boundary 필요한 짧은 약어 (substring 오매칭 방지)
    for target, keywords in TARGET_EXACT_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in exclude:
                continue
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
    """referencesModule에서 PMID 논문 링크 추출 — 정밀도 우선.
    type: RESULT(시험 결과 논문)·DERIVED(PubMed가 NCT 자동연결)만 채택하고,
    BACKGROUND(배경 인용, 시험/약물과 무관한 경우 많음)는 제외해 노이즈를 줄인다."""
    links = []
    seen = set()
    for ref in refs_mod.get("references", []):
        if ref.get("type") == "BACKGROUND":
            continue
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
            "ref_type": ref.get("type", ""),
        })
    return links


def _cancer_kw_search(text: str, kw: str):
    """암종 키워드 매칭: word-boundary + 복수형 허용('Solid Tumors'도 'solid tumor'로 매칭).
    optional 's'라 기존 매칭을 잃지 않고 복수형만 추가로 잡는다."""
    pat = r"(?<![A-Za-z0-9])" + re.escape(kw) + r"s?(?![A-Za-z0-9])"
    return re.search(pat, text, re.IGNORECASE)


def normalize_cancer_category(condition: str) -> tuple[str, str]:
    """(cancer_category, condition_normalized) 반환.
    단어경계 매칭 — 약어 키워드("CRC","RCC" 등)가 다른 단어 부분문자열에 잘못 걸리는 것 방지
    (예: Colorectal "CRC"가 "ccRCC"(신장암)에 매칭되던 버그)."""
    for category, keywords in CANCER_CATEGORY_MAP.items():
        for kw in keywords:
            if _cancer_kw_search(condition, kw):
                return category, condition
    return "Other", condition


# 명시적 비종양/보조요법 신호 — 암 카테고리에 안 걸린(Other) 엔트리 중 이 용어가 있으면
# 비종양 시험으로 본다(보수적: 암 용어 없는 희귀암은 그냥 Other로 두고 종양으로 유지).
NON_ONCOLOGY_RE = re.compile(
    r"\b(pain|nausea|vomit|emesis|mucositis|neutropenia|anemia|anaemia|cachexia|"
    r"thrombocytopenia|myasthenia|arthritis|infection|hepatitis|fibrosis|diabet|"
    r"obesity|healthy volunteer|fatigue|neuropathy|dermatitis|psoriasis|colitis)\b",
    re.IGNORECASE,
)


def is_oncology_indication(conditions: list, cancer_categories: list) -> bool:
    """종양 적응증 여부. 암 카테고리가 하나라도 있으면 종양. 전부 Other인데 명시적
    비종양/보조요법 용어가 있으면 비종양(False). 그 외(암 용어 없는 희귀암)는 종양 유지."""
    if cancer_categories != ["Other"]:
        return True
    return not NON_ONCOLOGY_RE.search(" ".join(conditions or []))


def categorize_conditions(conditions: list) -> list:
    """복수 condition 각각을 cancer_category로 환원한 리스트(중복제거).
    basket 시험(서로 다른 암종)이 모든 암종 필터에 잡히도록 한다. 실제 암종이 하나라도
    있으면 'Other'는 노이즈라 제외하고, 전부 미매칭일 때만 ['Other']."""
    cats = []
    for c in conditions or []:
        cat, _ = normalize_cancer_category(c)
        if cat not in cats:
            cats.append(cat)
    non_other = [c for c in cats if c != "Other"]
    return non_other or cats or ["Other"]


# 우산/미상 카테고리 — 제목 vs condition "충돌" 판정에서 제외 (부위 미상이라 모순이 아님).
_UMBRELLA_CATEGORIES = {"Solid Tumor", "Cancer (NOS)", "Other"}

# "brain metastases"(뇌전이)는 원발이 아니므로 Glioma로 오분류되지 않도록 제목 스캔 전 제거.
_BRAIN_METS_RE = re.compile(r"brain\s+metasta\w*", re.IGNORECASE)


def _categories_in_text(text: str) -> list:
    """text(주로 제목)에 word-boundary로 매칭되는 모든 암종을 '첫 등장 위치' 순으로 반환.
    특정 암종이 하나라도 있으면 우산 카테고리(Solid Tumor/Cancer NOS)는 제외한다."""
    if not text:
        return []
    text = _BRAIN_METS_RE.sub(" ", text)
    hits: dict[str, int] = {}
    for category, keywords in CANCER_CATEGORY_MAP.items():
        for kw in keywords:
            m = _cancer_kw_search(text, kw)
            if m:
                hits[category] = min(hits.get(category, 10 ** 9), m.start())
                break
    ordered = [c for c, _ in sorted(hits.items(), key=lambda x: x[1])]
    specific = [c for c in ordered if c not in _UMBRELLA_CATEGORIES]
    return specific or ordered


def resolve_indication(
    conditions: list, brief_title: str = "", official_title: str = ""
) -> tuple[str, list, bool]:
    """(primary_category, cancer_categories, needs_review) 반환.

    제목 우선 전략: CT.gov의 conditions 필드는 등록 오류가 잦으므로(예: 담도암 시험을
    'Colon and Rectal Cancer'로 등록) 제목(brief+official)에서 암종이 식별되면 그것을
    대표로 삼고, condition 기반 카테고리는 보조로 합친다. 제목과 condition이 서로 다른
    특정 암종을 가리키면(교집합 없음) needs_review=True 로 표시한다."""
    title_cats = _categories_in_text(f"{brief_title} {official_title}")
    title_specific = [c for c in title_cats if c not in _UMBRELLA_CATEGORIES]
    cond_cats = categorize_conditions(conditions)
    cond_specific = [c for c in cond_cats if c not in _UMBRELLA_CATEGORIES]

    if title_specific:
        primary = title_specific[0]
        overlap = set(title_specific) & set(cond_specific)
        if cond_specific and not overlap:
            # 충돌: 제목과 condition이 서로 다른 특정 암종 → condition 등록 오류로 보고
            # 제목만 신뢰(조건 유래 카테고리를 필터 집합에서 제외). 검토 플래그.
            categories = title_specific
            needs_review = True
        else:
            # 일치하거나 겹침 → basket 가능성, 합집합 유지.
            categories = list(dict.fromkeys(title_specific + cond_specific))
            needs_review = False
    elif title_cats:
        # 제목이 전암종 umbrella("Advanced Solid Tumors" 등) — 특정 암종 명시 없음.
        # 이런 all-comers 바스켓은 condition의 개별 암종(유방/대장…)으로 분산하면 모든
        # 암종 필터를 오염시키므로, umbrella(Solid Tumor / Cancer NOS) 대표 하나로만 분류한다.
        primary = title_cats[0]
        categories = [primary]
        needs_review = False
    elif cond_specific:
        primary = cond_specific[0]
        categories = cond_specific
        needs_review = False
    else:
        primary = cond_cats[0] if cond_cats else "Other"
        categories = cond_cats or ["Other"]
        needs_review = False
    return primary, categories, needs_review


# ---------------------------------------------------------------------------
# ClinicalTrials.gov 응답 → 구조화 필드 추출
# ---------------------------------------------------------------------------

# 중단 사유(whyStopped 자유텍스트) → 범주. 조기중단 상태에서만 의미.
_STOP_TERMINAL = {"TERMINATED", "SUSPENDED", "WITHDRAWN"}
_STOP_REASON_RULES = [
    ("Safety",             r"safet|toxic|adverse|\bae\b|\bsae\b|tolerab|death|died|risk[- ]benefit|side effect"),
    ("Efficacy/Futility",  r"futil|efficac|lack of (response|benefit|activity)|no (response|benefit)|"
                           r"did not meet|insufficient (response|benefit|activity)|interim analysis|"
                           r"lack of clinical|not effective|poor response"),
    ("Enrollment",         r"enroll|accru|recruit|low (accrual|recruitment)|slow (accrual|recruitment)|"
                           r"insufficient (accrual|enrollment|recruitment|patient)|unable to (enroll|recruit)|"
                           r"lack of (patient|subject|accrual)|competing (trial|enrollment)"),
    ("Supply/Feasibility", r"supply|manufactur|feasib|logistic|covid|pandemic|drug (availab|shortage)|"
                           r"formulation|device|study drug"),
    ("Business/Strategic", r"business|sponsor|financ|fund|budget|portfolio|strateg|commercial|company|"
                           r"\bbd\b|decision (by|of) (the )?sponsor|prioriti|merger|acqui|resource"),
    ("Regulatory",         r"regulatory|\bfda\b|\bema\b|authorit|\bihub\b|clinical hold|hold placed|irb"),
]
_STOP_REASON_COMPILED = [(name, re.compile(pat, re.IGNORECASE)) for name, pat in _STOP_REASON_RULES]


def classify_stop_reason(why_stopped: str, overall_status: str) -> str:
    """조기중단 사유 범주. 중단상태가 아니면 '' , whyStopped가 비면 'Not reported'."""
    if (overall_status or "").upper() not in _STOP_TERMINAL:
        return ""
    if not why_stopped:
        return "Not reported"
    for name, rx in _STOP_REASON_COMPILED:
        if rx.search(why_stopped):
            return name
    return "Other"


# ---------------------------------------------------------------------------
# 규칙기반 코호트 세분화 (대장암) — eligibility 전문에서 선별기준 추출. LLM 불필요.
# ---------------------------------------------------------------------------
_COH_NEG = re.compile(r"(non[- ]?|not |without |un)$", re.IGNORECASE)
_ROMAN2NUM = {"1": 1, "2": 2, "3": 3, "4": 4, "i": 1, "ii": 2, "iii": 3, "iv": 4}


def _coh_roman(t: str) -> str:
    for a, b in [("Ⅳ", "IV"), ("Ⅲ", "III"), ("Ⅱ", "II"), ("Ⅰ", "I"),
                 ("ⅳ", "IV"), ("ⅲ", "III"), ("ⅱ", "II"), ("ⅰ", "I")]:
        t = t.replace(a, b)
    return t


def _coh_hits(text: str, core: str) -> bool:
    """core 매칭 중 부정어(non/not/without) 선행이 아닌 것이 있으면 True."""
    for m in re.finditer(core, text, re.IGNORECASE):
        if not _COH_NEG.search(text[max(0, m.start() - 6):m.start()]):
            return True
    return False


def _coh_neg_hits(text: str, core: str) -> bool:
    for m in re.finditer(core, text, re.IGNORECASE):
        if _COH_NEG.search(text[max(0, m.start() - 6):m.start()]):
            return True
    return False


def _coh_pick(pos, neg, inc, exc, pos_pat, neg_pat):
    p, n = _coh_hits(inc, pos_pat), _coh_hits(inc, neg_pat)
    if p and n:
        return "NR"                       # 둘 다 적격 = 선별 아님(all-comers)
    if p:
        return pos
    if n:
        return neg
    if _coh_hits(exc, pos_pat):
        return neg                        # pos를 제외 → neg 코호트
    if _coh_hits(exc, neg_pat):
        return pos
    return "NR"


def extract_cohort_rules(title: str, summary: str, conditions: str, eligibility: str) -> dict:
    """대장암 코호트 세분화(규칙). 환자 선별기준(enrollment) 기준, 미제한이면 NR."""
    low = (eligibility or "").lower()
    m = re.search(r"exclusion criteria", low)
    inc, exc = (eligibility[:m.start()], eligibility[m.start():]) if m else (eligibility, "")
    inc2 = _coh_roman(f"{title} {summary} {conditions} {inc}")
    exc = _coh_roman(exc)
    full = _coh_roman(f"{title} {summary} {conditions} {eligibility}")

    msih = _coh_hits(inc2, r"msi-?h|msi[- ]high|microsatellite instability[- ]high|dmmr|mismatch repair[- ]?deficient")
    mss = (_coh_hits(inc2, r"\bmss\b|microsatellite stable|pmmr|mismatch repair[- ]?proficient")
           or _coh_neg_hits(inc2, r"mismatch repair[- ]?deficient|dmmr"))
    msi = "NR" if (msih and mss) else ("MSI-H" if msih else ("MSS" if mss else "NR"))

    ras = _coh_pick("wt", "mutant", inc2, exc,
                    r"(k|n)?ras\s*(wild[- ]?type|wt)|wild[- ]?type\s*(k|n)?ras",
                    r"(k|n)?ras\s*(mutat|mutant|mutated)|\bg12[cdvrs]?\b|\bg13d?\b|\bq61\b")
    braf = _coh_pick("wt", "mutant", inc2, exc, r"braf\s*(wild[- ]?type|wt)",
                     r"braf\s*(mutat|mutant|mutated|v600)|\bv600e?\b")
    her2 = _coh_pick("+", "-", inc2, exc, r"her2\s*(positive|\+|amplif|overexpress|ihc\s*3)",
                     r"her2\s*(negative|non[- ]amplif)")
    ntrk = "+" if _coh_hits(inc2, r"ntrk|trk\s*fusion") else "NR"

    if _coh_hits(full, r"left[- ]?sided|left[- ]?colon|sigmoid|descending colon|splenic flexure"):
        side = "left"
    elif _coh_hits(full, r"right[- ]?sided|right[- ]?colon|ascending colon|cecum|caecum|hepatic flexure"):
        side = "right"
    else:
        side = "NR"
    liver = "yes" if _coh_hits(full, r"liver metasta|hepatic metasta|liver[- ]limited|liver[- ]only|"
                                     r"colorectal liver metasta|liver-?confined|resectable liver") else "NR"

    adj = _coh_hits(full, r"adjuvant|neoadjuvant|resected|curative (surgery|operation|resection)|after surgery")
    nums = []
    for mm in re.finditer(r"stages?\s*([1-4]|iv|iii|ii|i)(?:\s*[-–~]+\s*(?:to\s*)?([1-4]|iv|iii|ii|i))?", full, re.IGNORECASE):
        for g in mm.groups():
            if g:
                nums.append(_ROMAN2NUM[g.lower()])
    metastatic = _coh_hits(full, r"stage\s*iv|\bm1\b|\bmetastatic\b|\bmetastases\b|\bmetastasis\b")
    if metastatic and not adj:
        stage = "4"
    elif nums:
        cand = [n for n in nums if not (adj and n == 4)] or nums
        stage = str(max(cand))
    elif metastatic:
        stage = "4"
    else:
        stage = "NR"

    basket = bool(re.search(r"non[- ]small cell lung|nsclc|breast cancer|melanoma|pancrea|gastric|ovarian|"
                            r"solid tumou?rs?\b", f"{title} {conditions}", re.IGNORECASE)) \
        and "colorectal" not in title.lower()
    return {"sidedness": side, "stage": stage, "liver_met": liver, "msi": msi,
            "ras": ras, "braf": braf, "her2": her2, "ntrk": ntrk, "basket": basket}


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
    # 시험 수행 국가 (contactsLocationsModule.locations[].country) — Company 옆 Country 컬럼용.
    locs = proto.get("contactsLocationsModule", {}).get("locations", [])
    countries = list(dict.fromkeys(l.get("country", "").strip() for l in locs if l.get("country")))

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

    # 대표 약물 선택: arm 구조(실험군∖대조군)로 '실제 시험약물'을 먼저 식별하고,
    # 판별 불가 시(단일 arm 등) 접미사 점수로 폴백. 병용 레지멘(all_drugs)은 전체 보존.
    all_names = [i.get("name", "") for i in drug_interventions if i.get("name")]
    cleaned_all, _seen = [], set()
    for nm in all_names:
        c = _clean_drug_name(nm)
        if c and c.lower() not in _seen:
            _seen.add(c.lower())
            cleaned_all.append(c)

    arm_groups = parse_arms(arms_mod, _seen)
    arm_sel = select_arm_aware(arm_groups, cleaned_all)
    if arm_sel:
        drug_name = arm_sel["drug_name"]
        combo_drugs = arm_sel["combo_drugs"]
        investigational_drugs = arm_sel["investigational_drugs"]
        backbone_drugs = arm_sel["backbone_drugs"]
        exp_regimen = arm_sel["exp_regimen"]
        control_regimen = arm_sel["control_regimen"]
        drug_selection = "arm"
    else:
        drug_name, combo_drugs = select_primary_drug(all_names)
        investigational_drugs = [drug_name] if drug_name else []
        backbone_drugs = []
        exp_regimen = [drug_name] + combo_drugs if drug_name else []
        control_regimen = []
        drug_selection = "score"
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
    why_stopped = (status_mod.get("whyStopped", "") or "").strip()
    stop_reason = classify_stop_reason(why_stopped, overall_status)
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
    target = infer_target(drug_name, brief_summary, exclude_terms=combo_drugs)
    biomarker_found, biomarker_list = infer_biomarkers(eligibility_text, brief_summary)
    # 제목 우선 + 복수 암종(basket) + 제목/condition 충돌 플래그.
    condition_normalized = condition
    cancer_category, cancer_categories, indication_needs_review = resolve_indication(
        conditions, brief_title, official_title
    )
    # 비종양/보조요법(CINV·호중구감소·근무력증 등) 식별 — 프론트에서 걸러내는 데 사용.
    is_oncology = is_oncology_indication(conditions, cancer_categories)
    # 대장암 코호트 세분화(규칙기반, eligibility 전문) — MSI/RAS/BRAF/HER2/NTRK/side/stage/liver.
    cohort_rules = (extract_cohort_rules(brief_title, brief_summary, " ".join(conditions), eligibility_text)
                    if "Colorectal" in cancer_categories else None)

    partnership_status = "partnered" if collaborators else "solo"
    moa = f"{modality} targeting {target}" if target != "Unknown" else modality

    # Stage 1: referencesModule에서 논문 직접 추출
    pubmed_links = _extract_references(refs_mod)

    return {
        "drug_name": drug_name,
        "combo_drugs": combo_drugs,
        "all_drugs": all_drugs,
        "is_combination": is_combination,
        "investigational_drugs": investigational_drugs,
        "backbone_drugs": backbone_drugs,
        "exp_regimen": exp_regimen,
        "control_regimen": control_regimen,
        "drug_selection": drug_selection,
        "arms": arm_groups,
        "company": lead_sponsor,
        "company_normalized": (normalize_companies(lead_sponsor) or [None])[0],
        "collaborators": collaborators,
        "countries": countries,
        "partnership_status": partnership_status,
        "condition": condition,
        # 원본 conditionsModule.conditions 는 복수 암종 배열 — 대표(condition)만 쓰던 것을
        # 전체 보존해 복수 인디케이션 손실을 막는다. condition/cancer_category 는 대표값 유지(하위호환).
        "conditions": conditions,
        "condition_normalized": condition_normalized,
        "cancer_category": cancer_category,
        "cancer_categories": cancer_categories,
        "cohort_rules": cohort_rules,
        "indication_needs_review": indication_needs_review,
        "is_oncology": is_oncology,
        "phase": phase,
        "phases": phase_list,
        "overall_status": overall_status,
        "why_stopped": why_stopped,
        "stop_reason": stop_reason,
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
        # 임상시험 원문 요약 — 리치 LLM 한국어 요약(summary_ko)의 입력으로 사용
        "brief_summary": brief_summary,
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


def stable_drug_id(rep: dict) -> str:
    """결정적 drug_id — 재파싱해도 같은 엔트리는 같은 id (요약/xref 캐시가 살아남도록).
    키: 정규화 약물명 + 병용세트 + 정렬 NCT + condition (현재 데이터 33,891건 충돌 0).
    마이그레이션 스크립트도 이 함수를 import해 동일 해시 보장."""
    name = _normalize_drug_name(rep.get("drug_name", ""))
    regimen = "+".join(sorted(_normalize_drug_name(x) for x in (rep.get("all_drugs") or [rep.get("drug_name", "")])))
    ncts = "|".join(sorted(rep.get("nct_ids") or []))
    cond = _normalize_drug_name(rep.get("condition", ""))
    return hashlib.sha1(f"{name}::{regimen}::{ncts}::{cond}".encode()).hexdigest()[:16]


def _regimen_key(rec: dict) -> frozenset:
    """병용 약물 세트 (대표+병용 전체, 정규화)."""
    drugs = rec.get("all_drugs") or [rec.get("drug_name", "")]
    return frozenset(_normalize_drug_name(d) for d in drugs if d)


def dedup_by_drug(records: list[dict]) -> list[dict]:
    """
    약물명 + 회사 + Phase + 적응증 + 병용조합 기준으로 그룹핑.
    병용 레지멘이 다르면 별도 행으로 유지 (단독 vs 병용 구분).
    완전히 동일한 시험(다국가 동일 프로토콜 등)만 합침.
    """
    groups: dict[tuple, list[dict]] = {}
    for rec in records:
        key = (
            _normalize_drug_name(rec["drug_name"]),
            rec["company"].strip().lower(),
            rec.get("phase", ""),
            rec.get("cancer_category", ""),
            _regimen_key(rec),
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
        # 그룹 내 모든 trial의 수행 국가 합치기
        rep["countries"] = list(dict.fromkeys(c for r in group for c in (r.get("countries") or [])))

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

        rep["drug_id"] = stable_drug_id(rep)

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
