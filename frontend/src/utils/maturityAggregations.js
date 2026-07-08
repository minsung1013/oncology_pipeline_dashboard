// Target Maturity 집계 — 필터된 임상 약물(pipeline) + 필터된 전임상 초록을 target별로 통합.
// 임상: 각 약물 = 1 프로그램, phase×status 버킷. 전임상: 초록 drugs_mentioned 를
// maturity_drug_targets(약물→target) 로 조회 → 세포주 제외 + 고유 약물(프로그램) 카운트.
// build_matrix.py 의 버킷/정규화와 동일 체계.

export const PHASE_ORDER = ['Preclinical', 'P1', 'P1/2', 'P2', 'P2/3', 'P3', 'P4']

// 1상 녹색 · 2상 노랑 · 3상 오렌지 · 4상 빨강 (중간단계는 사이색, 전임상 그레이)
export const PHASE_COLORS = {
  Preclinical: '#b0b8c4',
  P1: '#2fa84f',
  'P1/2': '#8ec63f',
  P2: '#f5d020',
  'P2/3': '#f0a020',
  P3: '#ee7911',
  P4: '#d0021b',
}
export const PHASE_DARK_TEXT = new Set(['Preclinical', 'P1/2', 'P2', 'P2/3'])

const ONGOING = new Set(['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION'])
const COMPLETED = new Set(['COMPLETED'])
const STOPPED = new Set(['TERMINATED', 'WITHDRAWN', 'SUSPENDED'])

export function statusBucket(s) {
  s = (s || '').toUpperCase()
  if (ONGOING.has(s)) return 'ongoing'
  if (COMPLETED.has(s)) return 'completed'
  if (STOPPED.has(s)) return 'stopped'
  return 'unknown'
}

export function phaseBucket(p) {
  p = (p || '').toUpperCase()
  if (p === 'EARLY_PHASE1' || p === 'PHASE1') return 'P1'
  if (p === 'PHASE1/PHASE2') return 'P1/2'
  if (p === 'PHASE2') return 'P2'
  if (p === 'PHASE2/PHASE3') return 'P2/3'
  if (p === 'PHASE3') return 'P3'
  if (p === 'PHASE4') return 'P4'
  return 'NA'
}

// raw target → canonical (canon 맵 없거나 미등록이면 원본 유지, 'Unknown' 보존)
export function canonTarget(raw, canon) {
  if (!raw) return 'Unknown'
  return canon?.[raw] ?? raw
}

// canonical → [raw variants]  (막대 클릭 시 raw 값들로 필터 걸기 위한 역맵)
export function invertCanon(canon) {
  const inv = {}
  for (const [raw, c] of Object.entries(canon || {})) {
    (inv[c] ??= []).push(raw)
  }
  return inv
}

const CLINICAL_PHASES = ['P1', 'P1/2', 'P2', 'P2/3', 'P3', 'P4']

function emptyCell() {
  return {
    Preclinical: new Set(), // 고유 약물명
    P1: { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    'P1/2': { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    P2: { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    'P2/3': { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    P3: { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    P4: { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
  }
}

// 필터된 임상 약물 + 필터된 전임상 초록 → 성숙도 행 배열(전체 개수 내림차순)
// abstracts: 이미 filterAbstractsForVisualize 로 필터된 초록 (없으면 전임상 레이어 생략)
export function buildMaturityRows(drugs, abstracts, { drugTargets = {}, targetCanon = {} } = {}) {
  const cells = new Map()
  const cell = (t) => {
    if (!cells.has(t)) cells.set(t, emptyCell())
    return cells.get(t)
  }

  // 임상: 약물당 1 프로그램
  for (const d of drugs) {
    const t = canonTarget(d.target, targetCanon)
    if (t === 'Unknown') continue
    const pb = phaseBucket(d.phase)
    if (pb === 'NA') continue
    cell(t)[pb][statusBucket(d.overall_status)] += 1
  }

  // 전임상: phase 없는 초록의 drugs_mentioned → 약물맵 조회 → 고유 약물 per target
  if (abstracts) {
    for (const a of abstracts) {
      if (a.phase) continue // phase 있으면 임상단계 초록 → 이중집계 방지 위해 제외
      for (const raw of a.drugs_mentioned ?? []) {
        const ent = drugTargets[(raw || '').trim().toLowerCase()]
        if (!ent) continue // 세포주/미등록 → 배제
        if (ent.t === 'Unknown') continue
        cell(ent.t).Preclinical.add((ent.n || raw).toLowerCase())
      }
    }
  }

  const rows = []
  for (const [target, c] of cells) {
    const row = { target, preclinical: c.Preclinical.size }
    let clinicalTotal = 0
    let maxIdx = 0
    for (let i = 0; i < CLINICAL_PHASES.length; i++) {
      const p = CLINICAL_PHASES[i]
      const b = c[p]
      const tot = b.ongoing + b.completed + b.stopped + b.unknown
      row[`${p}_ongoing`] = b.ongoing
      row[`${p}_completed`] = b.completed
      row[`${p}_stopped`] = b.stopped
      row[`${p}_total`] = tot
      clinicalTotal += tot
      if (tot > 0) maxIdx = i + 1 // PHASE_ORDER index (Preclinical=0)
    }
    row.clinical_total = clinicalTotal
    row.total_activity = row.preclinical + clinicalTotal
    row.max_phase = maxIdx ? PHASE_ORDER[maxIdx] : (row.preclinical ? 'Preclinical' : 'NA')
    rows.push(row)
  }
  rows.sort((a, b) => b.total_activity - a.total_activity || b.clinical_total - a.clinical_total)
  return rows
}

export function segCount(row, phase) {
  return phase === 'Preclinical' ? row.preclinical : row[`${phase}_total`]
}

// 막대 세그먼트 hover 상세 텍스트
export function segDetail(row, phase) {
  if (phase === 'Preclinical') return `전임상 고유 약물 ${row.preclinical}개`
  const o = row[`${phase}_ongoing`], c = row[`${phase}_completed`], s = row[`${phase}_stopped`]
  const parts = []
  if (o) parts.push(`진행 ${o}`)
  if (c) parts.push(`완료 ${c}`)
  if (s) parts.push(`중단 ${s}`)
  return parts.length ? `${phase}: 총 ${o + c + s} (${parts.join(', ')})` : ''
}
