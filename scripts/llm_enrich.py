"""
로컬 LLM(Ollama / Qwen3) 기반 데이터 검증·보강.

규칙기반(parse_fields) 결과를 보완한다:
  - modality / target / biomarkers 를 LLM으로 재추출
  - 약물 고유 속성(modality·target)은 약물명 단위로 캐싱 → 호출 수 최소화
  - 캐시는 디스크에 저장되어 재개 가능(중단되어도 이어서)

용법:
  python scripts/llm_enrich.py --mode drugs --only-unknown --limit 100   # POC
  python scripts/llm_enrich.py --mode drugs --only-unknown               # 전체(Unknown만)
  python scripts/llm_enrich.py --mode eval --limit 100                   # 규칙 vs LLM 비교
"""

import argparse
import json
import os
import re
import time
import urllib.request

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "qwen3:30b-a3b-q4_K_M"

PIPELINE = "data/parsed/pipeline.json"
DRUG_CACHE = "data/cache/llm_drug_cache.json"
ABSTRACTS = "data/parsed/abstracts_asco2026.json"
ABSTRACT_CACHE = "data/cache/llm_abstract_cache.json"

MODALITIES = [
    "ADC", "Bispecific Antibody", "CAR-T", "Monoclonal Antibody", "Small Molecule",
    "mRNA", "Peptide", "Cell Therapy", "Oncolytic Virus", "Radiopharmaceutical", "Unknown",
]
_MOD_LOOKUP = {m.lower(): m for m in MODALITIES}

SYSTEM = (
    "You are an oncology drug classifier. Use your pharmacology knowledge of the named drug "
    "plus the trial context. Output STRICT JSON only:\n"
    '{"modality": <one of: ADC, Bispecific Antibody, CAR-T, Monoclonal Antibody, '
    "Small Molecule, mRNA, Peptide, Cell Therapy, Oncolytic Virus, Radiopharmaceutical, Unknown>, "
    '"target": <EXACTLY ONE primary molecular target as a gene/protein symbol (e.g. HER2, EGFR, PD-1); '
    'for multi-kinase inhibitors give the single most clinically relevant target; or "Unknown">, '
    '"biomarkers": <list of patient-selection biomarkers (e.g. ["PD-L1","MSI-H"]) or []>, '
    '"confidence": <0.0-1.0, your confidence in the modality+target>}\n'
    "Rules: supportive-care/non-antineoplastic agents (antiemetics, antidiarrheals, growth factors, "
    "placebo) -> modality Unknown, target Unknown. Only assert a target you are confident the drug acts on. "
    "For obscure internal code names you do not recognize, prefer Unknown with low confidence."
)


def ollama(prompt: str, timeout: int = 120) -> str:
    body = json.dumps({
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "think": False,
        "format": "json",
        "keep_alive": "15m",
        "options": {"temperature": 0, "num_ctx": 2048},
    }).encode()
    req = urllib.request.Request(OLLAMA_URL, data=body, headers={"Content-Type": "application/json"})
    resp = json.loads(urllib.request.urlopen(req, timeout=timeout).read())
    return resp.get("response", "")


def normalize_modality(m: str) -> str:
    if not m:
        return "Unknown"
    return _MOD_LOOKUP.get(m.strip().lower(), "Unknown")


def classify_drug(drug_name: str, combo: list, condition: str, title: str) -> dict:
    ctx = f"Drug: {drug_name}"
    if combo:
        ctx += f"\nCombination partners: {', '.join(combo)}"
    ctx += f"\nCondition: {condition or 'n/a'}\nTrial title: {title or 'n/a'}"
    prompt = f"{SYSTEM}\n\n{ctx}\n\nJSON:"
    raw = ollama(prompt)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"modality": "Unknown", "target": "Unknown", "biomarkers": [], "confidence": 0.0, "_error": "parse"}
    return {
        "modality": normalize_modality(data.get("modality")),
        "target": (data.get("target") or "Unknown").strip() or "Unknown",
        "biomarkers": data.get("biomarkers") if isinstance(data.get("biomarkers"), list) else [],
        "confidence": float(data.get("confidence", 0.0)) if isinstance(data.get("confidence", 0.0), (int, float)) else 0.0,
    }


