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

const PHASE_ENUM_ORDER = ['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4', 'NA']

// 약물의 phase enum 집합 (콤보는 분해, 미상은 NA) — Pipeline/Conferences와 동일 체계
function drugPhaseEnums(d) {
  const enums = (d.phases ?? []).filter((p) => p && p !== 'UNKNOWN')
  return enums.length ? enums : ['NA']
}

// Phase × Status: 누적 막대용 — 개별 phase enum별로 status 카운트 (콤보 분해)
export function aggregateByPhaseStatus(drugs) {
  const byPhase = new Map()
  for (const d of drugs) {
    const st = d.overall_status || 'UNKNOWN'
    for (const e of drugPhaseEnums(d)) {
      if (!byPhase.has(e)) byPhase.set(e, { raw: e, name: phaseLabel(e), total: 0 })
      const row = byPhase.get(e)
      row[st] = (row[st] ?? 0) + 1
      row.total += 1
    }
  }
  return [...byPhase.values()].sort(
    (a, b) => (PHASE_ENUM_ORDER.indexOf(a.raw) + 1 || 99) - (PHASE_ENUM_ORDER.indexOf(b.raw) + 1 || 99),
  )
}

// 초록에 공유 필터(암종·단계·모달리티·회사·타겟·바이오마커) 적용 (리스트 필드는 교집합)
export function filterAbstractsForVisualize(abstracts, f) {
  const has = (sel) => sel && sel.length > 0
  return abstracts.filter((a) => {
    if (has(f.cancers) && !(a.cancer_category ?? []).some((c) => f.cancers.includes(c))) return false
    if (has(f.phases) && !(a.phases ?? []).some((p) => f.phases.includes(p))) return false
    if (has(f.modalities) && !(a.modality_list ?? []).some((m) => f.modalities.includes(m))) return false
    if (has(f.companies) && !(a.companies_normalized ?? []).some((c) => f.companies.includes(c))) return false
    if (has(f.targets) && !(a.target_list ?? []).some((t) => f.targets.includes(t))) return false
    if (has(f.biomarkers) && !(a.biomarker_list ?? []).some((b) => f.biomarkers.includes(b))) return false
    return true
  })
}

// 초록 → 연도×학회 카운트 [{year, ASCO, AACR}]
export function aggregateAbstractsByYear(abstracts) {
  const byYear = new Map()
  for (const a of abstracts) {
    if (!byYear.has(a.year)) byYear.set(a.year, { year: a.year })
    const row = byYear.get(a.year)
    row[a.conference] = (row[a.conference] ?? 0) + 1
  }
  return [...byYear.values()].sort((x, y) => x.year - y.year)
}

// manifest([{conference, year, count}]) → 동일 형태 (필터 미적용 시 총계)
export function manifestByYear(manifest) {
  const byYear = new Map()
  for (const m of manifest) {
    if (!byYear.has(m.year)) byYear.set(m.year, { year: m.year })
    byYear.get(m.year)[m.conference] = m.count
  }
  return [...byYear.values()].sort((x, y) => x.year - y.year)
}

