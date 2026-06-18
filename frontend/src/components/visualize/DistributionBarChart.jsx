import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import ChartCard, { EmptyHint } from './ChartCard'

// 범용 가로 막대 분포 차트 (클릭 시 필터 토글). Conference 시각화에서 재사용.
// data: [{name, count, isOther?}], selected: string[], highlight: Set<string>
export default function DistributionBarChart({
  title,
  subtitle,
  data,
  onSelect,
  selected = [],
  highlight,
  baseColor = '#0ea5e9',
  selectedColor = '#0369a1',
  yWidth = 90,
  height = 320,
}) {
  const handleClick = (entry) => {
    if (entry && !entry.isOther && onSelect) onSelect(entry.name)
  }
  return (
    <ChartCard title={title} subtitle={subtitle} height={height}>
      {!data || data.length === 0 ? (
        <EmptyHint message="No data." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={yWidth} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip formatter={(v) => v.toLocaleString()} />
            <Bar
              dataKey="count"
              radius={[0, 3, 3, 0]}
              onClick={handleClick}
              cursor={onSelect ? 'pointer' : 'default'}
            >
              {data.map((d, i) => {
                const sel = selected.includes(d.name)
                const fill = d.isOther
                  ? '#cbd5e1'
                  : highlight?.has(d.name)
                    ? (sel ? '#b45309' : '#f59e0b')
                    : (sel ? selectedColor : baseColor)
                return <Cell key={i} fill={fill} />
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
