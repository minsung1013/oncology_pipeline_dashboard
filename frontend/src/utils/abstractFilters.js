import { normalizeCountry } from './dataClean'

export function applyAbstractFilters(abstracts, filters) {
  const {
    conferences, years, phases, modalities, cancers, countries, companies,
    targets = [], biomarkers = [], affiliation,
    authorName, keyword, nctId, showEmbargoed,
  } = filters

  const affilQ = affiliation?.trim().toLowerCase()

  return abstracts.filter((a) => {
    if (!showEmbargoed && a.status === 'embargoed') return false
    if (conferences?.length > 0 && !conferences.includes(a.conference)) return false
    if (years?.length > 0 && !years.includes(String(a.year))) return false
    if (phases.length > 0) {
      const ap = a.phases ?? []
      const isUn = ap.length === 0
      if (!phases.some((p) => (p === 'NA' ? isUn : ap.includes(p)))) return false
    }
    if (modalities.length > 0 && !modalities.some((m) => (a.modality_list ?? []).includes(m))) return false
    if (cancers.length > 0 && !(a.cancer_category ?? []).some((c) => cancers.includes(c))) return false
    if (countries?.length > 0 && !countries.includes(normalizeCountry(a.authors?.[0]?.country))) return false
    if (companies?.length > 0 && !(a.companies_normalized ?? []).some((c) => companies.includes(c))) return false
    if (targets.length > 0 && !(a.target_list ?? []).some((t) => targets.includes(t))) return false
    if (biomarkers.length > 0 && !(a.biomarker_list ?? []).some((b) => biomarkers.includes(b))) return false
    if (affilQ && !(a.authors?.[0]?.affiliation ?? '').toLowerCase().includes(affilQ)) return false
    if (authorName && a.authors?.[0]?.name !== authorName) return false
    if (nctId && !(a.nct_ids ?? []).includes(nctId)) return false

    if (keyword) {
      const q = keyword.toLowerCase()
      const searchable = [
        a.title,
        a.author_raw,
        a.abstract_id,
        ...(a.target_list ?? []),
        ...(a.biomarker_list ?? []),
        ...(a.nct_ids ?? []),
        ...(a.drugs_mentioned ?? []),
        ...(a.companies ?? []),
        ...(a.companies_normalized ?? []),
        ...(a.cancer_category ?? []),
        a.authors?.[0]?.country,
        a.authors?.[0]?.affiliation,
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

export function getAbstractFilterOptions(abstracts) {
  const conferences = [
    ...new Set(abstracts.map((a) => a.conference).filter(Boolean)),
  ].sort()

  const years = [
    ...new Set(abstracts.map((a) => a.year).filter(Boolean)),
  ].sort((a, b) => b - a).map(String)

  const phaseSet = new Set(abstracts.flatMap((a) => a.phases ?? []).filter(Boolean))
  if (abstracts.some((a) => (a.phases ?? []).length === 0)) phaseSet.add('NA')
  const phases = [...phaseSet].sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b))

  const modalities = [
    ...new Set(abstracts.flatMap((a) => a.modality_list ?? []).filter(Boolean)),
  ].sort()

  const cancers = [
    ...new Set(abstracts.flatMap((a) => a.cancer_category ?? []).filter(Boolean)),
  ].sort()

  const countries = [
    ...new Set(abstracts.map((a) => normalizeCountry(a.authors?.[0]?.country)).filter(Boolean)),
  ].sort()

  const companies = [
    ...new Set(abstracts.flatMap((a) => a.companies_normalized ?? []).filter(Boolean)),
  ].sort()

  const targets = [
    ...new Set(abstracts.flatMap((a) => a.target_list ?? []).filter((t) => t && t !== 'Unknown')),
  ].sort()

  const biomarkers = [
    ...new Set(abstracts.flatMap((a) => a.biomarker_list ?? []).filter(Boolean)),
  ].sort()

  return { conferences, years, phases, modalities, cancers, countries, companies, targets, biomarkers }
}
