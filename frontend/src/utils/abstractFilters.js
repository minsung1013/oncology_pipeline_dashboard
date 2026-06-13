export function applyAbstractFilters(abstracts, filters) {
  const {
    conferences, years, phases, modalities, cancers, countries, company, affiliation,
    keyword, nctId, showEmbargoed,
  } = filters

  const companyQ = company?.trim().toLowerCase()
  const affilQ = affiliation?.trim().toLowerCase()

  return abstracts.filter((a) => {
    if (!showEmbargoed && a.status === 'embargoed') return false
    if (conferences?.length > 0 && !conferences.includes(a.conference)) return false
    if (years?.length > 0 && !years.includes(String(a.year))) return false
    if (phases.length > 0 && !phases.some((p) => (a.phases ?? []).includes(p))) return false
    if (modalities.length > 0 && !modalities.some((m) => (a.modality_list ?? []).includes(m))) return false
    if (cancers.length > 0 && !(a.cancer_category ?? []).some((c) => cancers.includes(c))) return false
    if (countries?.length > 0 && !countries.includes(a.authors?.[0]?.country)) return false
    if (companyQ && !(a.companies ?? []).join(' ').toLowerCase().includes(companyQ)) return false
    if (affilQ && !(a.authors?.[0]?.affiliation ?? '').toLowerCase().includes(affilQ)) return false
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

  const phases = [
    ...new Set(abstracts.flatMap((a) => a.phases ?? []).filter(Boolean)),
  ].sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b))

  const modalities = [
    ...new Set(abstracts.flatMap((a) => a.modality_list ?? []).filter(Boolean)),
  ].sort()

  const cancers = [
    ...new Set(abstracts.flatMap((a) => a.cancer_category ?? []).filter(Boolean)),
  ].sort()

  const countries = [
    ...new Set(abstracts.map((a) => a.authors?.[0]?.country).filter(Boolean)),
  ].sort()

  return { conferences, years, phases, modalities, cancers, countries }
}
