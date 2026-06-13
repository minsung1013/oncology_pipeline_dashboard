"""
ASCO 2026 Abstract PDF Parser

PDF 구조: 2컬럼 레이아웃 → pdfminer가 [헤더A, 헤더B, 본문A, 본문B] 순으로 추출
파싱 전략: "First Author:" 위치 + FIFO 번호 큐로 매핑
출력: data/parsed/abstracts_asco2026.json, data/parsed/nct_index.json
"""

import json
import os
import re
import sys
import unicodedata
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from pdfminer.high_level import extract_text
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).parent))
from parse_fields import (
    MODALITY_KEYWORDS,
    MODALITY_PRIORITY,
    TARGET_KEYWORDS,
    TARGET_EXACT_KEYWORDS,
    BIOMARKER_KEYWORDS,
    BIOMARKER_EXACT_KEYWORDS,
    CANCER_CATEGORY_MAP,
    _word_boundary_match,
)
from normalize_entities import normalize_companies

# ── 경로 ──────────────────────────────────────────────────────────────────────
PDF_PATH = "data/source/asco_2026/ASCO26-Abstracts-Full-Proceedings.pdf"
OUT_ABSTRACTS = "data/parsed/abstracts_asco2026.json"
OUT_NCT_INDEX = "data/parsed/nct_index.json"
CONFERENCE = "ASCO"
YEAR = 2026

# ── 정규식 패턴 ──────────────────────────────────────────────────────────────
# 초록 번호: LBA1~LBA999 또는 3~5자리 숫자 (단독 줄)
ABSTRACT_NUM_RE = re.compile(r"(?m)^(LBA\d+|\d{3,5})\s*$")
# 섹션 페이지 번호: "14s", "132s" 등 (단독 줄) — 제거 대상
PAGE_NUM_RE = re.compile(r"(?m)^\d{1,3}s\s*$")
# 푸터
FOOTER_RE = re.compile(
    r"Visit meetings\.asco\.org and search by abstract for the full list.*?May 12, 2026\.",
    re.DOTALL,
)
# 세션 타입
SESSION_RE = re.compile(
    r"\b(Oral Abstract Session|Rapid Oral Abstract Session|Plenary Session"
    r"|Poster Session|Special Clinical Science Symposia)\b"
)
# 본문 시작 마커
BODY_START_RE = re.compile(
    r"\b(Background|Methods|Introduction|Objective|Objectives|Purpose|Rationale):"
)
# 본문 끝 마커
SPONSOR_RE = re.compile(
    r"Research Sponsor:\s*(.+?)(?=\n\n|Clinical trial information:|$)", re.DOTALL
)
CLINICAL_INFO_RE = re.compile(r"Clinical trial information:\s*([^\n]+)")
# Embargo 판별 — PDF 이중공백 대응 (\s+ 사용)
EMBARGOED_RE = re.compile(
    r"The\s+full,?\s+final\s+text\s+of\s+this\s+abstract\s+will\s+be\s+available",
    re.IGNORECASE,
)
# NCT / Phase
NCT_RE = re.compile(r"\bNCT\d{8}\b")
PHASE_RE = re.compile(r"\bphase\s*(I{1,3}V?|[1-4])\b", re.IGNORECASE)
PHASE_MAP = {
    "I": "PHASE1", "II": "PHASE2", "III": "PHASE3", "IV": "PHASE4",
    "1": "PHASE1", "2": "PHASE2", "3": "PHASE3", "4": "PHASE4",
}

