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

function DrugCell({ d, nctIndex }) {
  const [expanded, setExpanded] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const ncts = d.nct_ids ?? []
  const combo = d.combo_drugs ?? []
  const primaryUrl = d.clinicaltrials_url || (ncts[0] ? `https://clinicaltrials.gov/study/${ncts[0]}` : null)
  // nct_index: NCT → [{uid, axis, conference|journal, year}]. 학회 발표 + 논문 둘 다 배지로.
  const linkNct = ncts.find((nct) => nctIndex?.[nct]?.length)
  const entries = linkNct ? (nctIndex[linkNct] || []) : []
  const confLabel = [...new Set(entries.filter((e) => e.axis !== 'publication').map((e) => e.conference))]
    .filter(Boolean).join('/')
  const pubCount = entries.filter((e) => e.axis === 'publication').length

  return (
    <div>
      {/* 대표 약물명 → 첫 NCT 링크 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {primaryUrl ? (
          <a href={primaryUrl} target="_blank" rel="noreferrer"
             className="text-blue-600 hover:underline font-medium">
            {d.drug_name}
          </a>
        ) : (
          <span className="font-medium">{d.drug_name}</span>
        )}
        {confLabel && (
          <Link
            to={`/conferences?nct=${linkNct}`}
            className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold hover:bg-amber-200 transition-colors"
            title={`Conference abstract (${confLabel}) · ${linkNct}`}
          >
            {confLabel}
          </Link>
        )}
        {pubCount > 0 && (
          <Link
            to={`/publications?nct=${linkNct}`}
            className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold hover:bg-emerald-200 transition-colors"
            title={`${pubCount} journal publication(s) · ${linkNct}`}
          >
            {pubCount} Pub
          </Link>
        )}
        {ncts.length > 1 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-slate-400 hover:text-blue-500"
          >
            {expanded ? '▲' : `+${ncts.length - 1} NCT ▼`}
          </button>
        )}
      </div>

      {/* 병용 약물 */}
      {combo.length > 0 && (
        <div className="text-xs text-slate-400 mt-0.5" title={combo.join(', ')}>
          + {combo.join(', ')}
        </div>
      )}

      {/* AI 한국어 요약 — 토글 (기본 숨김, 클릭 시 펼침) */}
      {d.summary_ko && (
        <div className="mt-1">
          <button
            onClick={() => setShowSummary((v) => !v)}
            className="text-[10px] font-semibold text-violet-600 hover:text-violet-800 inline-flex items-center gap-0.5"
          >
            {showSummary ? '▲ AI 요약 숨기기' : '▼ AI 요약'}
          </button>
          {showSummary && (
            <div className="text-xs text-slate-600 mt-0.5 leading-snug border-l-2 border-violet-100 pl-2">
              {d.summary_ko}
            </div>
          )}
        </div>
      )}

      {/* 확장 시 전체 NCT 링크 목록 */}
      {expanded && ncts.length > 1 && (
        <div className="mt-1 flex flex-col gap-0.5 border-l-2 border-slate-100 pl-2">
          {ncts.map((nct) => (
            <a
              key={nct}
              href={`https://clinicaltrials.gov/study/${nct}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-500 hover:underline font-mono"
            >
              {nct}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// 연결된 학회초록/논문 한 건 (하위 행 내부 레이아웃): 출처배지 · 제목+한국어요약 · 저자+소속
function LinkedRow({ it }) {
  const isPub = it.axis === 'publication'
  const href = it.pmid
    ? `https://pubmed.ncbi.nlm.nih.gov/${it.pmid}/`
    : it.doi ? `https://doi.org/${it.doi}` : null
  const yr = it.year ? `·${String(it.year).slice(2)}` : ''
  const venue = `${it.venue ?? (isPub ? 'Journal' : 'Conf')}${yr}`
  return (
    <div className="flex gap-2 items-start">
      {/* 출처 배지 (제목 앞 작게) */}
      <span
        className={`shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
          isPub ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}
        title={isPub ? 'Journal publication' : 'Conference abstract'}
      >
        {isPub ? '📄' : '🎤'} {venue}
      </span>
      {/* 제목 + 한국어 요약 */}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-700 leading-snug">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="hover:underline">{it.title || '—'}</a>
          ) : (it.title || '—')}
          {it.why === 'nct' && (
            <span className="ml-1 text-[9px] font-bold text-blue-400 align-middle" title="NCT 직접 연결">●NCT</span>
          )}
        </div>
        {it.summary_ko && (
          <div className="text-[11px] text-slate-500 leading-snug mt-0.5 border-l-2 border-slate-200 pl-1.5">
            {it.summary_ko}
          </div>
        )}
      </div>
      {/* 대표 저자 + 소속 (학회=발표자, 논문=교신/책임) */}
      <div className="shrink-0 w-40 text-[11px] leading-tight">
        <div className="font-medium text-slate-600 truncate" title={it.author || ''}>{it.author || '—'}</div>
        {it.affil && <div className="text-slate-400 line-clamp-2" title={it.affil}>{it.affil}</div>}
      </div>
    </div>
  )
}

// 약물 1개 = 메인행(pipeline) + 연결된 논문·초록 하위행들. 우측 공통열은 rowSpan으로 병합.
// 정렬/필터/페이지는 TanStack이 약물 단위로 관리하고, 하위행은 렌더링 레이어에서만 펼침.
const LEFT_IDS = new Set(['drug_name', 'company', 'countries'])

function DrugRowGroup({ row, links }) {
  const [expanded, setExpanded] = useState(false)
  const cells = row.getVisibleCells()
  const leftCells = cells.filter((c) => LEFT_IDS.has(c.column.id))
  const rightCells = cells.filter((c) => !LEFT_IDS.has(c.column.id))

  const linked = links?.linked ?? []
  const nLinks = linked.length
  const shown = expanded ? linked : linked.slice(0, 3)
  const hasToggle = nLinks > 3
  const span = 1 + shown.length + (hasToggle ? 1 : 0)  // 우측 공통열 rowSpan = 그룹 총 <tr> 수

  const tdCommon = 'px-3 py-2 align-top overflow-hidden'
  return (
    <>
      {/* 메인 파이프라인 행 */}
      <tr className="border-b border-slate-100 hover:bg-slate-50/60 bg-white">
        {leftCells.map((cell) => (
          <td key={cell.id} style={{ width: cell.column.getSize() }} className={tdCommon}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
        {rightCells.map((cell) => (
          <td
            key={cell.id}
            rowSpan={span}
            style={{ width: cell.column.getSize() }}
            className={`${tdCommon} border-l border-slate-50`}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>

      {/* 연결된 논문·초록 하위행 (좌측 3열 병합) */}
      {shown.map((it) => (
        <tr key={it.uid} className="border-b border-slate-100 bg-violet-50/30 hover:bg-violet-50/60">
          <td colSpan={leftCells.length} className="px-3 py-1.5 align-top border-l-2 border-violet-200">
            <LinkedRow it={it} />
          </td>
        </tr>
      ))}

      {/* 더보기 / 접기 토글 */}
      {hasToggle && (
        <tr className="border-b border-slate-100 bg-violet-50/30">
          <td colSpan={leftCells.length} className="px-3 py-1 border-l-2 border-violet-200">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] font-semibold text-violet-600 hover:text-violet-800"
            >
              {expanded ? '▲ 접기' : `+${nLinks - 3} more (논문·학회 ▼)`}
            </button>
          </td>
        </tr>
      )}
    </>
  )
}

function makeColumns(nctIndex) {
  return [
  col.accessor('drug_name', {
    header: 'Drug',
    cell: ({ row }) => <DrugCell d={row.original} nctIndex={nctIndex} />,
    size: 220,
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

  col.accessor('target', {
    header: 'Target',
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

  // Biomarker는 Target 옆으로 이동
  col.accessor('biomarker_list', {
    header: 'Biomarkers',
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

  col.accessor('modality', {
    header: 'Modality',
    cell: ({ getValue, row }) => (
      <span className="inline-flex items-center">
        <ModalityBadge modality={getValue()} />
        {row.original.modality_src === 'llm' && <AiTag ruleValue={row.original.modality_rule} />}
      </span>
    ),
    size: 160,
  }),

  col.accessor('cancer_category', {
    header: 'Indication',
    cell: ({ row }) => {
      const d = row.original
      // 복수 암종 보존: conditions 전체를 표시(중복 제거), 없으면 대표 condition
      const conds = (d.conditions?.length ? d.conditions : (d.condition ? [d.condition] : []))
        .filter(Boolean)
      const uniq = [...new Set(conds)]
      return (
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-600">{d.cancer_category || '—'}</div>
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

  // MoA는 truncate 대신 줄바꿈으로 전체 표시
  col.accessor('moa', {
    header: 'MoA',
    enableSorting: false,
    cell: ({ getValue }) => (
      <span className="text-xs text-slate-500 break-words leading-tight block">{getValue() || '—'}</span>
    ),
    size: 170,
  }),
  ]
}


export default function PipelineTable({ drugs, nctIndex = {}, drugLinks = {} }) {
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
              <DrugRowGroup
                key={row.id}
                row={row}
                links={drugLinks[row.original.drug_id]}
              />
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
