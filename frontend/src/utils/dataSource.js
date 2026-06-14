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

export async function getAbstractIndex() {
  if (!_index) {
    const r = await fetch(INDEX_URL)
    if (!r.ok) throw new Error(`index HTTP ${r.status}`)
    _index = (await r.json()).abstracts // [{conference, year, count, file}, ...]
  }
  return _index
}

// manifest 항목들의 파일을 로드(캐시) → 합친 초록 배열
export async function loadAbstractFiles(items) {
  const lists = await Promise.all(items.map(async (m) => {
    if (!_files.has(m.file)) {
      const r = await fetch(abstractFileUrl(m.file))
      if (!r.ok) throw new Error(`${m.file} HTTP ${r.status}`)
      _files.set(m.file, (await r.json()).abstracts)
    }
    return _files.get(m.file)
  }))
  return lists.flat()
}
