#!/usr/bin/env python3
"""
Target Opportunity Map  (프로토타입)
====================================
기존 maturity_score(가중 합산)의 대안. 목적: '성숙한 타깃'이 아니라
'새로 주목받는 미성숙 타깃'을 전략적으로 발굴한다.

원칙
  - 데이터를 곱하거나 하나의 점수로 접지 않는다(가중치 없음).
  - 타깃을 2축에 '있는 그대로' 배치한다:
        x = 임상 성숙도   (도달한 최고 임상 단계)
        y = 전임상 연구 강도 (그 타깃을 다루는 '고유 기관 수')
  - 발굴 엔진은 절대량이 아니라 '속도(velocity)와 신규성'.

소스
  - data/parsed/abstracts_*.json  : 학회 초록(AACR/ASCO/ESMO). phase 없음 = 전임상.
  - data/frontend/pipeline.json   : 임상(ClinicalTrials.gov).

출력 (analysis/crc_target_maturity/)
  - opportunity_map.csv           : 타깃별 원본 지표 + 신·구 렌즈 비교
  - opportunity_map.html          : 기회 지도 산점도(인라인 SVG)

기존 build_matrix.py 의 정규화/집계를 그대로 재사용(중복 방지).
"""
import json, glob, csv, os, collections, html, math

import build_matrix as bm   # norm_target, is_cancer, phase_bucket, PHASE_ORDER, load_*, aggregate

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = bm.ROOT
CANCER = bm.CANCER

# 시간 창(window): 최근 2년 vs 과거 2년 — 성장비(velocity) 계산용
EARLY_YEARS  = {2022, 2023}
RECENT_YEARS = {2025, 2026}
NEW_SINCE    = 2024   # 이 해 이후 '첫 등장'이면 신규 타깃 플래그

# '뜨는 신규/부상' 판정 기준(가중치가 아니라 필터)
EMERGE_MIN_RECENT = 8     # 최근 2년 초록 ≥ 8 (충분한 주목)
EMERGE_MIN_GROWTH = 1.5   # 성장비 ≥ 1.5 (상승 추세)
EMERGE_MAX_PHASEIDX = 2   # 임상 최고단계 ≤ P1/2 (아직 초기)  (0=없음,1=P1,2=P1/2,...)

DROP = {"Unknown", "DNA", "RNA", "N/A", "NONE", "-"}


def load_preclinical_intensity():
    """phase 없는 암종 초록 → 타깃별 원본 지표(약물 카운트 아님, 연구 강도)."""
    orgs      = collections.defaultdict(set)   # target -> {회사/기관}
    modals    = collections.defaultdict(set)   # target -> {모달리티}
    yr_counts = collections.defaultdict(lambda: collections.Counter())  # target -> {year: n}
    orgs_early = collections.defaultdict(set)  # 과거 창에 등장한 기관
    orgs_recent = collections.defaultdict(set) # 최근 창에 등장한 기관
    abstracts = collections.Counter()          # target -> phase-less 초록 수
    first_year = {}                            # target -> 최초 등장 연도

    for f in glob.glob(os.path.join(ROOT, "data/parsed/abstracts_*.json")):
        for a in json.load(open(f)).get("abstracts", []):
            if not bm.is_cancer(a) or a.get("phase"):
                continue
            yr = a.get("year")
            tl = {bm.norm_target(t) or "Unknown" for t in (a.get("target_list") or [])}
            tl = {t for t in tl if t not in DROP}
            if not tl:
                continue
            co = [c for c in (a.get("companies_normalized") or a.get("companies") or []) if c]
            md = [m for m in (a.get("modality_list") or []) if m]
            for t in tl:
                abstracts[t] += 1
                if yr is not None:
                    yr_counts[t][yr] += 1
                    if first_year.get(t) is None or yr < first_year[t]:
                        first_year[t] = yr
                orgs[t].update(co)
                modals[t].update(md)
                if yr in EARLY_YEARS:
                    orgs_early[t].update(co)
                if yr in RECENT_YEARS:
                    orgs_recent[t].update(co)
    return dict(orgs=orgs, modals=modals, yr_counts=yr_counts, abstracts=abstracts,
                orgs_early=orgs_early, orgs_recent=orgs_recent, first_year=first_year)


