// 탭 전환(SPA 네비게이션) 사이에서 필터를 유지하는 인메모리 스토어.
// 한 번에 한 탭만 마운트되므로, 마운트 시 store에서 읽고 변경 시 store에 쓰는 것만으로
// "공통 필터 공유 + 각 탭 고유 필터 유지"가 동작한다. (전체 새로고침 시에는 초기화)

// Pipeline ↔ Visualize ↔ Conferences가 공유하는 축
//  - cancers/phases/modalities: 세 탭 모두 (Conferences는 Pipeline 체계로 재태깅됨)
//  - companies(원본)/targets/biomarkers/statuses/startYear: Pipeline ↔ Visualize
const SHARED_DEFAULT = {
  cancers: [],
  phases: [],
  modalities: [],
  companies: [],
  targets: [],
  biomarkers: [],
  statuses: [],
  startYear: { from: 'all', to: 'all' },
}

const store = {
  shared: { ...SHARED_DEFAULT },
  pipeline: null,
  visualize: null,
  conferences: null,
}

export function getShared() {
  return store.shared
}

export function setShared(next) {
  store.shared = next
}

export function getTabState(tab) {
  return store[tab]
}

export function setTabState(tab, value) {
  store[tab] = value
}