# ── Track 매핑 ────────────────────────────────────────────────────────────────
TRACK_RE = re.compile(
    r"(?m)^("
    r"BREAST CANCER[^\n]*"
    r"|CENTRAL NERVOUS SYSTEM TUMORS?"
    r"|GASTROINTESTINAL CANCER[^\n]*"
    r"|GENITOURINARY CANCER[^\n]*"
    r"|GYNECOLOGIC CANCER"
    r"|HEAD AND NECK CANCER"
    r"|HEMATOLOGIC MALIGNANCIES[^\n]*"
    r"|LUNG CANCER[^\n]*"
    r"|MELANOMA[^\n]*"
    r"|SKIN CANCER[^\n]*"
    r"|SARCOMA"
    r"|PEDIATRIC ONCOLOGY"
    r"|DEVELOPMENTAL THERAPEUTICS[^\n]*"
    r"|CARE DELIVERY[^\n]*"
    r"|MEDICAL EDUCATION[^\n]*"
    r"|PREVENTION[^\n]*"
    r"|QUALITY CARE[^\n]*"
    r"|SYMPTOM SCIENCE[^\n]*"
    r"|PLENARY SESSION"
    r")$"
)

TRACK_TO_CANCER: dict[str, list[str]] = {
    "BREAST CANCER": ["Breast Cancer"],
    "CENTRAL NERVOUS SYSTEM": ["CNS Cancer"],
    "GASTROINTESTINAL CANCER—COLORECTAL": ["GI Cancer"],
    "GASTROINTESTINAL CANCER—GASTROESOPHAGEAL": ["GI Cancer"],
    "GASTROINTESTINAL CANCER": ["GI Cancer"],
    "GENITOURINARY CANCER—KIDNEY": ["GU Cancer"],
    "GENITOURINARY CANCER—PROSTATE": ["GU Cancer"],
    "GENITOURINARY CANCER": ["GU Cancer"],
    "GYNECOLOGIC CANCER": ["Gynecologic Cancer"],
    "HEAD AND NECK CANCER": ["Head and Neck Cancer"],
    "HEMATOLOGIC MALIGNANCIES": ["Hematologic Cancer"],
    "LUNG CANCER": ["Lung Cancer"],
    "MELANOMA": ["Melanoma/Skin Cancer"],
    "SKIN CANCER": ["Melanoma/Skin Cancer"],
    "SARCOMA": ["Sarcoma"],
    "PEDIATRIC ONCOLOGY": ["Pediatric Cancer"],
}


# ASCO 트랙 문자열 → Pipeline 암종 (title 키워드가 없을 때 보강용, 구체적 순서로)
TRACK_SUBSTR_TO_PIPELINE: list[tuple[str, str]] = [
    ("PROSTATE", "Prostate"),
    ("KIDNEY", "Renal"),
    ("UROTHELIAL", "Bladder"),
    ("BLADDER", "Bladder"),
    ("GASTROESOPHAGEAL", "Gastric"),
    ("PANCREATIC", "Pancreatic"),
    ("HEPATOBILIARY", "Liver"),
    ("COLORECTAL", "Colorectal"),
    ("LUNG", "Lung"),
    ("BREAST", "Breast"),
    ("MELANOMA", "Melanoma"),
    ("SKIN", "Skin"),
    ("SARCOMA", "Sarcoma"),
    ("CENTRAL NERVOUS", "Glioma"),
    ("HEAD AND NECK", "Head & Neck"),
    ("HEMATOLOGIC", "Hematologic"),
]


# ── 헬퍼 함수 ─────────────────────────────────────────────────────────────────

def retag_cancer(track: str, title: str) -> list[str]:
    """Pipeline 암종 체계로 재태깅 (탭 간 공유용).
    1) title을 CANCER_CATEGORY_MAP 키워드로 스캔 (정확)
    2) 없으면 ASCO 트랙 문자열로 보강
    cross-cutting 트랙(Developmental Therapeutics 등)은 빈 리스트.
    """
    tl = (title or "").lower()
    cats: list[str] = []
    for cat, kws in CANCER_CATEGORY_MAP.items():
        if any(kw.lower() in tl for kw in kws):
            cats.append(cat)
    if cats:
        return cats
    tu = (track or "").upper()
    for sub, cat in TRACK_SUBSTR_TO_PIPELINE:
        if sub in tu:
            return [cat]
    return []


