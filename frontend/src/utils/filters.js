export function applyFilters(drugs, filters) {
  const {
    cancerCategories,
    modalities,
    phases,
    overallStatuses,
    partnershipStatus,
    needsReview,
    startYear,
    completionYear,
    keyword,
  } = filters

  return drugs.filter((drug) => {
    if (cancerCategories.length > 0 && !cancerCategories.includes(drug.cancer_category)) return false
    if (modalities.length > 0 && !modalities.includes(drug.modality)) return false
    if (phases.length > 0 && !phases.some((p) => (drug.phases ?? []).includes(p))) return false
    if (overallStatuses.length > 0 && !overallStatuses.includes(drug.overall_status)) return false
    if (partnershipStatus !== 'all' && drug.partnership_status !== partnershipStatus) return false
    if (needsReview && drug.target !== 'Unknown') return false

    if (startYear !== 'all') {
      const y = parseInt(drug.start_date?.slice(0, 4))
      if (!y || y !== parseInt(startYear)) return false
    }

    if (completionYear !== 'all') {
      const y = parseInt(drug.primary_completion_date?.slice(0, 4))
      if (!y || y !== parseInt(completionYear)) return false
    }

    if (keyword) {
      const q = keyword.toLowerCase()
      const searchable = [
        drug.drug_name,
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
  const phases = [...new Set(drugs.flatMap((d) => d.phases ?? []).filter(Boolean))]
    .sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b))
  const overallStatuses = [...new Set(drugs.map((d) => d.overall_status).filter(Boolean))].sort()

  const startYears = [...new Set(
    drugs.map((d) => parseInt(d.start_date?.slice(0, 4))).filter((y) => y > 2000 && y < 2040)
  )].sort((a, b) => a - b)

  const completionYears = [...new Set(
    drugs.map((d) => parseInt(d.primary_completion_date?.slice(0, 4))).filter((y) => y > 2000 && y < 2040)
  )].sort((a, b) => a - b)

  return { cancerCategories, modalities, phases, overallStatuses, startYears, completionYears }
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
