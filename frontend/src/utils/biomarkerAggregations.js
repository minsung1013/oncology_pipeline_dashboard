// Biomarker Maturity / Opportunity 집계 — Target 판과 동일 로직, 키만 target → biomarker.
// 파이프라인 약물·초록 모두 biomarker_list(같은 enrichment 어휘)를 공유 → canon 불필요.
// 행의 식별 필드는 'target'(=biomarker 문자열)로 두어 TargetMaturityChart / TargetOpportunityMap 를 그대로 재사용.

import { PHASE_ORDER, phaseBucket, statusBucket } from './maturityAggregations'
import { deriveYearWindows } from './opportunityAggregations'

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

// ── 기회 지도: x=임상 최고단계, y=전임상 최신가중 강도(초록). biomarker 단위. ──
export function buildBiomarkerOpportunityRows(drugs, abstracts, win) {
  const W = win ?? deriveYearWindows(abstracts)

  const M = new Map()
  const rec = (b) => {
    let m = M.get(b)
    if (!m) {
      m = { orgs: new Set(), modals: new Set(), orgsEarly: new Set(), orgsRecent: new Set(), yr: new Map(), abstracts: 0, firstYear: null }
      M.set(b, m)
    }
    return m
  }

  if (abstracts) {
    for (const a of abstracts) {
      if (a.phase) continue
      const bl = (a.biomarker_list ?? []).filter((b) => !DROP.has(b))
      if (!bl.length) continue
      const cos = (a.companies_normalized?.length ? a.companies_normalized : a.companies) ?? []
      const md = a.modality_list ?? []
      const yr = a.year
      const seen = new Set()
      for (const b of bl) {
        if (seen.has(b)) continue
        seen.add(b)
        const m = rec(b)
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

  const clin = new Map()
  for (const d of drugs ?? []) {
    const pb = phaseBucket(d.phase)
    if (pb === 'NA') continue
    const idx = PHASE_ORDER.indexOf(pb)
    for (const b of d.biomarker_list ?? []) {
      if (DROP.has(b)) continue
      let c = clin.get(b)
      if (!c) { c = { maxIdx: 0, total: 0 }; clin.set(b, c) }
      c.total += 1
      if (idx > c.maxIdx) c.maxIdx = idx
    }
  }

  const biomarkers = new Set([...M.keys(), ...clin.keys()])
  const rows = []
  for (const b of biomarkers) {
    if (DROP.has(b)) continue
    const m = M.get(b)
    const c = clin.get(b) ?? { maxIdx: 0, total: 0 }
    let early = 0, recent = 0
    if (m) for (const [y, n] of m.yr) { if (W.early.has(y)) early += n; if (W.recent.has(y)) recent += n }
    const growth = Math.round(((recent + 1) / (early + 1)) * 100) / 100
    rows.push({
      target: b, // 식별 필드(=biomarker) — 차트/스캐터 재사용
      clinical_total: c.total,
      clin_maturity_idx: c.maxIdx,
      max_phase: c.maxIdx ? PHASE_ORDER[c.maxIdx] : (m ? 'Preclinical' : 'NA'),
      pre_orgs: m ? m.orgs.size : 0,
      pre_abstracts: m ? m.abstracts : 0,
      pre_modalities: m ? m.modals.size : 0,
      year_counts: m ? Object.fromEntries(m.yr) : {},
      early, recent, growth_ratio: growth,
      new_entrant_orgs: m ? [...m.orgsRecent].filter((o) => !m.orgsEarly.has(o)).length : 0,
      first_year: m?.firstYear ?? null,
      brand_new: m?.firstYear != null && m.firstYear >= W.newSince,
    })
  }
  rows.sort((a, b) => b.recent - a.recent || b.pre_orgs - a.pre_orgs)
  return rows
}