def clean_text(text: str) -> str:
    """하이픈 줄바꿈 제거 + 연속 공백 정규화."""
    text = re.sub(r"-\n\s*", "", text)
    return re.sub(r"\s+", " ", text).strip()


def extract_phases(text: str) -> list[str]:
    phases = []
    for m in PHASE_RE.finditer(text):
        p = PHASE_MAP.get(m.group(1).upper())
        if p and p not in phases:
            phases.append(p)
    return phases


def extract_nct_ids(text: str) -> list[str]:
    return list(dict.fromkeys(NCT_RE.findall(text)))


def make_author_key(name: str, affiliation: str) -> str:
    n = unicodedata.normalize("NFD", name.lower())
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = re.sub(r"[^a-z0-9]+", "_", n).strip("_")
    a = re.sub(r"[^a-z0-9]+", "_", affiliation.split(",")[0].lower().strip()[:20])
    return f"{n}|{a}"


def parse_author(raw: str) -> dict | None:
    if not raw:
        return None
    text = clean_text(raw)
    parts = [p.strip() for p in text.split(",") if p.strip()]
    if not parts:
        return None

    name = parts[0]
    country = city = region = None
    affil_parts: list[str] = []

    if len(parts) >= 2:
        last = parts[-1]
        second_last = parts[-2] if len(parts) >= 3 else ""
        if re.match(r"^[A-Z]{2}$", last):          # 미국: 주 약자
            region, country, city = last, "USA", second_last
            affil_parts = parts[1:-2]
        else:                                        # 해외: 국가명
            country, city = last, second_last
            affil_parts = parts[1:-2] if len(parts) >= 3 else parts[1:]

    affiliation = ", ".join(affil_parts)
    company_hints = [
        "Inc.", "Ltd.", "LLC", "Corp.", "GmbH", "S.A.",
        "Therapeutics", "Pharma", "Bioscience", "Genomic",
        "LifeSciences", "Biotech", "Sciences",
    ]
    is_company = any(h.lower() in affiliation.lower() for h in company_hints)

    return {
        "name": name,
        "author_key": make_author_key(name, affiliation),
        "role": "first",
        "order": 1,
        "affiliation": affiliation,
        "city": city,
        "region": region,
        "country": country,
        "is_company": is_company,
        "orcid": None,
        "linkedin": None,
        "verified": False,
        "source": "asco_pdf",
    }


# ── 키워드 매칭 (배열 반환) ───────────────────────────────────────────────────

def infer_modality_list(text: str) -> list[str]:
    result, tl = [], text.lower()
    for m in MODALITY_PRIORITY:
        if any(kw.lower() in tl for kw in MODALITY_KEYWORDS[m]):
            result.append(m)
    return result or ["Unknown"]


def infer_target_list(text: str) -> list[str]:
    result, tl = [], text.lower()
    for target, kws in TARGET_KEYWORDS.items():
        if any(kw.lower() in tl for kw in kws):
            result.append(target)
    for target, kws in TARGET_EXACT_KEYWORDS.items():
        if target not in result and any(_word_boundary_match(text, kw) for kw in kws):
            result.append(target)
    return result or ["Unknown"]


def infer_biomarker_list(text: str) -> list[str]:
    tl = text.lower()
    found = [b for b in BIOMARKER_KEYWORDS if b.lower() in tl]
    for b in BIOMARKER_EXACT_KEYWORDS:
        if b not in found and _word_boundary_match(text, b):
            found.append(b)
    return found