def load_clinical_shape():
    """임상: 타깃별 phase 분포 + 최고단계 인덱스 + 총 프로그램 수."""
    shape = collections.defaultdict(lambda: collections.Counter())
    for x in json.load(open(os.path.join(ROOT, "data/frontend/pipeline.json")))["drugs"]:
        if not bm.is_cancer(x):
            continue
        tgt = bm.norm_target(x.get("target")) or "Unknown"
        if tgt in DROP:
            continue
        shape[tgt][bm.phase_bucket(x.get("phase"))] += 1
    out = {}
    for tgt, ph in shape.items():
        idx = 0
        for i, p in enumerate(bm.PHASE_ORDER[1:], start=1):   # P1..P4
            if ph.get(p, 0) > 0:
                idx = max(idx, i)
        out[tgt] = {"phase": ph, "max_phase_idx": idx,
                    "max_phase": bm.PHASE_ORDER[idx] if idx else "NA",
                    "clinical_total": sum(ph.values())}
    return out


def build_rows():
    pre = load_preclinical_intensity()
    clin = load_clinical_shape()

    # 구(舊) 렌즈: 기존 가중 maturity_score 재현(비교용)
    old_clin = bm.load_clinical()
    old_pre, old_mentions, _ = bm.load_preclinical()
    old_rows = {r["target"]: r for r in bm.aggregate(old_clin, old_pre, old_mentions)}

    targets = set(pre["abstracts"]) | set(clin)
    rows = []
    for t in targets:
        if t in DROP:
            continue
        yrc = pre["yr_counts"].get(t, {})
        early  = sum(yrc.get(y, 0) for y in EARLY_YEARS)
        recent = sum(yrc.get(y, 0) for y in RECENT_YEARS)
        growth = round((recent + 1) / (early + 1), 2)          # 스무딩된 성장비
        norgs  = len(pre["orgs"].get(t, ()))
        new_orgs = len(pre["orgs_recent"].get(t, set()) - pre["orgs_early"].get(t, set()))
        c = clin.get(t, {"max_phase_idx": 0, "max_phase": "NA", "clinical_total": 0})
        fy = pre["first_year"].get(t)

        emerging = (recent >= EMERGE_MIN_RECENT and growth >= EMERGE_MIN_GROWTH
                    and c["max_phase_idx"] <= EMERGE_MAX_PHASEIDX)
        brand_new = (fy is not None and fy >= NEW_SINCE)

        old = old_rows.get(t, {})
        rows.append({
            "target": t,
            # --- 임상(있는 그대로) ---
            "clinical_total": c["clinical_total"],
            "max_phase": c["max_phase"],
            "clin_maturity_idx": c["max_phase_idx"],       # x축
            # --- 전임상 연구 강도(있는 그대로) ---
            "pre_orgs": norgs,                             # y축(주 신호)
            "pre_abstracts": pre["abstracts"].get(t, 0),
            "pre_modalities": len(pre["modals"].get(t, ())),
            # --- 속도 / 신규성 ---
            "early_22_23": early,
            "recent_25_26": recent,
            "growth_ratio": growth,
            "new_entrant_orgs": new_orgs,
            "first_year": fy or "",
            "emerging": int(emerging),
            "brand_new": int(brand_new),
            # --- 참고: 구 렌즈 ---
            "old_maturity_score": old.get("maturity_score", 0),
            "old_preclinical_drugs": old.get("preclinical", 0),
        })
    return rows


