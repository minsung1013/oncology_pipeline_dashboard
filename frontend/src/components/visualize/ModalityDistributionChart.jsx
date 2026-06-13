import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

// CDx 시너지 직접 신호: 이 모달리티들은 강조색, 나머지는 무채색 — 스펙 §5④
const EMPHASIS_COLORS = {
  ADC: '#8b5cf6',
  'Bispecific Antibody': '#6366f1',
  'CAR-T': '#ec4899',
  'Cell Therapy': '#d946ef',
}
const MUTED = ['#94a3b8', '#cbd5e1', '#b8c2cf', '#a3aebd', '#d8dee6', '#e2e8f0', '#9aa6b5']

function colorFor(name, mutedIdx) {
  return EMPHASIS_COLORS[name] ?? MUTED[mutedIdx % MUTED.length]
}

export default function ModalityDistributionChart({ data, onSelect, selected = [] }) {
  let mutedIdx = 0
  const colored = data.map((d) => {
    const isEmphasis = d.name in EMPHASIS_COLORS
    const fill = isEmphasis ? EMPHASIS_COLORS[d.name] : MUTED[mutedIdx++ % MUTED.length]
    return { ...d, fill }
  })

  const handleClick = (entry) => {
    if (entry && entry.name && onSelect) onSelect(entry.name)
  }

  return (
    <ChartCard title="④ Modality Distribution" subtitle="CDx-synergistic modalities highlighted — click a slice to filter" height={320}>
      {data.length === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={colored}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={95}
              innerRadius={0}
              onClick={handleClick}
              cursor="pointer"
            >
              {colored.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.fill}
                  stroke={selected.includes(d.name) ? '#0f172a' : '#fff'}
                  strokeWidth={selected.includes(d.name) ? 2.5 : 1}
                />
              ))}
            </Pie>
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
