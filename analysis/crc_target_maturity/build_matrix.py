#!/usr/bin/env python3
"""
CRC Target Maturity Matrix
==========================
특정 암종(기본: 대장암/Colorectal)에 대해 개발 중인 '타겟'별로
전임상(학회 초록) + 임상(ClinicalTrials.gov) 성숙도를 한 장의 매트릭스로 집계한다.

소스
  - data/frontend/pipeline.json          : 임상 (약물=프로그램 단위, target/phase/status)
  - data/parsed/abstracts_*.json         : 학회 초록 (AACR/ASCO/ESMO). phase 없음 = 전임상/기초

출력 (analysis/crc_target_maturity/)
  - crc_target_maturity.csv              : 타겟 × 단계 매트릭스
  - crc_target_maturity.json             : 상세(진행/완료/중단 분해 포함)
  - crc_target_maturity.md               : 마크다운 리포트
  - crc_target_maturity.html             : 자체완결 HTML(인라인 SVG 히트맵)

사전(dictionary) 방식 그대로 사용. target_list의 'Unknown'은 별도 버킷으로 집계하고
리포트에 커버리지를 명시한다.
"""
import json, glob, csv, os, sys, collections, html, math, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = HERE
CANCER = os.environ.get("CANCER", "Colorectal")

# ---------------------------------------------------------------- normalization
# 명백한 동의어/표기흔들림만 병합(보수적). 생물학적으로 구분되는 것(VEGF 리간드 vs VEGFR 수용체 축은
# 실무상 함께 다뤄 'VEGF/VEGFR'로 통일; KRAS vs NRAS/HRAS 같은 별개 유전자는 분리 유지).
# 키는 아무 대소문자로 적어도 됨 — 조회 시 exact -> uppercase 순으로 매칭(그리스문자 α/β 안전).
TARGET_SYNONYMS = {
    # HER family
    "ERBB2": "HER2", "HER-2": "HER2", "HER2/neu": "HER2", "neu": "HER2",
    "ERBB2/HER2": "HER2", "HER2/ERBB2": "HER2", "HER2neu": "HER2",
    "ERBB1": "EGFR", "HER1": "EGFR",
    "ERBB3": "HER3",
    # immune checkpoints
    "PDCD1": "PD-1", "PD1": "PD-1", "PD-L1/PD-1": "PD-1", "PD-1/PD-L1": "PD-1",
    "PDL1": "PD-L1", "CD274": "PD-L1", "PD-L1/PD-L2": "PD-L1",
    "CTLA4": "CTLA-4",
    "LAG3": "LAG-3",
    "CD137": "4-1BB",              # CD137 = 4-1BB = TNFRSF9
    # RAS (제네릭 RAS + KRAS 변이만 KRAS로; NRAS/HRAS는 별개 행 유지)
    "RAS": "KRAS", "KRAS G12C": "KRAS", "KRASG12C": "KRAS",
    "KRAS G12D": "KRAS", "KRASG12D": "KRAS",
    # VEGF axis (리간드/수용체/VEGFR3까지 축으로 통일)
    "VEGF-A": "VEGF/VEGFR", "VEGFA": "VEGF/VEGFR", "VEGF": "VEGF/VEGFR",
    "VEGFR": "VEGF/VEGFR", "VEGFR2": "VEGF/VEGFR", "KDR": "VEGF/VEGFR",
    "VEGF/VEGFR2": "VEGF/VEGFR", "VEGFR3": "VEGF/VEGFR", "FLT4": "VEGF/VEGFR",
    # MAPK cascade
    "MEK1": "MEK", "MEK2": "MEK", "MAP2K1": "MEK",
    "ERK1": "ERK", "ERK2": "ERK", "ERK1/2": "ERK", "MAPK1": "ERK", "MAPK3": "ERK",
    # DDR
    "PARP1": "PARP", "PARP-1": "PARP",
    # engager arms / MET / TROP2
    "CD3E": "CD3",
    "cMET": "MET", "C-MET": "MET", "HGFR": "MET",
    "TROP-2": "TROP2", "TACSTD2": "TROP2", "Trop2": "TROP2",
    # CDK4/6 (다른 CDK 이소폼은 분리 유지)
    "CDK4": "CDK4/6", "CDK6": "CDK4/6",
    # PI3K (pan-PI3K와 이소폼 특이 PIK3CA는 구분; PI3Kα=PIK3CA만 병합)
    "PI3Kα": "PIK3CA",
    # gene<->protein 동일 타겟
    "TP53": "p53",
    "CTNNB1": "β-catenin",
    "Topoisomerase I": "TOP1", "TOPO I": "TOP1", "TOP1MT": "TOP1",
    "CEACAM5": "CEA",             # CEA = CEACAM5
    "GCC": "GUCY2C",              # guanylate cyclase C
    # 표기/대소문자 흔들림 통일
    "Akt": "AKT",
    "BCL-2": "BCL2",
    "MCL-1": "MCL1", "Mcl-1": "MCL1",
    "B7H3": "B7-H3",
    "CSF-1R": "CSF1R",
    "TGF-beta": "TGF-β", "TGFβ": "TGF-β", "TGF-B": "TGF-β",
    "tubulin": "Tubulin",
    "HIF-1a": "HIF-1α",
}