# ------------------------------------------------------------------ writers
def write_csv(rows):
    cols = ["target", "emerging", "brand_new", "clin_maturity_idx", "max_phase",
            "clinical_total", "pre_orgs", "pre_abstracts", "pre_modalities",
            "early_22_23", "recent_25_26", "growth_ratio", "new_entrant_orgs",
            "first_year", "old_maturity_score", "old_preclinical_drugs"]
    with open(os.path.join(HERE, "opportunity_map.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in sorted(rows, key=lambda r: (-r["emerging"], -r["recent_25_26"])):
            w.writerow(r)


def write_html(rows):
    """기회 지도: x=임상 성숙도, y=전임상 기관수(log). 색=성장비. 크기=초록수."""
    pts = [r for r in rows if r["pre_orgs"] > 0 or r["clinical_total"] > 0]
    W, H = 1080, 720
    padL, padR, padT, padB = 90, 40, 60, 90
    plotW, plotH = W - padL - padR, H - padT - padB

    xmax = 6                                    # P4
    ymax = max((r["pre_orgs"] for r in pts), default=1)
    def X(idx, jit=0.0):
        return padL + (idx + jit) / xmax * plotW
    def Y(n):
        return padT + plotH - (math.log1p(n) / math.log1p(ymax)) * plotH
    def color(g):                               # 성장비 → 파랑(식음)~빨강(뜸)
        t = max(0.0, min(1.0, (g - 0.5) / 2.0)) # 0.5→0, 2.5→1
        r = int(0x33 + (0xC1 - 0x33) * t); g_ = int(0x77 + (0x00 - 0x77) * t)
        b = int(0xCC + (0x00 - 0xCC) * t)
        return f"#{r:02x}{g_:02x}{b:02x}"
    def rad(n):
        return 3 + math.sqrt(n) * 0.9

    svg = [f'<svg width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" '
           f'font-family="-apple-system,Segoe UI,sans-serif">']
    # 사분면 배경(왼쪽 위 = 기회 존)
    xmid, ymid = X(2.0), Y(max(1, ymax) ** 0.5)
    svg.append(f'<rect x="{padL}" y="{padT}" width="{xmid-padL}" height="{ymid-padT}" '
               f'fill="#fff5f5"/>')
    svg.append(f'<text x="{padL+12}" y="{padT+22}" font-size="13" font-weight="700" '
               f'fill="#c10000">★ 부상 / 화이트스페이스</text>')
    svg.append(f'<text x="{padL+12}" y="{padT+40}" font-size="11" fill="#c96">'
               f'연구 활발 · 임상 미진</text>')
    # 축
    svg.append(f'<line x1="{padL}" y1="{padT+plotH}" x2="{padL+plotW}" y2="{padT+plotH}" stroke="#333"/>')
    svg.append(f'<line x1="{padL}" y1="{padT}" x2="{padL}" y2="{padT+plotH}" stroke="#333"/>')
    for i, lab in enumerate(bm.PHASE_ORDER):    # 0..6 = 없음/Preclinical..P4 -> x눈금
        lbl = "임상없음" if i == 0 else lab
        svg.append(f'<text x="{X(i):.0f}" y="{padT+plotH+20}" font-size="10" fill="#666" '
                   f'text-anchor="middle">{lbl}</text>')
    for n in (1, 3, 10, 30, 100):
        if n <= ymax:
            svg.append(f'<text x="{padL-10}" y="{Y(n)+4:.0f}" font-size="10" fill="#666" '
                       f'text-anchor="end">{n}</text>')
            svg.append(f'<line x1="{padL}" y1="{Y(n):.0f}" x2="{padL+plotW}" y2="{Y(n):.0f}" stroke="#f0f0f0"/>')
    svg.append(f'<text x="{padL+plotW/2:.0f}" y="{H-30}" font-size="13" font-weight="600" '
               f'text-anchor="middle">임상 성숙도 (도달 최고단계) →</text>')
    svg.append(f'<text x="24" y="{padT+plotH/2:.0f}" font-size="13" font-weight="600" '
               f'text-anchor="middle" transform="rotate(-90 24 {padT+plotH/2:.0f})">'
               f'전임상 연구 강도 (고유 기관 수, log) →</text>')

    # 점 — 겹침 완화용 결정적 지터(타깃명 해시)
    label_pts = sorted(pts, key=lambda r: -(r["pre_orgs"] + r["clinical_total"]))
    labeled = set(r["target"] for r in label_pts[:28]) | set(
        r["target"] for r in pts if r["emerging"])
    for r in pts:
        jit = ((hash(r["target"]) % 100) / 100 - 0.5) * 0.7
        x, y = X(r["clin_maturity_idx"], jit), Y(r["pre_orgs"])
        rr = rad(r["pre_abstracts"])
        stroke = '#c10000' if r["emerging"] else '#8894a4'
        sw = 2.2 if r["emerging"] else 0.6
        tip = (f'{r["target"]} — 기관 {r["pre_orgs"]} · 초록 {r["pre_abstracts"]} · '
               f'모달 {r["pre_modalities"]} · 최근/과거 {r["recent_25_26"]}/{r["early_22_23"]} '
               f'(성장 {r["growth_ratio"]}) · 임상 {r["clinical_total"]}({r["max_phase"]})'
               + (' · 신규진입기관 %d' % r["new_entrant_orgs"] if r["new_entrant_orgs"] else '')
               + (' · ★부상' if r["emerging"] else '') + (' · 🆕' if r["brand_new"] else ''))
        svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rr:.1f}" fill="{color(r["growth_ratio"])}" '
                   f'fill-opacity="0.55" stroke="{stroke}" stroke-width="{sw}">'
                   f'<title>{html.escape(tip)}</title></circle>')
        if r["target"] in labeled:
            fw = "700" if r["emerging"] else "400"
            fc = "#c10000" if r["emerging"] else "#333"
            svg.append(f'<text x="{x+rr+2:.1f}" y="{y+3:.1f}" font-size="10" font-weight="{fw}" '
                       f'fill="{fc}">{html.escape(r["target"])}'
                       + ('🆕' if r["brand_new"] else '') + '</text>')
    svg.append("</svg>")
    svg = "\n".join(svg)

    doc = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>{CANCER} 타깃 기회 지도</title>
