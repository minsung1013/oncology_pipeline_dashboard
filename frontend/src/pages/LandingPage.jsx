import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import FilterMultiSelect from '../components/common/FilterMultiSelect'
import { phaseLabel } from '../utils/visualizeAggregations'
import { getShared, setShared } from '../utils/filterStore'
import { getFacets, prefetchPipeline, prefetchAbstracts } from '../utils/dataSource'

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

const SOURCES = [
  { name: 'ClinicalTrials.gov', desc: 'Trial records via the official API v2 (industry-sponsored cancer studies).' },
  { name: 'Crossref', desc: 'ASCO (J Clin Oncol) & AACR (Cancer Research) abstract metadata + full text.' },
  { name: 'Enrichment', desc: 'Rule-based dictionaries + a local LLM (Qwen3) for modality / target / biomarker, plus institution / country / company normalization and Korean summaries.' },
]

const EMPTY = { cancers: [], modalities: [], targets: [], biomarkers: [], companies: [], phases: [], keyword: '' }

export default function LandingPage() {
  const navigate = useNavigate()
  const [facets, setFacets] = useState(null)
  // 기존 공유 필터를 반영해 시작 (다른 탭에서 설정한 값 유지)
  const [f, setF] = useState(() => {
    const s = getShared()
    return {
      cancers: s.cancers ?? [], modalities: s.modalities ?? [], targets: s.targets ?? [],
      biomarkers: s.biomarkers ?? [], companies: s.companies ?? [], phases: s.phases ?? [],
      keyword: s.keyword ?? '',
    }
  })

  useEffect(() => { getFacets().then(setFacets).catch(() => setFacets({})) }, [])

  const set = (key, value) => setF((prev) => ({ ...prev, [key]: value }))
  const activeCount = useMemo(
    () => ['cancers', 'modalities', 'targets', 'biomarkers', 'companies', 'phases'].reduce((n, k) => n + f[k].length, 0) + (f.keyword ? 1 : 0),
    [f],
  )

  // 선택한 필터를 공유 스토어에 반영 후 해당 visualize 탭으로 이동
  function go(path) {
    setShared({
      ...getShared(),
      cancers: f.cancers, modalities: f.modalities, targets: f.targets,
      biomarkers: f.biomarkers, companies: f.companies, phases: f.phases, keyword: f.keyword,
    })
    navigate(path)
  }

  const counts = facets?.counts ?? {}
  const stats = [
    { n: counts.drugs ? counts.drugs.toLocaleString() : '—', l: 'industry trials' },
    { n: counts.abstracts ? counts.abstracts.toLocaleString() : '—', l: 'conference abstracts' },
    { n: counts.companies ? counts.companies.toLocaleString() : '—', l: 'companies' },
    { n: 'ASCO · AACR', l: '2022–2026' },
  ]

  return (
    <div className="min-h-screen overflow-auto bg-gradient-to-b from-slate-50 to-blue-50/40">
      {/* Hero + concept */}
      <div className="max-w-5xl mx-auto px-6 pt-16 pb-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-5">
          <Logo size={44} />
          <span className="text-3xl font-bold text-slate-800">
            <span className="text-blue-600">Onco</span>lyzer
          </span>
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 leading-tight">
          What the biopharma industry is researching — and building
        </h1>
        <p className="mt-4 text-base text-slate-500 max-w-2xl mx-auto leading-relaxed">
          See who is studying which targets, cancers and biomarkers at <b>ASCO &amp; AACR</b>,
          and how those translate into <b>industry clinical pipelines</b> — the research signal and
          the commercial solution, side by side. Set a filter once, explore both.
        </p>
      </div>

      {/* Unified filter — center */}
      <div className="max-w-4xl mx-auto px-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-700">Build your search</h2>
            {activeCount > 0 && (
              <button onClick={() => setF(EMPTY)} className="text-xs text-slate-400 hover:text-red-500">
                Clear ({activeCount})
              </button>
            )}
          </div>

          <input
            type="text"
            value={f.keyword}
            onChange={(e) => set('keyword', e.target.value)}
            placeholder="Keyword — drug, gene, MoA, NCT, author…"
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />

          <div className="flex flex-wrap gap-2">
            <FilterMultiSelect label="Cancer" options={facets?.cancers ?? []} selected={f.cancers} onChange={(v) => set('cancers', v)} />
            <FilterMultiSelect label="Modality" options={facets?.modalities ?? []} selected={f.modalities} onChange={(v) => set('modalities', v)} />
            <FilterMultiSelect label="Target" options={facets?.targets ?? []} selected={f.targets} onChange={(v) => set('targets', v)} />
            <FilterMultiSelect label="Biomarker" options={facets?.biomarkers ?? []} selected={f.biomarkers} onChange={(v) => set('biomarkers', v)} />
            <FilterMultiSelect label="Company" options={facets?.companies ?? []} selected={f.companies} onChange={(v) => set('companies', v)} />
            <FilterMultiSelect label="Phase" options={facets?.phases ?? []} selected={f.phases} onChange={(v) => set('phases', v)} renderLabel={phaseLabel} />
          </div>

          {/* Two destinations */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
            <button
              onClick={() => go('/conference-visualize')}
              onMouseEnter={prefetchAbstracts}
              className="group text-left rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 hover:border-purple-300 transition-colors p-4"
            >
              <div className="text-xs font-semibold text-purple-600 uppercase tracking-wide">Research</div>
              <div className="mt-1 text-base font-bold text-slate-800">Conference Abstracts →</div>
              <div className="mt-1 text-xs text-slate-500">ASCO &amp; AACR studies, trends by year, players &amp; targets.</div>
            </button>
            <button
              onClick={() => go('/visualize')}
              onMouseEnter={prefetchPipeline}
              className="group text-left rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-300 transition-colors p-4"
            >
              <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Industry</div>
              <div className="mt-1 text-base font-bold text-slate-800">Clinical Pipeline →</div>
              <div className="mt-1 text-xs text-slate-500">Industry-sponsored trials, partnership &amp; CDx opportunities.</div>
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-slate-400">
            Filters apply to both views. Prefer tables? Open <button onClick={() => go('/conferences')} className="text-purple-600 hover:underline">Abstracts</button> or <button onClick={() => go('/pipeline')} className="text-blue-600 hover:underline">Pipeline</button>.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="max-w-3xl mx-auto px-6 mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.l} className="bg-white rounded-xl border border-slate-200 px-4 py-3 text-center">
            <div className="text-xl font-bold text-slate-800">{s.n}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Concept / what's inside */}
      <div className="max-w-5xl mx-auto px-6 pt-12 pb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">What's inside</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded bg-purple-100 text-purple-700">Research signal</span>
            <h3 className="mt-3 text-base font-bold text-slate-800">5 years of ASCO &amp; AACR</h3>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              64k abstracts (2022–2026) enriched with modality / target / biomarker, normalized
              institutions &amp; countries, Korean summaries, and NCT cross-links to the matching trial.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-700">Industry solution</span>
            <h3 className="mt-3 text-base font-bold text-slate-800">Industry clinical pipeline</h3>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              33k industry-sponsored oncology trials across 6k companies — phase, status,
              partnership and CDx-relevant targets, with linked papers.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded bg-teal-100 text-teal-700">One lens</span>
            <h3 className="mt-3 text-base font-bold text-slate-800">Research → market, connected</h3>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              Shared filters (cancer, modality, target, biomarker, company) carry across both views,
              so a target's academic momentum and its commercial pipeline read as one story.
            </p>
          </div>
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
