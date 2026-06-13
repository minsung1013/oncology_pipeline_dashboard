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


def normalize_companies(*texts: str) -> list[str]:
    """주어진 자유텍스트들에서 알려진 표준 회사명 목록을 추출 (순서 유지, 중복 제거)."""
    blob = " ; ".join(t for t in texts if t).lower()
    if not blob:
        return []
    found: list[str] = []
    for canonical, aliases in CANONICAL_COMPANIES:
        if canonical in found:
            continue
        if any(_matches(blob, a) for a in aliases):
            found.append(canonical)
    return found
