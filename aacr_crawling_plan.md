# AACR 초록 수집 계획 (Stage 4)

> 목표: AACR 컨퍼런스 초록을 수집해 기존 ASCO 데이터와 동일 스키마로 통합.
> 결론: **PDF·스크래핑이 아니라 Crossref API로 수집** — 훨씬 깨끗하고 ToS 친화적.

---

## 1. 사이트 구조 (조사 결과)

`https://aacrjournals.org/pages/meeting-abs` 분석:

- 각 학회 = **저널 supplement 이슈**. 예:
  | 학회 | URL |
  |---|---|
  | AACR Annual Meeting 2026 | `cancerres/issue/86/8_Supplement` (+ `7_Supplement` Part 1) |
  | AACR Annual Meeting 2025 | `cancerres/issue/85/8_Supplement_1` (Regular) + `_2` (Late-Breaking) |
  | SABCS 2025 | `clincancerres/issue/32/4_Supplement` |
  | AACR IO Conference | `cancerimmunolres/issue/14/2_Supplement` |
- 이슈 TOC(초록 목록)는 **JS로 로드** → 정적 HTML에 초록 링크 없음 (직접 스크래핑 비효율).
- robots.txt: search/download만 차단, 아티클·이슈 페이지는 허용. 봇은 403이라 브라우저 UA 필요.
- 개별 초록 페이지엔 `citation_*` 메타 + abstract 본문 있음 (백업 소스로 활용 가능).

## 2. 채택 소스: Crossref API ✅

AACR이 모든 초록 DOI를 Crossref에 등록 → **구조화 메타를 그대로 제공**:
- 엔드포인트: `https://api.crossref.org/journals/{ISSN}/works`
- ISSN: Cancer Research `1538-7445` (Annual Meeting), Clin Cancer Res `1557-3265` (SABCS 등), Cancer Immunol Res `2326-6074` (IO)
- 검증: AACR Annual Meeting **2026 = 7,585건**, 2025 = 7,045건
- 각 항목 제공: `DOI`(번호 내장 `am2026-4956`), `title`("Abstract 4956: ..."), `author`(구조화: family/given/affiliation), **`abstract`(본문 전체, JATS XML)**, `published`(날짜)
- 장점: PDF 파싱 불필요(ASCO의 2단 스크램블 문제 없음), 번호·제목·본문이 정확, rate-limit 친화(polite pool `mailto`), cursor 페이지네이션.

## 3. 수집 스크립트: `scripts/fetch_aacr.py`

```
for ISSN, year in 대상목록:
    cursor = "*"
    while True:
        GET /journals/{ISSN}/works
            ?filter=from-pub-date:{year}-01-01,until-pub-date:{year}-12-31
            &rows=500&cursor={cursor}&mailto=...
        각 work → 레코드 변환:
          abstract_id = DOI에서 추출 (am2026-4956 → "4956", LB#/PR# 포함)
          title       = title[0]에서 "Abstract N: " 접두사 제거
          author_raw  = author[0].family/given + affiliation[0]
          abstract_text = jats_strip(abstract)   # <jats:p> 등 제거
        cursor 없으면 종료
```

- 날짜 필터로 특정 학회 분리 (Annual Meeting은 4월). 또는 DOI 패턴 `am{year}`로 필터.
- 본문이 빈 항목(드묾)은 초록 페이지에서 보강(폴백).
- rate limit: polite pool, 요청 간 짧은 sleep.

## 4. 공유 스키마 매핑 (ASCO와 동일)

`build_record`와 동일하게, **conference-agnostic 추론 재사용** (parse_fields):
- `modality_list`, `target_list`, `biomarker_list` ← `infer_*` (title+abstract)
- `nct_ids`, `phases`, `cancer_category`(retag — 트랙 없으니 title+body 키워드 스캔), `companies_normalized`, `drugs_mentioned`
- 식별자: `uid = "aacr-{year}-{number}"`, `conference="AACR"`, `year`, `presentation_type`(Regular/Late-Breaking from DOI/title)
- 출력: `data/parsed/abstracts_aacr2026.json` (ASCO와 동일 구조)

## 5. ASCO와 통합

프론트엔드는 **이미 다중 학회 지원** (Source/Year 필터, `getAbstractFilterOptions` 동적):
- **방식 A (권장)**: 빌드 스텝이 `abstracts_all.json` 생성 (ASCO + AACR 병합). ConferencesPage·Visualize⑧ 차트가 이 파일 하나만 fetch.
- 방식 B: 프론트에서 `abstracts_*.json` 여러 개 fetch 후 클라이언트 병합.
- uid 네임스페이스(`asco-` vs `aacr-`)로 충돌 없음.
- 회사 정규화(`companies_normalized`)가 공통이라 **두 학회 회사 필터가 그대로 공유**됨.

## 6. LLM 보강

기존 `llm_enrich.py --mode abstracts` + `llm_merge.py --mode abstracts`가
title+body 기반이라 **AACR에도 그대로 적용** (modality/target/biomarker), 이어서 `normalize_fields.py`.

## 7. 단계 (제안)

1. `fetch_aacr.py` — Crossref로 AACR Annual Meeting 2026 수집 → `abstracts_aacr2026.json` (~7,585건)
2. 검증 (번호·제목·본문 샘플)
3. `abstracts_all.json` 병합 빌드 + 프론트 데이터 URL 전환
4. LLM 보강 + normalize
5. (확장) SABCS·IO·과거 연도 추가 — ISSN/연도만 추가
