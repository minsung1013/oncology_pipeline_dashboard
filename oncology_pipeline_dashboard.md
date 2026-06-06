# Oncology Pipeline Dashboard — 구현 스펙

## 1. 프로젝트 개요

### 목적
Phase 1 항암 임상 파이프라인을 모니터링하여 **동반진단(CDx) 협업 기회**를 탐색하는 BD 인텔리전스 대시보드.

### 비즈니스 컨텍스트
- H&E/IHC 이미지 기반 병리 파운데이션 모델 → 바이오마커 발현 예측
- 협업 타겟: Phase 2 진입 직전 파이프라인 (Phase 1 진행 중 / 완료)
- 핵심 질문: "이 암종에서 Phase 1을 진행 중인 회사는 어디고, 각 파이프라인의 CDx 기회는 무엇인가?"

---

## 2. 아키텍처

```
[GitHub Actions — Python]
  스케줄: 매주 월요일 09:00 KST (cron: '0 0 * * 1')

  1. ClinicalTrials.gov API v2 수집
  2. 키워드 기반 파싱 (모달리티 / 타겟 / MoA / 바이오마커)
  3. PubMed API 논문 링크 매핑
  4. CDx 기회 플래그 자동 계산
  5. data/raw/ 저장 + data/parsed/pipeline.json 생성 → commit & push

[GitHub Repository]  ← 현재 단계 (추후 DB로 마이그레이션 가능한 구조)
  /data/raw/            ← ClinicalTrials.gov 원본 응답 전체
  /data/parsed/         ← 프론트엔드용 가공 데이터
  /scripts/             ← Python 수집/파싱 스크립트
  /frontend/            ← React 프론트엔드

[Cloudflare Pages]
  GitHub 연결 → 자동 빌드/배포
  pipeline.json fetch → 클라이언트 사이드 필터링/정렬
```

### 향후 DB 마이그레이션 경로
현재 GitHub 기반 구조는 DB 도입 시 최소한의 변경으로 전환 가능하도록 설계.

```
현재:  scripts/ → data/raw/ → data/parsed/pipeline.json → Cloudflare Pages
이후:  scripts/ → PostgreSQL (raw table) → pipeline table → API 서버 → Cloudflare Pages
```

---

## 3. 파일 구조

```
oncology-pipeline-dashboard/
├── .github/
│   └── workflows/
│       └── update_pipeline.yml      # GitHub Actions 스케줄러
├── scripts/
│   ├── fetch_trials.py              # ClinicalTrials.gov API 수집
│   ├── parse_fields.py              # 키워드 기반 파싱
│   ├── fetch_pubmed.py              # PubMed 논문 링크
│   ├── flag_cdx.py                  # CDx 기회 플래그 계산
│   └── run_pipeline.py              # 전체 파이프라인 실행 (위 스크립트 통합)
├── data/
│   ├── raw/
│   │   ├── full_YYYY-MM-DD.json     # 초기 전체 수집 (일회성)
│   │   └── delta_YYYY-MM-DD.json   # 주간 변경분
│   └── parsed/
│       └── pipeline.json            # 프론트엔드용 가공 데이터
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── FilterBar.jsx        # 상단 필터 바
│   │   │   ├── CompanyList.jsx      # 회사 목록 (1단계)
│   │   │   ├── PipelineTable.jsx    # 파이프라인 테이블 (2단계 드릴다운)
│   │   │   └── CdxBadge.jsx        # CDx 기회 플래그 배지
│   │   └── utils/
│   │       └── filters.js           # 필터/정렬 로직
│   ├── package.json
│   └── vite.config.js
├── requirements.txt
└── README.md
```

---

## 4. 데이터 수집 스펙

### 4-1. ClinicalTrials.gov API v2

**엔드포인트**
```
GET https://clinicaltrials.gov/api/v2/studies
```

