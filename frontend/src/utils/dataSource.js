// 데이터 소스 (Cloudflare R2). VITE_DATA_BASE_URL로 오버라이드 가능.
export const DATA_BASE =
  import.meta.env.VITE_DATA_BASE_URL ??
  'https://pub-38ddc55a3aa34cf0988d355d9a0abe74.r2.dev'

export const PIPELINE_URL = `${DATA_BASE}/pipeline.json`
export const INDEX_URL = `${DATA_BASE}/index.json`
export const abstractFileUrl = (file) => `${DATA_BASE}/${file}`

// ── 초록 연도별 lazy 로딩 (모듈 캐시) ─────────────────────────────────────────
let _index = null
const _files = new Map() // file -> abstracts[]

// no-cache: 매 로드마다 R2 ETag로 재검증(변경 없으면 304, 변경 시 최신 데이터).
// R2 dev URL은 Cache-Control을 안 주므로 옵션 없이 fetch하면 휴리스틱 캐싱으로 옛 데이터가 남는다.
const REVALIDATE = { cache: 'no-cache' }

// pipeline.json(대용량)은 세션 내 1회만 로드 → 탭 전환마다 53MB 재다운로드 방지.
let _pipeline = null
export async function getPipeline() {
  if (!_pipeline) {
    const r = await fetch(PIPELINE_URL, REVALIDATE)
    if (!r.ok) throw new Error(`pipeline HTTP ${r.status}`)
    _pipeline = await r.json()
  }
  return _pipeline
}

let _nctIndex = null
export async function getNctIndex() {
  if (!_nctIndex) {
    const r = await fetch(`${DATA_BASE}/nct_index.json`, REVALIDATE)
    _nctIndex = r.ok ? await r.json() : {}
  }
  return _nctIndex
}

// 랜딩 통합 필터용 경량 옵션(facets) — 데이터 전체 로드 없이 옵션만.
let _facets = null
export async function getFacets() {
  if (!_facets) {
    const r = await fetch(`${DATA_BASE}/facets.json`, REVALIDATE)
    if (!r.ok) throw new Error(`facets HTTP ${r.status}`)
    _facets = await r.json()
  }
  return _facets
}

export async function getAbstractIndex() {
  if (!_index) {
    const r = await fetch(INDEX_URL, REVALIDATE)
    if (!r.ok) throw new Error(`index HTTP ${r.status}`)
    _index = (await r.json()).abstracts // [{conference, year, count, file}, ...]
  }
  return _index
}

// 네비 hover 시 캐시 워밍 → 탭 클릭하면 즉시 표시 (실패는 무시).
export function prefetchPipeline() {
  getPipeline().catch(() => {})
}
export function prefetchAbstracts() {
  getAbstractIndex()
    .then((idx) => {
      if (!idx?.length) return
      const latest = Math.max(...idx.map((m) => m.year))
      return loadAbstractFiles(idx.filter((m) => m.year === latest))
    })
    .catch(() => {})
}

// manifest 항목들의 파일을 로드(캐시) → 합친 초록 배열
export async function loadAbstractFiles(items) {
  const lists = await Promise.all(items.map(async (m) => {
    if (!_files.has(m.file)) {
      const r = await fetch(abstractFileUrl(m.file), REVALIDATE)
      if (!r.ok) throw new Error(`${m.file} HTTP ${r.status}`)
      _files.set(m.file, (await r.json()).abstracts)
    }
    return _files.get(m.file)
  }))
  return lists.flat()
}

// ── 퍼블리케이션(저널 논문) 연도별 lazy 로딩 ────────────────────────────────
let _pubIndex = null
export async function getPublicationIndex() {
  if (!_pubIndex) {
    const r = await fetch(`${DATA_BASE}/pub_index.json`, REVALIDATE)
    if (!r.ok) throw new Error(`pub_index HTTP ${r.status}`)
    _pubIndex = (await r.json()).publications // [{year, count, file}, ...]
  }
  return _pubIndex
}
// 초록 파일과 동일 캐시(_files) 공유 → file 경로로 구분
export async function loadPublicationFiles(items) {
  const lists = await Promise.all(items.map(async (m) => {
    if (!_files.has(m.file)) {
      const r = await fetch(abstractFileUrl(m.file), REVALIDATE)
      if (!r.ok) throw new Error(`${m.file} HTTP ${r.status}`)
      _files.set(m.file, (await r.json()).abstracts)
    }
    return _files.get(m.file)
  }))
  return lists.flat()
}
export function prefetchPublications() {
  getPublicationIndex()
    .then((idx) => {
      if (!idx?.length) return
      const latest = Math.max(...idx.map((m) => m.year))
      return loadPublicationFiles(idx.filter((m) => m.year === latest))
    })
    .catch(() => {})
}
