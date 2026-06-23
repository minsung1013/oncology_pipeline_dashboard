export default function ChartCard({ title, subtitle, children, height = 300, action }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div style={{ height }}>{children}</div>
    </div>
  )
}

export function EmptyHint({ message }) {
  return (
    <div className="h-full flex items-center justify-center text-slate-400 text-xs text-center px-4">
      {message}
    </div>
  )
}
