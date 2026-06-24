// 퍼블리케이션(저널 논문) 필터 — Conference와 동일 구조, 로컬 슬라이스만 tab 'publications'.
// 공유 축(cancer/modality/target/biomarker/company/keyword)은 store.shared로 전 축 공유.
// 고유 축: conferences(=저널), years, countries, presentationKinds(=출판유형), affiliation/author.
import { getShared, setShared, getTabState, setTabState } from './filterStore'

const SHARED = ['cancers', 'phases', 'modalities', 'companies', 'targets', 'biomarkers', 'institutions', 'keyword']

export const PUB_LOCAL_DEFAULT = {
  conferences: [], years: [], countries: [], presentationKinds: [],
  affiliation: '', authorName: '', authorAffil: '', showEmbargoed: true,
}

export function buildPublicationFilters() {
  const s = getShared()
  const l = getTabState('publications') ?? PUB_LOCAL_DEFAULT
  return {
    cancers: s.cancers, phases: s.phases, modalities: s.modalities, companies: s.companies,
    targets: s.targets, biomarkers: s.biomarkers, institutions: s.institutions ?? [], keyword: s.keyword ?? '',
    conferences: l.conferences ?? [], years: l.years ?? [], countries: l.countries ?? [],
    presentationKinds: l.presentationKinds ?? [],
    affiliation: l.affiliation ?? '', authorName: l.authorName ?? '', authorAffil: l.authorAffil ?? '',
    showEmbargoed: l.showEmbargoed ?? true,
  }
}

function syncShared(next) {
  setShared({
    ...getShared(),
    cancers: next.cancers, phases: next.phases, modalities: next.modalities,
    companies: next.companies, targets: next.targets, biomarkers: next.biomarkers,
    institutions: next.institutions, keyword: next.keyword,
  })
}
function persistLocal(next) {
  setTabState('publications', {
    conferences: next.conferences, years: next.years, countries: next.countries,
    presentationKinds: next.presentationKinds,
    affiliation: next.affiliation, authorName: next.authorName, authorAffil: next.authorAffil,
    showEmbargoed: next.showEmbargoed,
  })
}

export function setPublicationFilter(prev, key, value) {
  const next = { ...prev, [key]: value }
  if (SHARED.includes(key)) syncShared(next)
  else persistLocal(next)
  return next
}

export function clearedPublicationFilters() {
  const next = {
    cancers: [], phases: [], modalities: [], companies: [], targets: [], biomarkers: [],
    institutions: [], keyword: '', ...PUB_LOCAL_DEFAULT,
  }
  syncShared(next)
  setTabState('publications', { ...PUB_LOCAL_DEFAULT })
  return next
}

export function publicationFilterActive(filters, nctParam) {
  return Boolean(
    filters.keyword || filters.affiliation || filters.authorName || nctParam ||
    filters.cancers.length || filters.phases.length || filters.modalities.length ||
    filters.companies.length || filters.targets.length || filters.biomarkers.length ||
    (filters.institutions?.length ?? 0) || filters.countries.length ||
    (filters.presentationKinds?.length ?? 0),
  )
}

export function anyPublicationFilter(filters, nctParam) {
  return publicationFilterActive(filters, nctParam) ||
    filters.years.length > 0 || filters.conferences.length > 0
}
