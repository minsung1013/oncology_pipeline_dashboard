import { useMemo } from 'react'
import { X_TICKS } from '../../utils/opportunityAggregations'

// 기회 지도 산점도.
//   x = 임상 성숙도(단계×상태 가중 평균, 전임상0.3~P4 4+) · y = 최신성(0~1, 최근일수록 1)
//   크기 = 총 발표 수(임상+초록+논문) · 색 = 성장비(파랑=식음→빨강=뜸) · 빨강 테두리 = 부상
// rows: applyRecency + flagEmerging 적용. selected: 선택된 식별자 배열. onSelect(name).

const W = 1080, H = 700
const padL = 92, padR = 40, padT = 56, padB = 84
const plotW = W - padL - padR
const plotH = H - padT - padB
const XDOM = 4.7 // 성숙도 도메인 (P4 완료 ≈ 4.6 수용)

function hashJit(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return ((Math.abs(h) % 100) / 100 - 0.5) * 0.16 // ±0.08 성숙도 지터
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

  const X = (v, jit = 0) => padL + ((v + jit) / XDOM) * plotW
  const Y = (rec) => padT + plotH - Math.max(0, Math.min(1, rec)) * plotH
  const R = (n) => 3 + Math.sqrt(n / smax) * 24 // 크기 = 총 발표 수 (sqrt 정규화)

  const labeled = useMemo(() => {
    const top = [...pts].sort((a, b) => b.size_total - a.size_total).slice(0, 26)
    const s = new Set(top.map((r) => r.target))
    for (const r of pts) if (r.emerging || selSet.has(r.target)) s.add(r.target)
    return s
  }, [pts, selSet])

  const xMid = X(2)          // 성숙도 2(≈P2) 경계
  const yMid = Y(0.5)        // 최신성 0.5 경계

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" style={{ maxHeight: '72vh' }}>
      {/* 화이트스페이스 사분면 (왼쪽 위 = 최신·미성숙) */}
      <rect x={padL} y={padT} width={xMid - padL} height={yMid - padT} fill="#fff5f5" />
      <text x={padL + 12} y={padT + 20} fontSize="13" fontWeight="700" fill="#c10000">★ 부상 / 화이트스페이스</text>
      <text x={padL + 12} y={padT + 37} fontSize="11" fill="#cc9999">최신 활발 · 임상 미성숙</text>

      {/* y 격자 (최신성 0~1) */}
      {[0, 0.25, 0.5, 0.75, 1].map((n) => (
        <g key={n}>
          <line x1={padL} y1={Y(n)} x2={padL + plotW} y2={Y(n)} stroke="#f0f0f0" />
          <text x={padL - 10} y={Y(n) + 4} fontSize="10" fill="#888" textAnchor="end">{n}</text>
        </g>
      ))}
      {/* 축 */}
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#333" />
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#333" />
      {X_TICKS.map((t) => (
        <g key={t.v}>
          <line x1={X(t.v)} y1={padT} x2={X(t.v)} y2={padT + plotH} stroke="#f6f6f6" />
          <text x={X(t.v)} y={padT + plotH + 18} fontSize="10" fill="#666" textAnchor="middle">{t.label}</text>
        </g>
      ))}
      <text x={padL + plotW / 2} y={H - 26} fontSize="12" fontWeight="600" textAnchor="middle" fill="#444">임상 성숙도 (단계×진행상태 가중 평균) →</text>
      <text x="22" y={padT + plotH / 2} fontSize="12" fontWeight="600" textAnchor="middle" fill="#444" transform={`rotate(-90 22 ${padT + plotH / 2})`}>최신성 (발표 평균, 1=최근) →</text>

      {pts.map((r) => {
        const x = X(r.clin_maturity, hashJit(r.target))
        const y = Y(r.recency)
        const rr = R(r.size_total)
        const sel = selSet.has(r.target)
        const stroke = sel ? '#1d4ed8' : r.emerging ? '#c10000' : '#8894a4'
        const sw = sel ? 2.6 : r.emerging ? 2.2 : 0.6
        const tip =
          `${r.target} — 성숙도 ${r.clin_maturity}(최고 ${r.max_phase}) · ` +
          `임상 ${r.clinical_total}(진행${r.clin_ongoing}/완료${r.clin_completed}/중단${r.clin_stopped}) · ` +
          `초록 ${r.abstract_count} · 논문 ${r.pub_count} · 총 ${r.size_total} · ` +
          `최신성 ${r.recency} · 성장 ${r.growth_ratio}` + (r.emerging ? ' · ★부상' : '')
        return (
          <g key={r.target} onClick={() => onSelect?.(r.target)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={rr} fill={growthColor(r.growth_ratio)} fillOpacity={sel ? 0.8 : 0.5} stroke={stroke} strokeWidth={sw}>
              <title>{tip}</title>
            </circle>
            {labeled.has(r.target) && (
              <text x={x + rr + 2} y={y + 3} fontSize="10" fontWeight={r.emerging || sel ? 700 : 400} fill={sel ? '#1d4ed8' : r.emerging ? '#c10000' : '#333'} style={{ pointerEvents: 'none' }}>
                {r.target}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
