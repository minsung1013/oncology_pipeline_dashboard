import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table'
import { useState } from 'react'
import { ModalityBadge, StatusDot } from './CdxBadge'

const col = createColumnHelper()

function DrugCell({ d }) {
  const [expanded, setExpanded] = useState(false)
  const ncts = d.nct_ids ?? []
  const combo = d.combo_drugs ?? []
  const primaryUrl = d.clinicaltrials_url || (ncts[0] ? `https://clinicaltrials.gov/study/${ncts[0]}` : null)

  return (
    <div>
      {/* 대표 약물명 → 첫 NCT 링크 */}
      <div>
        {primaryUrl ? (
          <a href={primaryUrl} target="_blank" rel="noreferrer"
             className="text-blue-600 hover:underline font-medium">
            {d.drug_name}
          </a>
        ) : (
          <span className="font-medium">{d.drug_name}</span>
        )}
        {ncts.length > 1 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ml-1.5 text-xs text-slate-400 hover:text-blue-500"
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

const COLUMNS = [
  col.accessor('drug_name', {
    header: 'Drug',
    cell: ({ row }) => <DrugCell d={row.original} />,
    size: 200,
  }),

  col.accessor('company', {
    header: 'Company',
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
    header: 'Target',
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
    header: 'Modality',
    cell: ({ getValue }) => <ModalityBadge modality={getValue()} />,
    size: 160,
  }),

  col.accessor('cancer_category', {
    header: 'Indication',
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
    header: 'Status',
    cell: ({ getValue }) => <StatusDot status={getValue()} />,
    size: 140,
  }),

  col.accessor('start_date', {
    header: 'Start',
    cell: ({ getValue }) => (
      <span className="text-sm text-slate-600">{getValue() || '—'}</span>
    ),
    size: 100,
  }),

  col.accessor('primary_completion_date', {
    header: 'Completion',
    cell: ({ getValue }) => (
      <span className="text-sm text-slate-600">{getValue() || '—'}</span>
    ),
    size: 100,
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

  col.display({
    id: 'pubmed',
    header: 'Papers',
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