# 비특이/정크 타겟 -> Unknown 버킷으로 (랭킹에서 제외되지만 총계에는 포함)
DROP_TARGETS = {"DNA", "RNA", "N/A", "NONE", "-", "TUMOR", "CANCER", "MULTIPLE"}

_SYN_UPPER = {k.upper(): v for k, v in TARGET_SYNONYMS.items()}

# KRAS 점돌연변이 표기(G12V, G13D, Q61H 등)는 타겟이 아니라 바이오마커 -> KRAS로 접음
_KRAS_MUT = re.compile(r'^k-?ras[\s\-]?(g12[a-z]|g13[a-z]|q61[a-z]|a146[a-z])$', re.I)
# ERBB/HER 패밀리 표기 흔들림: ErbB-2, ErbB2, ERBB-2, WTErbB-2, ErbB2c 등 → 단일유전자.
# ERBB1=EGFR, ERBB2=HER2, ERBB3=HER3 (ERBB4는 별개 유지). 숫자 없는 generic 'ErbB'는 보존.
_ERBB_RE = re.compile(r'^(?:wt)?erbb[\s\-]?([123])[a-z]?$', re.I)
_ERBB_MAP = {'1': 'EGFR', '2': 'HER2', '3': 'HER3'}

def norm_target(t):
    if not t:
        return None
    t = t.strip()
    if not t:
        return None
    if t.upper() in DROP_TARGETS:
        return "Unknown"
    if t in TARGET_SYNONYMS:            # exact (그리스문자 등 대소문자 변환 위험 회피)
        return TARGET_SYNONYMS[t]
    if _KRAS_MUT.match(t):
        return "KRAS"
    m = _ERBB_RE.match(t)               # ErbB-2 / WTErbB-2 / ErbB2c … → HER2 등
    if m:
        return _ERBB_MAP[m.group(1)]
    return _SYN_UPPER.get(t.upper(), t) # ASCII 대소문자 무시 매칭

# ---- 2차: 포맷(구분자/대소문자)만 다른 표기 자동 통일 -------------------------
# 그리스문자·숫자는 유지(이소폼 구분 보존) → ERα vs ERβ, PI3Kγ vs PI3Kδ 는 병합 안 됨.
def _fmt_key(s):
    return re.sub(r'[\s\-_/:.\*·]+', '', s.lower())

def build_format_canon(name_counts):
    """{raw_name: canonical} 맵. 같은 포맷키 그룹에서 최다빈도 표기를 대표형으로."""
    groups = collections.defaultdict(list)
    for name, cnt in name_counts.items():
        if name == "Unknown":
            continue
        groups[_fmt_key(name)].append((name, cnt))
    canon = {}
    merges = []
    for key, members in groups.items():
        if len(members) == 1:
            canon[members[0][0]] = members[0][0]
            continue
        # 대표형: 최다빈도 → 하이픈 포함(표준표기) 선호 → 짧은 것
        rep = sorted(members, key=lambda m: (-m[1], -("-" in m[0]), len(m[0])))[0][0]
        for name, _ in members:
            canon[name] = rep
        merges.append((rep, sorted(n for n, _ in members if n != rep)))
    return canon, merges

# ---------------------------------------------------------------- buckets
ONGOING = {"RECRUITING", "ACTIVE_NOT_RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION"}
COMPLETED = {"COMPLETED"}
STOPPED = {"TERMINATED", "WITHDRAWN", "SUSPENDED"}

