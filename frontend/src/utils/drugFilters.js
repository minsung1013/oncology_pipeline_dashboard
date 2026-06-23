// 통합 약물(파이프라인) 필터 — Pipeline·Visualize가 공유하는 단일 옵션빌더 + 필터함수.
// 같은 pipeline.json(drugs)을 다루므로 두 페이지가 동일한 필터 모델을 쓴다.

const PHASE_ORDER = ['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4', 'NA']

// 모든 약물 필터의 표준(canonical) 기본값 — 빈 필터.
export const DRUG_FILTER_DEFAULT = {
  // 다중선택 축
  companies: [], drugs: [], cancers: [], phases: [], modalities: [],
  targets: [], biomarkers: [], statuses: [],
  // 연도 범위
  startYear: { from: 'all', to: 'all' },
  completionYear: { from: 'all', to: 'all' },
  // 자유 검색
  keyword: '',
  // 파이프라인 전용 스칼라 (Visualize는 무시 — 기본값이면 통과)
  partnershipStatus: 'all',
  regimen: 'all',
  needsReview: false,
}

function byFrequency(drugs, extract) {
  const counts = new Map()
  for (const d of drugs) {
    const v = extract(d)
    const arr = Array.isArray(v) ? v : [v]
    for (const x of arr) if (x) counts.set(x, (counts.get(x) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

const yr = (v) => (v && v !== 'all' ? parseInt(v) : null)

// 각 축의 선택지. company/cancer/modality는 알파벳, drug/target/biomarker는 빈도순.
export function getDrugFilterOptions(drugs) {
  const companies = [...new Set(drugs.map((d) => d.company_normalized).filter(Boolean))].sort()
  const drugNames = byFrequency(drugs, (d) => d.drug_name)
  const cancers = [...new Set(drugs.map((d) => d.cancer_category).filter(Boolean))].sort()
  const modalities = [...new Set(drugs.map((d) => d.modality).filter(Boolean))].sort()
  const targets = byFrequency(drugs, (d) => (d.target && d.target !== 'Unknown' ? d.target : null))
  const biomarkers = byFrequency(drugs, (d) => d.biomarker_list ?? [])
  const statuses = [...new Set(drugs.map((d) => d.overall_status).filter(Boolean))]

  const phaseSet = new Set(drugs.flatMap((d) => d.phases ?? []).filter((p) => p && p !== 'UNKNOWN'))
  if (drugs.some((d) => { const p = d.phases ?? []; return p.length === 0 || p.every((v) => v === 'UNKNOWN') })) {
    phaseSet.add('NA')
  }
  const phases = [...phaseSet].sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b))

  const startYears = [...new Set(
    drugs.map((d) => parseInt(d.start_date?.slice(0, 4))).filter((y) => y > 2000 && y < 2040),
  )].sort((a, b) => a - b)
  const completionYears = [...new Set(
    drugs.map((d) => parseInt(d.primary_completion_date?.slice(0, 4))).filter((y) => y > 2000 && y < 2040),
  )].sort((a, b) => a - b)

  // 키 = 필터 축 키와 동일 (FilterBar config가 options[key]로 참조)
  return { companies, drugs: drugNames, cancers, phases, modalities, targets, biomarkers, statuses, startYears, completionYears }
}

// 표준 필터 적용. 파이프라인 전용 필드는 기본값이면 무해(Visualize 호환).
export function applyDrugFilters(drugs, f = {}) {
  const companies = new Set(f.companies ?? [])
  const drugSet = new Set(f.drugs ?? [])
  const cancers = new Set(f.cancers ?? [])
  const phases = new Set(f.phases ?? [])
  const mods = new Set(f.modalities ?? [])
  const targets = new Set(f.targets ?? [])
  const bios = new Set(f.biomarkers ?? [])
  const statuses = new Set(f.statuses ?? [])
  const sFrom = yr(f.startYear?.from), sTo = yr(f.startYear?.to)
  const cFrom = yr(f.completionYear?.from), cTo = yr(f.completionYear?.to)
  const kw = (f.keyword ?? '').trim().toLowerCase()
  const partnership = f.partnershipStatus ?? 'all'
  const regimen = f.regimen ?? 'all'
  const needsReview = !!f.needsReview

  return drugs.filter((d) => {
    if (companies.size > 0 && !companies.has(d.company_normalized)) return false
    if (drugSet.size > 0 && !drugSet.has(d.drug_name)) return false
    if (cancers.size > 0 && !cancers.has(d.cancer_category)) return false
    if (mods.size > 0 && !mods.has(d.modality)) return false
    if (targets.size > 0 && !targets.has(d.target)) return false
    if (bios.size > 0 && !(d.biomarker_list ?? []).some((b) => bios.has(b))) return false
    if (statuses.size > 0 && !statuses.has(d.overall_status)) return false
    if (phases.size > 0) {
      const dp = d.phases ?? []
      const isUn = dp.length === 0 || dp.every((p) => p === 'UNKNOWN')
      const ok = [...phases].some((p) => (p === 'NA' ? isUn || dp.includes('NA') : dp.includes(p)))
      if (!ok) return false
    }

    if (partnership !== 'all' && d.partnership_status !== partnership) return false
    if (regimen === 'mono' && d.is_combination) return false
    if (regimen === 'combo' && !d.is_combination) return false
    if (needsReview && d.target !== 'Unknown') return false

    if (sFrom !== null || sTo !== null) {
      const y = parseInt(d.start_date?.slice(0, 4))
      if (!y) return false
      if (sFrom !== null && y < sFrom) return false
      if (sTo !== null && y > sTo) return false
    }
    if (cFrom !== null || cTo !== null) {
      const y = parseInt(d.primary_completion_date?.slice(0, 4))
      if (!y) return false
      if (cFrom !== null && y < cFrom) return false
      if (cTo !== null && y > cTo) return false
    }

    if (kw) {
      const blob = [
        d.drug_name, ...(d.combo_drugs ?? []), d.company, d.company_normalized,
        d.target, d.modality, d.condition, d.cancer_category, d.official_title,
        d.brief_title, d.moa, d.overall_status,
        ...(d.biomarker_list ?? []), ...(d.collaborators ?? []),
        ...(d.primary_outcomes ?? []), ...(d.nct_ids ?? []),
      ].filter(Boolean).join(' ').toLowerCase()
      if (!blob.includes(kw)) return false
    }

    return true
  })
}

export function groupByCompany(drugs) {
  const map = {}
  for (const drug of drugs) {
    const co = drug.company || 'Unknown'
    if (!map[co]) map[co] = []
    map[co].push(drug)
  }
  return Object.entries(map)
    .map(([company, items]) => ({ company, count: items.length, drugs: items }))
    .sort((a, b) => b.count - a.count)
}
