// 임상시험 상태 메타 — Phase×Status 차트와 Status 분포 차트가 공유 (색·라벨·순서 일치)
export const STATUS_META = [
  { key: 'NOT_YET_RECRUITING', label: 'Not yet recruiting', color: '#60a5fa' },
  { key: 'RECRUITING', label: 'Recruiting', color: '#22c55e' },
  { key: 'ENROLLING_BY_INVITATION', label: 'By invitation', color: '#06b6d4' },
  { key: 'ACTIVE_NOT_RECRUITING', label: 'Active', color: '#eab308' },
  { key: 'COMPLETED', label: 'Completed', color: '#6366f1' },
  { key: 'TERMINATED', label: 'Terminated', color: '#ef4444' },
  { key: 'SUSPENDED', label: 'Suspended', color: '#f97316' },
  { key: 'WITHDRAWN', label: 'Withdrawn', color: '#ec4899' },
  { key: 'UNKNOWN', label: 'Unknown', color: '#cbd5e1' },
]

const BY_KEY = Object.fromEntries(STATUS_META.map((s) => [s.key, s]))

export function statusLabel(key) {
  return BY_KEY[key]?.label ?? key
}

export function statusColor(key) {
  return BY_KEY[key]?.color ?? '#94a3b8'
}