def status_bucket(s):
    s = (s or "").upper()
    if s in ONGOING: return "ongoing"
    if s in COMPLETED: return "completed"
    if s in STOPPED: return "stopped"
    return "unknown"

def phase_bucket(p):
    p = (p or "").upper()
    if p in ("EARLY_PHASE1", "PHASE1"): return "P1"
    if p == "PHASE1/PHASE2": return "P1/2"
    if p == "PHASE2": return "P2"
    if p == "PHASE2/PHASE3": return "P2/3"
    if p == "PHASE3": return "P3"
    if p == "PHASE4": return "P4"
    return "NA"

PHASE_ORDER = ["Preclinical", "P1", "P1/2", "P2", "P2/3", "P3", "P4"]
PHASE_WEIGHT = {"Preclinical": 0.3, "P1": 1, "P1/2": 1.5, "P2": 2, "P2/3": 2.5, "P3": 3, "P4": 4}

def is_cancer(entry):
    cats = entry.get("cancer_categories") or entry.get("cancer_category") or []
    if isinstance(cats, str):
        cats = [cats]
    return CANCER in cats

# ---------------------------------------------------------------- load clinical
def load_clinical():
    d = json.load(open(os.path.join(ROOT, "data/frontend/pipeline.json")))["drugs"]
    rows = []
    for x in d:
        if not is_cancer(x):
            continue
        tgt = norm_target(x.get("target"))
        rows.append({
            "target": tgt if tgt else "Unknown",
            "phase": phase_bucket(x.get("phase")),
            "status": status_bucket(x.get("overall_status")),
            "drug": x.get("drug_name"),
            "company": x.get("company_normalized") or x.get("company"),
            "nct_ids": x.get("nct_ids") or [],
        })
    return rows

# ---------------------------------------------------------------- load preclinical
_DRUG_CACHE = None
def drug_cache():
    global _DRUG_CACHE
    if _DRUG_CACHE is None:
        _DRUG_CACHE = json.load(open(os.path.join(ROOT, "data/cache/llm_drug_cache.json")))
    return _DRUG_CACHE

def load_preclinical():
    """학회 초록(phase 없음=전임상/기초) → 고유 약물(프로그램) 단위 집계.

    각 초록 drugs_mentioned 를 llm_drug_cache 로 조회:
      - 캐시에 있으면 = 실약물(세포주 자동 배제). 약물 자신의 resolved target 사용.
    반환: (programs, mentions_counter, stats)
      programs: [{target, drug}]  (약물은 target별로 aggregate 단계에서 set 중복제거)
      mentions_counter: 참고용 예전 방식(초록-멘션) 카운트
      stats: 커버리지 진단
    """
    cache = drug_cache()
    programs = []                 # (target, canonical drug) — abstract별 1회, target별 set은 aggregate에서
    mentions = collections.Counter()
    seen_prog = set()             # (target, drug) 전역 중복제거
    n_pre = n_with_drug = n_basic = 0
    hit = miss = 0
    miss_names = collections.Counter()
    for f in glob.glob(os.path.join(ROOT, "data/parsed/abstracts_*.json")):
        for a in json.load(open(f)).get("abstracts", []):
            if not is_cancer(a) or a.get("phase"):
                continue
            n_pre += 1
            # (참고) 예전 멘션 방식
            seen_t = set()
            for t in (a.get("target_list") or []):
                nt = norm_target(t) or "Unknown"
                if nt not in seen_t:
                    seen_t.add(nt); mentions[nt] += 1
            if not (a.get("target_list") or []):
                mentions["Unknown"] += 1
            # 프로그램(약물) 방식
            dms = a.get("drugs_mentioned") or []
            drug_hit = False
            for d in dms:
                ent = cache.get((d or "").strip().lower())
                if not ent:
                    miss += 1; miss_names[d] += 1
                    continue
                hit += 1; drug_hit = True
                canon_drug = ent.get("_drug_name") or d
                tgt = norm_target(ent.get("target")) or "Unknown"
                key = (tgt, canon_drug.lower())
                if key in seen_prog:
                    continue
                seen_prog.add(key)
                programs.append({"target": tgt, "drug": canon_drug})
            if dms:
                n_with_drug += 1
            if not drug_hit:
                n_basic += 1   # 식별 가능한 약물 없음(순수 기초연구/세포주만)
    stats = {
        "preclin_abstracts": n_pre,
        "preclin_with_drug_field": n_with_drug,
        "preclin_no_identifiable_drug": n_basic,
        "drug_cache_hit": hit, "drug_cache_miss": miss,
        "unique_programs": len(seen_prog),
        "top_misses": miss_names.most_common(15),
    }
    return programs, mentions, stats

