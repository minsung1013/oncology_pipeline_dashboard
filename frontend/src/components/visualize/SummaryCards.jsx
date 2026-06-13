function Card({ label, value, accent }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-col">
      <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? 'text-slate-800'}`}>{value}</span>
    </div>
  )
}

export default function SummaryCards({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card label="Records" value={stats.total.toLocaleString()} />
      <Card label="Companies" value={stats.uniqueCompanies.toLocaleString()} />
      <Card label="Cancer Types" value={stats.uniqueCancerTypes.toLocaleString()} />
      <Card label="Biomarker Mentioned" value={`${stats.biomarkerPct}%`} accent="text-rose-600" />
    </div>
  )
}
