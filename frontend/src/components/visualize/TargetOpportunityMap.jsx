import { useMemo } from 'react'
import { X_TICKS } from '../../utils/opportunityAggregations'

// 기회 지도 산점도.
//   x = 최신 임팩트(Σ 최근가중 발표량, 선형) · y = 임상 성숙도(Σ 단계×상태, 로그)
//   크기 = 총 발표 수(임상+초록+논문) · 색 = 성장비(파랑=식음→빨강=뜸) · 빨강 테두리 = 부상
// rows: applyRecency + flagEmerging 적용. selected: 선택된 식별자 배열. onSelect(name).

const W = 1280, H = 560
const padL = 92, padR = 48, padT = 34, padB = 60
const plotW = W - padL - padR
const plotH = H - padT - padB

function hashJit(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return ((Math.abs(h) % 100) / 100 - 0.5) * 14 // ±7px 지터(로그축 겹침 완화)
}
function growthColor(g) {
  const t = Math.max(0, Math.min(1, (g - 0.5) / 2))
  const r = Math.round(0x33 + (0xc1 - 0x33) * t)
  const gr = Math.round(0x77 + (0x00 - 0x77) * t)
  const b = Math.round(0xcc + (0x00 - 0xcc) * t)
  return `rgb(${r},${gr},${b})`
}

export default function TargetOpportunityMap({ rows, selected = [], onSelect }) {
  const selSet = useMemo(() => new Set(selected), [selected])
  const pts = useMemo(() => rows.filter((r) => r.size_total > 0), [rows])
  const smax = useMemo(() => Math.max(1, ...pts.map((r) => r.size_total)), [pts])
  const xmax = useMemo(() => Math.max(0.3, ...pts.map((r) => r.recency)), [pts])     // x=최신성(0~1)
  const ymax = useMemo(() => Math.max(4, ...pts.map((r) => r.clin_maturity)), [pts]) // y=임상 성숙도

  const lg = (v) => Math.log10(Math.max(0, v) + 1)
  const X = (v, jitPx = 0) => padL + (Math.max(0, v) / xmax) * plotW + jitPx // 선형 x
  const Y = (v, jitPx = 0) => padT + plotH - (lg(v) / lg(ymax + 1)) * plotH + jitPx // 로그 y
  const R = (n) => 2.5 + Math.sqrt(n / smax) * 20 // 크기 = 총 발표 수 (sqrt 정규화)
  const xTicks = useMemo(() => Array.from({ length: 6 }, (_, i) => Math.round((xmax * i) / 5 * 100) / 100), [xmax])
  const yTicks = useMemo(() => X_TICKS.filter((t) => t <= ymax * 1.05), [ymax])

  const labeled = useMemo(() => {
    const top = [...pts].sort((a, b) => b.size_total - a.size_total).slice(0, 28)
    const s = new Set(top.map((r) => r.target))
    for (const r of pts) if (r.emerging || selSet.has(r.target)) s.add(r.target)
    return s
  }, [pts, selSet])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" style={{ maxHeight: '62vh' }}>
      {/* y 격자 (임상 성숙도, 로그) */}
      {yTicks.map((n) => (
        <g key={n}>
          <line x1={padL} y1={Y(n)} x2={padL + plotW} y2={Y(n)} stroke="#f0f0f0" />
          <text x={padL - 10} y={Y(n) + 4} fontSize="10" fill="#888" textAnchor="end">{n === 0.3 ? '전임상' : n}</text>
        </g>
      ))}
      {/* 축 */}
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#333" />
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#333" />
      {/* x 격자 (최신 임팩트, 로그) */}
      {xTicks.map((t) => (
        <g key={t}>
          <line x1={X(t)} y1={padT} x2={X(t)} y2={padT + plotH} stroke="#f6f6f6" />
          <text x={X(t)} y={padT + plotH + 18} fontSize="10" fill="#666" textAnchor="middle">{t}</text>
        </g>
      ))}
      <text x={padL + plotW / 2} y={H - 24} fontSize="12" fontWeight="600" textAnchor="middle" fill="#444">최신성 (최근 가중 평균, 0~1 · 오른쪽일수록 최근) →</text>
      <text x="24" y={padT + plotH / 2} fontSize="12" fontWeight="600" textAnchor="middle" fill="#444" transform={`rotate(-90 24 ${padT + plotH / 2})`}>임상 성숙도 (Σ 단계×진행상태 가중, 로그) →</text>

      {pts.map((r) => {
        const x = X(r.recency, hashJit(r.target))
        const y = Y(r.clin_maturity, hashJit(r.target + '#'))
        const rr = R(r.size_total)
        const sel = selSet.has(r.target)
        const stroke = sel ? '#1d4ed8' : r.emerging ? '#c10000' : '#8894a4'
        const sw = sel ? 2.6 : r.emerging ? 2.2 : 0.6
        const tip =
          `${r.target} — 최신성 ${r.recency} · 성숙도 ${r.clin_maturity}(최고 ${r.max_phase}) · ` +
          `임상 ${r.clinical_total}(진행${r.clin_ongoing}/완료${r.clin_completed}/중단${r.clin_stopped}) · ` +
          `초록 ${r.abstract_count} · 논문 ${r.pub_count} · 총 ${r.size_total} · ` +
          `성장 ${r.growth_ratio}` + (r.emerging ? ' · ★부상' : '')
        return (
          <g key={r.target} onClick={() => onSelect?.(r.target)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={rr} fill={growthColor(r.growth_ratio)} fillOpacity={sel ? 0.8 : 0.45} stroke={stroke} strokeWidth={sw}>
              <title>{tip}</title>
            </circle>
            {labeled.has(r.target) && (
              <text x={x + rr + 1} y={y - 1} fontSize="10" textAnchor="start"
                transform={`rotate(-45 ${x + rr + 1} ${y - 1})`}
                fontWeight={r.emerging || sel ? 700 : 400} fill={sel ? '#1d4ed8' : r.emerging ? '#c10000' : '#333'} style={{ pointerEvents: 'none' }}>
                {r.target}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
