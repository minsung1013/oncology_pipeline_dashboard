"""
바이오마커 정규화 (유전자 기준).

LLM이 추출한 biomarker_list는 같은 유전자가 변이형/표기변형으로 흩어져 있다
(HER2 / ERBB2 / Her2 / HER2-low, KRAS / KRAS G12C / KRASG12C, EGFR / EGFR L858R …).
이를 유전자(또는 표준 마커명) 단위로 합친다. 항목을 '제거'하지 않고 정규화만 한다
— 매핑 안 되는 값은 정리(공백/표기)만 해서 보존.

용법:
    from normalize_biomarkers import normalize_biomarker, normalize_biomarker_list
    normalize_biomarker('KRAS G12C')      -> 'KRAS'
    normalize_biomarker('Her2-low')       -> 'HER2'
    normalize_biomarker('VEGFR2')         -> 'VEGFR2'   (EGFR로 오합치 안 함)
"""

import re

# ── 동의어 → 표준명 (소문자 키, 구두점/공백 정규화 후 매칭) ────────────────────
_ALIAS = {
    # HER2 / ERBB2
    "erbb2": "HER2", "her-2": "HER2", "her2/neu": "HER2", "her-2/neu": "HER2",
    "c-erbb-2": "HER2", "c-erbb2": "HER2", "her2neu": "HER2", "neu": "HER2",
    # PD axis (서로 다른 유전자 — 분리 유지)
    "pdl1": "PD-L1", "pd l1": "PD-L1", "pdl-1": "PD-L1", "cd274": "PD-L1",
    "pd1": "PD-1", "pdcd1": "PD-1", "pdl2": "PD-L2",
    # MSI / MMR
    "microsatellite instability": "MSI", "microsatellite instability-high": "MSI-H",
    "msi high": "MSI-H", "msi-high": "MSI-H", "msi-l": "MSI-L", "msi-low": "MSI-L",
    "microsatellite stable": "MSS",
    "mismatch repair": "MMR", "mismatch repair deficiency": "dMMR",
    "mismatch repair deficient": "dMMR", "deficient mismatch repair": "dMMR",
    "mmr deficient": "dMMR", "mmr-d": "dMMR", "mmrd": "dMMR",
    "mismatch repair proficient": "pMMR", "mmr proficient": "pMMR", "mmr-p": "pMMR",
    # TMB
    "tumor mutational burden": "TMB", "tumour mutational burden": "TMB",
    "tmb-high": "TMB-H", "tmb high": "TMB-H", "tmb-h": "TMB-H",
    # 호르몬 수용체
    "estrogen receptor": "ER", "oestrogen receptor": "ER",
    "progesterone receptor": "PR", "androgen receptor": "AR",
    "hormone receptor": "HR", "estrogen receptor 1": "ESR1",
    # HRD / HRR
    "homologous recombination deficiency": "HRD",
    "homologous recombination repair": "HRR",
    "homologous recombination": "HRR",
    # ctDNA / cfDNA
    "circulating tumor dna": "ctDNA", "circulating tumour dna": "ctDNA",
    "ct-dna": "ctDNA", "ct dna": "ctDNA", "cf-dna": "cfDNA", "cf dna": "cfDNA",
    # 증식 지수
    "ki-67": "Ki67", "ki 67": "Ki67", "mib-1": "Ki67", "mib1": "Ki67",
    # 기타 흔한 표기
    "egfrviii": "EGFR", "egfr viii": "EGFR",
    "dmmr": "dMMR", "pmmr": "pMMR", "ctdna": "ctDNA", "cfdna": "cfDNA",
    "her2": "HER2",
}

# 매핑 후에도 PD-1/PD-L1/PD-L2 가 합쳐지지 않도록 명시적 보호 (부분일치 금지 대상)
# (알고리즘이 leading 토큰만 보므로 자연히 분리되지만, 안전망)

