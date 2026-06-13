# Conference Abstract Intelligence DB — 스키마 정의 및 설계 스펙

> **문서 목적**: ASCO/AACR 등 종양학 학회 초록을 파싱·구조화하여 기존 oncology pipeline dashboard에 통합하기 위한 데이터 스키마와 아키텍처 정의. 이 문서는 Claude Code가 구현 작업을 시작하기 위한 설계 기준 문서이다.
>
> **최종 목적 (BD 관점)**: 거시(관심 분야 전반의 흐름 파악) → 미시(개별 연구·파이프라인 이해) → 액션(연락할 KOL/PI 컨택 발굴). 이를 위해 ① 초록 데이터 구조화, ② 회사·약물·타겟 분석, ③ 연구자 공저 네트워크 분석을 단계적으로 구축한다.

---

## 1. 전체 로드맵

구현은 아래 순서로 진행한다. 각 단계는 앞 단계의 산출물 위에 쌓인다.

1. **스키마 정의** (이 문서)
2. **ASCO 2026 파싱** — PDF → 구조화 JSON
3. **프론트엔드 제작 + 기존 앱에 부착** — 학회 대시보드 뷰 추가
4. **AACR 데이터 수집** — 웹 크롤링 (임상/Late-Breaking 초록)
5. **프론트엔드에 AACR 적용** — 동일 스키마로 통합
6. **다른 학회 추가** — 동일 방식 복제 (ESMO, SITC 등)
7. **공저자 네트워크 뷰어** — 연구자 관계 그래프 + 관심영역 분석

> **핵심 원칙**: 스키마는 한 번만 정의하고 모든 학회·모든 뷰가 이를 재사용한다. 따라서 이 문서의 스키마는 "지금 ASCO에 필요한 것"이 아니라 "AACR·네트워크 뷰어까지 내다본 것"을 담는다.

---

## 2. 아키텍처 원칙

### 2-1. 기존 인프라 재사용

기존 `oncology_pipeline_dashboard` 레포(GitHub + Cloudflare Pages, 무료)에 통합한다. 새 인프라를 만들지 않는다.

```
[GitHub Actions / 수동 배치 — Python]
  학회 초록 수집 → 파싱 → 사전 매칭 태깅 → JSON 생성 → commit & push

[GitHub Repository]
  /data/parsed/        ← 프론트엔드용 가공 데이터 (정적 JSON, single source of truth)
  /scripts/            ← Python 수집/파싱 스크립트
  /frontend/           ← React 프론트엔드 (단일 SPA, 라우팅으로 뷰 분리)

[Cloudflare Pages]
  정적 JSON fetch → 클라이언트 사이드 필터링/정렬/렌더링
```

### 2-2. 무거운 계산은 빌드 타임, 브라우저는 렌더만

Cloudflare Pages는 정적 호스팅(서버 연산 없음). 모든 무거운 계산(파싱, 사전 매칭, 그래프 분석, 클러스터링, 중심성)은 **GitHub Actions/로컬 Python에서 빌드 타임에** 수행하고, 결과를 계산 완료된 정적 JSON으로 떨군다. 브라우저는 그걸 받아 **필터링·렌더링만** 한다.

### 2-3. 학회별 입력 어댑터 + 공통 스키마

학회마다 입력 소스가 다르다(ASCO=PDF, AACR=웹). **입력단(어댑터)만 학회별로 다르게** 구현하고, 출력 스키마는 공통으로 통일한다.

| 학회 | 입력 소스 | 어댑터 |
|------|----------|--------|
| ASCO | 단일 PDF (전체 초록) | PDF 파서 |
| AACR | Cancer Research 저널 웹 supplement (임상/LB만) | 웹 크롤러 |
| ESMO/SITC 등 | (추후 조사) | 추후 |

> **AACR 주의**: AACR regular abstract PDF(27MB)는 기초연구 위주이고 임상/LB가 빠져 있어 **수집 대상에서 제외**한다. BD 타겟인 임상/Late-Breaking 초록은 aacrjournals.org의 Cancer Research online supplement(웹)에서 크롤링한다. URL 패턴: `aacrjournals.org/cancerres/article/{volume}/{issue}/{abstract_id}/...`. AACR은 ASCO와 달리 **전체 저자·소속·DOI·NCT가 본문에 모두 포함**되어 데이터가 더 풍부하다.

### 2-4. 단계적 enrichment (정확성 우선)