# ---------------------------------------------------------------- aggregate
def aggregate(clinical, preclinical_programs, mentions):
    targets = collections.defaultdict(lambda: {
        "Preclinical": set(),     # 고유 약물(프로그램) 집합
        "P1": collections.Counter(), "P1/2": collections.Counter(),
        "P2": collections.Counter(), "P2/3": collections.Counter(),
        "P3": collections.Counter(), "P4": collections.Counter(), "NA": collections.Counter(),
    })
    for r in preclinical_programs:
        targets[r["target"]]["Preclinical"].add(r["drug"].lower())
    for r in clinical:
        ph = r["phase"]
        targets[r["target"]][ph][r["status"]] += 1

    out = []
    for tgt, cells in targets.items():
        pre = len(cells["Preclinical"])          # 고유 전임상 약물 수
        clin_total = sum(sum(cells[p].values()) for p in PHASE_ORDER[1:]) + sum(cells["NA"].values())
        # maturity score
        score = pre * PHASE_WEIGHT["Preclinical"]
        max_phase_idx = 0
        for i, p in enumerate(PHASE_ORDER[1:], start=1):
            n = sum(cells[p].values())
            score += n * PHASE_WEIGHT[p]
            if n > 0:
                max_phase_idx = max(max_phase_idx, i)
        total = pre + clin_total
        row = {
            "target": tgt,
            "preclinical": pre,                       # 고유 전임상 약물(프로그램) 수
            "preclinical_mentions": mentions.get(tgt, 0),  # 참고: 예전 초록-멘션 방식
            "preclinical_drugs": sorted(cells["Preclinical"]),
            "clinical_total": clin_total,
            "total_activity": total,
            "max_phase": PHASE_ORDER[max_phase_idx] if max_phase_idx else ("Preclinical" if pre else "NA"),
            "maturity_score": round(score, 1),
            "emerging_ratio": round(pre / total, 2) if total else 0,
        }
        for p in PHASE_ORDER[1:]:
            c = cells[p]
            row[f"{p}_ongoing"] = c["ongoing"]
            row[f"{p}_completed"] = c["completed"]
            row[f"{p}_stopped"] = c["stopped"]
            row[f"{p}_total"] = sum(c.values())
        out.append(row)
    out.sort(key=lambda r: (r["maturity_score"], r["total_activity"]), reverse=True)
    return out