# ── 약물명 추출 (제목 기반) ───────────────────────────────────────────────────
# INN 접미사 (일반명): pembrolizumab, osimertinib, palbociclib 등
DRUG_SUFFIXES = (
    "mab", "nib", "tinib", "ciclib", "parib", "rasib", "lisib", "degib", "zomib",
    "metinib", "tecan", "platin", "rubicin", "taxel", "citabine", "ciloleucel",
    "leucel", "brutinib", "asib", "fenib", "limus", "sidenib",
)
DRUG_SUFFIX_RE = re.compile(
    r"\b([A-Za-z]{5,}(?:"
    + "|".join(sorted(set(DRUG_SUFFIXES), key=len, reverse=True))
    + r"))\b"
)
# 하이픈 코드명: ABBV-706, BGB-43395, DS-8201 등 (하이픈 필수 — 오탐 최소화)
DRUG_CODE_RE = re.compile(r"\b([A-Z]{2,5}-\d{2,6}[A-Z]{0,2}\d{0,2})\b")
# 약물이 아닌 접두사: 종양마커·사이토카인·바이러스·질병코드·임상시험그룹/시험명·설문지
NON_DRUG_PREFIX = {
    # 종양마커·사이토카인·바이러스
    "CA", "CD", "IL", "HPV", "COVID", "SARS", "GDF", "TGF", "EGF", "FGF", "VEGF",
    "IGG", "IGM", "IP",
    # 통계·결과 지표
    "HR", "CI", "OS", "PFS",
    # 질병·코딩·설문지·그랜트
    "CLL", "AML", "CRC", "GI", "DIPG", "ICD", "SF", "SOC", "NSF",
    # 임상시험그룹·협력그룹·시험명 약어
    "TBCRC", "OPBC", "TTCC", "BCRF", "OPERA", "TRUCE", "GOG", "SOLTI", "CGGA",
    "IFCT", "FIGHT", "HIPEC", "IIT", "II", "EF", "SURE", "OMAHA", "CLIO", "EV",
    "EPC", "AA", "KN",
}


def extract_drugs(text: str) -> list[str]:
    """텍스트(제목+본문)에서 약물명 후보 추출 (INN 접미사 + 하이픈 코드명)."""
    if not text:
        return []
    found: list[str] = []
    low: set[str] = set()
    for m in DRUG_SUFFIX_RE.finditer(text):
        w = m.group(1)
        if w.lower() not in low:
            found.append(w)
            low.add(w.lower())
    for m in DRUG_CODE_RE.finditer(text):
        w = m.group(1)
        prefix = re.match(r"^[A-Z]+", w).group(0)
        if prefix in NON_DRUG_PREFIX:
            continue
        if w.lower() not in low:
            found.append(w)
            low.add(w.lower())
    return found[:10]


# 하위호환 별칭 (제목만)
def extract_drugs_from_title(title: str) -> list[str]:
    return extract_drugs(title)


def clean_company(research_sponsor: str | None) -> str | None:
    """research_sponsor → 회사명 정규화 ('None.'·빈값 제거, 후행 마침표 제거)."""
    if not research_sponsor:
        return None
    s = research_sponsor.strip().rstrip(".").strip()
    if s.lower() in ("none", ""):
        return None
    return s


# ── 초록 블록 파싱 ────────────────────────────────────────────────────────────


# ── 컬럼 인식 추출 (2단 레이아웃 정렬) ──────────────────────────────────────────
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer, LAParams

NUM_LINE_RE = re.compile(r"^(LBA\d+|TPS\d+|\d{3,5})$")
SESSION_START_RE = re.compile(
    r"^(Plenary Session|Poster Session|Oral Abstract Session|Rapid Oral Abstract Session"
    r"|Poster Discussion Session|Clinical Science Symposium)",
    re.I,
)
FA_RE = re.compile(r"First\s+Author:")
PAGENUM_BOX_RE = re.compile(r"^\d{1,4}s$")
TRACK_BOX_RE = re.compile(r"^[A-Z][A-Z &/—\-,'()0-9]{8,}$")


