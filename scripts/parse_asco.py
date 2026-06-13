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
    _word_boundary_match,
)

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


# ── 헬퍼 함수 ─────────────────────────────────────────────────────────────────

def get_cancer_category(track: str) -> list[str]:
    if not track:
        return []
    t = track.upper()
    for key, cats in sorted(TRACK_TO_CANCER.items(), key=lambda x: -len(x[0])):
        if t.startswith(key):
            return cats
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


# ── 초록 블록 파싱 ────────────────────────────────────────────────────────────

def parse_block(
    abstract_id: str,
    text_before: str,   # "First Author:" 이전 (~3000자 윈도우)
    text_after: str,    # "First Author:" 이후 ~ 다음 "First Author:" 이전
    current_track: str,
) -> dict:
    is_lba = abstract_id.startswith("LBA")
    uid = f"asco-{YEAR}-{abstract_id.lower()}"

    # 세션 타입 (lookback 마지막 매칭)
    session_type = None
    for m in SESSION_RE.finditer(text_before):
        session_type = m.group(1)

    # Track 갱신 (lookback에서 마지막 매칭)
    track = current_track
    for m in TRACK_RE.finditer(text_before):
        track = m.group(0).strip()

    cancer_category = get_cancer_category(track)

    # 제목: lookback에서 "이전 초록 끝" 위치를 찾아 그 이후 텍스트를 제목으로 사용
    # 우선순위: 세션타입 > Research Sponsor > Clinical trial info > Embargo 끝 > 마지막 \n\n
    title_start = 0
    for m in SESSION_RE.finditer(text_before):
        title_start = max(title_start, m.end())
    for m in re.finditer(r"(?:Research\s+)?Sponsor:[^\n]*\n?", text_before):
        title_start = max(title_start, m.end())
    for m in re.finditer(r"Clinical trial information:[^\n]*\n?", text_before):
        title_start = max(title_start, m.end())
    for m in EMBARGOED_RE.finditer(text_before):
        para_end = text_before.find("\n\n", m.end())
        title_start = max(title_start, para_end + 2 if para_end > 0 else m.end())
    # 위 마커가 없을 때: 마지막 \n\n 이후가 제목 (이전 초록 저자라인과 구분)
    if title_start == 0:
        for m in re.finditer(r"\n\n", text_before):
            title_start = max(title_start, m.end())

    raw_title = text_before[title_start:]
    # 잔여 번호·페이지 마커·Track명·세션타입·Sponsor 제거
    raw_title = re.sub(r"^\s*(LBA)?\d+\s*", "", raw_title)
    raw_title = re.sub(r"^\s*\d+s\s*", "", raw_title)
    raw_title = TRACK_RE.sub("", raw_title, count=1).strip()
    raw_title = SESSION_RE.sub("", raw_title, count=1).strip()
    raw_title = re.sub(r"^(?:Research\s+)?Sponsor:[^\n]+\n?", "", raw_title).strip()
    title = clean_text(raw_title)

    # Embargo 판별
    is_embargoed = bool(EMBARGOED_RE.search(text_after))

    if is_embargoed:
        em = EMBARGOED_RE.search(text_after)
        author_raw = text_after[:em.start()].strip()
        author_raw = clean_text(author_raw)
        body_text = None
        status = "embargoed"
        enrich_status = "embargoed"
    else:
        # 저자 라인: "First Author:" ~ 본문 시작 마커 (Background: 등)
        bm = BODY_START_RE.search(text_after)
        if bm:
            author_raw = clean_text(text_after[:bm.start()])
            body_raw = text_after[bm.start():]
        else:
            nl = text_after.find("\n\n")
            if nl > 0:
                author_raw = clean_text(text_after[:nl])
                body_raw = text_after[nl:]
            else:
                author_raw = clean_text(text_after[:300])
                body_raw = ""

        # 본문 끝 자르기 (Research Sponsor / Clinical trial info)
        body_raw = re.sub(r"-\n\s*", "", body_raw)
        cut = len(body_raw)
        sm = SPONSOR_RE.search(body_raw)
        cm = CLINICAL_INFO_RE.search(body_raw)
        if sm:
            cut = min(cut, sm.start())
        if cm:
            cut = min(cut, cm.start())
        body_text = re.sub(r"\s+", " ", body_raw[:cut]).strip()
        # 본문이 너무 짧으면 Embargo 미감지로 판단 (Background: 구조 없는 경우)
        if len(body_text) < 200 and not BODY_START_RE.search(body_text):
            body_text = None
            status = "embargoed"
            enrich_status = "embargoed"
        else:
            status = "available"
            enrich_status = "dictionary_v1"

    author = parse_author(author_raw) if author_raw else None

    # NCT, Phase, 키워드 매칭 (제목+본문+전체 after 포함)
    full = f"{title} {body_text or ''} {text_after}"
    nct_ids = extract_nct_ids(full)
    phases = extract_phases(full)
    modality_list = infer_modality_list(full)
    target_list = infer_target_list(full)
    biomarker_list = infer_biomarker_list(full)

    sm2 = SPONSOR_RE.search(text_after)
    research_sponsor = clean_text(sm2.group(1)) if sm2 else None

    return {
        "uid": uid,
        "conference": CONFERENCE,
        "year": YEAR,
        "abstract_id": abstract_id,
        "is_lba": is_lba,
        "status": status,
        "presentation_type": session_type,
        "track": track,
        "cancer_category": cancer_category,
        "title": title,
        "authors": [author] if author else [],
        "author_raw": author_raw,
        "abstract_text": body_text,
        "phase": phases[0] if phases else None,
        "phases": phases,
        "modality_list": modality_list,
        "target_list": target_list,
        "biomarker_mentioned": len(biomarker_list) > 0,
        "biomarker_list": biomarker_list,
        "nct_ids": nct_ids,
        "clinicaltrials_url": (
            f"https://clinicaltrials.gov/study/{nct_ids[0]}" if nct_ids else None
        ),
        "companies": [],
        "drugs_mentioned": [],
        "research_sponsor": research_sponsor,
        "source": {"url": None, "doi": None, "page": None},
        "keyword_parsed": status == "available",
        "enrichment_status": enrich_status,
    }