SYSTEM_ABS = (
    "You are an oncology conference abstract classifier. From the abstract text, extract STRICT JSON:\n"
    '{"modality_list": <list from: ADC, Bispecific Antibody, CAR-T, Monoclonal Antibody, Small Molecule, '
    "mRNA, Peptide, Cell Therapy, Oncolytic Virus, Radiopharmaceutical (only those actually studied; [] if none)>, "
    '"target_list": <list of molecular target gene/protein symbols studied (e.g. ["HER2","EGFR"]) or []>, '
    '"biomarkers": <list of patient-selection / stratification biomarkers (e.g. ["PD-L1","MSI-H","ctDNA"]) or []>, '
    '"confidence": <0.0-1.0>}\n'
    "Extract only what the abstract actually investigates. Do not invent."
)


def classify_abstract(title: str, body: str) -> dict:
    txt = f"Title: {title or 'n/a'}\nAbstract: {(body or '')[:3000]}"
    raw = ollama(f"{SYSTEM_ABS}\n\n{txt}\n\nJSON:", timeout=180)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"_error": "parse"}

    def _clean_list(v):
        return [str(x).strip() for x in v if str(x).strip()] if isinstance(v, list) else []

    mods = [normalize_modality(m) for m in _clean_list(data.get("modality_list"))]
    mods = [m for m in mods if m != "Unknown"]
    return {
        "modality_list": list(dict.fromkeys(mods)),
        "target_list": list(dict.fromkeys(_clean_list(data.get("target_list")))),
        "biomarkers": list(dict.fromkeys(_clean_list(data.get("biomarkers")))),
        "confidence": float(data.get("confidence", 0.0)) if isinstance(data.get("confidence", 0.0), (int, float)) else 0.0,
    }


def _norm_name(n: str) -> str:
    return re.sub(r"\s+", " ", (n or "").strip().lower())


def load_cache() -> dict:
    if os.path.exists(DRUG_CACHE):
        with open(DRUG_CACHE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict) -> None:
    os.makedirs(os.path.dirname(DRUG_CACHE), exist_ok=True)
    tmp = DRUG_CACHE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DRUG_CACHE)


def run_drugs(only_unknown: bool, limit: int | None) -> None:
    drugs = json.load(open(PIPELINE, encoding="utf-8"))["drugs"]
    cache = load_cache()

    # 약물명 단위로 대표 레코드 선택 (가장 정보 많은 title)
    by_name: dict[str, dict] = {}
    for d in drugs:
        if only_unknown and d.get("modality") != "Unknown" and d.get("target") != "Unknown":
            continue
        key = _norm_name(d["drug_name"])
        if not key or key in cache:
            continue
        cur = by_name.get(key)
        if cur is None or len(d.get("official_title") or "") > len(cur.get("official_title") or ""):
            by_name[key] = d

    todo = list(by_name.items())
    if limit:
        todo = todo[:limit]
    print(f"고유 약물 {len(by_name)}개 중 이번 실행 {len(todo)}개 (캐시됨 {len(cache)})")

    t0 = time.time()
    for i, (key, d) in enumerate(todo, 1):
        try:
            res = classify_drug(
                d["drug_name"], d.get("combo_drugs") or [],
                d.get("condition"), d.get("official_title") or d.get("brief_title"),
            )
        except Exception as e:
            res = {"_error": str(e)[:80]}
        # 에러(네트워크/파싱) 건은 캐시하지 않음 → 재개 시 재시도 (Ollama 장애가 캐시 오염 X)
        if "_error" in res:
            print(f"  [skip] {d['drug_name'][:30]}: {res['_error']}")
            continue
        res["_drug_name"] = d["drug_name"]
        cache[key] = res
        if i % 10 == 0 or i == len(todo):
            save_cache(cache)
            rate = i / (time.time() - t0)
            eta = (len(todo) - i) / rate if rate else 0
            print(f"  {i}/{len(todo)}  {rate:.2f}/s  ETA {eta/60:.1f}min  | {d['drug_name'][:30]} -> {res['modality']}/{res['target']}")
    save_cache(cache)
    print(f"완료. 캐시 총 {len(cache)}개 -> {DRUG_CACHE}")