def column_aware_stream(pdf_path: str) -> list[str]:
    """2단 레이아웃을 좌→우, 위→아래 순서로 재정렬한 텍스트 박스 스트림."""
    stream: list[str] = []
    for page in extract_pages(pdf_path, laparams=LAParams()):
        mid = page.width / 2
        boxes = []
        for el in page:
            if isinstance(el, LTTextContainer):
                t = el.get_text().strip()
                if t:
                    cx = (el.x0 + el.x1) / 2
                    boxes.append((cx < mid, -round(el.y0 / 3), el.x0, t))
        boxes.sort(key=lambda b: (not b[0], b[1], b[2]))
        stream.extend(b[3] for b in boxes)
    return stream


def _pick_title(block: list[str]) -> str:
    """블록에서 제목 박스 선택 (푸터·페이지번호·트랙·번호 건너뜀, 세션 접두사 제거), First Author 앞까지."""
    for b in block:
        # 세션 라벨이 같은 박스 앞에 붙은 경우 제거 ("Clinical Science Symposium\n<title>")
        s2 = SESSION_START_RE.sub("", b, count=1).strip()
        if not s2 or FOOTER_RE.search(s2) or PAGENUM_BOX_RE.match(s2):
            continue
        if NUM_LINE_RE.match(s2) or TRACK_BOX_RE.match(s2):
            continue
        m = FA_RE.search(s2)
        title = s2[:m.start()] if m else s2
        return clean_text(title).rstrip(". ")
    return ""


def build_record(abstract_id: str, session_type: str, track: str, block: list[str]) -> dict:
    is_lba = abstract_id.startswith("LBA")
    uid = f"asco-{YEAR}-{abstract_id.lower()}"
    title = _pick_title(block)

    btxt = "\n".join(b for b in block if not FOOTER_RE.search(b))
    btxt = re.sub(r"-\n\s*", "", btxt)
    cancer_category = retag_cancer(track, title)

    fam = FA_RE.search(btxt)
    after_fa = btxt[fam.end():] if fam else ""
    is_embargoed = bool(EMBARGOED_RE.search(btxt))

    if is_embargoed:
        em = EMBARGOED_RE.search(after_fa)
        author_raw = clean_text(after_fa[:em.start()]) if em else clean_text(after_fa[:300])
        body_text, status, enrich = None, "embargoed", "embargoed"
    else:
        bm = BODY_START_RE.search(after_fa)
        if bm:
            author_raw = clean_text(after_fa[:bm.start()])
            body_raw = after_fa[bm.start():]
        else:
            author_raw = clean_text(after_fa[:300])
            body_raw = ""
        cut = len(body_raw)
        sm = SPONSOR_RE.search(body_raw)
        cm = CLINICAL_INFO_RE.search(body_raw)
        if sm:
            cut = min(cut, sm.start())
        if cm:
            cut = min(cut, cm.start())
        body_text = re.sub(r"\s+", " ", body_raw[:cut]).strip()
        if len(body_text) < 200 and not BODY_START_RE.search(body_text):
            body_text, status, enrich = None, "embargoed", "embargoed"
        else:
            status, enrich = "available", "dictionary_v1"

    author = parse_author(author_raw) if author_raw else None
    full = f"{title} {body_text or ''} {btxt}"
    nct_ids = extract_nct_ids(full)
    phases = extract_phases(full)
    modality_list = infer_modality_list(full)
    target_list = infer_target_list(full)
    biomarker_list = infer_biomarker_list(full)
    sm2 = SPONSOR_RE.search(btxt)
    research_sponsor = clean_text(sm2.group(1)) if sm2 else None
    drugs_mentioned = extract_drugs(f"{title} {body_text or ''}")
    company = clean_company(research_sponsor)
    companies = [company] if company else []
    companies_normalized = normalize_companies(
        research_sponsor or "", author.get("affiliation", "") if author else ""
    )

    return {
        "uid": uid, "conference": CONFERENCE, "year": YEAR, "abstract_id": abstract_id,
        "is_lba": is_lba, "status": status, "presentation_type": session_type, "track": track,
        "cancer_category": cancer_category, "title": title,
        "authors": [author] if author else [], "author_raw": author_raw,
        "abstract_text": body_text, "phase": phases[0] if phases else None, "phases": phases,
        "modality_list": modality_list, "target_list": target_list,
        "biomarker_mentioned": len(biomarker_list) > 0, "biomarker_list": biomarker_list,
        "nct_ids": nct_ids,
        "clinicaltrials_url": f"https://clinicaltrials.gov/study/{nct_ids[0]}" if nct_ids else None,
        "companies": companies, "companies_normalized": companies_normalized,
        "drugs_mentioned": drugs_mentioned, "research_sponsor": research_sponsor,
        "source": {"url": None, "doi": None, "page": None},
        "keyword_parsed": status == "available", "enrichment_status": enrich,
    }


