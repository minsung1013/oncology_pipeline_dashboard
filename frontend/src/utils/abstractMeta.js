// 초록 발표 종류. ESMO는 데이터에 presentation_type(Poster/Oral 등)이 있고,
// ASCO/AACR은 abstract_id 접두에서 파생. (메타데이터에 poster/oral 구분이 없는 ASCO는 'Presented')
const KINDS = [
  { label: 'Late-Breaking', cls: 'bg-amber-100 text-amber-700' },
  { label: 'Trials in Progress', cls: 'bg-sky-100 text-sky-700' },
  { label: 'Oral', cls: 'bg-rose-100 text-rose-700' },
  { label: 'Mini Oral', cls: 'bg-pink-100 text-pink-700' },
  { label: 'Poster Discussion', cls: 'bg-fuchsia-100 text-fuchsia-700' },
  { label: 'Poster', cls: 'bg-teal-100 text-teal-700' },
  { label: 'Clinical Trial', cls: 'bg-blue-100 text-blue-700' },
  { label: 'Symposium', cls: 'bg-violet-100 text-violet-700' },
  { label: 'Online only', cls: 'bg-slate-100 text-slate-500' },
  { label: 'Presented', cls: 'bg-emerald-100 text-emerald-700' },
]
const CLS = Object.fromEntries(KINDS.map((k) => [k.label, k.cls]))

// 고정 표시 순서 (필터 옵션 정렬용)
export const PRESENTATION_KINDS = KINDS.map((k) => k.label)

export function presentationKindClass(label) {
  return CLS[label] ?? 'bg-slate-100 text-slate-500'
}

export function presentationKind(a) {
  // ESMO 등 명시적 발표타입 우선 (Poster/Oral/Mini Oral/Poster Discussion/Trials in Progress/Late-Breaking)
  const pt = a?.presentation_type
  if (pt && pt !== 'e-abstract' && CLS[pt]) return pt

  // ASCO/AACR: abstract_id 접두에서 파생
  const id = String(a?.abstract_id || '')
  const u = id.toUpperCase()
  if (a?.is_lba || u.startsWith('LBA') || /^LB\d/.test(u)) return 'Late-Breaking'
  if (u.startsWith('TPS')) return 'Trials in Progress'
  if (u.startsWith('CT')) return 'Clinical Trial'
  if (/^(SY|PL|ED|NG|ND|SS|LE)/.test(u)) return 'Symposium'
  if (pt === 'e-abstract' || (a?.conference === 'ASCO' && /^E\d/.test(u))) return 'Online only'
  if (/^\d/.test(id)) return 'Presented'
  return null
}