1차는 사전 기반 키워드 매칭(LLM 없음). 사전에 없으면 `"Unknown"`으로 저장 → BD 관점에서 오히려 수동 검토 우선 대상(신규 first-in-class 가능성). 2차로 LLM 검증을 별도 레이어로 얹는다. `enrichment_status` 필드로 단계를 추적한다.

---

## 3. 통합 데이터 스키마

### 3-1. 최상위 파일 구조

```
data/parsed/
  pipeline.json          # 기존 (ClinicalTrials.gov trial 데이터) — 건드리지 않음
  abstracts_asco2026.json # 신규: ASCO 2026 초록
  abstracts_aacr2026.json # 추후: AACR 2026 초록
  nct_index.json         # NCT → abstract_id 역인덱스 (trial↔abstract 연결용)
  # 네트워크 뷰어용 (추후, 빌드 타임 생성)
  researchers.json       # 연구자 노드 (프로필 + cluster_id + centrality)
  edges.json             # 공저 엣지 (가중치)
  author_aliases.json    # 동일인 통합/동명이인 분리 수동 교정 테이블
```

학회별 JSON은 분리 관리한다(갱신 주기·크기가 다름). trial은 weekly cron(살아있는 데이터), 학회 초록은 학회마다 1회 배치(스냅샷).

### 3-2. Abstract 레코드 스키마

```json
{
  "uid": "asco-2026-509",
  "conference": "ASCO",
  "year": 2026,
  "abstract_id": "509",
  "is_lba": false,
  "status": "available",

  "presentation_type": "Rapid Oral Abstract Session",
  "track": "Breast Cancer—Local/Regional/Adjuvant",
  "cancer_category": ["Breast Cancer"],

  "title": "Neoadjuvant pyrotinib vs pertuzumab therapy for HER2-positive early breast cancer: The HELEN HER-013 randomized clinical trial.",

  "authors": [
    {
      "name": "Jiujun Zhu",
      "author_key": "jiujun_zhu|henan",
      "role": "first",
      "order": 1,
      "affiliation": "Department of Breast Disease, Henan Breast Cancer Center, The Affiliated Cancer Hospital of Zhengzhou University & Henan Cancer Hospital",
      "city": "Zhengzhou",
      "region": null,
      "country": "China",
      "is_company": false,
      "orcid": null,
      "linkedin": null,
      "verified": false,
      "source": "asco_pdf"
    }
  ],
  "author_raw": "Jiujun Zhu, Department of Breast Disease, ..., Zhengzhou, China",

  "abstract_text": "Background: Docetaxel, carboplatin... Conclusions: ...alternative neoadjuvant strategy.",

  "phase": "PHASE3",
  "phases": ["PHASE3"],
  "modality_list": ["Small Molecule", "Monoclonal Antibody"],
  "target_list": ["HER2"],
  "biomarker_mentioned": true,
  "biomarker_list": ["HER2"],

  "nct_ids": ["NCT05918328"],
  "clinicaltrials_url": "https://clinicaltrials.gov/study/NCT05918328",

  "companies": [
    {"name": "Daiichi Sankyo", "source": "nct", "role": "sponsor"}
  ],
  "drugs_mentioned": ["pyrotinib", "nab-paclitaxel", "trastuzumab"],
  "research_sponsor": "None",

  "source": {
    "url": null,
    "doi": null,
    "page": 1
  },

  "keyword_parsed": true,
  "enrichment_status": "dictionary_v1"
}
```

### 3-3. 필드 정의

#### 식별자

| 필드 | 타입 | 설명 |
|------|------|------|
| `uid` | string | 전역 고유 ID. 규칙: `{conference}-{year}-{abstract_id}` (소문자). 예: `asco-2026-509`, `aacr-2026-CT001`. 학회·연도 간 abstract_id 충돌 방지. |
| `conference` | string | `"ASCO"`, `"AACR"`, `"ESMO"`, `"SITC"` 등 |
| `year` | int | 학회 연도 |
| `abstract_id` | string | 학회 내 초록 번호 (문자열). ASCO: `"509"`, `"LBA503"`. AACR: `"CT001"`, `"LB042"` |
| `is_lba` | bool | Late-Breaking Abstract 여부 |
| `status` | string | `"available"` (본문 있음) / `"embargoed"` (placeholder만, 본문 비어있음) |

#### 분류

