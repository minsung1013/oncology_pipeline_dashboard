import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getExpandedRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table'
import { useState, useMemo, Fragment } from 'react'
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

// 약물명 셀 — 이름/NCT링크/병용/AI요약 토글 + 연결(논문·초록) 배지(=펼침 토글)
function DrugCell({ d, links, isExpanded, onToggleLinks, canExpand }) {
  const [expanded, setExpanded] = useState(false)   // 다중 NCT 펼침
  const [showSummary, setShowSummary] = useState(false)
  const ncts = d.nct_ids ?? []
  const combo = d.combo_drugs ?? []
  const primaryUrl = d.clinicaltrials_url || (ncts[0] ? `https://clinicaltrials.gov/study/${ncts[0]}` : null)
  const nPub = links?.n_pub ?? 0
  const nConf = links?.n_conf ?? 0

  return (
    <div>
      {/* 대표 약물명 → 첫 NCT 링크 + 연결 배지(펼침) */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {primaryUrl ? (
          <a href={primaryUrl} target="_blank" rel="noreferrer"
             className="text-blue-600 hover:underline font-medium">
            {d.drug_name}
          </a>
        ) : (
          <span className="font-medium">{d.drug_name}</span>
        )}

        {canExpand && (
          <button
            onClick={onToggleLinks}
            className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-semibold transition-colors
              ${isExpanded ? 'bg-violet-200 text-violet-800' : 'bg-violet-50 text-violet-600 hover:bg-violet-100'}`}
            title={`연결된 학회초록 ${nConf} · 논문 ${nPub} — 클릭하여 ${isExpanded ? '접기' : '펼치기'}`}
          >
            {nPub > 0 && <span>📄{nPub}</span>}
            {nConf > 0 && <span>🎤{nConf}</span>}
            <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▸</span>
          </button>
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

      {/* AI 한국어 요약 — 토글 (기본 숨김) */}
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

      {/* 다중 NCT 전체 링크 목록 */}
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

// 펼침 패널 안의 연결된 학회초록/논문 한 건: 출처배지 · 제목+한국어요약 · 저자+소속
function LinkedItem({ it }) {
  const isPub = it.axis === 'publication'
  const href = it.pmid
    ? `https://pubmed.ncbi.nlm.nih.gov/${it.pmid}/`
    : it.doi ? `https://doi.org/${it.doi}` : null
  const yr = it.year ? `·${String(it.year).slice(2)}` : ''
  const venue = `${it.venue ?? (isPub ? 'Journal' : 'Conf')}${yr}`
  return (
    <div className="flex gap-2.5 items-start py-1.5">
      <span
        className={`shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
          isPub ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}
        title={isPub ? 'Journal publication' : 'Conference abstract'}
      >
        {isPub ? '📄' : '🎤'} {venue}
      </span>
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
      <div className="shrink-0 w-44 text-[11px] leading-tight">
        <div className="font-medium text-slate-600 truncate" title={it.author || ''}>{it.author || '—'}</div>
        {it.affil && <div className="text-slate-400 line-clamp-2" title={it.affil}>{it.affil}</div>}
      </div>
    </div>
  )
}

// 약물 행 아래로 펼쳐지는 연결 패널 (논문·초록 목록)
function LinkPanel({ links }) {
  const items = links?.linked ?? []
  const nPub = links?.n_pub ?? 0
  const nConf = links?.n_conf ?? 0
  const more = (links?.total ?? items.length) - items.length
  return (
    <div className="bg-violet-50/40 border-l-4 border-violet-300 px-4 py-2">
      <div className="text-[11px] font-semibold text-violet-700 mb-1">
        연결된 근거 — 📄 논문 {nPub} · 🎤 학회초록 {nConf}
      </div>
      <div className="divide-y divide-violet-100">
        {items.map((it) => <LinkedItem key={it.uid} it={it} />)}
      </div>
      {more > 0 && (
        <div className="text-[10px] text-slate-400 mt-1">+{more}건 더 (상위 {items.length}건 표시)</div>
      )}
    </div>
  )
}

function makeColumns(drugLinks) {
  return [
  col.accessor('drug_name', {
    header: 'Drug',
    cell: ({ row }) => {
      const links = drugLinks[row.original.drug_id]
      const canExpand = !!(links && links.total > 0)
      return (
        <DrugCell
          d={row.original}
          links={links}
          canExpand={canExpand}
          isExpanded={row.getIsExpanded()}
          onToggleLinks={row.getToggleExpandedHandler()}
        />
      )
    },
    size: 240,
  }),

  col.accessor('company', {
    header: 'Company',
    cell: ({ row }) => {
      const d = row.original
      return (
        <div className="min-w-0">
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
  const [expanded, setExpanded] = useState({})
  const columns = useMemo(() => makeColumns(drugLinks), [drugLinks])

  const table = useReactTable({
    data: drugs,
    columns,
    state: { sorting, columnSizing, expanded },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    onExpandedChange: setExpanded,
    getRowCanExpand: (row) => !!drugLinks[row.original.drug_id]?.total,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
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
  const colCount = table.getVisibleLeafColumns().length

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
              <Fragment key={row.id}>
                <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
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
                {row.getIsExpanded() && (
                  <tr className="border-b border-slate-200">
                    <td colSpan={colCount} className="p-0">
                      <LinkPanel links={drugLinks[row.original.drug_id]} />
                    </td>
                  </tr>
                )}
              </Fragment>
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
