import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table'
import { useState } from 'react'
import AuthorCell from './AuthorCell'
import { normalizeCountry } from '../../utils/dataClean'

const col = createColumnHelper()

function PhaseBadge({ phases }) {
  if (!phases?.length) return <span className="text-slate-300">—</span>
  const colorMap = {
    PHASE1: 'bg-blue-100 text-blue-700',
    EARLY_PHASE1: 'bg-sky-100 text-sky-700',
    PHASE2: 'bg-violet-100 text-violet-700',
    PHASE3: 'bg-green-100 text-green-700',
    PHASE4: 'bg-orange-100 text-orange-700',
  }
  return (
    <div className="flex flex-wrap gap-1">
      {phases.map((p) => {
        const label = p.replace('PHASE', 'Ph').replace('EARLY_', 'Early ').replace('_', '/')
        const cls = colorMap[p] ?? 'bg-slate-100 text-slate-500'
        return (
          <span key={p} className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cls}`}>
            {label}
          </span>
        )
      })}
    </div>
  )
}

function TagList({ items, colorCls = 'bg-slate-100 text-slate-600', max = 3 }) {
  if (!items?.length) return <span className="text-slate-300">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.slice(0, max).map((item) => (
        <span key={item} className={`text-xs px-1.5 py-0.5 rounded ${colorCls}`}>
          {item}
        </span>
      ))}
      {items.length > max && (
        <span className="text-xs text-slate-400">+{items.length - max}</span>
      )}
    </div>
  )
}

function TitleCell({ a }) {
  const [expanded, setExpanded] = useState(false)
  const hasText = a.abstract_text && a.abstract_text.length > 10

  return (
    <div>
      <div
        className={`text-sm font-medium text-slate-800 leading-tight ${expanded ? '' : 'line-clamp-2'}`}
        title={!expanded ? a.title : undefined}
      >
        {a.title || <span className="text-slate-400 italic">Embargoed</span>}
      </div>
      {hasText && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-blue-500 hover:text-blue-700 mt-0.5"
        >
          {expanded ? '▲ Collapse' : '▼ Abstract'}
        </button>
      )}
      {expanded && hasText && (
        <div className="mt-1.5 text-xs text-slate-600 leading-relaxed border-l-2 border-slate-200 pl-2 whitespace-pre-wrap max-h-60 overflow-auto">
          {a.abstract_text}
        </div>
      )}
    </div>
  )
}

function NctCell({ ncts, onPipeline }) {
  if (!ncts?.length) return <span className="text-slate-300">—</span>
  return (
    <div className="flex flex-col gap-0.5">
      {ncts.slice(0, 3).map((nct) => (
        <div key={nct} className="flex items-center gap-1">
          {/* NCT 클릭 → Pipeline 탭에서 해당 시험 필터 */}
          <button
            onClick={() => onPipeline?.(nct)}
            title="View this trial in the Pipeline tab"
            className="text-xs text-blue-600 hover:underline font-mono"
          >
            {nct}
          </button>
          <a
            href={`https://clinicaltrials.gov/study/${nct}`}
            target="_blank"
            rel="noreferrer"
            title="Open on ClinicalTrials.gov"
            className="text-slate-300 hover:text-blue-500 text-[10px]"
          >
            ↗
          </a>
        </div>
      ))}
      {ncts.length > 3 && (
        <span className="text-xs text-slate-400">+{ncts.length - 3}</span>
      )}
    </div>
  )
}

