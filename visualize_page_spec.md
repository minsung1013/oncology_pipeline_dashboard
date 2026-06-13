# Pipeline 시각화 페이지 — 설계 스펙

> **문서 목적**: `oncology_pipeline_dashboard`에 회사·암종 중심의 파이프라인 시각화 탭을 추가하기 위한 구현 스펙. Claude Code가 이 문서를 기준으로 구현한다.
>
> **목적 (BD 관점)**: 우리는 H&E 이미지로부터 바이오마커/돌연변이/공간전사체를 예측하는 AI 모델을 보유. 이 모델은 동반진단(CDx) 및 임상시험 디자인(환자 선별 전략)에 가치를 제공할 수 있다. 이 시각화는 **"어떤 제약사가 우리 모델과 시너지를 가질 영역에 얼마나 베팅하고 있는지"**를 회사·암종 단위로 한눈에 파악하기 위한 탐색 도구다.

---

## 1. 범위

- **1차**: `data/parsed/pipeline.json` (33,735개 약물=trial 레코드) 기반. 회사·암종 다중 필터 → 6개 분포 차트.
- **2차 (이후)**: `data/parsed/abstracts_asco2026.json` (ASCO 연계: 회사별 발표 수 등) 추가. 이번 구현 범위 아님 — 단, 컴포넌트 구조상 나중에 abstract 데이터를 끼워 넣기 쉽게 설계.
- **Synergy Score(파트너 적합도 정량화)**: 이번 구현 범위 아님. 추후 별도 작업.

---

## 2. 라우팅 & 네비게이션

독립 탭으로 추가한다.

```
/                → Pipeline (기존)
/conferences     → Conferences (기존)
/visualize       → Pipeline Visualization (신규)
```

- `App.jsx`의 상단 네비에 "Visualize" 탭 추가 (기존 NavLink 패턴과 동일한 스타일).
- 새 페이지: `frontend/src/pages/VisualizePage.jsx`
- 새 컴포넌트 디렉토리: `frontend/src/components/visualize/`

---

## 3. 데이터 흐름

```
pipeline.json (33,735 drugs)
   │
   ▼
[필터] 회사(다중) × 암종(다중) — 기존 FilterBar의 MultiSelect 컴포넌트 재사용/확장
   │
   ▼
filteredDrugs (필터링된 약물 리스트)
   │
   ▼
[집계 함수들] → 6개 차트 각각의 데이터 생성
   │
   ▼
recharts 컴포넌트 6개 (그리드 배치)
```

- 33,735개 레코드에 대한 필터링·집계(group-by)는 클라이언트에서 즉시 수행 가능한 규모(가벼움). 빌드 타임 사전 계산 불필요.
- 필터는 **다중 선택, 합산형(aggregate)**: 여러 회사/여러 암종을 선택하면 해당 조건에 맞는 모든 레코드를 하나의 풀로 합쳐 집계한다. (회사별/암종별 grouped 비교 차트는 이번 범위 아님)

---

## 4. 필터 UI

기존 `FilterBar.jsx`의 `MultiSelect` 컴포넌트(체크박스 드롭다운, 선택 개수 뱃지 등 기존 스타일)를 그대로 활용해 시각화 페이지 전용 필터 바를 구성한다.

| 필터 | 소스 필드 | 옵션 |
|------|----------|------|
| 회사 (다중) | `company` | `pipeline.json`의 고유 `company` 값 목록 (개수 많으므로 검색 가능한 MultiSelect 또는 텍스트 입력 필터링 고려) |
| 암종 (다중) | `cancer_category` | 기존 `filterOptions.cancerCategories`와 동일 |

- 기존 필터(phase, modality, partnership_status 등)는 **이 페이지에선 적용하지 않음** — 회사·암종 2개 축으로 단순하게 시작. (필요 시 추후 확장 가능하도록 필터 객체는 확장 가능한 형태로 설계)
- 필터 미선택(둘 다 빈 배열)일 때는 **전체 데이터셋**(33,735건) 기준으로 차트 렌더.
- 선택된 필터는 헤더에 요약 표시 (예: "AbbVie, Genentech · Breast, Lung — 1,243 records").

---

## 5. 차트 구성 (recharts, 2열 × 3행 그리드)

```
┌─────────────────────────┬─────────────────────────┐
│ ① 회사 분포 (Top N)        │ ② Phase 분포              │
├─────────────────────────┼─────────────────────────┤
│ ③ 암종 분포               │ ④ 모달리티 분포            │
├─────────────────────────┼─────────────────────────┤
│ ⑤ 타겟 분포 (Top N)        │ ⑥ 바이오마커 언급 비율      │
└─────────────────────────┴─────────────────────────┘
```

각 차트 위에 "요약 카드" 행 추가: 매칭 레코드 수, 고유 회사 수, 고유 암종 수, biomarker_mentioned 비율(%) — 4개 숫자를 카드로 표시.

### ① 회사 분포 (Top N)
- 소스: `company` 필드 group-by count
- 차트: 가로 막대 (BarChart, layout="vertical" — 회사명이 길어서 가로형 권장)
- Top N 적용 (섹션 6 참조), 나머지는 "Other"로 합산
- **회사를 1개 이상 선택한 경우에도 이 차트는 계속 표시**(선택한 회사들이 필터링된 풀 내에서 몇 건인지 보여줌 — 단, 이미 필터링되어 선택 회사 외엔 0이므로, 이 경우 차트 의미가 줄어듦. 데이터 없으면 "선택된 회사만 표시됨" 안내 문구 표시)