**쿼리 파라미터**
```python
params = {
    "query.cond": "cancer OR carcinoma OR tumor OR neoplasm OR lymphoma OR leukemia OR sarcoma OR melanoma",
    "filter.overallStatus": "RECRUITING,ACTIVE_NOT_RECRUITING,NOT_YET_RECRUITING,ENROLLING_BY_INVITATION",
    "filter.studyType": "INTERVENTIONAL",
    "filter.phase": "PHASE1",
    "aggFilters": "fundingType:INDUSTRY",
    "fields": ",".join([
        "NCTId",
        "BriefTitle",
        "OfficialTitle",
        "Condition",
        "InterventionName",
        "InterventionDescription",
        "InterventionType",
        "Phase",
        "OverallStatus",
        "LeadSponsorName",
        "CollaboratorName",
        "PrimaryCompletionDate",
        "StartDate",
        "EligibilityCriteria",
        "BriefSummary",
        "DetailedDescription",
        "LastUpdatePostDate",
        "StudyFirstPostDate",
        "EnrollmentCount",
        "ArmGroupLabel",
        "ArmGroupDescription",
        "PrimaryOutcomeMeasure",
        "SecondaryOutcomeMeasure",
    ]),
    "pageSize": 100,
}
```

**페이지네이션**
```python
all_studies = []
next_token = None
while True:
    if next_token:
        params["pageToken"] = next_token
    response = requests.get(BASE_URL, params=params)
    data = response.json()
    all_studies.extend(data.get("studies", []))
    next_token = data.get("nextPageToken")
    if not next_token:
        break
```

### 4-2. Raw Data 저장 전략

**초기 실행 (full dump)**
```python
# 최초 1회: 전체 수집 후 raw 저장
output_path = f"data/raw/full_{today}.json"
save_json(all_studies, output_path)
```

**주간 업데이트 (delta)**
```python
# 이후 매주: lastUpdatePostDate 필터로 변경분만 수집
# 예상 건수: 주당 100~150건 (약 2~7MB)
params["filter.lastUpdatePostDate"] = last_run_date
output_path = f"data/raw/delta_{today}.json"
save_json(changed_studies, output_path)
```

**raw data 활용 원칙**
- API 재호출 없이 raw에서 재파싱 가능 (키워드 사전 업데이트 시 유용)
- raw는 ClinicalTrials.gov 원본 응답 그대로 저장 (가공 없음)
- parsed/pipeline.json은 raw에서 생성 (raw가 single source of truth)

### 4-3. 약물 단위 Deduplication

같은 약물이 여러 trial에 등록될 수 있으므로 약물 단위로 dedup.

```python
# InterventionName 기준으로 그룹핑
# 같은 약물명이면 가장 최근 / 가장 advanced trial로 대표
# NCT ID는 리스트로 보존 (모든 관련 trial 링크 제공)
```

---

## 5. 키워드 기반 파싱 스펙

LLM 없이 키워드 사전 매칭으로 구조화 필드 추출.
Novel first-in-class 약물처럼 사전에 없는 경우는 `"Unknown"`으로 저장 →
BD 관점에서 오히려 수동 검토 우선 대상으로 플래그 활용.

### 5-1. 모달리티 키워드 사전