const COLUMNS = [
  col.accessor('conference', {
    header: 'Source',
    cell: ({ getValue }) => {
      const v = getValue()
      if (!v) return <span className="text-slate-300">—</span>
      // 학회별 색 (Visualize 연도 차트와 동일 팔레트)
      const cls = v === 'ASCO'
        ? 'bg-blue-100 text-blue-700'
        : v === 'AACR'
          ? 'bg-purple-100 text-purple-700'
          : 'bg-slate-100 text-slate-600'
      return (
        <span className={`inline-block text-xs font-semibold px-1.5 py-0.5 rounded ${cls}`}>
          {v}
        </span>
      )
    },
    size: 80,
  }),

  col.accessor('year', {
    header: 'Year',
    cell: ({ getValue }) => (
      <span className="text-xs font-medium text-slate-600">{getValue() ?? '—'}</span>
    ),
    size: 70,
  }),

  col.accessor('abstract_id', {
    header: '#',
    cell: ({ row }) => {
      const a = row.original
      return (
        <div className="flex flex-col items-start gap-0.5">
          <span className="font-mono text-xs font-semibold text-slate-700">
            {a.is_lba && (
              <span className="bg-amber-100 text-amber-700 text-xs px-1 py-0.5 rounded mr-1 font-bold">
                LBA
              </span>
            )}
            {a.abstract_id}
          </span>
          {a.status === 'embargoed' && (
            <span className="text-xs bg-slate-100 text-slate-400 px-1 py-0.5 rounded">
              embargoed
            </span>
          )}
        </div>
      )
    },
    size: 90,
  }),

  col.accessor('title', {
    header: 'Title',
    cell: ({ row }) => <TitleCell a={row.original} />,
    size: 420,
  }),

  col.accessor('author_raw', {
    header: 'First Author',
    cell: ({ getValue, row, table }) => (
      <AuthorCell
        raw={getValue()}
        name={row.original.authors?.[0]?.name}
        onClick={table.options.meta?.onAuthorClick}
      />
    ),
    size: 180,
  }),

  col.accessor((row) => row.authors?.[0]?.affiliation, {
    id: 'affiliation',
    header: 'Affiliation',
    sortUndefined: 'last',
    cell: ({ getValue }) => {
      const v = getValue()
      if (!v) return <span className="text-slate-300">—</span>
      return (
        <span className="text-xs text-slate-600 line-clamp-2" title={v}>
          {v}
        </span>
      )
    },
    size: 200,
  }),

  col.accessor((row) => normalizeCountry(row.authors?.[0]?.country), {
    id: 'country',
    header: 'Country',
    cell: ({ getValue }) => {
      const v = getValue()
      if (!v) return <span className="text-slate-300">—</span>
      return <span className="text-xs text-slate-600">{v}</span>
    },
    size: 110,
  }),

  col.accessor((row) => row.companies_normalized ?? [], {
    id: 'company',
    header: 'Company',
    enableSorting: false,
    cell: ({ getValue, row }) => {
      const list = getValue()
      const raw = row.original.research_sponsor
      if (!list.length) return <span className="text-slate-300">—</span>
      return (
        <div className="flex flex-wrap gap-1" title={raw || undefined}>
          {list.map((c) => (
            <span
              key={c}
              className="text-xs font-medium bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded"
            >
              {c}
            </span>
          ))}
        </div>
      )
    },
    size: 180,
  }),

  col.accessor('drugs_mentioned', {
    header: 'Drugs',
    enableSorting: false,
    cell: ({ getValue }) => (
      <TagList items={getValue()} colorCls="bg-emerald-50 text-emerald-700" max={3} />
    ),
    size: 170,
  }),

  col.accessor('cancer_category', {
    header: 'Cancer',
    enableSorting: false,
    cell: ({ getValue }) => {
      const cats = getValue() ?? []
      if (cats.length === 0) return <span className="text-slate-300">—</span>
      return (
        <span className="text-xs text-slate-600">{cats.join(', ')}</span>
      )
    },
    size: 120,
  }),

  col.accessor('phases', {
    header: 'Phase',
    cell: ({ getValue }) => <PhaseBadge phases={getValue()} />,
    size: 110,
  }),

  col.accessor('modality_list', {
    header: 'Modality',
    enableSorting: false,
    cell: ({ getValue }) => (
      <TagList items={getValue()} colorCls="bg-indigo-50 text-indigo-700" max={2} />
    ),
    size: 160,
  }),

  col.accessor('target_list', {
    header: 'Targets',
    enableSorting: false,
    cell: ({ getValue }) => (
      <TagList items={getValue()} colorCls="bg-teal-50 text-teal-700" max={3} />
    ),
    size: 160,
  }),

  col.accessor('biomarker_list', {
    header: 'Biomarkers',
    enableSorting: false,
    cell: ({ getValue }) => (
      <TagList items={getValue()} colorCls="bg-rose-50 text-rose-700" max={2} />
    ),
    size: 150,
  }),

  col.accessor('nct_ids', {
    id: 'nct_ids',
    header: 'NCT IDs',
    enableSorting: false,
    cell: ({ getValue, table }) => (
      <NctCell ncts={getValue()} onPipeline={table.options.meta?.onNctClick} />
    ),
    size: 130,
  }),
]

export default function AbstractTable({ abstracts, onAuthorClick, onNctClick }) {
  const [sorting, setSorting] = useState([])
  const [columnSizing, setColumnSizing] = useState({})

  const table = useReactTable({
    data: abstracts,
    columns: COLUMNS,
    state: { sorting, columnSizing },
    meta: { onAuthorClick, onNctClick },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  })

  if (abstracts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 py-20">
        No abstracts match the current filters
      </div>
    )
  }

  const { pageIndex, pageSize } = table.getState().pagination
  const total = abstracts.length

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
                        ${header.column.getIsResizing() ? 'bg-blue-400' : 'bg-transparent hover:bg-slate-300'}`}
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

      <div className="border-t border-slate-200 bg-white px-4 py-2 flex items-center justify-between text-sm text-slate-500 shrink-0">
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
          <span>{pageIndex + 1} / {table.getPageCount()}</span>
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
