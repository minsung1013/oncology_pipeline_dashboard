import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table'
import { useState, useCallback } from 'react'
import { ModalityBadge, StatusDot } from './CdxBadge'

const col = createColumnHelper()

const COLUMNS = [
  col.accessor('drug_name', {
    header: '약물명',
    cell: ({ row }) => {
      const d = row.original
      const url = d.clinicaltrials_url || (d.nct_ids?.[0] ? `https://clinicaltrials.gov/study/${d.nct_ids[0]}` : null)
      return (
        <div>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline font-medium"
            >
              {d.drug_name}
            </a>
          ) : (
            <span className="font-medium">{d.drug_name}</span>
          )}
          {d.nct_ids?.length > 1 && (
            <span className="ml-1 text-xs text-slate-400">+{d.nct_ids.length - 1}</span>
          )}
        </div>
      )
    },
    size: 160,
  }),

  col.accessor('company', {
    header: '회사',
    cell: ({ row }) => {
      const d = row.original
      return (
        <div>
          <span className="font-medium text-slate-700">{d.company || '—'}</span>
          {d.collaborators?.length > 0 && (
            <div className="text-xs text-slate-400 truncate max-w-40" title={d.collaborators.join(', ')}>
              + {d.collaborators.join(', ')}
            </div>
          )}
        </div>
      )
    },
    size: 170,
  }),

  col.accessor('target', {
    header: '타겟',
    cell: ({ getValue }) => {
      const v = getValue()
      return v === 'Unknown' ? (
        <span className="text-orange-500 font-medium flex items-center gap-1">
          <span>🔍</span> Unknown
        </span>
      ) : (
        <span className="font-medium">{v}</span>
      )
    },
    size: 110,
  }),

  col.accessor('modality', {
    header: '모달리티',
    cell: ({ getValue }) => <ModalityBadge modality={getValue()} />,
    size: 160,
  }),

  col.accessor('cancer_category', {
    header: '암종',
    size: 110,
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
    header: '등록 상태',
    cell: ({ getValue }) => <StatusDot status={getValue()} />,
    size: 140,
  }),

  col.accessor('primary_completion_date', {
    header: 'Completion',
    cell: ({ getValue }) => (
      <span className="text-sm text-slate-600">{getValue() || '—'}</span>
    ),
    size: 100,
  }),

  col.accessor('partnership_status', {
    header: '파트너십',
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
    size: 180,
  }),

  col.accessor('moa', {
    header: 'MoA',
    enableSorting: false,
    cell: ({ getValue }) => {
      const v = getValue() || '—'
      return (
        <span title={v} className="text-xs text-slate-500 truncate block max-w-36">
          {v}
        </span>
      )
    },
    size: 150,
  }),

  col.accessor('brief_summary', {
    header: 'Study Summary',
    enableSorting: false,
    cell: ({ getValue }) => <SummaryCell text={getValue()} />,
    size: 240,
  }),

  col.display({
    id: 'pubmed',
    header: '논문',
    enableSorting: false,
    cell: ({ row }) => {
      const links = row.original.pubmed_links ?? []
      if (links.length === 0) return <span className="text-slate-300">—</span>
      return (
        <div className="flex gap-1">
          {links.map((l) => (
            <a
              key={l.pmid}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              title={l.title}
              className="text-blue-500 hover:text-blue-700 text-sm"
            >
              📄
            </a>
          ))}
        </div>
      )
    },
    size: 60,
  }),
]

function SummaryCell({ text }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return <span className="text-slate-300">—</span>

  const SHORT_LEN = 80
  const isLong = text.length > SHORT_LEN
  const preview = isLong ? text.slice(0, SHORT_LEN) + '…' : text

  return (
    <div className="text-xs text-slate-600 leading-relaxed">
      {expanded ? (
        <>
          <span>{text}</span>
          <button
            onClick={() => setExpanded(false)}
            className="ml-1 text-blue-400 hover:text-blue-600 whitespace-nowrap font-medium"
          >
            접기 ▲
          </button>
        </>
      ) : (
        <>
          <span>{preview}</span>
          {isLong && (
            <button
              onClick={() => setExpanded(true)}
              className="ml-1 text-blue-400 hover:text-blue-600 whitespace-nowrap font-medium"
            >
              더보기 ▼
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default function PipelineTable({ drugs }) {
  const [sorting, setSorting] = useState([])
  const [columnSizing, setColumnSizing] = useState({})

  const table = useReactTable({
    data: drugs,
    columns: COLUMNS,
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
        표시할 데이터가 없습니다
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
          {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, total)} / {total}건
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
              <option key={n} value={n}>{n}개씩</option>
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
