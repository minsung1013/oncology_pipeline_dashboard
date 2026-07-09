// Biomarker Maturity / Opportunity 집계 — Target 판과 동일 로직, 키만 target → biomarker.
// 파이프라인 약물·초록 모두 biomarker_list(같은 enrichment 어휘)를 공유 → canon 불필요.
// 행의 식별 필드는 'target'(=biomarker 문자열)로 두어 TargetMaturityChart / TargetOpportunityMap 를 그대로 재사용.

import { PHASE_ORDER, phaseBucket, statusBucket } from './maturityAggregations'
import { newAcc, addLiterature, addClinical, finalizeRow, deriveYearWindowsFromAcc } from './opportunityAggregations'

const CLINICAL_PHASES = ['P1', 'P1/2', 'P2', 'P2/3', 'P3', 'P4']
const DROP = new Set(['', 'Unknown', 'N/A', 'NONE', '-'])

function emptyCell() {
  return {
    Preclinical: new Set(),
    P1: { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    'P1/2': { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    P2: { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    'P2/3': { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    P3: { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
    P4: { ongoing: 0, completed: 0, stopped: 0, unknown: 0 },
  }
}

// ── 성숙도: 임상=biomarker×phase×status, 전임상=phase 없는 초록의 고유 약물 per biomarker ──
export function buildBiomarkerMaturityRows(drugs, abstracts, { drugTargets = {} } = {}) {
  const cells = new Map()
  const cell = (b) => {
    if (!cells.has(b)) cells.set(b, emptyCell())
    return cells.get(b)
  }

  for (const d of drugs) {
    const pb = phaseBucket(d.phase)
    if (pb === 'NA') continue
    const st = statusBucket(d.overall_status)
    for (const b of d.biomarker_list ?? []) {
      if (DROP.has(b)) continue
      cell(b)[pb][st] += 1
    }
  }

  if (abstracts) {
    for (const a of abstracts) {
      if (a.phase) continue
      const bl = (a.biomarker_list ?? []).filter((b) => !DROP.has(b))
      if (!bl.length) continue
      for (const raw of a.drugs_mentioned ?? []) {
        const ent = drugTargets[(raw || '').trim().toLowerCase()]
        if (!ent) continue // 세포주/미등록 배제
        const drugName = (ent.n || raw).toLowerCase()
        for (const b of bl) cell(b).Preclinical.add(drugName)
      }
    }
  }

  const rows = []
  for (const [biomarker, c] of cells) {
    const row = { target: biomarker, preclinical: c.Preclinical.size }
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
      if (tot > 0) maxIdx = i + 1
    }
    row.clinical_total = clinicalTotal
    row.total_activity = row.preclinical + clinicalTotal
    row.max_phase = maxIdx ? PHASE_ORDER[maxIdx] : (row.preclinical ? 'Preclinical' : 'NA')
    rows.push(row)
  }
  rows.sort((a, b) => b.total_activity - a.total_activity || b.clinical_total - a.clinical_total)
  return rows
}

// ── 기회 지도(biomarker): x=임상 성숙도(단계×상태 평균), y=최신성, 크기=총 발표 수, 색=추세. 논문 포함. ──
export function buildBiomarkerOpportunityRows(drugs, abstracts, publications) {
  const M = new Map()
  const acc = (b) => { let a = M.get(b); if (!a) { a = newAcc(); M.set(b, a) } return a }

  const addLit = (records, isPub) => {
    for (const r of records ?? []) {
      const seen = new Set()
      for (const b of r.biomarker_list ?? []) {
        if (DROP.has(b) || seen.has(b)) continue
        seen.add(b); addLiterature(acc(b), r, isPub)
      }
    }
  }
  addLit(abstracts, false)
  addLit(publications, true)
  for (const d of drugs ?? []) {
    const seen = new Set()
    for (const b of d.biomarker_list ?? []) {
      if (DROP.has(b) || seen.has(b)) continue
      seen.add(b); addClinical(acc(b), d)
    }
  }

  const W = deriveYearWindowsFromAcc(M)
  const rows = []
  for (const [b, a] of M) { if (!DROP.has(b)) rows.push(finalizeRow(b, a, W)) }
  rows.sort((a, b) => b.recent - a.recent || b.size_total - a.size_total)
  return rows
}
