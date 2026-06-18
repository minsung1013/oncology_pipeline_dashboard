import { Link } from 'react-router-dom'

function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <line x1="20.5" y1="20.5" x2="28.5" y2="28.5" stroke="#2563eb" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="13" cy="13" r="9.6" fill="#eff6ff" stroke="#2563eb" strokeWidth="2.2" />
      <g fill="none" strokeLinecap="round">
        <line x1="9.2" y1="9.5" x2="16.8" y2="9.5" stroke="#93c5fd" strokeWidth="1.3" />
        <line x1="9.2" y1="16.5" x2="16.8" y2="16.5" stroke="#93c5fd" strokeWidth="1.3" />
        <path d="M13 5.8 C16 7 17 8 17 9.5 C17 11 16 12 13 13 C10 14 9 15 9 16.5 C9 18 10 19 13 20.2" stroke="#2563eb" strokeWidth="1.7" />
        <path d="M13 5.8 C10 7 9 8 9 9.5 C9 11 10 12 13 13 C16 14 17 15 17 16.5 C17 18 16 19 13 20.2" stroke="#7c3aed" strokeWidth="1.7" />
      </g>
    </svg>
  )
}

const STATS = [
  { n: '33,735', l: 'industry trials' },
  { n: '6,039', l: 'companies' },
  { n: '64,217', l: 'conference abstracts' },
  { n: 'ASCO · AACR', l: '2022–2026' },
]

const FEATURES = [
  {
    to: '/pipeline', tag: 'Pipeline', color: 'blue',
    title: 'Clinical Trial Pipeline',
    desc: 'Industry-sponsored oncology trials. Filter by company, cancer, modality, target, phase, status and biomarker; spot CDx-relevant targets, partnership status and linked papers.',
  },
  {
    to: '/conferences', tag: 'Conferences', color: 'purple',
    title: 'ASCO & AACR Abstracts',
    desc: 'Five years of ASCO and AACR abstracts — authors with institutions and countries normalized to a clean level, plus pharma sponsors, drugs, targets and biomarkers, cross-linked to the matching trial by NCT.',
  },
  {
    to: '/conference-visualize', tag: 'Visualize', color: 'teal',
    title: 'Cross-Filter Analytics',
    desc: 'Per-domain interactive dashboards — separate Conference and Pipeline views covering modality, target, biomarker, cancer, company, institution, country and phase. Click any bar to drill down across the dashboard.',
  },
]

const SOURCES = [
  { name: 'ClinicalTrials.gov', desc: 'Trial records via the official API v2 (industry-sponsored cancer studies).' },
  { name: 'Crossref', desc: 'ASCO (J Clin Oncol) & AACR (Cancer Research) abstract metadata + full text.' },
  { name: 'Enrichment', desc: 'Rule-based dictionaries + a local LLM (Qwen3) for modality / target / biomarker, plus field normalization (institutions, countries, companies).' },
]

const TAG_CLS = {
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  teal: 'bg-teal-100 text-teal-700',
}

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-auto bg-gradient-to-b from-slate-50 to-blue-50/40">
      {/* Hero */}
      <div className="max-w-5xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Logo size={44} />
          <span className="text-3xl font-bold text-slate-800">
            <span className="text-blue-600">Onco</span>lyzer
          </span>
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 leading-tight">
          Oncology BD &amp; CDx Intelligence
        </h1>
        <p className="mt-5 text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
          Track industry oncology trials and conference abstracts in one place — to surface
          companion-diagnostic and partnership opportunities, and see where pharma is betting.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/pipeline"
            className="px-6 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors shadow-sm"
          >
            Enter Dashboard →
          </Link>
          <Link
            to="/visualize"
            className="px-6 py-3 rounded-lg border border-slate-300 text-slate-600 font-semibold hover:bg-white transition-colors"
          >
            Explore Visualize
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
          {STATS.map((s) => (
            <div key={s.l} className="bg-white rounded-xl border border-slate-200 px-4 py-4">
              <div className="text-2xl font-bold text-slate-800">{s.n}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <div className="max-w-5xl mx-auto px-6 pb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">What it does</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <Link
              key={f.to} to={f.to}
              className="group bg-white rounded-xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-md transition-all"
            >
              <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded ${TAG_CLS[f.color]}`}>
                {f.tag}
              </span>
              <h3 className="mt-3 text-base font-bold text-slate-800">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              <span className="mt-3 inline-block text-sm text-blue-600 font-medium group-hover:underline">
                Open →
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Data sources */}
      <div className="max-w-5xl mx-auto px-6 py-10">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Data sources</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {SOURCES.map((s) => (
            <div key={s.name} className="bg-white/70 rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-bold text-slate-700">{s.name}</h3>
              <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs text-slate-400 text-center">
          Data refreshed periodically · abstracts cover ASCO &amp; AACR 2022–2026 · for business-development &amp; CDx research.
        </p>
      </div>

      <footer className="text-center text-xs text-slate-400 pb-8">
        Oncolyzer — built for oncology BD intelligence
      </footer>
    </div>
  )
}
