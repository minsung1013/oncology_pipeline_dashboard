export function applyFilters(drugs, filters) {
  const {
    cancerCategories,
    modalities,
    overallStatuses,
    partnershipStatus,
    needsReview,
    completionYearFrom,
    completionYearTo,
    keyword,
  } = filters

  return drugs.filter((drug) => {
    if (cancerCategories.length > 0 && !cancerCategories.includes(drug.cancer_category)) return false
    if (modalities.length > 0 && !modalities.includes(drug.modality)) return false
    if (overallStatuses.length > 0 && !overallStatuses.includes(drug.overall_status)) return false
    if (partnershipStatus !== 'all' && drug.partnership_status !== partnershipStatus) return false
    if (needsReview && drug.target !== 'Unknown') return false

    // Completion Date 연도 범위
    if (completionYearFrom || completionYearTo) {
      const year = parseInt(drug.primary_completion_date?.slice(0, 4))
      if (!year) return false
      if (completionYearFrom && year < parseInt(completionYearFrom)) return false
      if (completionYearTo && year > parseInt(completionYearTo)) return false
    }

    // 전문 검색 — 모든 텍스트 필드 대상
    if (keyword) {
      const q = keyword.toLowerCase()
      const searchable = [
        drug.drug_name,
        drug.company,
        drug.target,
        drug.modality,
        drug.condition,
        drug.cancer_category,
        drug.brief_summary,
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

export function getFilterOptions(drugs) {
  const cancerCategories = [...new Set(drugs.map((d) => d.cancer_category).filter(Boolean))].sort()
  const modalities = [...new Set(drugs.map((d) => d.modality).filter(Boolean))].sort()
  const overallStatuses = [...new Set(drugs.map((d) => d.overall_status).filter(Boolean))].sort()

  // Completion Date 연도 범위
  const years = drugs
    .map((d) => parseInt(d.primary_completion_date?.slice(0, 4)))
    .filter((y) => y > 2000 && y < 2040)
  const minYear = years.length ? Math.min(...years) : 2010
  const maxYear = years.length ? Math.max(...years) : 2030

  return { cancerCategories, modalities, overallStatuses, minYear, maxYear }
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