# 변이/상태 서술어 (대소문자 무시, 뒤따르면 떼어냄)
_MODIFIER = (
    r"mutations?|mutant|mutated|mut|amplifications?|amplified|amp|deletions?|del|"
    r"insertions?|ins|expressions?|overexpression|expressing|positive|negative|"
    r"pos|neg|high|low|loss|gain|fusions?|rearrangements?|rearranged|translocations?|"
    r"status|alterations?|variants?|wild[- ]?type|wt|aberrations?|"
    r"copy number|cnv|methylation|methylated|splice|splicing|hotspot"
)
_MODIFIER_RE = re.compile(rf"[\s,/_+-]*\b(?:{_MODIFIER})\b\.?$", re.I)
# 대소문자 무시 특수 꼬리: vIII, exon N, delN, IHC 점수, CPS/TPS, n+
_SPECIAL_RE = re.compile(
    r"[\s,/_+-]*(?:viii|exon\s?\d+|ex\d+|del\s?\d+|ins\s?\d+|cps|tps|ihc\s?\d?\+?|fish|[0-3]\+)\.?$", re.I)
# 아미노산 변이는 대문자 구분 (V600E, L858R, G12C, T790M). \d{2,4}로 유전자번호(VEGFR2)와 구분
_AA_TAIL_RE = re.compile(r"[\s,/_-]+[A-Z]\d{2,4}[A-Z*](?:fs|del|dup|ins)?$")
_AA_CONCAT_RE = re.compile(r"^([A-Z][A-Z0-9]{1,7}?)([A-Z]\d{2,4}[A-Z*])$")
_LC_TAIL_RE = re.compile(r"(?<=[A-Z])(?:mut|mt|amp|del|m)$")

_GENE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,8}(?:-[A-Za-z0-9]+)?$")


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).strip(" ,;")


def _strip_modifiers(s: str) -> str:
    """문자열 끝의 변이/서술어 토큰을 반복 제거해 유전자 베이스만 남긴다."""
    prev = None
    cur = s
    while prev != cur:
        prev = cur
        cur = _MODIFIER_RE.sub("", cur).strip(" ,/_-+")
        cur = _SPECIAL_RE.sub("", cur).strip(" ,/_-+")
        cur = _AA_TAIL_RE.sub("", cur).strip(" ,/_-+")          # KRAS G12C → KRAS
        m = _AA_CONCAT_RE.match(cur)                            # KRASG12C → KRAS
        if m:
            cur = m.group(1)
        cur = _LC_TAIL_RE.sub("", cur)                          # EGFRm → EGFR
    return cur


def normalize_biomarker(raw: str) -> str | None:
    s = _clean(raw)
    if not s:
        return None
    low = re.sub(r"\s+", " ", s.lower())
    if low in _ALIAS:
        return _ALIAS[low]

    base = _strip_modifiers(s)
    if not base:
        return s  # 변이만 있고 유전자가 안 남으면 정리본 보존

    blow = base.lower()
    if blow in _ALIAS:
        return _ALIAS[blow]

    # 유전자 심볼처럼 보일 때만 대문자 표준화.
    # 대문자/숫자/하이픈을 포함하면 심볼로 간주(HER2-low→HER2, Her2→HER2),
    # 순수 소문자 단어(genomic, biomarker)는 유전자가 아니므로 정리본 그대로 둔다.
    if _GENE_RE.match(base):
        looks_gene = (base != base.lower()) or any(c.isdigit() for c in base)
        if looks_gene:
            up = base.upper()
            return _ALIAS.get(up.lower(), up)

    return base  # 서술형/소문자어/비유전자는 보존(제거하지 않음)


def normalize_biomarker_list(items):
    """리스트 정규화 + 순서보존 중복제거. 항목은 제거하지 않음(매핑 실패 시 정리본 유지)."""
    out, seen = [], set()
    for it in items or []:
        v = normalize_biomarker(it)
        if not v:
            continue
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out
