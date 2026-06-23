// 초록 abstract_id 등에서 발표 종류 파생 (메타데이터에 poster/oral 구분은 없음).
// 필터·테이블·차트가 공유.
const KINDS = [
  { label: 'Late-Breaking', cls: 'bg-amber-100 text-amber-700' },
  { label: 'Trials in Progress', cls: 'bg-sky-100 text-sky-700' },
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
  const id = String(a?.abstract_id || '')
  const u = id.toUpperCase()
  if (a?.is_lba || u.startsWith('LBA') || /^LB\d/.test(u)) return 'Late-Breaking'
  if (u.startsWith('TPS')) return 'Trials in Progress'
  if (u.startsWith('CT')) return 'Clinical Trial'
  if (/^(SY|PL|ED|NG|ND|SS|LE)/.test(u)) return 'Symposium'
  if (a?.presentation_type === 'e-abstract' || (a?.conference === 'ASCO' && /^E\d/.test(u))) return 'Online only'
  if (/^\d/.test(id)) return 'Presented'
  return null
}