```python
MODALITY_KEYWORDS = {
    "ADC": [
        "antibody-drug conjugate", "ADC", "-DXd", "-vc-MMAE", "-SMCC",
        "conjugate"
    ],
    "Bispecific Antibody": [
        "bispecific", "bsAb", "bispecific antibody", "tandem",
        "dual targeting", "CrossMAb"
    ],
    "CAR-T": [
        "CAR-T", "CAR T-cell", "chimeric antigen receptor",
        "CAR T cell therapy"
    ],
    "Monoclonal Antibody": [
        "monoclonal antibody", "mAb", "-mab", "-umab", "-zumab",
        "-ximab", "-limab"
    ],
    "Small Molecule": [
        "inhibitor", "tyrosine kinase inhibitor", "TKI", "-inib",
        "small molecule", "kinase inhibitor", "antagonist"
    ],
    "mRNA": [
        "mRNA", "messenger RNA", "mRNA vaccine", "mRNA therapy"
    ],
    "Peptide": [
        "peptide", "cyclic peptide", "stapled peptide"
    ],
    "Cell Therapy": [
        "cell therapy", "NK cell", "TIL", "tumor infiltrating lymphocyte",
        "TCR-T"
    ],
    "Oncolytic Virus": [
        "oncolytic", "oncolytic virus", "oncolytic therapy"
    ],
    "Radiopharmaceutical": [
        "radiopharmaceutical", "radioligand", "PSMA", "lutetium", "actinium"
    ],
}
# 우선순위: ADC > Bispecific > CAR-T > Monoclonal Antibody > Small Molecule
# (중복 매칭 시 위 순서로 우선 적용)
```

### 5-2. 타겟 키워드 사전

```python
TARGET_KEYWORDS = {
    "PD-1":       ["anti-PD-1", "PD-1", "PD1", "pembrolizumab", "nivolumab", "tislelizumab"],
    "PD-L1":      ["anti-PD-L1", "PD-L1", "PDL1", "atezolizumab", "durvalumab"],
    "HER2":       ["HER2", "HER-2", "ErbB2", "trastuzumab", "pertuzumab"],
    "EGFR":       ["EGFR", "epidermal growth factor receptor", "osimertinib", "-tinib"],
    "VEGF/VEGFR": ["VEGF", "VEGFR", "bevacizumab", "anti-angiogenic", "ramucirumab"],
    "TROP2":      ["TROP2", "TROP-2", "trophoblast cell surface antigen"],
    "CLDN18.2":   ["Claudin 18.2", "CLDN18.2", "Claudin18.2", "zolbetuximab"],
    "CTLA-4":     ["CTLA-4", "CTLA4", "ipilimumab", "tremelimumab"],
    "CD19":       ["CD19", "anti-CD19"],
    "CD20":       ["CD20", "anti-CD20", "rituximab", "obinutuzumab"],
    "BCMA":       ["BCMA", "B-cell maturation antigen"],
    "MET":        ["MET", "c-MET", "HGF", "crizotinib", "capmatinib"],
    "KRAS":       ["KRAS", "KRAS G12C", "sotorasib", "adagrasib"],
    "ALK":        ["ALK", "anaplastic lymphoma kinase", "crizotinib", "alectinib"],
    "FGFR":       ["FGFR", "fibroblast growth factor receptor"],
    "IDH1/2":     ["IDH1", "IDH2", "isocitrate dehydrogenase"],
    "CDK4/6":     ["CDK4", "CDK6", "CDK4/6", "palbociclib", "ribociclib"],
    "PARP":       ["PARP", "poly ADP-ribose", "olaparib", "niraparib"],
}
```

### 5-3. 바이오마커 키워드 사전

```python
BIOMARKER_KEYWORDS = [
    # 단백질 발현 (IHC 관련 — LG AI Research 핵심 관심)
    "PD-L1", "HER2", "TROP2", "CLDN18.2", "RET", "MET",
    "ER", "PR", "AR",
    # 유전체
    "TMB", "tumor mutational burden",
    "MSI", "MSI-H", "microsatellite instability",
    "dMMR", "mismatch repair",
    "EGFR mutation", "KRAS", "BRAF", "ALK", "ROS1", "NTRK",
    # 기타
    "biomarker", "biomarker-selected", "biomarker analysis",
    "companion diagnostic", "CDx",
    "genomic", "molecular profiling",
]
```

### 5-4. CDx 전략 판별 로직

