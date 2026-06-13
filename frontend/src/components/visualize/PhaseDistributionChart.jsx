import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

// 상태 표시 순서(진행→종료) + 라벨 + 색
const STATUSES = [
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

export default function PhaseDistributionChart({ data, onSelect, selected = [] }) {
  const handleClick = (entry) => {
    // 누적 막대의 어느 세그먼트를 눌러도 payload에 phase row(raw)가 담김
    const raw = entry?.raw ?? entry?.payload?.raw
    if (raw && onSelect) onSelect(raw)
  }

  // 현재 데이터에 실제 등장하는 status만 범례·막대로
  const present = STATUSES.filter((s) => data.some((d) => d[s.key] > 0))

  return (
    <ChartCard
      title="② Phase × Status"
      subtitle="Stacked by trial status — click a bar to filter by phase"
      height={320}
    >
      {data.length === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(v, name) => [v.toLocaleString(), name]}
              labelFormatter={(l) => `Phase: ${l}`}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            {present.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="status"
                fill={s.color}
                onClick={handleClick}
                cursor="pointer"
                radius={i === present.length - 1 ? [3, 3, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