def run_abstracts(limit: int | None) -> None:
    abstracts = json.load(open(ABSTRACTS, encoding="utf-8"))["abstracts"]
    cache = {}
    if os.path.exists(ABSTRACT_CACHE):
        cache = json.load(open(ABSTRACT_CACHE, encoding="utf-8"))

    todo = [a for a in abstracts if a["uid"] not in cache and (a.get("title") or a.get("abstract_text"))]
    if limit:
        todo = todo[:limit]
    print(f"초록 {len(abstracts)}개 중 이번 실행 {len(todo)}개 (캐시됨 {len(cache)})")

    t0 = time.time()
    for i, a in enumerate(todo, 1):
        try:
            res = classify_abstract(a.get("title"), a.get("abstract_text"))
        except Exception as e:
            res = {"_error": str(e)[:80]}
        if "_error" in res:
            print(f"  [skip] {a['uid']}: {res['_error']}")
            continue
        cache[a["uid"]] = res
        if i % 10 == 0 or i == len(todo):
            tmp = ABSTRACT_CACHE + ".tmp"
            os.makedirs(os.path.dirname(ABSTRACT_CACHE), exist_ok=True)
            json.dump(cache, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            os.replace(tmp, ABSTRACT_CACHE)
            rate = i / (time.time() - t0)
            eta = (len(todo) - i) / rate if rate else 0
            print(f"  {i}/{len(todo)}  {rate:.2f}/s  ETA {eta/60:.1f}min | {a['abstract_id']} -> {res['modality_list']}/{res['biomarkers']}")
    print(f"완료. 캐시 총 {len(cache)} -> {ABSTRACT_CACHE}")


def run_eval(limit: int) -> None:
    """규칙기반 vs LLM 비교 (현재 Unknown이 아닌 것 포함, 무작위)."""
    import random
    drugs = json.load(open(PIPELINE, encoding="utf-8"))["drugs"]
    random.seed(42)
    sample = random.sample(drugs, min(limit, len(drugs)))
    agree_mod = recovered_mod = changed_mod = 0
    rows = []
    for d in sample:
        res = classify_drug(d["drug_name"], d.get("combo_drugs") or [], d.get("condition"),
                            d.get("official_title") or d.get("brief_title"))
        rule_m, llm_m = d.get("modality"), res["modality"]
        if rule_m == llm_m:
            agree_mod += 1
        elif rule_m == "Unknown" and llm_m != "Unknown":
            recovered_mod += 1
        elif rule_m != "Unknown" and llm_m != rule_m:
            changed_mod += 1
        rows.append((d["drug_name"][:28], rule_m, llm_m, d.get("target"), res["target"]))
    n = len(sample)
    print(f"\n=== {n}건 비교 (modality) ===")
    print(f"일치: {agree_mod}  | 규칙 Unknown→LLM 채움: {recovered_mod}  | 규칙≠LLM(불일치): {changed_mod}")
    print("\n약물 | 규칙mod -> LLMmod | 규칙tgt -> LLMtgt")
    for r in rows[:40]:
        print(f"  {r[0]:30} {str(r[1]):20}->{str(r[2]):20} | {str(r[3]):12}->{r[4]}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["drugs", "abstracts", "eval"], default="eval")
    ap.add_argument("--only-unknown", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    if args.mode == "eval":
        run_eval(args.limit or 60)
    elif args.mode == "abstracts":
        run_abstracts(args.limit)
    else:
        run_drugs(args.only_unknown, args.limit)