| 필드 | 타입 | 설명 |
|------|------|------|
| `presentation_type` | string | 세션 타입. ASCO: `"Oral Abstract Session"`, `"Poster Session"`, `"Rapid Oral Abstract Session"` 등 |
| `track` | string | 학회 원본 트랙명 (세분화 유지). ASCO 목차의 카테고리 그대로 |
| `cancer_category` | array[string] | 정규화 암종 (넓게). track에서 1차 매핑 + 본문 보강. 암종 무관 트랙은 `[]` |

#### 저자 (authors 배열)

각 저자 객체:

| 필드 | 타입 | 설명 |
|------|------|------|
| `name` | string | 저자명 (원본 표기) |
| `author_key` | string | 자동 생성 식별 키. 규칙: `정규화이름\|소속핵심어`. 이름 정규화(소문자·악센트제거·이니셜정리) + 소속 핵심어. **동일인 1차 매칭용** |
| `role` | string | `"first"` / `"middle"` / `"last"`. last author = PI/책임자 후보 (네트워크 그래프에서 가중) |
| `order` | int | 저자 순서 (1부터). 그래프 가중치 계산용 |
| `affiliation` | string | 소속 (콤마 포함 가능, 통째로) |
| `city` / `region` / `country` | string/null | 지역. 미국: city+region(주2글자)+country="USA". 해외: city+country, region=null. 도시 추출 애매 시 country만 |
| `is_company` | bool | 소속이 회사인지(academic/병원과 구분). 회사 식별·그래프에 활용 |
| `orcid` | string/null | ORCID. 1차 null, 추후 자동 보강(NCT→PubMed→ORCID 경로 가능) |
| `linkedin` | string/null | LinkedIn. **자동 수집 안 함**(약관·법적 리스크). 수동 참조용 슬롯 |
| `verified` | bool | 수동 검증 완료 여부 |
| `source` | string | 이 저자 정보 출처: `"asco_pdf"` / `"aacr_web"` / `"pubmed"` / `"ctgov"` / `"manual"` |

> **저자 식별 전략 (단순하게 시작, 점진적 정제)**
> - 1차: `author_key` = 이름(정규화) + 소속(정규화)로 자동 매칭. 대부분 이걸로 묶임.
> - 한계 인정: 소속 변경(이직), 표기 변형, 동명이인(특히 흔한 성)은 자동으로 완벽히 못 가린다.
> - 교정: `author_aliases.json`에 "이 key들은 동일인" 또는 "이 둘은 다른 사람"을 **수동으로** 기록해 보강. 핵심 KOL 수십~수백 명만 손봐도 실용적.
> - 외부 검증: ORCID는 적법·표준이라 자동 보강 여지. LinkedIn은 수동 참조만.

> **학회별 저자 채움 차이**: ASCO PDF는 First Author 1명만 → `authors`에 1개 객체(role="first"). AACR 웹은 전체 저자 → `authors`에 전원, 마지막 저자 role="last". 스키마는 동일, 채워지는 양만 다름.

#### 본문

| 필드 | 타입 | 설명 |
|------|------|------|
| `title` | string | 제목 |
| `abstract_text` | string | 본문 전체를 통으로 (Background:/Methods:/Results:/Conclusions: 헤더 살린 채). 별도 필드 분리 안 함. **표(Table) 텍스트는 제거.** placeholder(embargoed)는 null |
| `author_raw` | string | "First Author:" 뒤 원문 전체 (파싱 검수·재처리용 보존) |

#### 임상·분류 태그 (사전 매칭, 전부 배열, OR 검색)

> 기존 `scripts/parse_fields.py`의 `MODALITY_KEYWORDS`, `TARGET_KEYWORDS`, `BIOMARKER_KEYWORDS` 사전을 **재사용**한다(두 데이터셋 분류 체계 일치). 검색은 배열 중 하나라도 매칭되면 hit(OR 매칭, `array.some(...)`).

| 필드 | 타입 | 설명 |
|------|------|------|
| `phase` | string/null | 대표 phase, 정규화 포맷 `"PHASE3"`(대문자·공백없음). trial 아닌 초록(메타분석·레트로)은 null |
| `phases` | array[string] | 전체 phase 목록 |
| `modality_list` | array[string] | 모달리티 (한 초록에 여러 약물=여러 모달리티 정상). 미상은 `["Unknown"]` |
| `target_list` | array[string] | 타겟 |
| `biomarker_mentioned` | bool | 바이오마커 언급 여부 |
| `biomarker_list` | array[string] | 바이오마커 목록 |

#### 연결 (trial 조인)

