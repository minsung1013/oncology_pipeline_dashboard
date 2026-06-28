const CDX_STYLES = {
  high:   'bg-red-100 text-red-700 border border-red-200',
  medium: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  low:    'bg-slate-100 text-slate-500 border border-slate-200',
}

const CDX_DOT = {
  high:   'bg-red-500',
  medium: 'bg-yellow-400',
  low:    'bg-slate-400',
}

export default function CdxBadge({ level }) {
  if (!level) return null
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${CDX_STYLES[level]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${CDX_DOT[level]}`} />
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  )
}

const STRATEGY_STYLES = {
  confirmed:   'bg-green-100 text-green-700',
  exploratory: 'bg-blue-100 text-blue-700',
  none:        'bg-slate-100 text-slate-500',
}

export function CdxStrategyBadge({ strategy }) {
  if (!strategy) return null
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded ${STRATEGY_STYLES[strategy] ?? 'bg-slate-100 text-slate-500'}`}>
      {strategy}
    </span>
  )
}

const MODALITY_COLORS = {
  'ADC':                'bg-purple-100 text-purple-700',
  'Bispecific Antibody':'bg-indigo-100 text-indigo-700',
  'CAR-T':              'bg-pink-100 text-pink-700',
  'Monoclonal Antibody':'bg-sky-100 text-sky-700',
  'Fusion Protein':     'bg-cyan-100 text-cyan-700',
  'Recombinant Protein':'bg-emerald-100 text-emerald-700',
  'Small Molecule':     'bg-teal-100 text-teal-700',
  'mRNA':               'bg-orange-100 text-orange-700',
  'Vaccine':            'bg-rose-100 text-rose-700',
  'Peptide':            'bg-lime-100 text-lime-700',
  'Cell Therapy':       'bg-fuchsia-100 text-fuchsia-700',
  'Oncolytic Virus':    'bg-amber-100 text-amber-700',
  'Radiopharmaceutical':'bg-red-100 text-red-700',
  'Unknown':            'bg-slate-100 text-slate-400',
}

export function ModalityBadge({ modality }) {
  if (!modality) return null
  const cls = MODALITY_COLORS[modality] ?? 'bg-slate-100 text-slate-500'
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${cls}`}>
      {modality}
    </span>
  )
}

const STATUS_STYLES = {
  RECRUITING:              'text-green-600',
  ACTIVE_NOT_RECRUITING:   'text-yellow-600',
  NOT_YET_RECRUITING:      'text-blue-500',
  ENROLLING_BY_INVITATION: 'text-cyan-600',
}

const STATUS_LABELS = {
  RECRUITING:              'Recruiting',
  ACTIVE_NOT_RECRUITING:   'Active',
  NOT_YET_RECRUITING:      'Not yet recruiting',
  ENROLLING_BY_INVITATION: 'By invitation',
  COMPLETED:               'Completed',
  TERMINATED:              'Terminated',
  WITHDRAWN:               'Withdrawn',
  SUSPENDED:               'Suspended',
  UNKNOWN:                 'Unknown',
}

export function StatusDot({ status }) {
  const cls = STATUS_STYLES[status] ?? 'text-slate-400'
  const label = STATUS_LABELS[status] ?? status?.replace(/_/g, ' ') ?? ''
  return <span className={`text-xs font-medium ${cls}`}>{label}</span>
}