# ── 메인 ─────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"[1/4] PDF 텍스트 추출: {PDF_PATH}")
    raw = extract_text(PDF_PATH)
    pages = raw.count("\x0c") + 1
    print(f"      {len(raw):,} chars / {pages} pages")

    print("[2/4] 클리닝 (푸터·페이지번호 제거)")
    cleaned_pages = []
    for page in raw.split("\x0c"):
        page = FOOTER_RE.sub("", page)
        page = PAGE_NUM_RE.sub("", page)
        cleaned_pages.append(page)
    full = "\n\n".join(cleaned_pages)

    print("[3/4] 파싱")

    # 이벤트 시퀀스 구축: abstract_number와 First Author: 위치
    num_events: list[tuple[int, str]] = [
        (m.start(), m.group(1)) for m in ABSTRACT_NUM_RE.finditer(full)
    ]
    fa_positions: list[int] = [
        m.start() for m in re.finditer(r"First Author:", full)
    ]

    print(f"      Abstract number candidates: {len(num_events)}")
    print(f"      'First Author:' occurrences: {len(fa_positions)}")

    # FIFO 큐: 번호를 순서대로 소비해 First Author: 에 매핑
    num_queue: deque[tuple[int, str]] = deque(num_events)
    fa_assignments: list[tuple[int, str]] = []  # (fa_pos, abstract_id)

    for fa_pos in fa_positions:
        # 큐 앞에서 fa_pos보다 앞에 있는 번호를 꺼냄
        while num_queue and num_queue[0][0] > fa_pos:
            num_queue.popleft()   # fa_pos보다 앞에 없으면 건너뜀

        if num_queue:
            _, abstract_id = num_queue.popleft()
        else:
            abstract_id = f"auto-{len(fa_assignments):04d}"

        fa_assignments.append((fa_pos, abstract_id))

    print(f"      Matched: {len(fa_assignments)}")

    # 초록 파싱
    abstracts: list[dict] = []
    current_track: str | None = None
    LOOKBACK = 3000

    for i, (fa_pos, abstract_id) in enumerate(tqdm(fa_assignments, desc="  Parsing")):
        # lookback 윈도우 (이전 FA 이후 ~ 현재 FA)
        prev_fa_end = (
            fa_assignments[i - 1][0] + len("First Author:")
            if i > 0 else 0
        )
        lookback_start = max(prev_fa_end, fa_pos - LOOKBACK)
        text_before = full[lookback_start:fa_pos]

        # next FA까지가 after 범위
        next_fa = fa_assignments[i + 1][0] if i + 1 < len(fa_assignments) else len(full)
        text_after = full[fa_pos + len("First Author:"):next_fa]

        # track 갱신
        for m in TRACK_RE.finditer(text_before):
            current_track = m.group(0).strip()

        try:
            rec = parse_block(abstract_id, text_before, text_after, current_track)
            abstracts.append(rec)
        except Exception as e:
            print(f"\n  [warn] {abstract_id} @ pos {fa_pos}: {e}")

    available = sum(1 for a in abstracts if a["status"] == "available")
    embargoed = sum(1 for a in abstracts if a["status"] == "embargoed")
    auto_ids = sum(1 for a in abstracts if str(a["abstract_id"]).startswith("auto-"))

    print(f"\n      Total: {len(abstracts)}")
    print(f"      Available: {available}  Embargoed: {embargoed}  Auto-ID: {auto_ids}")

    print("[4/4] 저장")
    os.makedirs("data/parsed", exist_ok=True)

    output = {
        "metadata": {
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "conference": CONFERENCE,
            "year": YEAR,
            "total_abstracts": len(abstracts),
            "available": available,
            "embargoed": embargoed,
            "source_pdf": PDF_PATH,
        },
        "abstracts": abstracts,
    }

    with open(OUT_ABSTRACTS, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    mb = os.path.getsize(OUT_ABSTRACTS) / 1024 / 1024
    print(f"      {OUT_ABSTRACTS}  ({mb:.1f} MB)")

    # NCT → uid 역인덱스
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
