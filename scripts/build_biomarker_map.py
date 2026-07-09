#!/usr/bin/env python3
"""
Biomarker cleaning/normalization 맵 생성 → frontend/src/utils/biomarkers.js
=========================================================================
파이프라인 + 학회 초록의 biomarker_list 전수 어휘에서
  BLOCK: '바이오마커 아님'(genomic/biomarker/ctDNA/CDx/DNA/NGS/methylation/ECOG …) 정확일치 제거
  CANON: 표기 병합(MSI-H/MSI/microsatellite instability, ERBB2/HER2, "EGFR mutation"/EGFR, "PD-L1 expression"/PD-L1 …)
를 만든다. 보수적 접미사(mutation/expression/status/positive/negative/amplification 등)만 제거하고
KRAS G12C·BRAF V600E·HER2-low 등 임상적으로 구별되는 변이/상태는 보존(과병합 금지).

재생성:  python3 scripts/build_biomarker_map.py
"""
import json, glob, os, collections, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
OUT = os.path.join(ROOT, "frontend", "src", "utils", "biomarkers.js")


def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


# generic 용어·방법·카테고리·임상상태
TIER1 = {
 'genomic','genomics','genomic profiling','genomic alteration','genomic alterations','genomic instability','genomic instability score','genomic signature','genomic landscape','biomarker','biomarkers','biomarker analysis','biomarker positive','biomarker negative','biomarker status','molecular profiling','molecular subtype','molecular subtypes','molecular subtyping','molecular classification','molecular','molecular alteration','molecular alterations','molecular residual disease','gene expression','expression','overexpression','gene expression profile','gene signature','signature','oncosignature','mutation','mutations','somatic mutation','somatic mutations','germline mutation','germline mutations','mutational burden','mutation burden','driver mutation','driver mutations','gene mutation','point mutation','copy number','copy number variation','cnv','cnvs','copy number alteration','copy number alterations','amplification','deletion','fusion','gene fusion','rearrangement','translocation','wild-type','wildtype','wild type','mutant','mutation status','positive','negative','status','ngs','wes','wgs','ihc','fish','pcr','qpcr','rt-pcr','ddpcr','immunohistochemistry','sequencing','next-generation sequencing','whole exome sequencing','whole genome sequencing','rna-seq','rna sequencing','dna sequencing','companion diagnostic','cdx','radiomics','proteomics','transcriptomics','metabolomics','proteomic','metabolomic','transcriptomic','multi-omics','omics','sphingolipid profiling','liquid biopsy','molecular testing','molecular test','panel','gene panel','multi-gene panel','multigene panel','assay','methylation','dna methylation','epigenetic','epigenetics','dna repair','dna damage response','dna damage response (ddr)','tumor microenvironment','tme','microbiome','ecog','ecog performance status','performance status','smoking status','kps','karnofsky','pcr (pathologic complete response)','pathologic complete response','tnm stage','stage','international staging system stage 3','iss stage 3','clinical stage',
}
# 핵산 analyte / 액체생검 (샘플·방법 계열, 분자마커 아님)
TIER2 = {
 'dna','rna','mrna','mirna','mirnas','cdna','mtdna','ecdna','line-1 dna','exo-mirna','ctdna','cfdna','ccfdna','cell-free dna','circulating tumor dna','ct-dna','utdna','ctdna methylation','cfdna methylation','ctc','ctcs','ctcna','circulating tumor cells','circulating tumor cell','ebv dna','hbv dna','hpv dna','ct-hpv dna','cthpvdna','ttmv-hpv dna','ebv-dna','hbv-dna','mrd',
}
BLOCK = {norm(x) for x in (TIER1 | TIER2)}

