"""
회사명 엔티티 정규화.

research_sponsor / affiliation 자유텍스트에서 알려진 제약·바이오 기업을
표준명으로 매핑한다. 다중 스폰서 문자열도 스캔 방식으로 모두 추출.

용법:
    from normalize_entities import normalize_companies
    normalize_companies("AstraZeneca UK Limited")  -> ["AstraZeneca"]
    normalize_companies("AstraZeneca; Merck")      -> ["AstraZeneca", "Merck (MSD)"]
"""

import re

# 표준명 -> 매칭 별칭(소문자 부분일치). 더 구체적인 항목을 먼저 검사한다.
# (별칭이 짧고 모호한 경우 word-boundary 매칭: bms, gsk, msd, j&j, lilly, bayer 등)
CANONICAL_COMPANIES: list[tuple[str, list[str]]] = [
    # ── 빅파마 ──
    ("AstraZeneca",            ["astrazeneca", "astra zeneca", "medimmune"]),
    ("Daiichi Sankyo",         ["daiichi sankyo", "daiichi"]),
    ("Merck KGaA",             ["merck kgaa", "emd serono", "healthcare business of merck",
                                "merck healthcare", "merck, s.l", "merck serono"]),
    # bare "merck"는 KGaA/Serono 문맥 제외 (정규식 별칭 're:')
    ("Merck (MSD)",            ["merck sharp", "msd", "merck & co", "merck and co",
                                "merck foundation",
                                r"re:merck(?!\s*(?:kgaa|healthcare|serono|s\.l))"]),
    ("Roche/Genentech",        ["hoffmann-la roche", "hoffmann la roche", "genentech",
                                "roche"]),
    ("Pfizer",                 ["pfizer", "seagen", "seattle genetics"]),
    ("Bristol Myers Squibb",   ["bristol myers squibb", "bristol-myers", "celgene",
                                "juno therapeutics", "bms"]),
    ("Novartis",               ["novartis"]),
    ("Johnson & Johnson",      ["janssen", "johnson & johnson", "johnson and johnson",
                                "j&j", "legend biotech"]),
    ("GSK",                    ["glaxosmithkline", "glaxosmithklin", "gsk"]),
    ("AbbVie",                 ["abbvie", "abbisko"]),
    ("Gilead Sciences",        ["gilead", "kite pharma", "kite"]),
    ("Amgen",                  ["amgen"]),
    ("Sanofi",                 ["sanofi", "genzyme"]),
    ("Bayer",                  ["bayer"]),
    ("Takeda",                 ["takeda"]),
    ("BeiGene/BeOne",          ["beigene", "beone medicines", "beone"]),
    ("Astellas",               ["astellas"]),
    ("Eisai",                  ["eisai"]),
    ("Boehringer Ingelheim",   ["boehringer"]),
    ("Eli Lilly",              ["eli lilly", "loxo oncology", "loxo", "lilly"]),
    ("Regeneron",              ["regeneron"]),
    ("Moderna",                ["moderna"]),
    ("BioNTech",               ["biontech"]),
    ("Incyte",                 ["incyte"]),
    ("Exelixis",               ["exelixis"]),
    ("Jazz Pharmaceuticals",   ["jazz pharma"]),
    ("Servier",                ["servier"]),
    ("Taiho",                  ["taiho"]),
    ("Ipsen",                  ["ipsen"]),
    ("Merus",                  ["merus"]),
    ("Zymeworks",              ["zymeworks"]),
    ("Arvinas",                ["arvinas"]),
    ("Revolution Medicines",   ["revolution medicines"]),
    ("Mirati",                 ["mirati"]),
    ("Blueprint Medicines",    ["blueprint medicines"]),
    ("Deciphera",              ["deciphera"]),
    ("Kura Oncology",          ["kura oncology"]),
    ("Nuvation",               ["nuvation"]),
    ("Summit Therapeutics",    ["summit therapeutics"]),
    ("Bicara",                 ["bicara"]),
    # ── 중국 제약 ──
    ("HUTCHMED",               ["hutchmed"]),
    ("Hengrui",                ["hengrui"]),
    ("Innovent",               ["innovent"]),
    ("Junshi",                 ["junshi"]),
    ("Akeso",                  ["akeso"]),
    ("Zai Lab",                ["zai lab", "zailab"]),
    ("BeiGene/BeOne",          ["beigene"]),
    ("Shanghai Henlius",       ["henlius"]),
    ("3SBio",                  ["3sbio"]),
    ("Kelun",                  ["kelun"]),
    ("Hansoh",                 ["hansoh"]),
    # ── 한국 제약 ──
    ("Yuhan",                  ["yuhan"]),
    ("Hanmi",                  ["hanmi"]),
    ("Samyang",                ["samyang"]),
]