| 필드 | 타입 | 설명 |
|------|------|------|
| `nct_ids` | array[string] | 본문에서 `NCT\d{8}` 정규식 추출. 기존 trial(`pipeline.json`)과 **1:1 조인키**(검증됨: 중복 0). 한 초록에 여러 NCT 가능 |
| `clinicaltrials_url` | string/null | NCT로 생성. 프론트 링크용 |

#### 회사·약물

> **회사 식별 다단계** (출처 표시 필수 — 시각화에서 신뢰도 구분):
> 1. **NCT 매칭** (최고 신뢰): 초록 NCT가 기존 trial에 있으면 거기 `company`/`collaborators` 사용
> 2. **약물명 매칭** (중간): 본문 약물명 → 기존 17,228개 약물→회사 사전으로 역추적
> 3. **research_sponsor** (보조): 회사명이면 추가. "None"/재단/대학은 무시
> 4. **회사 소속 저자** (보조): affiliation이 회사면 추가
>
> **주의 1**: 기존 trial `company` 필드는 회사가 아닐 때 많음(개인 PI명, 병원, 대학). 제약/바이오 회사인지 필터링 필요(academic vs industry).
> **주의 2**: 약물→회사는 1:다. **범용 약물(azacitidine, paclitaxel, cyclophosphamide 등 화학항암제·제네릭)은 회사 매핑에서 제외**(노이즈 방지). 신약·타겟 약물 위주로만 역추적.

| 필드 | 타입 | 설명 |
|------|------|------|
| `companies` | array[object] | `{"name": ..., "source": "nct"/"drug_mapping"/"sponsor"/"affiliation", "role": "sponsor"/"developer"/"collaborator"}` |
| `drugs_mentioned` | array[string] | 본문/제목에서 추출한 약물명 |
| `research_sponsor` | string | "Research Sponsor:" 뒤 텍스트 원문 |

#### 출처·상태

| 필드 | 타입 | 설명 |
|------|------|------|
| `source.url` | string/null | 원본 URL (AACR 웹). ASCO는 null |
| `source.doi` | string/null | DOI (AACR). ASCO는 null |
| `source.page` | int/null | PDF 페이지 (ASCO). AACR은 null |
| `keyword_parsed` | bool | 사전 매칭 완료 여부 |
| `enrichment_status` | string | `"dictionary_v1"`(사전 매칭) → 추후 `"llm_verified"`(LLM 검증 완료) |

---

## 4. ASCO 2026 파싱 명세 (단계 2)

### 4-1. 입력 특성 (확인 완료)

- PDF 약 870페이지. **텍스트 레이어가 컬럼 순서대로 정상 추출됨** → 별도 2단 컬럼 분리(bounding box) 불필요.
- abstract가 페이지 경계를 넘지 않음(각 페이지가 자기 초록으로 끝남).
- OCR 불필요(전부 텍스트).

### 4-2. 파싱 규칙

| 항목 | 규칙 |
|------|------|
| abstract 경계 | 줄 시작의 `^(LBA)?\d+\s+.+?Session$` 패턴 (번호 + 발표타입) |
| 제목 | 번호 줄 다음 ~ "First Author:" 전 |
| 저자 | "First Author:" 뒤. 뒤에서부터 자르기(right-anchored): 첫 콤마 앞=이름, 맨 끝=지역(미국 주약자/국가명 판별), 중간 전부=소속 |
| 본문 | 통째로 `abstract_text`. 표 텍스트 제거. `Clinical trial information:`/`Research Sponsor:`에서 본문 끝 처리 |
| NCT | `NCT\d{8}` 정규식 |
| research_sponsor | "Research Sponsor:" 뒤 |
| phase | `phase\s*(I{1,3}\|[123])` → `PHASE\d` 정규화 |
| 푸터 제거 | "Visit meetings.asco.org... May 12, 2026." 등 노이즈 제거 |

### 4-3. 예외 케이스

- **LBA placeholder**: "The full, final text of this abstract will be available..." → `status="embargoed"`, `abstract_text=null`
- **표(Table) 데이터**: 본문 뒤 표 텍스트(예: "TAM AI OFS No OFS / EZN (n=175)...") → 제거. `Conclusions` 필드 오염 방지를 위해 `Research Sponsor:`/`Clinical trial information:`에서 끊음

### 4-4. Track 매핑 (목차 기반)

ASCO 목차(TOC)의 페이지 범위로 각 초록의 track을 할당한다. 본문 푸터의 track명(예: "BREAST CANCER—LOCAL/REGIONAL/ADJUVANT")을 1차 기준으로 쓰되, 목차 페이지 범위로 교차검증. 어긋나면 플래그.