// 초록(ASCO) 회사별 발표 수 — companies_normalized 리스트 평탄화 + Top N
export function aggregateAbstractsByCompany(abstracts, topN) {
  const counts = new Map()
  for (const a of abstracts) {
    for (const c of a.companies_normalized ?? []) {
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
  }
  const sorted = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
  if (!topN || sorted.length <= topN) return sorted
  const top = sorted.slice(0, topN)
  const rest = sorted.slice(topN)
  const otherCount = rest.reduce((s, r) => s + r.count, 0)
  if (otherCount > 0) top.push({ name: `Other (${rest.length})`, count: otherCount, isOther: true })
  return top
}

// Status: overall_status group-by count (라벨/색은 차트에서 STATUS_META로 매핑)
export function aggregateByStatus(drugs) {
  const counts = new Map()
  for (const d of drugs) {
    const key = d.overall_status || 'UNKNOWN'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts // Map<statusKey, count>
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

// 빈도순 옵션 목록 (값/배열값 모두 지원)
function byFrequency(drugs, extract) {
  const counts = new Map()
  for (const d of drugs) {
    const v = extract(d)
    const arr = Array.isArray(v) ? v : v ? [v] : []
    for (const x of arr) if (x) counts.set(x, (counts.get(x) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

// 필터 옵션: 각 축의 고유값
export function getVisualizeOptions(drugs) {
  const companies = [...new Set(drugs.map((d) => d.company_normalized).filter(Boolean))].sort()
  // drug/target/biomarker는 빈도순 (가장 흔한 것부터) — 스펙
  const drugNames = byFrequency(drugs, (d) => d.drug_name)
  const cancerCategories = [...new Set(drugs.map((d) => d.cancer_category).filter(Boolean))].sort()
  const phaseSet = new Set(drugs.flatMap((d) => d.phases ?? []).filter((p) => p && p !== 'UNKNOWN'))
  if (drugs.some((d) => { const p = d.phases ?? []; return p.length === 0 || p.every((v) => v === 'UNKNOWN') })) {
    phaseSet.add('NA')
  }
  const phases = [...phaseSet].sort(
    (a, b) => (PHASE_ENUM_ORDER.indexOf(a) + 1 || 99) - (PHASE_ENUM_ORDER.indexOf(b) + 1 || 99),
  )
  const modalities = [...new Set(drugs.map((d) => d.modality).filter(Boolean))].sort()
  const targets = byFrequency(drugs, (d) => (d.target && d.target !== 'Unknown' ? d.target : null))
  const biomarkers = byFrequency(drugs, (d) => d.biomarker_list ?? [])
  const statuses = [...new Set(drugs.map((d) => d.overall_status).filter(Boolean))]
  const startYears = [...new Set(
    drugs.map((d) => parseInt(d.start_date?.slice(0, 4))).filter((y) => y > 2000 && y < 2040),
  )].sort((a, b) => a - b)
  return { companies, drugNames, cancerCategories, phases, modalities, targets, biomarkers, statuses, startYears }
}

export function applyVisualizeFilters(drugs, filters) {
  const { companies, drugs: drugFilter, cancers, phases, modalities, targets, biomarkers, statuses, startYear } = filters
  const compSet = new Set(companies)
  const drugSet = new Set(drugFilter)
  const cancerSet = new Set(cancers)
  const phaseSet = new Set(phases)
  const modSet = new Set(modalities)
  const targetSet = new Set(targets)
  const bioSet = new Set(biomarkers)
  const statusSet = new Set(statuses)
  const from = startYear && startYear.from !== 'all' ? parseInt(startYear.from) : null
  const to = startYear && startYear.to !== 'all' ? parseInt(startYear.to) : null

  return drugs.filter((d) => {
    if (compSet.size > 0 && !compSet.has(d.company_normalized)) return false
    if (drugSet.size > 0 && !drugSet.has(d.drug_name)) return false
    if (cancerSet.size > 0 && !cancerSet.has(d.cancer_category)) return false
    if (phaseSet.size > 0) {
      const dp = d.phases ?? []
      const isUn = dp.length === 0 || dp.every((p) => p === 'UNKNOWN')
      const ok = [...phaseSet].some((p) => (p === 'NA' ? isUn || dp.includes('NA') : dp.includes(p)))
      if (!ok) return false
    }
    if (modSet.size > 0 && !modSet.has(d.modality)) return false
    if (targetSet.size > 0 && !targetSet.has(d.target)) return false
    if (bioSet.size > 0 && !(d.biomarker_list ?? []).some((b) => bioSet.has(b))) return false
    if (statusSet.size > 0 && !statusSet.has(d.overall_status)) return false
    if (from !== null || to !== null) {
      const y = parseInt(d.start_date?.slice(0, 4))
      if (!y) return false
      if (from !== null && y < from) return false
      if (to !== null && y > to) return false
    }
    return true
  })
}
