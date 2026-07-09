import { useMemo } from 'react'
import { CLIN_AXIS } from '../../utils/opportunityAggregations'

// 기회 지도 산점도 — 가중치 없이 두 원본 지표를 축에 배치.
//   x = 임상 성숙도(clin_maturity_idx 0..6) · y = 전임상 고유 기관 수(log)
//   색 = 성장비(파랑=식음→빨강=뜸) · 크기 = 초록 수 · 빨강 테두리 = 부상
// rows: flagEmerging 적용된 행. selected: 선택된 canonical target Set/배열. onSelect(target).

const W = 1080, H = 700
const padL = 92, padR = 40, padT = 56, padB = 84
const plotW = W - padL - padR
const plotH = H - padT - padB

function hashJit(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return ((Math.abs(h) % 100) / 100 - 0.5) * 0.7 // ±0.35 슬롯
}
function growthColor(g) {
  const t = Math.max(0, Math.min(1, (g - 0.5) / 2)) // 0.5→0, 2.5→1
  const r = Math.round(0x33 + (0xc1 - 0x33) * t)
  const gr = Math.round(0x77 + (0x00 - 0x77) * t)
  const b = Math.round(0xcc + (0x00 - 0xcc) * t)
  return `rgb(${r},${gr},${b})`
}

export default function TargetOpportunityMap({ rows, selected = [], onSelect }) {
  const selSet = useMemo(() => new Set(selected), [selected])
  const pts = useMemo(
    () => rows.filter((r) => r.pre_orgs > 0 || r.clinical_total > 0),
    [rows],
  )
  const ymax = useMemo(() => Math.max(1, ...pts.map((r) => r.pre_orgs)), [pts])
  const xmax = 6

  const X = (idx, jit = 0) => padL + ((idx + jit) / xmax) * plotW
  const Y = (n) => padT + plotH - (Math.log1p(n) / Math.log1p(ymax)) * plotH
  const R = (n) => 3 + Math.sqrt(n) * 0.9

  // 라벨 대상: 활동량 상위 26 + 부상 전부 + 선택 전부
  const labeled = useMemo(() => {
    const top = [...pts].sort(
      (a, b) => b.pre_orgs + b.clinical_total - (a.pre_orgs + a.clinical_total),
    ).slice(0, 26)
    const s = new Set(top.map((r) => r.target))
    for (const r of pts) if (r.emerging || selSet.has(r.target)) s.add(r.target)
    return s
  }, [pts, selSet])

  const yMid = Y(Math.sqrt(Math.max(1, ymax))) // 기하 중앙(로그축 중간)
  const xMid = X(2) // ≈ P1/2 경계

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" style={{ maxHeight: '72vh' }}>
      {/* 화이트스페이스 사분면 (왼쪽 위) */}
      <rect x={padL} y={padT} width={xMid - padL} height={yMid - padT} fill="#fff5f5" />
      <text x={padL + 12} y={padT + 20} fontSize="13" fontWeight="700" fill="#c10000">★ 부상 / 화이트스페이스</text>
      <text x={padL + 12} y={padT + 37} fontSize="11" fill="#cc9999">연구 활발 · 임상 미진</text>

      {/* 격자 (y) */}
      {[1, 3, 10, 30, 100].filter((n) => n <= ymax).map((n) => (
        <g key={n}>
          <line x1={padL} y1={Y(n)} x2={padL + plotW} y2={Y(n)} stroke="#f0f0f0" />
          <text x={padL - 10} y={Y(n) + 4} fontSize="10" fill="#888" textAnchor="end">{n}</text>
        </g>
      ))}
      {/* 축 */}
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#333" />
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#333" />
      {CLIN_AXIS.map((lab, i) => (
        <text key={lab} x={X(i)} y={padT + plotH + 18} fontSize="10" fill="#666" textAnchor="middle">{lab}</text>
      ))}
      <text x={padL + plotW / 2} y={H - 26} fontSize="12" fontWeight="600" textAnchor="middle" fill="#444">임상 성숙도 (도달 최고단계) →</text>
      <text x="22" y={padT + plotH / 2} fontSize="12" fontWeight="600" textAnchor="middle" fill="#444" transform={`rotate(-90 22 ${padT + plotH / 2})`}>전임상 연구 강도 (고유 기관 수, log) →</text>

      {/* 점 */}
      {pts.map((r) => {
        const x = X(r.clin_maturity_idx, hashJit(r.target))
        const y = Y(r.pre_orgs)
        const rr = R(r.pre_abstracts)
        const sel = selSet.has(r.target)
        const stroke = sel ? '#1d4ed8' : r.emerging ? '#c10000' : '#8894a4'
        const sw = sel ? 2.6 : r.emerging ? 2.2 : 0.6
        const tip =
          `${r.target} — 기관 ${r.pre_orgs} · 초록 ${r.pre_abstracts} · 모달 ${r.pre_modalities}` +
          ` · 최근/과거 ${r.recent}/${r.early} (성장 ${r.growth_ratio}) · 임상 ${r.clinical_total}(${r.max_phase})` +
          (r.new_entrant_orgs ? ` · 신규진입기관 ${r.new_entrant_orgs}` : '') +
          (r.emerging ? ' · ★부상' : '') + (r.brand_new ? ' · 🆕' : '')
        return (
          <g key={r.target} onClick={() => onSelect?.(r.target)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={rr} fill={growthColor(r.growth_ratio)} fillOpacity={sel ? 0.8 : 0.55} stroke={stroke} strokeWidth={sw}>
              <title>{tip}</title>
            </circle>
            {labeled.has(r.target) && (
              <text x={x + rr + 2} y={y + 3} fontSize="10" fontWeight={r.emerging || sel ? 700 : 400} fill={sel ? '#1d4ed8' : r.emerging ? '#c10000' : '#333'} style={{ pointerEvents: 'none' }}>
                {r.target}{r.brand_new ? '🆕' : ''}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
