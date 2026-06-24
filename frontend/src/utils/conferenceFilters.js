// Conference 테이블 ↔ Conference Visualize 가 동일한 필터를 쓰도록 하는 공유 상태 로직.
//  - 공유 축(cancer/phase/modality/company/target/biomarker/keyword)은 store.shared (전 탭 공유)
//  - conference 고유 축(Source/Year/Country/Affiliation/Author/Embargoed)은 tab 'conferences'
//    (두 conference 페이지가 같은 슬라이스를 공유 → 필터가 그대로 이어짐)
import { getShared, setShared, getTabState, setTabState } from './filterStore'

const SHARED = ['cancers', 'phases', 'modalities', 'companies', 'targets', 'biomarkers', 'institutions', 'keyword']

export const CONF_LOCAL_DEFAULT = {
  conferences: [], years: [], countries: [], presentationKinds: [],
  affiliation: '', authorName: '', authorAffil: '', showEmbargoed: false,
}

export function buildConferenceFilters() {
  const s = getShared()
  const l = getTabState('conferences') ?? CONF_LOCAL_DEFAULT
  return {
    cancers: s.cancers, phases: s.phases, modalities: s.modalities, companies: s.companies,
    targets: s.targets, biomarkers: s.biomarkers, institutions: s.institutions ?? [], keyword: s.keyword ?? '',
    conferences: l.conferences ?? [], years: l.years ?? [], countries: l.countries ?? [],
    presentationKinds: l.presentationKinds ?? [],
    affiliation: l.affiliation ?? '', authorName: l.authorName ?? '', authorAffil: l.authorAffil ?? '',
    showEmbargoed: l.showEmbargoed ?? false,
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
  setTabState('conferences', {
    conferences: next.conferences, years: next.years, countries: next.countries,
    presentationKinds: next.presentationKinds,
    affiliation: next.affiliation, authorName: next.authorName, authorAffil: next.authorAffil,
    showEmbargoed: next.showEmbargoed,
  })
}

// 한 축 변경 → store 반영 후 다음 filters 반환 (value = 그 축의 새 전체값)
export function setConferenceFilter(prev, key, value) {
  const next = { ...prev, [key]: value }
  if (SHARED.includes(key)) syncShared(next)
  else persistLocal(next)
  return next
}

export function clearedConferenceFilters() {
  const next = {
    cancers: [], phases: [], modalities: [], companies: [], targets: [], biomarkers: [],
    institutions: [], keyword: '',
    ...CONF_LOCAL_DEFAULT,
  }
  syncShared(next)
  setTabState('conferences', { ...CONF_LOCAL_DEFAULT })
  return next
}

// 활성 필터 여부 (검색 의도 — 전 연도 로드 판단용; year/conference 제외)
export function conferenceFilterActive(filters, nctParam) {
  return Boolean(
    filters.keyword || filters.affiliation || filters.authorName || nctParam ||
    filters.cancers.length || filters.phases.length || filters.modalities.length ||
    filters.companies.length || filters.targets.length || filters.biomarkers.length ||
    (filters.institutions?.length ?? 0) || filters.countries.length ||
    (filters.presentationKinds?.length ?? 0),
  )
}

// 어떤 필터든 선택되어 있는지 (Clear all 버튼 노출용 — year/conference 포함)
export function anyConferenceFilter(filters, nctParam) {
  return conferenceFilterActive(filters, nctParam) ||
    filters.years.length > 0 || filters.conferences.length > 0
}

// Pipeline에서 NCT로 넘어왔을 때: 다른 축 무시하고 해당 시험만 (공유필터에 가려지지 않게)
export function nctOnlyFilters(nct) {
  return {
    cancers: [], phases: [], modalities: [], companies: [], targets: [], biomarkers: [], institutions: [],
    conferences: [], years: [], countries: [], presentationKinds: [], affiliation: '', authorName: '', authorAffil: '', keyword: '',
    nctId: nct, showEmbargoed: true,
  }
}
