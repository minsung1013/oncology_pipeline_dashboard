// Pipeline 시각화용 집계 함수 모음.
// 입력: filteredDrugs (pipeline.json drugs 일부), 출력: recharts용 [{name, count}] 등.
import { normalizeCountry, normalizeAffiliation } from './dataClean'

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
function topNFromCounts(counts, topN) {
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

export function aggregateByField(drugs, field, topN) {
  const counts = new Map()
  for (const d of drugs) {
    const key = d[field] || 'Unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return topNFromCounts(counts, topN)
}

// accessor가 약물당 여러 값(배열)을 반환 — 각 값에 1씩 카운트(회사: 메인+협력사).
export function aggregateByAccessor(drugs, accessor, topN) {
  const counts = new Map()
  for (const d of drugs) {
    const keys = accessor(d)
    for (const key of (keys && keys.length ? keys : ['Unknown'])) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return topNFromCounts(counts, topN)
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
  const kw = (f.keyword ?? '').trim().toLowerCase()
  return abstracts.filter((a) => {
    if (has(f.cancers) && !(a.cancer_category ?? []).some((c) => f.cancers.includes(c))) return false
    if (has(f.phases) && !(a.phases ?? []).some((p) => f.phases.includes(p))) return false
    if (has(f.modalities) && !(a.modality_list ?? []).some((m) => f.modalities.includes(m))) return false
    if (has(f.companies) && !(a.companies_normalized ?? []).some((c) => f.companies.includes(c))) return false
    if (has(f.targets) && !(a.target_list ?? []).some((t) => f.targets.includes(t))) return false
    if (has(f.biomarkers) && !(a.biomarker_list ?? []).some((b) => f.biomarkers.includes(b))) return false
    if (has(f.institutions) && !f.institutions.includes(normalizeAffiliation(a.authors?.[0]?.affiliation))) return false
    if (kw) {
      const blob = [
        a.title, a.author_raw, a.abstract_id,
        ...(a.target_list ?? []), ...(a.biomarker_list ?? []), ...(a.nct_ids ?? []),
        ...(a.drugs_mentioned ?? []), ...(a.companies_normalized ?? []), ...(a.cancer_category ?? []),
      ].filter(Boolean).join(' ').toLowerCase()
      if (!blob.includes(kw)) return false
    }
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

// ── Conference 시각화용 초록 집계 ─────────────────────────────────────────────
// 초록 리스트 필드(modality_list / target_list / biomarker_list / cancer_category /
// companies_normalized)를 평탄화해 빈도 카운트 → Top N + Other
export function aggregateAbstractListField(abstracts, field, topN, { excludeUnknown = false } = {}) {
  const counts = new Map()
  for (const a of abstracts) {
    for (const v of a[field] ?? []) {
      if (!v || (excludeUnknown && v === 'Unknown')) continue
      counts.set(v, (counts.get(v) ?? 0) + 1)
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

// 스칼라 필드(저널/출판유형 등) Top-N 카운트 (+ Other)
export function aggregateAbstractScalar(abstracts, accessor, topN, { excludeUnknown = false } = {}) {
  const counts = new Map()
  for (const a of abstracts) {
    const v = accessor(a)
    if (!v || (excludeUnknown && v === 'Unknown')) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  if (!topN || sorted.length <= topN) return sorted
  const top = sorted.slice(0, topN)
  const rest = sorted.slice(topN)
  const otherCount = rest.reduce((s, r) => s + r.count, 0)
  if (otherCount > 0) top.push({ name: `Other (${rest.length})`, count: otherCount, isOther: true })
  return top
}

// 연도별 단일 시리즈 카운트 [{year, [label]: n}] (학회별 분리 없는 by-year 막대용)
export function aggregateByYearSingle(abstracts, label = 'count') {
  const byYear = new Map()
  for (const a of abstracts) {
    if (!byYear.has(a.year)) byYear.set(a.year, { year: a.year, [label]: 0 })
    byYear.get(a.year)[label] += 1
  }
  return [...byYear.values()].sort((x, y) => x.year - y.year)
}

// 연도별 트렌드: 리스트 필드(cancer_category/modality_list/target_list/biomarker_list)의
// Top-N 값에 대해 연도별 초록(연구) 수를 집계 → recharts용 rows + keys.
// rows: [{year, [valueA]: n, [valueB]: n, ...}], keys: [valueA, valueB, ...]
export function aggregateTrendByYear(abstracts, field, topN = 8, { excludeUnknown = false } = {}) {
  const totals = new Map()
  for (const a of abstracts) {
    for (const v of a[field] ?? []) {
      if (!v || (excludeUnknown && v === 'Unknown')) continue
      totals.set(v, (totals.get(v) ?? 0) + 1)
    }
  }
  const keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k]) => k)
  const keySet = new Set(keys)
  const years = [...new Set(abstracts.map((a) => a.year).filter(Boolean))].sort((a, b) => a - b)
  const byYear = new Map(years.map((y) => [y, Object.fromEntries(keys.map((k) => [k, 0]))]))
  for (const a of abstracts) {
    const row = byYear.get(a.year)
    if (!row) continue
    const seen = new Set()
    for (const v of a[field] ?? []) {
      if (keySet.has(v) && !seen.has(v)) { row[v] += 1; seen.add(v) }
    }
  }
  const rows = years.map((y) => ({ year: y, ...byYear.get(y) }))
  return { rows, keys }
}

// 초록 교신저자 국가 분포 → Top N + Other
export function aggregateAbstractsByCountry(abstracts, topN) {
  const counts = new Map()
  for (const a of abstracts) {
    const c = normalizeCountry(a.authors?.[0]?.country)
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
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

// 초록 교신저자 소속 기관(대학/회사) 분포 → Top N + Other
export function aggregateAbstractsByInstitution(abstracts, topN) {
  const counts = new Map()
  for (const a of abstracts) {
    const inst = normalizeAffiliation(a.authors?.[0]?.affiliation)
    if (inst) counts.set(inst, (counts.get(inst) ?? 0) + 1)
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

// 초록 phase 분포 — phases 리스트를 개별 enum으로 분해(빈 건 NA), Pipeline과 동일 순서
export function aggregateAbstractsByPhase(abstracts) {
  const counts = new Map()
  for (const a of abstracts) {
    const enums = (a.phases ?? []).filter((p) => p && p !== 'UNKNOWN')
    for (const e of (enums.length ? enums : ['NA'])) {
      counts.set(e, (counts.get(e) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([raw, count]) => ({ name: phaseLabel(raw), raw, count }))
    .sort((a, b) => (PHASE_ENUM_ORDER.indexOf(a.raw) + 1 || 99) - (PHASE_ENUM_ORDER.indexOf(b.raw) + 1 || 99))
}

// Conference 요약 카드 통계
export function getAbstractSummaryStats(abstracts) {
  const companies = new Set()
  const cancers = new Set()
  const confYears = new Set()
  let withTherapeutic = 0
  for (const a of abstracts) {
    for (const c of a.companies_normalized ?? []) companies.add(c)
    for (const c of a.cancer_category ?? []) cancers.add(c)
    if (a.conference && a.year) confYears.add(`${a.conference} ${a.year}`)
    if ((a.modality_list ?? []).length) withTherapeutic += 1
  }
  return {
    total: abstracts.length,
    uniqueCompanies: companies.size,
    uniqueCancerTypes: cancers.size,
    datasets: confYears.size,
    therapeuticPct: abstracts.length ? Math.round((withTherapeutic / abstracts.length) * 100) : 0,
  }
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