# ── 메인 ─────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"[1/4] 컬럼 인식 추출: {PDF_PATH}")
    stream = column_aware_stream(PDF_PATH)
    print(f"      {len(stream):,} text boxes")

    print("[2/4] 세그먼트 (번호→세션 시작점)")
    starts = [
        k for k in range(len(stream) - 1)
        if NUM_LINE_RE.match(stream[k]) and SESSION_START_RE.match(stream[k + 1].strip())
    ]
    print(f"      {len(starts)} abstract blocks")

    print("[3/4] 파싱")
    abstracts: list[dict] = []
    current_track = None
    for idx, k in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(stream)
        abstract_id = stream[k]
        sm = SESSION_START_RE.match(stream[k + 1].strip())
        session_type = sm.group(1) if sm else stream[k + 1].strip()[:40]
        # 트랙: 이 시작점 직전의 전역 마지막 ALL-CAPS 트랙 박스 갱신
        for j in range(max(0, k - 4), k):
            s = stream[j].strip()
            if TRACK_BOX_RE.match(s) and not NUM_LINE_RE.match(s):
                current_track = s
        # 세션 박스(k+1)부터 포함 — 세션 라벨과 제목이 한 박스에 있는 경우 대응
        block = stream[k + 1:end]
        try:
            abstracts.append(build_record(abstract_id, session_type, current_track, block))
        except Exception as e:
            print(f"  [warn] {abstract_id}: {e}")

    # 중복 abstract_id 처리 (드물게 페이지 헤더 반복) — 첫 등장 유지
    seen = set()
    deduped = []
    for a in abstracts:
        if a["abstract_id"] in seen:
            continue
        seen.add(a["abstract_id"])
        deduped.append(a)
    abstracts = deduped

    available = sum(1 for a in abstracts if a["status"] == "available")
    embargoed = sum(1 for a in abstracts if a["status"] == "embargoed")
    print(f"\n      Total: {len(abstracts)}  Available: {available}  Embargoed: {embargoed}")

    print("[4/4] 저장")
    os.makedirs("data/parsed", exist_ok=True)
    output = {
        "metadata": {
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "conference": CONFERENCE, "year": YEAR,
            "total_abstracts": len(abstracts), "available": available, "embargoed": embargoed,
            "source_pdf": PDF_PATH,
        },
        "abstracts": abstracts,
    }
    with open(OUT_ABSTRACTS, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    mb = os.path.getsize(OUT_ABSTRACTS) / 1024 / 1024
    print(f"      {OUT_ABSTRACTS}  ({mb:.1f} MB)")

    nct_index: dict[str, list[str]] = {}
    for a in abstracts:
        for nct in a.get("nct_ids", []):
            nct_index.setdefault(nct, []).append(a["uid"])
    with open(OUT_NCT_INDEX, "w", encoding="utf-8") as f:
        json.dump(nct_index, f, ensure_ascii=False, indent=2)
    print(f"      {OUT_NCT_INDEX}  ({len(nct_index)} NCT IDs)")
    print("\n완료!")


if __name__ == "__main__":
    main()
