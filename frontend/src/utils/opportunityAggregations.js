// Target Opportunity Map 집계 (재설계).
//   x = 임상 성숙도  : 단계 가중(전임상0.3·P1 1·P1/2 1.5·P2 2·P2/3 2.5·P3 3·P4 4)에
//                      진행상태 가중(완료 보너스·중단 페널티)을 곱한 값의 '데이터 포인트 평균'
//   y = 최신성       : 임상·초록·논문 발표의 연도 시간감쇠 '평균'(최신일수록 1에 근접)
//   버블 크기 = 총 발표 수 (임상 + 초록 + 논문)
//   색 = 추세        : 최근2년/과거2년 성장비
// 논문(publications)도 초록과 함께 연구 신호에 포함. (성숙도 탭은 초록만 유지 — 중복 방지)

import { PHASE_ORDER, phaseBucket, statusBucket, canonTarget } from './maturityAggregations'

// 단계 가중 — build_matrix.py 의 성숙도 모델과 동일
export const PHASE_WEIGHT = { Preclinical: 0.3, P1: 1, 'P1/2': 1.5, P2: 2, 'P2/3': 2.5, P3: 3, P4: 4 }
// 진행상태 가중 — 완료=통과(보너스), 진행=현재단계, 중단=실패(페널티)
export const STATUS_WEIGHT = { completed: 1.15, ongoing: 1.0, unknown: 0.9, stopped: 0.5 }

// x축 눈금(성숙도 스코어): 전임상 0.3 ~ P4 4
export const X_TICKS = [
  { v: 0.3, label: '전임상' }, { v: 1, label: 'P1' }, { v: 2, label: 'P2' },
  { v: 3, label: 'P3' }, { v: 4, label: 'P4' },
]

const DROP = new Set(['Unknown', 'DNA', 'RNA', 'N/A', 'NONE', '-'])

export function yearOf(v) {
  if (v == null) return 0
  const m = String(v).match(/\d{4}/)
  return m ? Number(m[0]) : 0
}

export function deriveYearWindows(records) {
  let maxYear = 0
  for (const r of records ?? []) {
    const y = yearOf(r.year)
    if (y > maxYear) maxYear = y
  }
  if (!maxYear) maxYear = new Date().getFullYear()
  return { maxYear, recent: new Set([maxYear, maxYear - 1]), early: new Set([maxYear - 4, maxYear - 3]), newSince: maxYear - 2 }
}

