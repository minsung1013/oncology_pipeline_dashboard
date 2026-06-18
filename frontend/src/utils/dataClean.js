// 표시·집계용 필드 정규화. 원본 파싱 데이터(R2)의 더러운 값을 프런트에서 통일한다.
//
// country 필드 문제 (data/parsed 기준):
//  1) 꼬리 마침표  : 'China.' vs 'China', 'Japan.' …
//  2) 미국 주 약자 : 'CA.' 'TX.' 'MA.' … 가 국가로 오인 파싱됨 → USA
//  3) 명칭 변형    : 'Republic of Korea' / 'South Korea', 'United States' / 'USA' …

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
])

// 2글자 미국 영토 약자 → 정식 명칭 (USA로 합치지 않고 영토명 유지)
const US_TERRITORIES = { GU: 'Guam', PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands' }

// 명칭 변형 통일 (관측된 중복만)
const COUNTRY_ALIASES = {
  'Republic of Korea': 'South Korea',
  'Korea, Republic of': 'South Korea',
  'United States': 'USA',
  'United States of America': 'USA',
  'U.S.A': 'USA',
  'US': 'USA',
}

export function normalizeCountry(raw) {
  if (!raw) return raw
  const s = String(raw).replace(/[.\s]+$/, '').trim() // 꼬리 마침표·공백 제거
  if (!s) return raw
  const up = s.toUpperCase()
  if (US_STATES.has(up)) return 'USA'
  if (US_TERRITORIES[up]) return US_TERRITORIES[up]
  return COUNTRY_ALIASES[s] ?? s
}

// ── affiliation → 기관(대학/회사) 단위 ────────────────────────────────────────
// 자유텍스트 소속에서 학과·도시·국가를 떼고 기관명만 남긴다. 완벽한 표준화는
// 불가능하므로(원문은 테이블/원논문에서 확인 가능) 상위 변형만 별칭으로 합친다.
const SUBUNIT = /^(the\s+)?(department|dept|division|divisione|faculty|school|section|unit|laboratory|lab|center for|centre for|programme?|service|chair|servicio|servizio|dipartimento|abteilung|departement|departamento|institute of (molecular|clinical|cancer research|oncology))\b/i
const COMPANY_SUFFIX_ONLY = /^(inc|ltd|llc|gmbh|co|corp|corporation|company|ag|plc|s\.?a|sas|bv|pvt\.?\s*ltd|pvt|aps|oy|ab)\.?$/i
const HAS_COMPANY = /\b(pharmaceuticals?|therapeutics|biosciences?|biopharma|biotech|oncology|genomics|medicines?|sciences?)\b/i
const INST_KW = [
  'universit', 'college', 'hospital', 'institute', 'institut', 'cancer cent', 'medical cent',
  'clinic', 'klinik', 'foundation', 'school of medicine', 'health system', 'health network',
  'centre', 'center', 'pharmaceutic', 'therapeutics', 'biosciences', 'biotech', 'laboratories',
  'nhs', 'academy', 'clinica',
]
// 충분히 고유한 상위 기관 변형 통일
const AFFIL_CANON = [
  [/md anderson/i, 'MD Anderson Cancer Center'],
  [/sloan.?kettering|mskcc|memorial sloan/i, 'Memorial Sloan Kettering Cancer Center'],
  [/dana.?farber/i, 'Dana-Farber Cancer Institute'],
  [/moffitt/i, 'Moffitt Cancer Center'],
  [/mayo clinic/i, 'Mayo Clinic'],
  [/cleveland clinic/i, 'Cleveland Clinic'],
  [/massachusetts general/i, 'Massachusetts General Hospital'],
]
const MULTI_CAMPUS = /^University of (California|Texas|Colorado|Washington|Pittsburgh|Wisconsin)$/i

function hasInst(p) {
  const pl = p.toLowerCase()
  return INST_KW.some((k) => pl.includes(k)) || HAS_COMPANY.test(p)
}

export function normalizeAffiliation(raw) {
  if (!raw) return raw
  // 분리 후, 분리된 회사 접미사(', Inc.')는 앞 토막에 다시 붙임
  const segs = String(raw).split(/[;,]/).map((p) => p.trim()).filter(Boolean)
  if (!segs.length) return String(raw).trim()
  const parts = []
  for (const p of segs) {
    if (parts.length && COMPANY_SUFFIX_ONLY.test(p)) parts[parts.length - 1] += `, ${p}`
    else parts.push(p)
  }
  const kept = parts.filter((p) => !SUBUNIT.test(p))
  const pool = kept.length ? kept : parts
  let chosen = pool.find((p) => hasInst(p)) ?? pool[0]
  // 멀티캠퍼스 대학: 다음 토막이 캠퍼스/도시면 붙여 UCSF/UCLA 구분 유지
  if (MULTI_CAMPUS.test(chosen)) {
    const idx = parts.indexOf(chosen)
    const nxt = idx >= 0 ? parts[idx + 1] : null
    if (nxt && nxt.split(/\s+/).length <= 3 && !hasInst(nxt)) chosen = `${chosen}, ${nxt}`
  }
  for (const [rx, std] of AFFIL_CANON) if (rx.test(chosen)) return std
  // "X University School/College/Faculty of …" → "X University"
  const m = chosen.match(/^(.*\bUniversity)\s+(?:School|College|Faculty)\s+of\s+.+$/i)
  return m ? m[1] : chosen
}