# word-boundary 매칭이 필요한 짧은/모호한 별칭 (부분일치 오탐 방지)
_SHORT_ALIASES = {
    "msd", "bms", "gsk", "j&j", "lilly", "bayer", "roche", "kite", "loxo",
    "ipsen", "merus", "kelun", "yuhan", "hanmi", "akeso", "beone", "3sbio",
}


def _matches(text_lower: str, alias: str) -> bool:
    if alias.startswith("re:"):
        return bool(re.search(alias[3:], text_lower))
    if alias in _SHORT_ALIASES:
        return bool(re.search(r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])", text_lower))
    return alias in text_lower


# ── 큐레이션 사전에 없는 회사용 스마트 fallback ────────────────────────────────
# 큐레이션(~60개 빅파마)에 없어도 진짜 회사(ABL Bio, Chia Tai Tianqing 등)를
# 인식하기 위한 휴리스틱. 단, 대학·병원·암센터 등 학술기관은 제외(기업 활동 뷰 유지).

# 다중 스폰서 구분자 (&는 회사명 일부인 경우가 많아 제외: Merck Sharp & Dohme 등)
_SEP = re.compile(r"\s*[;|]\s*|\s+/\s+")

# 학술/비영리/공공 기관 — 회사로 보지 않음 (우선순위 최상)
_NON_COMPANY = re.compile(
    r"\b(?:universit\w*|college|school of medicine|medical school|hospital|"
    r"clinic|cancer cent(?:er|re)|comprehensive cancer|medical cent(?:er|re)|"
    r"health (?:network|system|services|authority)|institut\w*|foundation|"
    r"national (?:cancer|institute|university|health)|n\.c\.i|nci|nih|"
    r"research (?:cent(?:er|re)|institut\w*|hospital)|academ\w*|"
    r"ministry|government|federal|consortium|cooperative group|"
    r"society|association|department of|trials? group|alliance|network|"
    r"polyclinic|infirmary|klinik\w*|università|universidad|universit[ée]|"
    r"universit[äa]t|centre hospitalier|assistance publique|gustave roussy|"
    r"m\.?d\.? anderson|sloan kettering|dana[- ]?farber|moffitt|"
    r"mayo clinic|cleveland clinic|charit[ée])\b", re.I)

# 회사로 인식하는 신호: 법인 접미사(정확 경계) 또는 제약/바이오 stem(접두 매칭).
# stem은 \bstem\w* 로 융합 단어도 포착: Biogen, PharmaMar, Oncotherapeutics 등.
_COMPANY_HINT = re.compile(
    r"\b(?:inc|incorporated|ltd|limited|llc|gmbh|corp|corporation|co|ag|plc|"
    r"s\.?a|sas|b\.?v|pvt|aps|oy|ab|s\.?r\.?l)\b"
    r"|\b(?:bio|pharma|biopharma|onco|therapeutic|biotech|biosci|"
    r"genomic|medicine|diagnostic|biologic|biopharmaceutical)\w*", re.I)

# 이름 끝의 법인 접미사 (반복 제거용, 끝anchor)
_LEGAL_TAIL = re.compile(
    r"[\s,]*\b(?:inc(?:orporated)?|ltd|limited|llc|l\.l\.c\.|gmbh|"
    r"corp(?:oration)?|company|co|ag|plc|s\.?a\.?s?|b\.?v\.?|pvt|aps|oy|ab|"
    r"s\.?r\.?l\.?|group|holding(?:s)?)\b\.?\s*$", re.I)


def _clean_company_name(seg: str) -> str | None:
    """법인 접미사·구두점을 끝에서 반복 제거해 표시용 회사명 생성."""
    name = seg.strip().strip(",").strip()
    prev = None
    while prev != name:
        prev = name
        name = _LEGAL_TAIL.sub("", name).strip().strip(",").strip()
    return name if len(name) >= 2 else None


def _company_fallback(seg: str) -> str | None:
    low = seg.lower()
    if _NON_COMPANY.search(low):
        return None
    if not _COMPANY_HINT.search(low):
        return None
    return _clean_company_name(seg)


def normalize_companies(*texts: str) -> list[str]:
    """자유텍스트에서 회사명 추출 (순서 유지, 중복 제거).

    1) 큐레이션 표준명 우선 매칭 → canonical 명으로 통일.
    2) 미매칭 세그먼트는 스마트 fallback(법인 접미사/바이오 키워드 인식,
       학술기관 제외)으로 정제된 raw 회사명 채택.
    """
    found: list[str] = []
    for raw in texts:
        if not raw:
            continue
        for seg in _SEP.split(raw):
            seg = seg.strip()
            if not seg:
                continue
            low = seg.lower()
            hit = None
            for canonical, aliases in CANONICAL_COMPANIES:
                if any(_matches(low, a) for a in aliases):
                    hit = canonical
                    break
            name = hit or _company_fallback(seg)
            if name and name not in found:
                found.append(name)
    return found
