import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

// IHC 기반 CDx 친화 타겟 — 강조 색 (사용자가 판단하도록 가벼운 시각 신호만)
const CDX_FRIENDLY = new Set(['HER2', 'PD-L1', 'TROP2', 'EGFR', 'CLDN18.2', 'MET'])

export default function TargetDistributionChart({ data }) {
  return (
    <ChartCard title="⑤ Target Distribution" subtitle="Trials per target (Top N · IHC-friendly highlighted)" height={320}>
      {data.length === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.isOther ? '#cbd5e1' : CDX_FRIENDLY.has(d.name) ? '#f59e0b' : '#0ea5e9'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