<style>
 body{{font-family:-apple-system,Segoe UI,sans-serif;margin:32px;color:#1a1a1a;max-width:1160px}}
 h1{{color:#c10000;margin-bottom:4px}} .meta{{color:#555;font-size:13px;line-height:1.7}}
 .legend{{font-size:12px;color:#555;margin:8px 0 4px}} b{{color:#c10000}}
</style></head><body>
<h1>{CANCER} 타깃 기회 지도 (프로토타입)</h1>
<div class="meta">
 가중치 없음 — 두 원본 지표를 축에 그대로 배치.
 <b>x</b>=임상 도달 최고단계 · <b>y</b>=전임상 고유 기관 수(log) ·
 점 크기=초록 수 · 색=성장비(<span style="color:#3377cc">파랑=식음</span>→<span style="color:#c10000">빨강=뜸</span>) ·
 <b>빨강 테두리=부상 타깃</b> · 🆕={NEW_SINCE}년 이후 첫 등장<br>
 왼쪽 위 핑크 영역 = 연구는 활발하나 임상은 미진한 <b>화이트스페이스</b>.
 소스: AACR/ASCO/ESMO 초록 + ClinicalTrials.gov
</div>
<div class="legend">부상 판정: 최근2년 초록 ≥ {EMERGE_MIN_RECENT} · 성장비 ≥ {EMERGE_MIN_GROWTH} · 임상 ≤ P1/2</div>
{svg}
</body></html>"""
    open(os.path.join(HERE, "opportunity_map.html"), "w").write(doc)


def main():
    rows = build_rows()
    write_csv(rows)
    write_html(rows)

    old_top = sorted(rows, key=lambda r: -r["old_maturity_score"])[:15]
    emerging = sorted([r for r in rows if r["emerging"]],
                      key=lambda r: -(r["recent_25_26"] * r["growth_ratio"]))
    newest = sorted([r for r in rows if r["brand_new"] and r["pre_orgs"] >= 3],
                    key=lambda r: -r["recent_25_26"])[:12]

    print(f"[{CANCER}] targets={len(rows)}  emerging={len(emerging)}")
    print("\n=== 구(舊) 렌즈: maturity_score 상위 15 (성숙 타깃이 위로) ===")
    print(f"{'target':16s}{'score':>7} {'clin':>5} {'maxP':>6} {'orgs':>5} {'grow':>6}")
    for r in old_top:
        print(f"{r['target'][:15]:16s}{r['old_maturity_score']:7.1f} {r['clinical_total']:5d} "
              f"{r['max_phase']:>6} {r['pre_orgs']:5d} {r['growth_ratio']:6.2f}")

    print("\n=== 신(新) 렌즈: 부상/뜨는 신규 타깃 (연구 활발 · 임상 초기 · 상승) ===")
    print(f"{'target':16s}{'orgs':>5}{'abstr':>6}{'25-26':>6}{'22-23':>6}{'grow':>6}"
          f"{'newOrg':>7}{'maxP':>6}{'first':>6}")
    for r in emerging[:20]:
        print(f"{r['target'][:15]:16s}{r['pre_orgs']:5d}{r['pre_abstracts']:6d}"
              f"{r['recent_25_26']:6d}{r['early_22_23']:6d}{r['growth_ratio']:6.2f}"
              f"{r['new_entrant_orgs']:7d}{r['max_phase']:>6}{str(r['first_year']):>6}"
              + ("  🆕" if r["brand_new"] else ""))

    if newest:
        print(f"\n=== 🆕 {NEW_SINCE}년 이후 첫 등장 & 기관 ≥3 (완전 신규 관심) ===")
        for r in newest:
            print(f"  {r['target'][:15]:16s} 기관 {r['pre_orgs']:3d} · 최근 {r['recent_25_26']:3d}건 · "
                  f"모달 {r['pre_modalities']} · 임상 {r['clinical_total']}({r['max_phase']})")

    print("\nwrote: opportunity_map.{csv,html}")


if __name__ == "__main__":
    main()