# 보수적 접미사: 구별 안 주는 서술어만 제거 (V600E/G12C/exon/high-low/fusion/methylation 은 보존)
SUF = re.compile(r"\s*(mutation[s]?|mutant|positive|negative|expression|overexpression|amplification|amplified|ihc\s*\d*\+?|status)\s*$", re.I)
# fold-group 대표형 강제 병합
SEMANTIC = {'erbb2': 'HER2', 'pdcd1': 'PD-1', 'cd274': 'PD-L1', 'p53': 'TP53'}
# 명시적 병합 (MSI 계열 — opposites(MSS/pMMR/MSI-low) 제외)
EXPLICIT = {
 'msi': 'MSI-H', 'msi-h': 'MSI-H', 'msih': 'MSI-H', 'msi high': 'MSI-H', 'msi-high': 'MSI-H',
 'microsatellite instability': 'MSI-H', 'microsatellite instability-high': 'MSI-H',
 'microsatellite instability high': 'MSI-H', 'microsatellite-instability': 'MSI-H',
 'erbb2': 'HER2', 'her-2': 'HER2', 'pdcd1': 'PD-1', 'cd274': 'PD-L1', 'p53': 'TP53',
}


def fold(s):
    x = s.strip()
    for _ in range(3):
        x2 = SUF.sub("", x).strip().strip("-").strip()
        if x2 == x:
            break
        x = x2
    return re.sub(r"[\s\-_/]+", "", x.lower())


def main():
    c = collections.Counter()
    for d in json.load(open(os.path.join(ROOT, "data/frontend/pipeline.json")))["drugs"]:
        for b in (d.get("biomarker_list") or []):
            c[b] += 1
    for f in glob.glob(os.path.join(ROOT, "data/parsed/abstracts_*.json")):
        for a in json.load(open(f)).get("abstracts", []):
            for b in (a.get("biomarker_list") or []):
                c[b] += 1

    groups = collections.defaultdict(list)
    for b, n in c.items():
        if norm(b) in BLOCK:
            continue
        groups[fold(b)].append((b, n))
    gc = {}
    for k, v in groups.items():
        if k in SEMANTIC:
            gc[k] = SEMANTIC[k]; continue
        v.sort(key=lambda x: (-x[1], len(x[0])))
        gc[k] = v[0][0]
    CANON = {}
    for k, v in groups.items():
        canon = gc[k]; tot = sum(n for _, n in v)
        for b, n in v:
            if norm(b) != norm(canon) and (tot >= 3 or k in SEMANTIC):
                CANON[norm(b)] = canon
    CANON.update(EXPLICIT)
    for k in list(CANON):
        if k in BLOCK:
            del CANON[k]

    def js_set(s):
        return "[\n  " + ",\n  ".join(json.dumps(x) for x in sorted(s)) + ",\n]"

    def js_map(m):
        return "{\n  " + ",\n  ".join(f"{json.dumps(k)}: {json.dumps(v)}" for k, v in sorted(m.items())) + ",\n}"

    body = f'''// Biomarker 정제(cleaning) + 정규화(normalization) — dataSource 로드 시 1회 적용.
// 목적: (1) genomic/biomarker/ctDNA/CDx 등 '바이오마커 아님' 제거,
//       (2) MSI-H/MSI/microsatellite instability, ERBB2/HER2, "EGFR mutation"/EGFR 등 표기 병합.
// 원칙: 정확 일치(소문자+공백정규화 키). KRAS G12C·BRAF V600E·HER2-low 등 임상적으로 구별되는
//       변이/상태는 보존(과병합 금지). 이 파일은 scripts/build_biomarker_map.py 로 데이터서 생성 — 직접 수정 금지.

const norm = (s) => (s || '').trim().replace(/\\s+/g, ' ').toLowerCase()

// 제거: generic 용어·방법·카테고리·임상상태·핵산 analyte(액체생검)
const BLOCK = new Set({js_set(BLOCK)})

// 표기 병합: normalizedRaw -> canonical surface
const CANON = {js_map(CANON)}

// 원소 배열을 정제·정규화·중복제거해서 반환 (dataSource 에서 각 레코드 biomarker_list 에 적용)
export function cleanBiomarkers(list) {{
  if (!list || !list.length) return list || []
  const out = []
  const seen = new Set()
  for (const b of list) {{
    const nb = norm(b)
    if (!nb || BLOCK.has(nb)) continue
    const c = CANON[nb] ?? (typeof b === 'string' ? b.trim() : b)
    const nc = norm(c)
    if (seen.has(nc)) continue
    seen.add(nc)
    out.push(c)
  }}
  return out
}}
'''
    open(OUT, "w").write(body)
    print(f"wrote {os.path.relpath(OUT, ROOT)}  (BLOCK={len(BLOCK)}, CANON={len(CANON)})")


if __name__ == "__main__":
    main()