```python
def infer_cdx_strategy(eligibility_text: str) -> str:
    """
    'confirmed': 특정 바이오마커 기반 환자 선택 기준 존재
    'exploratory': 바이오마커 분석 언급되나 선택 기준 아님
    'none': 바이오마커 관련 내용 없음
    """
    text = eligibility_text.lower()

    confirmed_patterns = [
        "positive", "overexpression", "amplification",
        "mutation", "high expression", "selected",
        "must have", "required", "documented",
    ]
    exploratory_patterns = [
        "exploratory", "optional", "tissue sample",
        "correlative", "biomarker analysis", "translational",
    ]

    has_biomarker = any(b.lower() in text for b in BIOMARKER_KEYWORDS)

    if has_biomarker:
        if any(p in text for p in confirmed_patterns):
            return "confirmed"
        elif any(p in text for p in exploratory_patterns):
            return "exploratory"
        else:
            return "exploratory"  # 바이오마커 언급 있으면 기본 exploratory
    return "none"
```

### 5-5. 파싱 정확도 및 한계

| 필드 | 예상 정확도 | 비고 |
|---|---|---|
| 모달리티 | ~90% | 약물명 suffix 패턴이 명확 |
| 타겟 | ~85% | Novel target은 Unknown 처리 |
| 바이오마커 언급 | ~95% | eligibility criteria 텍스트 매칭 |
| CDx 전략 | ~80% | 문맥 의존적인 경우 오분류 가능 |

`"Unknown"` 처리된 항목은 대시보드에서 별도 플래그로 표시 → 수동 검토 우선 대상으로 활용.

---

## 6. PubMed 연동 스펙

**엔드포인트**: NCBI E-utilities API (무료, API key 권장)

```python
BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"

def fetch_pubmed_links(drug_name: str, max_results: int = 3) -> list:
    # esearch로 PMID 수집
    search_url = f"{BASE_URL}esearch.fcgi"
    params = {
        "db": "pubmed",
        "term": f"{drug_name}[Title/Abstract] AND clinical trial[PT]",
        "retmax": max_results,
        "retmode": "json",
        "sort": "relevance",
        "api_key": NCBI_API_KEY,  # 선택, 없어도 동작 (rate limit 낮음)
    }
    # efetch로 메타데이터 수집
    # 반환: [{"pmid": "...", "title": "...", "url": "https://pubmed.ncbi.nlm.nih.gov/{pmid}"}]
```

---

## 7. CDx 기회 플래그 로직

```python
def calculate_cdx_opportunity(trial: dict) -> dict:
    score = 0
    flags = []

    # 1. Phase 1 완료 임박 (primary_completion_date 기준 6개월 이내)
    if is_completion_within_months(trial["primary_completion_date"], months=6):
        score += 3
        flags.append("phase2_entry_imminent")

    # 2. 바이오마커 언급 있음
    if trial["biomarker_mentioned"]:
        score += 2
        flags.append("biomarker_relevant")

    # 3. CDx 전략이 탐색적 또는 미정 (confirmed는 이미 전략 있음)
    if trial["cdx_strategy"] == "exploratory":
        score += 2
        flags.append("cdx_strategy_open")
    elif trial["cdx_strategy"] == "none":
        score += 1
        flags.append("cdx_strategy_undefined")

    # 4. 우선 타겟 암종 (대장암 / 위암)
    priority_cancers = [
        "colorectal", "gastric", "stomach", "colon", "rectal",
        "gastrointestinal", "GI", "CRC", "GC"
    ]
    if any(c in trial["condition"].lower() for c in priority_cancers):
        score += 2
        flags.append("priority_indication")

    # 5. 파트너십 없는 단독 개발
    if not trial["collaborators"]:
        score += 1
        flags.append("no_partner")

    # 6. 타겟 Unknown → 수동 검토 필요
    if trial["target"] == "Unknown":
        flags.append("needs_review")

    return {
        "cdx_opportunity_score": score,
        "cdx_opportunity_level": (
            "high"   if score >= 7 else
            "medium" if score >= 4 else
            "low"
        ),
        "cdx_flags": flags,
    }
```

