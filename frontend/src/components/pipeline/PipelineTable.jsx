import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table'
import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ModalityBadge, StatusDot } from './CdxBadge'

const col = createColumnHelper()

// LLM 보강 출처 표시 (rule 원본을 툴팁으로)
function AiTag({ ruleValue }) {
  return (
    <span
      title={`AI-enriched (qwen3)${ruleValue && ruleValue !== 'Unknown' ? ` · rule said: ${ruleValue}` : ' · rule had no value'}`}
      className="ml-1 align-middle text-[9px] font-bold bg-violet-100 text-violet-600 px-1 rounded cursor-help"
    >
      AI
    </span>
  )
}

// arm 정보로 실험군/대조군 레지멘 유도.
// 실험군 = 시험약물(investigational)을 포함한 arm들의 약물 합집합,
// 대조군 = 시험약물이 없는 arm들의 약물 합집합(없으면 단일군).
function deriveRegimens(d) {
  // 서버에서 미리 계산된 레지멘 우선 사용
  if (d.exp_regimen?.length || d.control_regimen?.length) {
    return { exp: d.exp_regimen ?? [], ctrl: d.control_regimen ?? [] }
  }
  const invest = new Set((d.investigational_drugs?.length ? d.investigational_drugs : [d.drug_name])
    .filter(Boolean).map((s) => s.toLowerCase()))
  const arms = (d.arms ?? []).filter((a) => (a.drugs ?? []).length)
  const hasInvest = (a) => a.drugs.some((x) => invest.has(x.toLowerCase()))
  const uniq = (lists) => {
    const seen = new Set(); const out = []
    for (const l of lists) for (const x of l) {
      const k = x.toLowerCase()
      if (!seen.has(k)) { seen.add(k); out.push(x) }
    }
    return out
  }
  let exp = uniq(arms.filter(hasInvest).map((a) => a.drugs))
  if (!exp.length) exp = d.all_drugs ?? (d.drug_name ? [d.drug_name] : [])
  // 시험약물을 앞으로 정렬
  exp = [...exp].sort((a, b) => (invest.has(b.toLowerCase()) ? 1 : 0) - (invest.has(a.toLowerCase()) ? 1 : 0))
  const ctrl = uniq(arms.filter((a) => !hasInvest(a)).map((a) => a.drugs))
  return { exp, ctrl }
}

// 임상 제목 셀 — 제목(→ NCT 링크) + 학회/논문 배지 + NCT 확장 + AI 한국어 요약 토글
function TitleCell({ d, nctIndex }) {
  const [expanded, setExpanded] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const ncts = d.nct_ids ?? []
  const primaryUrl = d.clinicaltrials_url || (ncts[0] ? `https://clinicaltrials.gov/study/${ncts[0]}` : null)
  const title = d.brief_title || d.official_title || '—'
  const linkNct = ncts.find((nct) => nctIndex?.[nct]?.length)
  const entries = linkNct ? (nctIndex[linkNct] || []) : []
  const confLabel = [...new Set(entries.filter((e) => e.axis !== 'publication').map((e) => e.conference))]
    .filter(Boolean).join('/')
  const pubCount = entries.filter((e) => e.axis === 'publication').length

  return (
    <div className="min-w-0">
      {primaryUrl ? (
        <a href={primaryUrl} target="_blank" rel="noreferrer"
           className="text-blue-600 hover:underline font-medium leading-snug break-words line-clamp-3"
           title={d.official_title || title}>
          {title}
        </a>
      ) : (
        <span className="font-medium leading-snug break-words line-clamp-3" title={title}>{title}</span>
      )}

      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
        {confLabel && (
          <Link to={`/conferences?nct=${linkNct}`}
            className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold hover:bg-amber-200 transition-colors"
            title={`Conference abstract (${confLabel}) · ${linkNct}`}>
            {confLabel}
          </Link>
        )}
        {pubCount > 0 && (
          <Link to={`/publications?nct=${linkNct}`}
            className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold hover:bg-emerald-200 transition-colors"
            title={`${pubCount} journal publication(s) · ${linkNct}`}>
            {pubCount} Pub
          </Link>
        )}
        {ncts.length > 1 && (
          <button onClick={() => setExpanded((v) => !v)}
            className="text-xs text-slate-400 hover:text-blue-500">
            {expanded ? '▲' : `+${ncts.length - 1} NCT ▼`}
          </button>
        )}
        {d.summary_ko && (
          <button onClick={() => setShowSummary((v) => !v)}
            className="text-[10px] font-semibold text-violet-600 hover:text-violet-800">
            {showSummary ? '▲ AI 요약' : '▼ AI 요약'}
          </button>
        )}
      </div>

      {showSummary && d.summary_ko && (
        <div className="text-xs text-slate-600 mt-1 leading-snug border-l-2 border-violet-100 pl-2">
          {d.summary_ko}
        </div>
      )}
      {expanded && ncts.length > 1 && (
        <div className="mt-1 flex flex-col gap-0.5 border-l-2 border-slate-100 pl-2">
          {ncts.map((nct) => (
            <a key={nct} href={`https://clinicaltrials.gov/study/${nct}`} target="_blank" rel="noreferrer"
               className="text-xs text-blue-500 hover:underline font-mono">{nct}</a>
          ))}
        </div>
      )}
    </div>
  )
}