// ── 엔티티 누적기 (target 또는 biomarker 공용) ──
export function newAcc() {
  return {
    yr: new Map(), clin: 0, abs: 0, pub: 0,
    wSum: 0, wN: 0, maxIdx: 0,
    st: { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    modals: new Set(),
  }
}
const bump = (map, y) => { if (y) map.set(y, (map.get(y) ?? 0) + 1) }

// 문헌(초록/논문) 1건 반영: 발표 수 + 연도. isPub 로 초록/논문 구분.
export function addLiterature(acc, rec, isPub) {
  if (isPub) acc.pub += 1; else acc.abs += 1
  bump(acc.yr, yearOf(rec.year))
  for (const m of rec.modality_list ?? []) if (m) acc.modals.add(m)
}
// 임상 프로그램 1건 반영: 발표 수 + 성숙도(단계×상태) + 상태분해 + 시작연도.
export function addClinical(acc, d) {
  acc.clin += 1
  const sb = statusBucket(d.overall_status)
  acc.st[sb] += 1
  const pb = phaseBucket(d.phase)
  if (pb !== 'NA') {
    acc.wSum += PHASE_WEIGHT[pb] * STATUS_WEIGHT[sb]
    acc.wN += 1
    const idx = PHASE_ORDER.indexOf(pb)
    if (idx > acc.maxIdx) acc.maxIdx = idx
  }
  bump(acc.yr, yearOf(d.start_date))
}

// 누적기 → 행. W: year windows.
export function finalizeRow(name, acc, W) {
  let early = 0, recent = 0
  for (const [y, n] of acc.yr) { if (W.early.has(y)) early += n; if (W.recent.has(y)) recent += n }
  const growth = Math.round(((recent + 1) / (early + 1)) * 100) / 100
  const hasResearch = acc.abs + acc.pub > 0
  // 임상 성숙도: 임상 데이터 포인트(단계 인식된 것)의 평균 (단계×상태). 임상 없으면 전임상 0.3.
  const clinMaturity = acc.wN > 0
    ? Math.round((acc.wSum / acc.wN) * 100) / 100
    : (hasResearch ? PHASE_WEIGHT.Preclinical : 0)
  return {
    target: name,
    clin_maturity: clinMaturity,
    max_phase: acc.maxIdx ? PHASE_ORDER[acc.maxIdx] : (hasResearch ? 'Preclinical' : 'NA'),
    clinical_total: acc.clin,
    clin_ongoing: acc.st.ongoing, clin_completed: acc.st.completed, clin_stopped: acc.st.stopped,
    abstract_count: acc.abs, pub_count: acc.pub,
    size_total: acc.clin + acc.abs + acc.pub, // 버블 크기 = 총 발표 수
    modalities: acc.modals.size,
    year_counts: Object.fromEntries(acc.yr), // 최신성/추세 계산용
    early, recent, growth_ratio: growth,
  }
}

// ── Target 빌더 ──
export function buildOpportunityRows(drugs, abstracts, publications, { targetCanon = {} } = {}) {
  const M = new Map()
  const acc = (t) => { let a = M.get(t); if (!a) { a = newAcc(); M.set(t, a) } return a }

  const addLit = (records, isPub) => {
    for (const r of records ?? []) {
      const seen = new Set()
      for (const raw of r.target_list ?? []) {
        const t = canonTarget(raw, targetCanon)
        if (DROP.has(t) || seen.has(t)) continue
        seen.add(t); addLiterature(acc(t), r, isPub)
      }
    }
  }
  addLit(abstracts, false)
  addLit(publications, true)
  for (const d of drugs ?? []) {
    const t = canonTarget(d.target, targetCanon)
    if (DROP.has(t)) continue
    addClinical(acc(t), d)
  }

  const W = deriveYearWindowsFromAcc(M)
  const rows = []
  for (const [t, a] of M) { if (!DROP.has(t)) rows.push(finalizeRow(t, a, W)) }
  rows.sort((a, b) => b.recent - a.recent || b.size_total - a.size_total)
  return rows
}

// 누적기들의 연도에서 window 도출 (임상 시작연도까지 포함)
export function deriveYearWindowsFromAcc(M) {
  let maxYear = 0
  for (const a of M.values()) for (const y of a.yr.keys()) if (y > maxYear) maxYear = y
  if (!maxYear) maxYear = new Date().getFullYear()
  return { maxYear, recent: new Set([maxYear, maxYear - 1]), early: new Set([maxYear - 4, maxYear - 3]), newSince: maxYear - 2 }
}

export const HALFLIFE_DEFAULT = 2 // 년. 최신성 반감기

// 최신성 y = 발표들의 연도 시간감쇠 '평균' (0~1, 최신일수록 1). 볼륨과 무관(크기가 볼륨 담당).
export function applyRecency(rows, { halfLife = HALFLIFE_DEFAULT, maxYear } = {}) {
  const my = maxYear ?? Math.max(0, ...rows.flatMap((r) => Object.keys(r.year_counts || {}).map(Number)))
  const hl = halfLife > 0 ? halfLife : HALFLIFE_DEFAULT
  return rows.map((r) => {
    let wsum = 0, n = 0
    for (const [y, c] of Object.entries(r.year_counts || {})) {
      wsum += c * Math.pow(0.5, (my - Number(y)) / hl); n += c
    }
    return { ...r, recency: n ? Math.round((wsum / n) * 1000) / 1000 : 0 }
  })
}

export const EMERGE_DEFAULTS = { minRecent: 4, minGrowth: 1.3, maxMaturity: 2.0 } // 성숙도 ≤ 2(≈P2)

// 부상 판정(필터): 최근 발표 충분 · 상승 추세 · 아직 임상 성숙도 낮음.
export function flagEmerging(rows, thr = EMERGE_DEFAULTS) {
  const { minRecent, minGrowth, maxMaturity } = { ...EMERGE_DEFAULTS, ...thr }
  return rows.map((r) => ({
    ...r,
    emerging: r.recent >= minRecent && r.growth_ratio >= minGrowth && r.clin_maturity <= maxMaturity && r.size_total > 0,
  }))
}
