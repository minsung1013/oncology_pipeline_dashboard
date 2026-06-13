// Pipeline 시각화용 집계 함수 모음.
// 입력: filteredDrugs (pipeline.json drugs 일부), 출력: recharts용 [{name, count}] 등.

const PHASE_ORDER = ['EARLY_PHASE1', 'PHASE1', 'PHASE1/PHASE2', 'PHASE2', 'PHASE2/PHASE3', 'PHASE3', 'PHASE4', 'NA', 'UNKNOWN']

const PHASE_SHORT = {
  EARLY_PHASE1: 'Early Ph1',
  PHASE1: 'Ph1',
  PHASE2: 'Ph2',
  PHASE3: 'Ph3',
  PHASE4: 'Ph4',
  NA: 'N/A',
  UNKNOWN: 'Unknown',
}

// 콤보 라벨도 짧게: 'PHASE1/PHASE2' -> 'Ph1/Ph2'
export function phaseLabel(p) {
  if (!p) return 'Unknown'
  return p.split('/').map((x) => PHASE_SHORT[x] ?? x).join('/')
}

// 회사·암종·타겟 공용: field로 group-by count → Top N + Other
export function aggregateByField(drugs, field, topN) {
  const counts = new Map()
  for (const d of drugs) {
    const key = d[field] || 'Unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const sorted = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  if (!topN || sorted.length <= topN) return sorted

  const top = sorted.slice(0, topN)
  const rest = sorted.slice(topN)
  const otherCount = rest.reduce((sum, r) => sum + r.count, 0)
  if (otherCount > 0) top.push({ name: `Other (${rest.length})`, count: otherCount, isOther: true })
  return top
}

// Phase: 단일 phase 필드 기준 카운트 (콤보 라벨 그대로) — 스펙 §5②
export function aggregateByPhase(drugs) {
  const counts = new Map()
  for (const d of drugs) {
    const key = d.phase || 'UNKNOWN'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([raw, count]) => ({ name: phaseLabel(raw), raw, count }))
    .sort((a, b) => {
      const ai = PHASE_ORDER.indexOf(a.raw)
      const bi = PHASE_ORDER.indexOf(b.raw)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
}

// Modality: group-by count (Unknown 포함 — 스펙 §5④)
export function aggregateByModality(drugs) {
  const counts = new Map()
  for (const d of drugs) {
    const key = d.modality || 'Unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

// Biomarker: 언급 비율 + 상위 바이오마커
export function aggregateBiomarker(drugs) {
  let mentioned = 0
  const bioCounts = new Map()
  for (const d of drugs) {
    if (d.biomarker_mentioned) mentioned += 1
    for (const b of d.biomarker_list ?? []) {
      bioCounts.set(b, (bioCounts.get(b) ?? 0) + 1)
    }
  }
  const topBiomarkers = [...bioCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    mentioned,
    notMentioned: drugs.length - mentioned,
    topBiomarkers,
  }
}

// 요약 카드 통계
export function getSummaryStats(drugs) {
  const companies = new Set()
  const cancers = new Set()
  let biomarker = 0
  for (const d of drugs) {
    if (d.company) companies.add(d.company)
    if (d.cancer_category) cancers.add(d.cancer_category)
    if (d.biomarker_mentioned) biomarker += 1
  }
  return {
    total: drugs.length,
    uniqueCompanies: companies.size,
    uniqueCancerTypes: cancers.size,
    biomarkerPct: drugs.length ? Math.round((biomarker / drugs.length) * 100) : 0,
  }
}

// 필터 옵션: 회사·암종 고유값
export function getVisualizeOptions(drugs) {
  const companies = [...new Set(drugs.map((d) => d.company).filter(Boolean))].sort()
  const cancerCategories = [...new Set(drugs.map((d) => d.cancer_category).filter(Boolean))].sort()
  return { companies, cancerCategories }
}

export function applyVisualizeFilters(drugs, { companies, cancers }) {
  if (companies.length === 0 && cancers.length === 0) return drugs
  const compSet = new Set(companies)
  const cancerSet = new Set(cancers)
  return drugs.filter((d) =>
    (companies.length === 0 || compSet.has(d.company)) &&
    (cancers.length === 0 || cancerSet.has(d.cancer_category)),
  )
}
