export function applyFilters(drugs, filters) {
  const { cancerCategories, modalities, partnershipStatus, needsReview, keyword } = filters

  return drugs.filter((drug) => {
    if (cancerCategories.length > 0 && !cancerCategories.includes(drug.cancer_category)) return false
    if (modalities.length > 0 && !modalities.includes(drug.modality)) return false
    if (partnershipStatus !== 'all' && drug.partnership_status !== partnershipStatus) return false
    if (needsReview && drug.target !== 'Unknown') return false

    if (keyword) {
      const q = keyword.toLowerCase()
      const searchable = [
        drug.drug_name,
        drug.company,
        drug.target,
        drug.modality,
        drug.condition,
      ]
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
  return { cancerCategories, modalities }
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