// 레지멘 셀 (실험군/대조군 공용)
function RegimenCell({ drugs, muted }) {
  const list = drugs ?? []
  if (!list.length) return <span className="text-slate-300">—</span>
  return (
    <span className={`text-xs break-words leading-tight block ${muted ? 'text-slate-500' : 'text-slate-700'}`}
          title={list.join(' + ')}>
      {list.join(' + ')}
    </span>
  )
}

function makeColumns(nctIndex) {
  return [
  col.accessor('brief_title', {
    header: '임상 제목',
    cell: ({ row }) => <TitleCell d={row.original} nctIndex={nctIndex} />,
    size: 320,
  }),

  col.accessor('drug_name', {
    header: '대표약물',
    cell: ({ getValue, row }) => {
      const d = row.original
      const ncts = d.nct_ids ?? []
      const url = d.clinicaltrials_url || (ncts[0] ? `https://clinicaltrials.gov/study/${ncts[0]}` : null)
      const v = getValue() || '—'
      return url
        ? <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium break-words leading-tight">{v}</a>
        : <span className="font-medium break-words leading-tight">{v}</span>
    },
    size: 150,
  }),

  col.accessor('exp_regimen', {
    header: '실험군',
    enableSorting: false,
    cell: ({ row }) => <RegimenCell drugs={deriveRegimens(row.original).exp} />,
    size: 190,
  }),

  col.accessor('control_regimen', {
    header: '대조군',
    enableSorting: false,
    cell: ({ row }) => <RegimenCell drugs={deriveRegimens(row.original).ctrl} muted />,
    size: 160,
  }),

  col.accessor('company', {
    header: 'Company',
    cell: ({ row }) => {
      const d = row.original
      return (
        <div className="min-w-0">
          {/* 긴 회사명은 truncate 대신 줄바꿈(최대 3줄)으로 보기 좋게 + 정규명/전체명 툴팁 */}
          <div
            className="font-medium text-slate-700 break-words leading-tight line-clamp-3"
            title={d.company_normalized ? `${d.company_normalized} · ${d.company}` : d.company || ''}
          >
            {d.company || '—'}
          </div>
          {d.collaborators?.length > 0 && (
            <div className="text-xs text-slate-400 break-words leading-tight line-clamp-2 mt-0.5" title={d.collaborators.join(', ')}>
              + {d.collaborators.join(', ')}
            </div>
          )}
        </div>
      )
    },
    size: 170,
  }),

  // 시험 수행 국가 (CT.gov locations) — Company 옆
  col.accessor('countries', {
    header: 'Country',
    enableSorting: false,
    cell: ({ getValue }) => {
      const list = [...new Set(getValue() ?? [])]
      if (list.length === 0) return <span className="text-slate-300">—</span>
      return (
        <div className="text-xs text-slate-600 break-words leading-tight line-clamp-3" title={list.join(', ')}>
          {list.join(', ')}
          {list.length > 1 && <span className="ml-1 text-[9px] font-bold text-slate-400">×{list.length}</span>}
        </div>
      )
    },
    size: 130,
  }),

  col.accessor('biomarker_list', {
    header: '바이오마커',
    enableSorting: false,
    cell: ({ getValue }) => {
      const list = getValue() ?? []
      if (list.length === 0) return <span className="text-slate-300">—</span>
      return (
        <div className="flex flex-wrap gap-1">
          {list.slice(0, 3).map((b) => (
            <span key={b} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
              {b}
            </span>
          ))}
          {list.length > 3 && (
            <span className="text-xs text-slate-400">+{list.length - 3}</span>
          )}
        </div>
      )
    },
    size: 170,
  }),

  col.accessor('target', {
    header: '타겟',
    cell: ({ getValue, row }) => {
      const v = getValue()
      const ai = row.original.target_src === 'llm'
      return v === 'Unknown' ? (
        <span className="text-orange-500 font-medium flex items-center gap-1">
          <span>🔍</span> Unknown
        </span>
      ) : (
        <span className="font-medium">{v}{ai && <AiTag ruleValue={row.original.target_rule} />}</span>
      )
    },
    size: 110,
  }),

  col.accessor('modality', {
    header: '모달리티',
    cell: ({ getValue, row }) => (
      <span className="inline-flex items-center">
        <ModalityBadge modality={getValue()} />
        {row.original.modality_src === 'llm' && <AiTag ruleValue={row.original.modality_rule} />}
      </span>
    ),
    size: 160,
  }),

  col.accessor('cancer_category', {
    header: '인디케이션',
    cell: ({ row }) => {
      const d = row.original
      // 복수 암종 보존: conditions 전체를 표시(중복 제거), 없으면 대표 condition
      const conds = (d.conditions?.length ? d.conditions : (d.condition ? [d.condition] : []))
        .filter(Boolean)
      const uniq = [...new Set(conds)]
      return (
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-600">
            {d.cancer_category || '—'}
            {d.indication_needs_review && (
              <span
                className="ml-1 text-amber-500 cursor-help"
                title={`제목과 등록 질환(condition)이 불일치 — 제목 기준으로 분류함.\nconditions: ${uniq.join(', ')}`}
              >⚠</span>
            )}
          </div>
          {uniq.length > 0 && (
            <div className="text-xs text-slate-400 line-clamp-2" title={uniq.join(' · ')}>
              {uniq.join(', ')}
              {uniq.length > 1 && (
                <span className="ml-1 text-[9px] font-bold text-violet-500">×{uniq.length}</span>
              )}
            </div>
          )}
        </div>
      )
    },
    size: 150,
  }),

  col.accessor('phase', {
    header: 'Phase',
    cell: ({ getValue }) => {
      const v = getValue() || '—'
      const clean = v.replace('PHASE', 'Ph').replace('EARLY_', 'Early ').replace('_', '/')
      const colorMap = {
        PHASE1: 'bg-blue-100 text-blue-700',
        EARLY_PHASE1: 'bg-sky-100 text-sky-700',
        PHASE2: 'bg-violet-100 text-violet-700',
        PHASE3: 'bg-green-100 text-green-700',
        PHASE4: 'bg-orange-100 text-orange-700',
      }
      const cls = colorMap[v] ?? 'bg-slate-100 text-slate-500'
      return <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cls}`}>{clean}</span>
    },
    size: 90,
  }),

  col.accessor('overall_status', {
    header: 'Status',
    cell: ({ getValue }) => <StatusDot status={getValue()} />,
    size: 140,
  }),

  col.accessor('start_date', {
    header: 'Start',
    cell: ({ getValue }) => (
      <span className="text-sm text-slate-600 whitespace-nowrap">{getValue() || '—'}</span>
    ),
    size: 112,
  }),

  col.accessor('primary_completion_date', {
    header: 'Completion',
    cell: ({ getValue }) => (
      <span className="text-sm text-slate-600 whitespace-nowrap">{getValue() || '—'}</span>
    ),
    size: 112,
  }),

  col.accessor('partnership_status', {
    header: 'Partnership',
    cell: ({ getValue }) => {
      const v = getValue()
      return (
        <span className={`text-xs font-medium ${v === 'partnered' ? 'text-violet-600' : 'text-slate-500'}`}>
          {v === 'partnered' ? 'Partnered' : 'Solo'}
        </span>
      )
    },
    size: 90,
  }),
  ]
}


export default function PipelineTable({ drugs, nctIndex = {} }) {
  const [sorting, setSorting] = useState([])
  const [columnSizing, setColumnSizing] = useState({})
  const columns = useMemo(() => makeColumns(nctIndex), [nctIndex])

  const table = useReactTable({
    data: drugs,
    columns,
    state: { sorting, columnSizing },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  })

  if (drugs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 py-20">
        No data to display
      </div>
    )
  }

  const { pageIndex, pageSize } = table.getState().pagination
  const total = drugs.length

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="overflow-auto flex-1">
        <table
          className="text-sm border-collapse"
          style={{ width: table.getTotalSize() }}
        >
          <thead className="sticky top-0 bg-slate-50 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-slate-200">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ width: header.getSize(), position: 'relative' }}
                    className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                  >
                    {header.column.getCanSort() ? (
                      <button
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex items-center gap-1 hover:text-slate-800"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIcon direction={header.column.getIsSorted()} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                    {/* 리사이즈 핸들 */}
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none
                        ${header.column.getIsResizing()
                          ? 'bg-blue-400'
                          : 'bg-transparent hover:bg-slate-300'
                        }`}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{ width: cell.column.getSize() }}
                    className="px-3 py-2 align-top overflow-hidden"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <div className="border-t border-slate-200 bg-white px-4 py-2 flex items-center justify-between text-sm text-slate-500">
        <span>
          {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, total)} of {total}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50"
          >
            ‹
          </button>
          <span>
            {pageIndex + 1} / {table.getPageCount()}
          </span>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50"
          >
            ›
          </button>
          <select
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="border border-slate-200 rounded px-1 py-1 text-xs"
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

function SortIcon({ direction }) {
  if (!direction) return <span className="text-slate-300 text-xs">⇅</span>
  return <span className="text-blue-500 text-xs">{direction === 'asc' ? '↑' : '↓'}</span>
}