---

## 8. 데이터 스키마

### 8-1. Raw Data (data/raw/full_YYYY-MM-DD.json)

ClinicalTrials.gov API 응답 원본을 그대로 저장. 가공 없음.

```json
{
  "fetch_date": "2026-06-09T00:00:00Z",
  "fetch_type": "full",
  "total_count": 2048,
  "studies": [
    { /* ClinicalTrials.gov API 원본 응답 그대로 */ }
  ]
}
```

### 8-2. Parsed Data (data/parsed/pipeline.json)

```json
{
  "metadata": {
    "last_updated": "2026-06-09T00:00:00Z",
    "total_drugs": 1842,
    "total_companies": 312,
    "source_raw": "data/raw/full_2026-06-09.json"
  },
  "drugs": [
    {
      "drug_id": "uuid-v4",
      "drug_name": "Tislelizumab",
      "company": "BeiGene",
      "collaborators": ["Novartis"],
      "partnership_status": "partnered",

      "condition": "Non-Small Cell Lung Cancer",
      "condition_normalized": "NSCLC",
      "cancer_category": "Lung",

      "phase": "Phase 1",
      "overall_status": "RECRUITING",
      "primary_completion_date": "2026-12-31",
      "start_date": "2023-03-01",

      "modality": "Monoclonal Antibody",
      "target": "PD-1",
      "moa": "Anti-PD-1 immune checkpoint inhibitor",

      "biomarker_mentioned": true,
      "biomarker_list": ["PD-L1", "TMB"],
      "cdx_strategy": "exploratory",

      "cdx_opportunity_score": 8,
      "cdx_opportunity_level": "high",
      "cdx_flags": ["phase2_entry_imminent", "biomarker_relevant", "cdx_strategy_open"],

      "nct_ids": ["NCT05000001"],
      "clinicaltrials_url": "https://clinicaltrials.gov/study/NCT05000001",
      "pubmed_links": [
        {
          "pmid": "38000001",
          "title": "Tislelizumab in advanced NSCLC...",
          "url": "https://pubmed.ncbi.nlm.nih.gov/38000001"
        }
      ],

      "keyword_parsed": true,
      "parse_date": "2026-06-09T00:00:00Z"
    }
  ]
}
```

---

## 9. GitHub Actions 워크플로우

```yaml
# .github/workflows/update_pipeline.yml

name: Update Oncology Pipeline Data

on:
  schedule:
    - cron: '0 0 * * 1'   # 매주 월요일 00:00 UTC (09:00 KST)
  workflow_dispatch:        # 수동 실행 가능

jobs:
  update:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install -r requirements.txt

      - name: Run pipeline
        env:
          NCBI_API_KEY: ${{ secrets.NCBI_API_KEY }}   # 선택
        run: python scripts/run_pipeline.py

      - name: Commit and push data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/
          git diff --staged --quiet || git commit -m "chore: update pipeline data $(date +'%Y-%m-%d')"
          git push
```

---

## 10. 프론트엔드 스펙

### 기술 스택
- **React + Vite**
- **TanStack Table v8** — 정렬, 필터, 페이지네이션
- **Tailwind CSS** — 스타일링
- **데이터 소스**: `raw.githubusercontent.com/{owner}/{repo}/main/data/parsed/pipeline.json`

### 뷰 구조

