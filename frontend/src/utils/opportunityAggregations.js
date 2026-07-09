// Target Opportunity Map 집계 — '성숙한 타깃'이 아니라 '새로 주목받는 미성숙 타깃'을 발굴.
// 가중치 없음: 두 원본 지표를 그대로 축에 배치한다.
//   x = 임상 성숙도 (도달한 최고 임상 단계 인덱스)
//   y = 전임상 연구 강도 (그 타깃을 다루는 '고유 기관 수')
// 발굴 신호는 절대량이 아니라 속도(성장비)·신규성(첫 등장). 임계값은 프론트에서 조정.
// build_matrix.py / opportunity_map.py 파이썬 프로토타입과 동일 로직.

import { PHASE_ORDER, phaseBucket, canonTarget } from './maturityAggregations'

// x축 눈금 라벨 (clin_maturity_idx: 0=임상없음, 1=P1 … 6=P4)
export const CLIN_AXIS = ['임상없음', 'P1', 'P1/2', 'P2', 'P2/3', 'P3', 'P4']

const DROP = new Set(['Unknown', 'DNA', 'RNA', 'N/A', 'NONE', '-'])

// 시간 창을 데이터의 최신 연도에서 파생 → 해가 바뀌어도 자동 갱신.
// recent = {maxYear, maxYear-1}, early = {maxYear-4, maxYear-3}, newSince = maxYear-2
export function deriveYearWindows(abstracts) {
  let maxYear = 0
  for (const a of abstracts ?? []) {
    if (a.year && a.year > maxYear) maxYear = a.year
  }
  if (!maxYear) maxYear = new Date().getFullYear()
  return {
    maxYear,
    recent: new Set([maxYear, maxYear - 1]),
    early: new Set([maxYear - 4, maxYear - 3]),
    newSince: maxYear - 2,
  }
}

// 필터된 임상 약물 + 필터된 초록 → 타깃별 '원본 지표' 행 (임계값 미적용).
// 임계값과 무관하므로 데이터가 바뀔 때만 재계산하면 됨(슬라이더 조정은 flagEmerging 로 저렴하게).
export function buildOpportunityRows(drugs, abstracts, { targetCanon = {} } = {}, win) {
  const W = win ?? deriveYearWindows(abstracts)

  // ── 전임상: phase 없는 초록의 target_list → 기관/모달/연도 집계 ──
  const M = new Map()
  const rec = (t) => {
    let m = M.get(t)
    if (!m) {
      m = {
        orgs: new Set(), modals: new Set(),
        orgsEarly: new Set(), orgsRecent: new Set(),
        yr: new Map(), abstracts: 0, firstYear: null,
      }
      M.set(t, m)
    }
    return m
  }

  if (abstracts) {
    for (const a of abstracts) {
      if (a.phase) continue // phase 있으면 임상단계 초록 → 전임상 아님
      const tl = a.target_list ?? []
      if (!tl.length) continue
      const cos = (a.companies_normalized?.length ? a.companies_normalized : a.companies) ?? []
      const md = a.modality_list ?? []
      const yr = a.year
      const seen = new Set()
      for (const raw of tl) {
        const t = canonTarget(raw, targetCanon)
        if (DROP.has(t) || seen.has(t)) continue
        seen.add(t)
        const m = rec(t)
        m.abstracts += 1
        if (yr) {
          m.yr.set(yr, (m.yr.get(yr) ?? 0) + 1)
          if (m.firstYear === null || yr < m.firstYear) m.firstYear = yr
        }
        for (const c of cos) { if (c) { m.orgs.add(c); if (W.recent.has(yr)) m.orgsRecent.add(c); if (W.early.has(yr)) m.orgsEarly.add(c) } }
        for (const x of md) { if (x) m.modals.add(x) }
      }
    }
  }

  // ── 임상: 약물당 1 프로그램 → 타깃별 최고단계 인덱스 + 총 프로그램 수 ──
  const clin = new Map()
  for (const d of drugs ?? []) {
    const t = canonTarget(d.target, targetCanon)
    if (DROP.has(t)) continue
    const pb = phaseBucket(d.phase)
    if (pb === 'NA') continue
    const idx = PHASE_ORDER.indexOf(pb) // 1..6
    let c = clin.get(t)
    if (!c) { c = { maxIdx: 0, total: 0 }; clin.set(t, c) }
    c.total += 1
    if (idx > c.maxIdx) c.maxIdx = idx
  }

  // ── 병합 → 행 ──
  const targets = new Set([...M.keys(), ...clin.keys()])
  const rows = []
  for (const t of targets) {
    if (DROP.has(t)) continue
    const m = M.get(t)
    const c = clin.get(t) ?? { maxIdx: 0, total: 0 }
    let early = 0, recent = 0
    if (m) {
      for (const [y, n] of m.yr) { if (W.early.has(y)) early += n; if (W.recent.has(y)) recent += n }
    }
    const growth = Math.round(((recent + 1) / (early + 1)) * 100) / 100
    rows.push({
      target: t,
      // 임상 (있는 그대로)
      clinical_total: c.total,
      clin_maturity_idx: c.maxIdx,
      max_phase: c.maxIdx ? PHASE_ORDER[c.maxIdx] : (m ? 'Preclinical' : 'NA'),
      // 전임상 연구 강도 (있는 그대로)
      pre_orgs: m ? m.orgs.size : 0,
      pre_abstracts: m ? m.abstracts : 0,
      pre_modalities: m ? m.modals.size : 0,
      // 연도별 초록 카운트 (최신 가중 강도 계산용 — applyRecencyWeight)
      year_counts: m ? Object.fromEntries(m.yr) : {},
      // 속도 / 신규성
      early, recent, growth_ratio: growth,
      new_entrant_orgs: m ? [...m.orgsRecent].filter((o) => !m.orgsEarly.has(o)).length : 0,
      first_year: m?.firstYear ?? null,
      brand_new: m?.firstYear != null && m.firstYear >= W.newSince,
    })
  }
  rows.sort((a, b) => b.recent - a.recent || b.pre_orgs - a.pre_orgs)
  return rows
}