### ② Phase 분포
- 소스: `phases` 배열 — 약물이 여러 phase에 걸쳐 있을 수 있으므로(`PHASE1/PHASE2` 등 콤보 값도 존재) **분리 카운트**: 각 약물의 `phases` 배열의 각 원소를 1건씩 카운트. 또는 단순화하여 `phase` 단일 필드(콤보 라벨 그대로, 예: `PHASE1/PHASE2`)로 카운트. → **단일 `phase` 필드 기준으로 카운트**(기존 FilterBar의 `PHASE_LABELS` 매핑 재사용해 라벨 표시)
- 차트: 세로 막대 또는 파이 (BarChart 권장 — 카테고리 8개 정도라 파이보다 막대가 비교 쉬움)

### ③ 암종 분포
- 소스: `cancer_category` 필드 group-by count
- 차트: 가로 막대, Top N + Other
- 회사를 선택한 경우: "이 회사(들)가 어떤 암종에 집중하는지"가 핵심 그림

### ④ 모달리티 분포
- 소스: `modality` 필드 group-by count
- 차트: 파이 또는 가로 막대 (카테고리 수가 비교적 적음 — Unknown, Monoclonal Antibody, Small Molecule, ADC, Bispecific, CAR-T 등). 파이 권장.
- **CDx 시너지 직접 신호**: ADC/Bispecific Antibody/Cell Therapy/CAR-T 비중이 시각적으로 부각되도록 색상 강조(예: 이 모달리티들은 명도 높은 강조색, 나머지는 무채색 계열) — 단, 색상 로직은 간단한 카테고리 매핑으로 처리.

### ⑤ 타겟 분포 (Top N)
- 소스: `target` 필드 group-by count (`"Unknown"` 포함)
- 차트: 가로 막대, Top N + Other
- **CDx 시너지 직접 신호**: HER2/PD-L1/TROP2/EGFR 등 IHC 기반 타겟이 상위에 보이면 파트너 적합도 높음 — 별도 강조 로직 없이 데이터 그대로 노출(사용자가 판단)

### ⑥ 바이오마커 언급 비율
- 소스: `biomarker_mentioned` (bool) — true/false 비율
- 차트: 단일 도넛(파이) 차트로 true/false 비율. 추가로 `biomarker_list`에서 가장 빈도 높은 바이오마커 Top 5를 작은 리스트/막대로 함께 표시(서브 차트 또는 카드 내 리스트).

---

## 6. Top N 조절 기능

- 회사 분포(①), 암종 분포(③), 타겟 분포(⑤)에 공통 적용.
- 페이지 상단(필터 바 옆 또는 별도 줄)에 **Top N 선택 컨트롤** 배치: 숫자 입력 또는 select (옵션: 5 / 10 / 15 / 20 / 30, 기본값 10).
- 하나의 전역 Top N 값을 ①③⑤ 차트에 공통 적용(차트별 개별 설정 아님 — 단순하게).
- N개를 초과하는 나머지는 항목들을 합산해 `"Other (N개)"`로 표시.

---

## 7. 구현 파일 구조 (제안)

```
frontend/src/
├── pages/
│   └── VisualizePage.jsx          # 페이지 컨테이너: 데이터 fetch, 필터 상태, 레이아웃
├── components/
│   └── visualize/
│       ├── VisualizeFilterBar.jsx # 회사/암종 다중선택 + Top N 컨트롤
│       ├── SummaryCards.jsx       # 요약 카드 4개
│       ├── CompanyDistributionChart.jsx
│       ├── PhaseDistributionChart.jsx
│       ├── CancerTypeDistributionChart.jsx
│       ├── ModalityDistributionChart.jsx
│       ├── TargetDistributionChart.jsx
│       └── BiomarkerChart.jsx
└── utils/
    └── visualizeAggregations.js   # group-by/Top-N 집계 함수 모음 (차트별 데이터 생성)
```

- 데이터 fetch: `PipelinePage.jsx`와 동일하게 `pipeline.json`을 fetch (`VITE_PIPELINE_URL` 환경변수 재사용). 중복 fetch가 걱정되면 추후 공통 데이터 context로 리팩터링 가능 — 이번 범위에서는 단순 중복 fetch 허용.
- `visualizeAggregations.js`에 다음 함수들 구현:
  - `aggregateByField(drugs, field, topN)` → `[{name, count}, ...]` + Other 처리 — ①③⑤에 공용으로 사용
  - `aggregateByPhase(drugs)` → phase 라벨별 카운트
  - `aggregateByModality(drugs)` → 모달리티별 카운트
  - `aggregateBiomarker(drugs)` → `{mentioned, notMentioned, topBiomarkers: [{name, count}]}`
  - `getSummaryStats(drugs)` → `{total, uniqueCompanies, uniqueCancerTypes, biomarkerPct}`

---

## 8. 의존성

- `recharts` 신규 설치 필요 (`npm install recharts`). `frontend/package.json`의 dependencies에 추가.

---

## 9. 이번 범위에 포함되지 않는 것 (명시적 제외)

- Synergy Score / 파트너 적합도 정량 지표
- ASCO abstract 데이터(`abstracts_asco2026.json`) 연계 — 회사별 발표 수 등
- 회사별/암종별 grouped 비교 차트(다중 선택 시 항목별 분리 비교)
- phase/modality 등 기존 FilterBar의 다른 필터 옵션과의 연동
