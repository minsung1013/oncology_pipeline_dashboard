import { useMemo } from 'react'
import {
  PHASE_ORDER, PHASE_COLORS, PHASE_DARK_TEXT, segCount, segDetail,
} from '../../utils/maturityAggregations'

// 얇은 가로 누적 막대 (로그 스케일). 막대 길이=전체 고유약물 수, 색=개발 단계.
// 막대(행) 클릭 → 해당 target 필터 토글. 세그먼트 hover → 진행/완료/중단.
export default function TargetMaturityChart({
  rows, topN = 100, selected = [], onSelect,
  title = '타겟 성숙도 — 단계별 프로그램 (로그 스케일)',
  emptyLabel = '표시할 타겟이 없습니다 (필터 결과 비어있음).',
}) {
  const shown = useMemo(
    () => rows.filter((r) => r.total_activity > 0).slice(0, topN),
    [rows, topN],
  )

  if (!shown.length) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-400">
        {emptyLabel}
      </div>
    )
  }

  const rowH = 13, gap = 3, barMaxW = 720, top0 = 44, left0 = 158, padR = 48
  const W = left0 + barMaxW + padR
  const H = top0 + (rowH + gap) * shown.length + 14
  const maxtot = Math.max(...shown.map((r) => r.total_activity), 1)
  const logmax = Math.log10(maxtot + 1) || 1
  const xlen = (v) => (Math.log10(v + 1) / logmax) * barMaxW
  const ticks = [1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000].filter((t) => t <= maxtot)
  const selSet = new Set(selected)

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 overflow-x-auto">
      <div className="flex items-center justify-between mb-1 px-1">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <div className="flex items-center gap-2.5 text-[10px] text-slate-500 flex-wrap">
          {PHASE_ORDER.map((p) => (
            <span key={p} className="inline-flex items-center gap-1">
              <i style={{ background: PHASE_COLORS[p], width: 11, height: 11, borderRadius: 2, display: 'inline-block' }} />
              {p}
            </span>
          ))}
        </div>
      </div>
      <svg width={W} height={H} style={{ fontFamily: 'inherit', maxWidth: '100%' }}>
        {/* 로그 눈금 */}
        {ticks.map((t) => {
          const x = left0 + xlen(t)
          return (
            <g key={t}>
              <line x1={x} y1={top0 - 6} x2={x} y2={H - 8} stroke="#eee" />
              <text x={x} y={top0 - 12} fontSize="9" fill="#aab" textAnchor="middle">{t}</text>
            </g>
          )
        })}
        <text x={left0} y={top0 - 28} fontSize="10" fill="#94a3b8">전체 프로그램 수 (로그) →</text>

        {shown.map((r, i) => {
          const y = top0 + i * (rowH + gap)
          const barlen = xlen(r.total_activity)
          const isSel = selSet.has(r.target)
          // 세그먼트 위치 1회 계산: {p, v, x, w}
          const segs = []
          let cx = left0
          for (const p of PHASE_ORDER) {
            const v = segCount(r, p)
            if (!v) continue
            const w = (barlen * v) / r.total_activity
            segs.push({ p, v, x: cx, w })
            cx += w
          }
          const label = r.target.length > 20 ? r.target.slice(0, 19) + '…' : r.target
          return (
            <g key={r.target} onClick={() => onSelect?.(r.target)} style={{ cursor: 'pointer' }}>
              <rect x={0} y={y - 1} width={W} height={rowH + 2} fill={isSel ? '#eff6ff' : 'transparent'} />
              <text x={left0 - 8} y={y + rowH / 2 + 3.5} fontSize="10.5" textAnchor="end"
                fill={isSel ? '#1d4ed8' : '#334155'} fontWeight={isSel ? 600 : 400}>
                <title>{r.target}</title>{label}
              </text>
              {segs.map((s, si) => (
                <rect key={s.p} x={s.x} y={y} width={Math.max(s.w, 0.8)} height={rowH}
                  rx={si === 0 || si === segs.length - 1 ? 1.5 : 0} fill={PHASE_COLORS[s.p]}>
                  <title>{`${r.target} — ${segDetail(r, s.p)}`}</title>
                </rect>
              ))}
              {segs.filter((s) => s.w >= 13).map((s) => (
                <text key={`t${s.p}`} x={s.x + s.w / 2} y={y + rowH / 2 + 3} fontSize="8.5"
                  fill={PHASE_DARK_TEXT.has(s.p) ? '#333' : '#fff'} textAnchor="middle"
                  style={{ pointerEvents: 'none' }}>{s.v}</text>
              ))}
              <text x={cx + 5} y={y + rowH / 2 + 3.5} fontSize="9.5" fontWeight="600" fill="#475569"
                style={{ pointerEvents: 'none' }}>{r.total_activity}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