```
┌──────────────────────────────────────────────────────────────┐
│  Oncology Pipeline Dashboard          마지막 업데이트: 2026-06-09 │
├──────────────────────────────────────────────────────────────┤
│  [암종 ▼]  [모달리티 ▼]  [CDx 기회 ▼]  [파트너십 ▼]  [🔍 검색]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  회사 목록                         선택된 회사: BeiGene        │
│  ┌─────────────────────┐          ┌───────────────────────┐ │
│  │ BeiGene       · 12  │ ←선택    │ 파이프라인 테이블        │ │
│  │ Roche         · 9   │          │ (컬럼 목록 아래 참조)   │ │
│  │ AstraZeneca   · 8   │          │                       │ │
│  │ Merck         · 7   │          │                       │ │
│  └─────────────────────┘          └───────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### FilterBar 컴포넌트

| 필터 | 타입 | 옵션 |
|---|---|---|
| 암종 | multi-select | pipeline.json에서 동적 생성 |
| 모달리티 | multi-select | ADC / Bispecific / CAR-T / Monoclonal Antibody / Small Molecule / mRNA / Peptide / Other |
| CDx 기회 | single-select | High / Medium / Low / All |
| 파트너십 | single-select | Partnered / Solo / All |
| 수동 검토 필요 | toggle | target=Unknown 항목만 |
| 키워드 검색 | text input | 약물명, 타겟, 회사명 전문 검색 |

### PipelineTable 컴포넌트

| 컬럼 | 정렬 | 비고 |
|---|---|---|
| 약물명 | ✅ | NCT 링크 포함 |
| 타겟 | ✅ | Unknown이면 🔍 배지 |
| MoA | ❌ | 툴팁으로 전문 표시 |
| 모달리티 | ✅ | 색상 배지 |
| 암종 | ✅ | |
| 임상단계 | ✅ | |
| 등록 상태 | ✅ | 색상 구분 (green/yellow/gray) |
| Completion Date | ✅ | Phase 2 진입 타이밍 |
| 파트너십 | ✅ | Partnered / Solo |
| 바이오마커 | ❌ | 리스트 표시 |
| CDx 전략 | ✅ | confirmed / exploratory / none |
| CDx 기회 | ✅ | 🔴 High / 🟡 Medium / ⚪ Low |
| 논문 | ❌ | PubMed 링크 아이콘 |

### Cloudflare Pages 빌드 설정

| 항목 | 값 |
|---|---|
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `frontend` |

---

## 11. 환경변수 및 시크릿

| 변수명 | 위치 | 용도 |
|---|---|---|
| `NCBI_API_KEY` | GitHub Secrets | PubMed API rate limit 향상 (선택) |

> OpenAI API 키 불필요 — 키워드 기반 파싱으로 외부 LLM 의존성 제거

---

## 12. requirements.txt

```
requests==2.32.3
python-dateutil==2.9.0
tqdm==4.66.4
```

---

## 13. 개발 순서 (Claude Code 구현 권장 순서)

1. `scripts/fetch_trials.py` — ClinicalTrials.gov 수집 및 raw 저장 (full/delta)
2. `scripts/parse_fields.py` — 키워드 기반 파싱 (소량 샘플로 먼저 검증)
3. `scripts/fetch_pubmed.py` — PubMed 연동
4. `scripts/flag_cdx.py` — CDx 플래그 계산
5. `scripts/run_pipeline.py` — 전체 통합 실행
6. `data/parsed/pipeline.json` 샘플 확인 및 키워드 사전 튜닝
7. `frontend/` — React 앱 (FilterBar → CompanyList → PipelineTable 순서)
8. `.github/workflows/update_pipeline.yml` — GitHub Actions 설정
9. Cloudflare Pages 연결

---

## 14. 향후 확장 포인트

- **DB 마이그레이션**: raw/parsed 구조 그대로 PostgreSQL로 이전, API 서버 추가
- **암종 커버리지 확대**: 대장암/위암 → 전체 고형암 → 혈액암
- **키워드 사전 고도화**: Unknown 비율 모니터링 후 사전 지속 보완
- **알림 기능**: CDx 기회 high 신규 항목 → 이메일 알림 (GitHub Actions + SMTP)
- **파이프라인 분포 차트**: 타겟별 / 모달리티별 현황 시각화 추가
- **파트너사 데모 뷰**: 특정 회사 파이프라인만 추출해서 공유 가능한 뷰