# ---------------------------------------------------------------- writers
def write_csv(rows):
    cols = ["target", "preclinical", "clinical_total", "total_activity", "max_phase",
            "maturity_score", "emerging_ratio"]
    for p in PHASE_ORDER[1:]:
        cols += [f"{p}_total", f"{p}_ongoing", f"{p}_completed", f"{p}_stopped"]
    with open(os.path.join(OUT, "crc_target_maturity.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)

def write_json(rows, meta):
    json.dump({"meta": meta, "rows": rows},
              open(os.path.join(OUT, "crc_target_maturity.json"), "w"),
              ensure_ascii=False, indent=1)

def fmt_cell(r, p):
    """진행/완료 -> 'o진행+완료 (중단)'"""
    o, c, s = r[f"{p}_ongoing"], r[f"{p}_completed"], r[f"{p}_stopped"]
    if o + c + s == 0:
        return ""
    parts = []
    if o: parts.append(f"진행{o}")
    if c: parts.append(f"완료{c}")
    if s: parts.append(f"중단{s}")
    return " / ".join(parts)

def write_md(rows, meta):
    top = [r for r in rows if r["target"] != "Unknown"][:40]
    lines = []
    lines.append(f"# {CANCER} 타겟 성숙도 매트릭스\n")
    lines.append(f"- 생성 소스: 임상 `pipeline.json` (ClinicalTrials.gov) + 학회 초록 AACR/ASCO/ESMO")
    lines.append(f"- 단위: **고유 약물(프로그램)**. 임상 **{meta['clinical_total']}개** · "
                 f"전임상 **{meta['preclinical_programs']}개**(학회 초록서 언급된 실약물, 세포주 제외)")
    lines.append(f"- 전임상 초록 {meta['preclinical_mentions']}건 중 식별 가능한 약물 없음(순수 기초연구/세포주만): "
                 f"**{meta['preclin_no_drug']}건** — 약물 캐시 히트율 {meta['drug_cache_hit_pct']}%")
    lines.append(f"- 정렬: 성숙도 스코어(전임상 0.3 · P1 1 · P2 2 · P3 3 · P4 4 가중) 내림차순\n")
    lines.append("## 성숙도 매트릭스 (상위 40 타겟, Unknown 제외)\n")
    header = "| # | Target | 전임상 | Phase 1 | Phase 1/2 | Phase 2 | Phase 2/3 | Phase 3 | Phase 4 | 최고단계 | 스코어 |"
    lines.append(header)
    lines.append("|" + "---|" * 11)
    for i, r in enumerate(top, 1):
        lines.append("| {i} | **{t}** | {pre} | {p1} | {p12} | {p2} | {p23} | {p3} | {p4} | {mp} | {sc} |".format(
            i=i, t=r["target"], pre=r["preclinical"] or "",
            p1=fmt_cell(r, "P1"), p12=fmt_cell(r, "P1/2"), p2=fmt_cell(r, "P2"),
            p23=fmt_cell(r, "P2/3"), p3=fmt_cell(r, "P3"), p4=fmt_cell(r, "P4"),
            mp=r["max_phase"], sc=r["maturity_score"]))
    lines.append("\n> 셀 표기: `진행N`=Recruiting/Active/Not-yet, `완료N`=Completed, `중단N`=Terminated/Withdrawn/Suspended\n")

    # established vs emerging
    established = [r for r in top if r["max_phase"] in ("P3", "P4")][:10]
    early = ("Preclinical", "P1", "P1/2")
    emerging = sorted([r for r in rows if r["target"] != "Unknown" and r["preclinical"] >= 3
                       and r["max_phase"] in early],
                      key=lambda r: (r["preclinical"], r["preclinical_mentions"]), reverse=True)[:15]
    # 약물화 이전 — 초록 관심은 크나 실약물 프로그램은 적음(가장 초기 신호)
    research_hot = sorted([r for r in rows if r["target"] != "Unknown"
                           and r["preclinical_mentions"] >= 15 and r["preclinical"] <= 2
                           and r["clinical_total"] <= 3],
                          key=lambda r: r["preclinical_mentions"], reverse=True)[:15]
    lines.append("## 성숙(established) 타겟 — 후기임상 도달\n")
    for r in established:
        lines.append(f"- **{r['target']}** — 최고 {r['max_phase']}, 임상약물 {r['clinical_total']}개 "
                     f"(P3/4 완료 {r['P3_completed']+r['P4_completed']}), 전임상약물 {r['preclinical']}개")
    lines.append("\n## 신흥(emerging) 타겟 — 전임상 약물 있으나 임상 초기\n")
    for r in emerging:
        lines.append(f"- **{r['target']}** — 전임상약물 {r['preclinical']}개, 임상약물 {r['clinical_total']}개, "
                     f"최고 {r['max_phase']} (초록멘션 {r['preclinical_mentions']})")
    lines.append("\n## 약물화 이전 — 학회 관심 높으나 실약물 프로그램 적음 (가장 초기 신호)\n")
    for r in research_hot:
        lines.append(f"- **{r['target']}** — 초록멘션 {r['preclinical_mentions']}건, "
                     f"전임상약물 {r['preclinical']}개, 임상약물 {r['clinical_total']}개")
    open(os.path.join(OUT, "crc_target_maturity.md"), "w").write("\n".join(lines))

def write_html_heatmap(rows, meta):
    top = [r for r in rows if r["target"] != "Unknown"][:40]
    cols = PHASE_ORDER  # Preclinical..P4
    # color scale by log count
    def cell_count(r, p):
        return r["preclinical"] if p == "Preclinical" else r[f"{p}_total"]
    maxv = max((cell_count(r, p) for r in top for p in cols), default=1) or 1
    def color(v):
        if v == 0:
            return "#f4f5f7"
        t = math.log1p(v) / math.log1p(maxv)
        # light -> LG red
        r0, g0, b0 = 0xE8, 0xF0, 0xFE
        r1, g1, b1 = 0xC1, 0x00, 0x00
        rr = int(r0 + (r1 - r0) * t); gg = int(g0 + (g1 - g0) * t); bb = int(b0 + (b1 - b0) * t)
        return f"#{rr:02x}{gg:02x}{bb:02x}"
    def tcolor(v):
        return "#fff" if (v > 0 and math.log1p(v)/math.log1p(maxv) > 0.55) else "#111"

    rowH, labelW, colW, top0, left0 = 26, 190, 90, 90, 200
    W = left0 + colW * len(cols) + 40
    H = top0 + rowH * len(top) + 40
    svg = [f'<svg width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Segoe UI,sans-serif">']
    for j, p in enumerate(cols):
        x = left0 + j * colW + colW / 2
        svg.append(f'<text x="{x}" y="{top0-12}" font-size="12" font-weight="600" text-anchor="middle">{p}</text>')
    for i, r in enumerate(top):
        y = top0 + i * rowH
        svg.append(f'<text x="{left0-10}" y="{y+rowH/2+4}" font-size="12" text-anchor="end">{html.escape(r["target"])}</text>')
        for j, p in enumerate(cols):
            v = cell_count(r, p)
            x = left0 + j * colW
            svg.append(f'<rect x="{x}" y="{y}" width="{colW-3}" height="{rowH-3}" rx="3" fill="{color(v)}"/>')
            if v:
                svg.append(f'<text x="{x+(colW-3)/2}" y="{y+rowH/2+4}" font-size="11" fill="{tcolor(v)}" text-anchor="middle">{v}</text>')
    svg.append("</svg>")
    svg = "\n".join(svg)

    doc = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>{CANCER} 타겟 성숙도</title>
<style>
 body{{font-family:-apple-system,Segoe UI,sans-serif;margin:32px;color:#1a1a1a;max-width:1100px}}
 h1{{color:#c10000}} .meta{{color:#555;font-size:14px;line-height:1.7}}
 .legend{{font-size:12px;color:#666;margin:8px 0 20px}}
</style></head><body>
<h1>{CANCER} 타겟 성숙도 매트릭스</h1>
<div class="meta">
 단위: 고유 약물(프로그램) · 임상 <b>{meta['clinical_total']}</b>개 · 전임상 <b>{meta['preclinical_programs']}</b>개<br>
 소스: ClinicalTrials.gov(pipeline.json) + AACR/ASCO/ESMO 초록 · 정렬: 성숙도 스코어 내림차순
</div>
<div class="legend">색이 진할수록 프로그램 수 많음. 셀 숫자 = 해당 단계 고유 약물 수.</div>
{svg}
</body></html>"""
    open(os.path.join(OUT, "crc_target_maturity_heatmap.html"), "w").write(doc)


# 단계별 색상: 전임상=그레이, 1상 녹색 · 2상 노랑 · 3상 오렌지 · 4상 빨강 (중간단계는 사이색)
PHASE_COLORS = {
    "Preclinical": "#b0b8c4",   # 그레이
    "P1":   "#2fa84f",          # 녹색
    "P1/2": "#8ec63f",          # 연두(1~2상)
    "P2":   "#f5d020",          # 노랑
    "P2/3": "#f0a020",          # 호박(2~3상)
    "P3":   "#ee7911",          # 오렌지
    "P4":   "#d0021b",          # 빨강
}
# 밝은 색(연두/노랑/호박/그레이) 세그먼트는 어두운 글자
PHASE_DARK_TEXT = {"Preclinical", "P1/2", "P2", "P2/3"}

def write_html_bars(rows, meta):
    """가로 누적 막대: 막대 길이=전체 개수, 세그먼트 색=개발 단계. hover 시 진행/완료/중단."""
    topn = int(os.environ.get("TOPN", "100"))
    top = sorted([r for r in rows if r["target"] != "Unknown" and r["total_activity"] > 0],
                 key=lambda r: r["total_activity"], reverse=True)[:topn]
    cols = PHASE_ORDER
    maxtot = max((r["total_activity"] for r in top), default=1) or 1

    def seg_count(r, p):
        return r["preclinical"] if p == "Preclinical" else r[f"{p}_total"]
    def seg_detail(r, p):
        if p == "Preclinical":
            return f"전임상 고유 약물 {r['preclinical']}개 (초록멘션 {r['preclinical_mentions']})"
        o, c, s = r[f"{p}_ongoing"], r[f"{p}_completed"], r[f"{p}_stopped"]
        parts = []
        if o: parts.append(f"진행 {o}")
        if c: parts.append(f"완료 {c}")
        if s: parts.append(f"중단 {s}")
        return f"{p}: 총 {o+c+s}건 (" + ", ".join(parts) + ")" if parts else ""

    rowH, gap, labelW, barMaxW, top0, left0 = 16, 4, 180, 780, 74, 190
    W = left0 + barMaxW + 60
    H = top0 + (rowH + gap) * len(top) + 30

    # 로그 스케일: 막대 총길이 = log1p(total) 압축, 세그먼트는 그 안에서 비율대로 분할
    logmax = math.log10(maxtot + 1) or 1
    def xlen(v):
        return math.log10(v + 1) / logmax * barMaxW   # count -> px (로그)

    svg = [f'<svg width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" '
           f'font-family="-apple-system,Segoe UI,sans-serif">']
    # 로그 눈금(1,2,5,10,20,...) 격자선
    ticks = [t for t in (1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000) if t <= maxtot]
    for t in ticks:
        x = left0 + xlen(t)
        svg.append(f'<line x1="{x:.1f}" y1="{top0-6}" x2="{x:.1f}" y2="{H-22}" stroke="#eee"/>')
        svg.append(f'<text x="{x:.1f}" y="{top0-12}" font-size="10" fill="#999" text-anchor="middle">{t}</text>')
    svg.append(f'<text x="{left0}" y="{top0-30}" font-size="11" fill="#666">전체 개수 (로그 스케일) →</text>')
    # bars
    for i, r in enumerate(top):
        y = top0 + i * (rowH + gap)
        fs = 11 if len(top) <= 60 else 10
        svg.append(f'<text x="{left0-8}" y="{y+rowH/2+3.5}" font-size="{fs}" text-anchor="end">'
                   f'{html.escape(r["target"])}</text>')
        barlen = xlen(r["total_activity"])
        cx = left0
        acc = 0
        segs = [(p, seg_count(r, p)) for p in cols if seg_count(r, p)]
        for p, v in segs:
            # 세그먼트 폭 = 전체 막대길이 × (해당단계 건수 / 전체건수) → 구성비 보존
            w = barlen * v / r["total_activity"]
            det = html.escape(seg_detail(r, p))
            rounded = ' rx="1.5"' if (p == segs[0][0] or p == segs[-1][0]) else ''
            svg.append(f'<rect x="{cx:.1f}" y="{y}" width="{max(w,0.8):.1f}" height="{rowH}"{rounded} '
                       f'fill="{PHASE_COLORS[p]}"><title>{html.escape(r["target"])} — {det}</title></rect>')
            if w >= 14:
                tc = "#333" if p in PHASE_DARK_TEXT else "#fff"
                svg.append(f'<text x="{cx+w/2:.1f}" y="{y+rowH/2+3.5}" font-size="9" '
                           f'fill="{tc}" text-anchor="middle">{v}</text>')
            cx += w
        svg.append(f'<text x="{cx+6:.1f}" y="{y+rowH/2+3.5}" font-size="10" font-weight="600" '
                   f'fill="#333">{r["total_activity"]}</text>')
    svg.append("</svg>")
    svg = "\n".join(svg)
    shown = len(top)

    # legend
    leg = ['<div class="legend"><b>개발 단계</b>:']
    for p in cols:
        leg.append(f'<span class="chip"><i style="background:{PHASE_COLORS[p]}"></i>{p}</span>')
    leg.append('</div>')
    legend = "".join(leg)

    doc = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>{CANCER} 타겟 성숙도 — 막대</title>
<style>
 body{{font-family:-apple-system,Segoe UI,sans-serif;margin:32px;color:#1a1a1a;max-width:1120px}}
 h1{{color:#c10000;margin-bottom:4px}}
 .meta{{color:#555;font-size:13px;line-height:1.7;margin-bottom:12px}}
 .legend{{font-size:12px;color:#444;margin:6px 0 18px}}
 .chip{{display:inline-flex;align-items:center;margin:0 10px 4px 0}}
 .chip i{{width:13px;height:13px;border-radius:3px;display:inline-block;margin-right:5px}}
 .hint{{font-size:11px;color:#888;margin-top:10px}}
 rect{{cursor:default}} rect:hover{{opacity:.82}}
</style></head><body>
<h1>{CANCER} 타겟 성숙도 — 단계별 막대</h1>
<div class="meta">
 막대 길이 = 고유 약물(프로그램) 수 <b>(로그 스케일)</b> · 색 = 개발 단계 · 상위 <b>{shown}</b>개 타겟(전체 개수 내림차순)<br>
 임상 <b>{meta['clinical_total']}</b>개 · 전임상 <b>{meta['preclinical_programs']}</b>개 (세포주 제외, 약물캐시 히트율 {meta['drug_cache_hit_pct']}%) ·
 순수 기초연구(약물 없는 초록) {meta['preclin_no_drug']}건은 미포함<br>
 소스: ClinicalTrials.gov + AACR/ASCO/ESMO 초록
</div>
{legend}
{svg}
<div class="hint">로그 스케일이라 막대 <b>길이</b>는 압축되어 있고, 막대 안 <b>색 구성비</b>가 단계 분포를 나타냅니다.
세그먼트 hover 시 진행/완료/중단 상세. 셀 숫자 = 단계 건수, 막대 끝 숫자 = 전체 합계.
표시 개수는 <code>TOPN</code> 환경변수로 조정.</div>
</body></html>"""
    open(os.path.join(OUT, "crc_target_maturity.html"), "w").write(doc)

# ---------------------------------------------------------------- main
def main():
    clinical = load_clinical()
    preclinical, mentions, pstats = load_preclinical()

    # 2차 포맷 통일: 전체 표기 빈도 집계 -> 대표형 맵 -> 소스 전체에 적용
    counts = collections.Counter(r["target"] for r in clinical)
    counts.update(r["target"] for r in preclinical)
    canon, merges = build_format_canon(counts)
    for r in clinical:
        r["target"] = canon.get(r["target"], r["target"])
    for r in preclinical:
        r["target"] = canon.get(r["target"], r["target"])
    mentions = collections.Counter({canon.get(k, k): v for k, v in mentions.items()})
    if merges:
        print(f"format-canon merged {len(merges)} groups (variant spellings unified)")

    rows = aggregate(clinical, preclinical, mentions)
    total_pre_programs = len({(r["target"], r["drug"].lower()) for r in preclinical})
    meta = {
        "cancer": CANCER,
        "clinical_total": len(clinical),
        "preclinical_programs": total_pre_programs,    # 고유 전임상 약물(프로그램)
        "preclinical_mentions": pstats["preclin_abstracts"],  # 전임상 초록 수(참고)
        "preclin_no_drug": pstats["preclin_no_identifiable_drug"],
        "drug_cache_hit_pct": round(100 * pstats["drug_cache_hit"] /
                                    max(pstats["drug_cache_hit"] + pstats["drug_cache_miss"], 1)),
        "n_targets": len([r for r in rows if r["target"] != "Unknown"]),
    }
    write_csv(rows); write_json(rows, meta); write_md(rows, meta)
    write_html_bars(rows, meta); write_html_heatmap(rows, meta)
    print(f"[{CANCER}] clinical_programs={meta['clinical_total']} "
          f"preclinical_programs(unique drugs)={meta['preclinical_programs']} "
          f"targets={meta['n_targets']}")
    print(f"  전임상 초록 {pstats['preclin_abstracts']}건 중 식별약물 없음(기초연구/세포주만): "
          f"{meta['preclin_no_drug']}건 · 약물캐시 히트율 {meta['drug_cache_hit_pct']}%")
    print("wrote: crc_target_maturity.{csv,json,md,html(+_heatmap)}")
    print("\nTop 15 by maturity score  (pre=고유 전임상 약물):")
    for r in [x for x in rows if x["target"] != "Unknown"][:15]:
        print(f"  {r['maturity_score']:6.1f}  {r['target']:14s} pre={r['preclinical']:3d} "
              f"clin={r['clinical_total']:3d} max={r['max_phase']}  "
              f"(mentions={r['preclinical_mentions']})")

if __name__ == "__main__":
    main()
