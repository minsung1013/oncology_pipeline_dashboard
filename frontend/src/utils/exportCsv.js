// 현재 필터된 파이프라인 행을 CSV로 내보내기 (Excel 호환: UTF-8 BOM).
// 분석/클러스터링용으로 cohort 구조화 필드(stage/line/selection_biomarkers/prior_therapy) 포함.

const COLUMNS = [
  ['NCT', (d) => (d.nct_ids ?? []).join('; ')],
  ['Title', (d) => d.brief_title || d.official_title || ''],
  ['Drug', (d) => d.drug_name || ''],
  ['Experimental', (d) => (d.exp_regimen ?? []).join(' + ')],
  ['Control', (d) => (d.control_regimen ?? []).join(' + ')],
  ['Cohort', (d) => d.cohort || ''],
  ['Line', (d) => d.line_of_therapy || ''],
  ['TumorType', (d) => d.cohort_struct?.tumor_type || ''],
  ['Histology', (d) => d.cohort_struct?.histology || ''],
  ['Stage', (d) => d.cohort_struct?.stage || ''],
  ['SelectionBiomarkers', (d) => (d.cohort_struct?.selection_biomarkers ?? []).join('; ')],
  ['PriorTherapy', (d) => (d.cohort_struct?.prior_therapy ?? []).join('; ')],
  ['Company', (d) => d.company_normalized || d.company || ''],
  ['Country', (d) => (d.countries ?? []).join('; ')],
  ['DrugBiomarkers', (d) => (d.biomarker_list ?? []).join('; ')],
  ['Target', (d) => (d.target && d.target !== 'Unknown' ? d.target : '')],
  ['Modality', (d) => (d.modality && d.modality !== 'Unknown' ? d.modality : '')],
  ['Indication', (d) => (d.cancer_categories ?? (d.cancer_category ? [d.cancer_category] : [])).join('; ')],
  ['Phase', (d) => (d.phases ?? []).join('/') || d.phase || ''],
  ['Status', (d) => d.overall_status || ''],
  ['Start', (d) => d.start_date || ''],
  ['Completion', (d) => d.primary_completion_date || ''],
  ['Partnership', (d) => d.partnership_status || ''],
]

function cell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportDrugsCsv(drugs, filename = 'pipeline.csv') {
  const header = COLUMNS.map(([h]) => h).join(',')
  const rows = (drugs ?? []).map((d) => COLUMNS.map(([, fn]) => cell(fn(d))).join(','))
  const csv = '﻿' + [header, ...rows].join('\r\n') // BOM → Excel에서 한글/특수문자 정상
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