export const HALFLIFE_DEFAULT = 2 // 년. 최신 가중 반감기 (2년 전 초록 = 1/2 가중)

// 최신 가중 연구 강도 — 초록을 연도 시간감쇠로 합산 → 연속 실수값(y축).
//   weighted = Σ_year  n(year) · 0.5^((maxYear − year) / halfLife)
// 이질 신호 합성이 아니라 '단일 신호(초록)에 시간 가중'(지수가중 이동합계).
export function applyRecencyWeight(rows, { halfLife = HALFLIFE_DEFAULT, maxYear } = {}) {
  const my = maxYear ?? Math.max(0, ...rows.flatMap((r) => Object.keys(r.year_counts || {}).map(Number)))
  const hl = halfLife > 0 ? halfLife : HALFLIFE_DEFAULT
  return rows.map((r) => {
    let w = 0
    for (const [y, n] of Object.entries(r.year_counts || {})) {
      w += n * Math.pow(0.5, (my - Number(y)) / hl)
    }
    return { ...r, pre_weighted: Math.round(w * 10) / 10 }
  })
}

export const EMERGE_DEFAULTS = { minRecent: 4, minGrowth: 1.3, maxPhaseIdx: 3 } // 완화된 기본값 (≤P2)

// 임계값(슬라이더) 적용 — 가중치가 아니라 '필터'. 저렴하므로 슬라이더 변경마다 호출.
export function flagEmerging(rows, thr = EMERGE_DEFAULTS) {
  const { minRecent, minGrowth, maxPhaseIdx } = { ...EMERGE_DEFAULTS, ...thr }
  return rows.map((r) => ({
    ...r,
    emerging:
      r.recent >= minRecent &&
      r.growth_ratio >= minGrowth &&
      r.clin_maturity_idx <= maxPhaseIdx &&
      r.pre_orgs > 0,
  }))
}
