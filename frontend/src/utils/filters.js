export function applyFilters(drugs, filters) {
  const {
    cancerCategories,
    modalities,
    phases,
    overallStatuses,
    companies,
    targets,
    biomarkers,
    partnershipStatus,
    regimen,
    needsReview,
    startYear,
    completionYear,
    keyword,
  } = filters

  return drugs.filter((drug) => {
    if (cancerCategories.length > 0 && !cancerCategories.includes(drug.cancer_category)) return false
    if (modalities.length > 0 && !modalities.includes(drug.modality)) return false
    if (companies?.length > 0 && !companies.includes(drug.company_normalized)) return false
    if (targets?.length > 0 && !targets.includes(drug.target)) return false
    if (biomarkers?.length > 0 && !(drug.biomarker_list ?? []).some((b) => biomarkers.includes(b))) return false
    if (phases.length > 0) {
      const drugPhases = drug.phases ?? []
      const isUnphased = drugPhases.length === 0 || drugPhases.every((p) => p === 'UNKNOWN')
      const hasMatch = phases.some((p) => {
        if (p === 'NA') return isUnphased || drugPhases.includes('NA')
        return drugPhases.includes(p)
      })
      if (!hasMatch) return false
    }
    if (overallStatuses.length > 0 && !overallStatuses.includes(drug.overall_status)) return false
    if (partnershipStatus !== 'all' && drug.partnership_status !== partnershipStatus) return false
    if (regimen === 'mono' && drug.is_combination) return false
    if (regimen === 'combo' && !drug.is_combination) return false
    if (needsReview && drug.target !== 'Unknown') return false

    if (startYear.from !== 'all' || startYear.to !== 'all') {
      const y = parseInt(drug.start_date?.slice(0, 4))
      if (!y) return false
      if (startYear.from !== 'all' && y < parseInt(startYear.from)) return false
      if (startYear.to !== 'all' && y > parseInt(startYear.to)) return false
    }

    if (completionYear.from !== 'all' || completionYear.to !== 'all') {
      const y = parseInt(drug.primary_completion_date?.slice(0, 4))
      if (!y) return false
      if (completionYear.from !== 'all' && y < parseInt(completionYear.from)) return false
      if (completionYear.to !== 'all' && y > parseInt(completionYear.to)) return false
    }

    if (keyword) {
      const q = keyword.toLowerCase()
      const searchable = [
        drug.drug_name,
        ...(drug.combo_drugs ?? []),
        drug.company,
        drug.target,
        drug.modality,
        drug.condition,
        drug.cancer_category,
        drug.official_title,
        drug.brief_title,
        drug.moa,
        drug.overall_status,
        ...(drug.biomarker_list ?? []),
        ...(drug.collaborators ?? []),
        ...(drug.primary_outcomes ?? []),
        ...(drug.nct_ids ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!searchable.includes(q)) return false
    }

    return true
  })
}

const PHASE_ORDER = ['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4', 'NA']

export function getFilterOptions(drugs) {
  const cancerCategories = [...new Set(drugs.map((d) => d.cancer_category).filter(Boolean))].sort()
  const modalities = [...new Set(drugs.map((d) => d.modality).filter(Boolean))].sort()
  const rawPhases = new Set(drugs.flatMap((d) => d.phases ?? []).filter((p) => p && p !== 'UNKNOWN'))
  const hasUnphased = drugs.some((d) => {
    const p = d.phases ?? []
    return p.length === 0 || p.every((v) => v === 'UNKNOWN')
  })
  if (hasUnphased) rawPhases.add('NA')
  const phases = [...rawPhases].sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b))
  const overallStatuses = [...new Set(drugs.map((d) => d.overall_status).filter(Boolean))].sort()
  const companies = [...new Set(drugs.map((d) => d.company_normalized).filter(Boolean))].sort()
  const targets = [...new Set(drugs.map((d) => d.target).filter(Boolean))].sort()
  const biomarkers = [...new Set(drugs.flatMap((d) => d.biomarker_list ?? []).filter(Boolean))].sort()

  const startYears = [...new Set(
    drugs.map((d) => parseInt(d.start_date?.slice(0, 4))).filter((y) => y > 2000 && y < 2040)
  )].sort((a, b) => a - b)

  const completionYears = [...new Set(
    drugs.map((d) => parseInt(d.primary_completion_date?.slice(0, 4))).filter((y) => y > 2000 && y < 2040)
  )].sort((a, b) => a - b)

  return {
    cancerCategories, modalities, phases, overallStatuses,
    companies, targets, biomarkers, startYears, completionYears,
  }
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
