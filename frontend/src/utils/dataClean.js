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