**Track → cancer_category 매핑 (넓게)**:

```
Breast Cancer—Local/Regional/Adjuvant      → ["Breast Cancer"]
Breast Cancer—Metastatic                   → ["Breast Cancer"]
Central Nervous System Tumors              → ["CNS Cancer"]
Gastrointestinal Cancer—Colorectal and Anal              → ["GI Cancer"]
Gastrointestinal Cancer—Gastroesophageal, Pancreatic...  → ["GI Cancer"]
Genitourinary Cancer—Kidney and Bladder                  → ["GU Cancer"]
Genitourinary Cancer—Prostate, Testicular, and Penile    → ["GU Cancer"]
Gynecologic Cancer                         → ["Gynecologic Cancer"]
Head and Neck Cancer                       → ["Head and Neck Cancer"]
Hematologic Malignancies—Leukemia/MDS/Allotransplant     → ["Hematologic Cancer"]
Hematologic Malignancies—Lymphoma and CLL                → ["Hematologic Cancer"]
Hematologic Malignancies—Plasma Cell Dyscrasia           → ["Hematologic Cancer"]
Lung Cancer—Non–Small Cell Local-Regional/Small Cell...  → ["Lung Cancer"]
Lung Cancer—Non–Small Cell Metastatic                    → ["Lung Cancer"]
Melanoma/Skin Cancers                      → ["Melanoma/Skin Cancer"]
Sarcoma                                    → ["Sarcoma"]
Pediatric Oncology                         → ["Pediatric Cancer"]
# 암종 무관 트랙 → cancer_category = []
Plenary Session / Special Clinical Science Symposia / Care Delivery /
Developmental Therapeutics—Immunotherapy / Developmental Therapeutics—Molecularly Targeted /
Medical Education / Prevention,Risk,Genetics / Quality Care / Symptom Science → []
```

> **참고**: Developmental Therapeutics(Immunotherapy/Molecularly Targeted) 트랙은 cancer_category가 비지만, 신규 모달리티/타겟 초기 연구가 몰려 있어 BD상 중요. 이 트랙은 본문 기반 `modality_list`/`target_list` 태깅 품질이 특히 중요.

---

## 5. 통합 & 프론트엔드 (단계 3)

### 5-1. 통합 방식: 별도 대시보드 + NCT 링크 (loose coupling)

trial 데이터와 abstract 데이터는 성격이 다르다(trial=상태 추적 / abstract=연구·KOL 스냅샷). 억지로 한 테이블에 합치지 않고, **별도 뷰 + NCT 공통키 연결**.

- 기존 trial 테이블(`PipelineTable`) 각 행: 그 NCT가 `nct_index.json`에 있으면 **ASCO 아이콘** 표시 → 클릭 시 해당 초록으로 점프
- abstract 테이블 각 행: NCT 있으면 기존 trial 뷰로 역링크
- NCT 없는 초록(레트로·메타분석 등 다수)도 독립적으로 존재

### 5-2. 프론트엔드: 단일 SPA + 라우팅으로 뷰 분리

frontend는 하나. `react-router-dom` 도입하여 URL로 화면 전환.

```
frontend/src/
├── App.jsx                # 라우터 + 공통 레이아웃(상단 네비)
├── pages/
│   ├── PipelinePage.jsx   # 기존 화면 이동 (pipeline.json + nct_index.json)
│   ├── ConferencesPage.jsx # 신규: 학회 초록 (abstracts_*.json)
│   └── NetworkPage.jsx    # 추후: 공저 네트워크 뷰어
├── components/
│   ├── pipeline/          # 기존 컴포넌트
│   ├── conferences/       # 신규 (AbstractTable, AuthorCell 등)
│   └── network/           # 추후
└── ...
```

```
라우트:
/                      → 파이프라인 (기존)
/conferences           → 학회 통합 뷰 (ASCO+AACR+...)
/conferences/asco-2026 → ASCO만 (학회 늘면 하위 추가)
/network               → 공저 네트워크 (추후)
```

- 상단 네비 1차: "Pipeline" / "Conferences" 2탭. 학회 늘면 Conferences 하위 탭 확장.
- Cloudflare Pages SPA fallback 설정 필요(라우터용, `_redirects` 파일 등).

### 5-3. 데이터 크기 관리

