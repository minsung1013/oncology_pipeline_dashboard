import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

// IHC 기반 CDx 친화 타겟 — 강조 색 (사용자가 판단하도록 가벼운 시각 신호만)
const CDX_FRIENDLY = new Set(['HER2', 'PD-L1', 'TROP2', 'EGFR', 'CLDN18.2', 'MET'])

export default function TargetDistributionChart({ data, onSelect, selected = [] }) {
  const handleClick = (entry) => {
    if (entry && !entry.isOther && onSelect) onSelect(entry.name)
  }
  return (
    <ChartCard title="⑤ Target Distribution" subtitle="Trials per target — click a bar to filter (IHC-friendly highlighted)" height={320}>
      {data.length === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} onClick={handleClick} cursor="pointer">
              {data.map((d, i) => {
                const sel = selected.includes(d.name)
                const fill = d.isOther
                  ? '#cbd5e1'
                  : CDX_FRIENDLY.has(d.name)
                    ? (sel ? '#b45309' : '#f59e0b')
                    : (sel ? '#0369a1' : '#0ea5e9')
                return <Cell key={i} fill={fill} />
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