~2000 초록 × 본문 포함 시 JSON 5~10MB 예상. 대응: ① 학회별 JSON 분할, ② Cloudflare gzip 자동, ③ 필요 시 본문은 lazy load(테이블엔 요약 필드만). 20명 경량 사용이라 ①+② 만으로 충분할 가능성.

### 5-4. 프론트엔드 목적 (둘 다)

- **탐색(거시)**: 회사×타겟×모달리티×암종 트렌드 시각화 (추후 시각화 페이지). 어떤 회사가 어디 집중하는지.
- **타겟팅(액션)**: 타겟/암종/회사 필터 → 관련 연구·연구자 검색. 컨택 발굴.

---

## 6. 공저자 네트워크 뷰어 (단계 7)

### 6-1. 데이터 (빌드 타임 생성)

abstract JSON의 `authors`에서 자동 파생. 별도 수집 불필요.

- **노드** = 연구자 (`researchers.json`): author_key, 소속, 국가, is_company, 관심영역 태그 집계(target/modality/cancer 빈도), cluster_id, centrality
- **엣지** = 공저 (`edges.json`): 같은 초록 공저 두 연구자 연결, 가중치=함께 쓴 횟수

> ASCO는 First Author만 → 공저 엣지 적음. AACR 전체 저자 → 엣지 풍부. 데이터 축적될수록 그래프 가치 상승(그래서 로드맵 마지막 단계).

### 6-2. 분석 (빌드 타임, Python networkx/igraph)

- **클러스터 탐지**(Louvain/Leiden): 자주 공저하는 군집 = 연구 그룹/KOL 집단
- **중심성**(degree/betweenness): 허브 연구자 = 핵심 KOL = 컨택 1순위
- **브로커**: academic↔industry 잇는 연구자 = 파트너십 가교
- **관심영역 유사도**: 1차는 태그 기반 프로필 벡터(코사인 유사도, 해석가능). 각 연구자 Top-N 유사 연구자만 미리 계산(`similar.json`). 추후 텍스트 임베딩(PubMedBERT/로컬) 레이어 옵션

### 6-3. 렌더링: "필터 먼저, 그래프 나중"

전체(수천 노드)를 한 화면에 그리면 "털뭉치"가 되어 무의미. 항상 필터링된 부분그래프만 렌더:

1. 타겟/암종/회사/연구자로 좁힘 (테이블·검색 UI)
2. 조건에 맞는 부분그래프만 렌더 (수십~수백 노드)
3. 연구자 클릭 → 이웃(공저자)+관심영역+유사 연구자 펼침

- 라이브러리: 소규모 D3-force(기존 d3 보유), 대규모 sigma.js(WebGL). 부분그래프만 그리므로 Pages에서 충분.

---

## 7. 핵심 결정 요약 (합의됨)

| # | 결정 |
|---|------|
| 1 | abstract 본문은 통으로 저장(헤더 살림), 표는 제거 |
| 2 | 저자: ASCO는 First만, AACR은 전체. authors 배열에 role/order 포함 |
| 3 | 분류 태그(modality/target/biomarker)는 전부 배열, OR 검색 |
| 4 | 암종(cancer_category)은 넓게, track 원본은 별도 보존 |
| 5 | 기존 parse_fields.py 사전 재사용 |
| 6 | NCT로 trial↔abstract 연결(1:1 조인 검증됨) |
| 7 | 회사: NCT+약물+sponsor+소속 다단계, source 표시, 범용약물 제외 |
| 8 | uid = {conference}-{year}-{abstract_id} 전역 키 |
| 9 | 저자 식별: 이름+소속 1차 키 + alias 테이블 수동 교정 + orcid/linkedin 슬롯 |
| 10 | 통합: 별도 대시보드 + NCT 링크 (단일 SPA + 라우팅) |
| 11 | AACR은 임상/LB만 웹 크롤링(기초연구 PDF 제외) |
| 12 | enrichment_status로 사전→LLM 단계 추적 |
| 13 | 무거운 계산은 빌드 타임, 브라우저는 렌더만 |

---

## 8. 미해결 / 추후 결정

- ESMO/SITC 등 다른 학회 입력 소스 조사
- LLM 검증 레이어 구체 설계(로컬 Qwen vs OpenAI, 검증 프롬프트)
- 약물 동의어 사전 보강(브랜드명↔성분명↔약어, 예: T-DXd=trastuzumab deruxtecan=Enhertu)
- academic vs industry 회사 분류 기준 확정
- 텍스트 임베딩 기반 관심영역 분석(태그 기반 이후)
