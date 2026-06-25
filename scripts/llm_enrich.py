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
import socket
import time
import urllib.error
import urllib.request

OLLAMA_URL = "http://localhost:11434/api/generate"
# 기본은 qwen3.5:27b(dense). 26GB 통합메모리 맥에서 전체 GPU 오프로드로 OOM 없이 돌고
# 한글 요약 품질이 좋아 채택. 다른 모델로 시험/교체할 땐 LLM_MODEL 환경변수로 덮어쓴다
# (예: LLM_MODEL=qwen3.5:9b → ~2배 빠르지만 한자 혼입·오역 일부).
# 같은 캐시를 공유하므로 모델을 바꾸면 신규 항목만 새 모델로 채워진다.
MODEL = os.environ.get("LLM_MODEL", "qwen3.5:27b")
# 출력 토큰 상한. 정상 응답은 ~300토큰이면 충분하지만, 유전자/단백질을 잔뜩 나열하는
# 초록에서 모델이 biomarker 목록을 무한 생성(runaway)해 180s 타임아웃을 내는 사고가 있었다.
# 상한을 두면 정상 호출은 영향 없고 폭주만 잘려서 진행이 멈추지 않는다.
NUM_PREDICT = 768

# GPU 오프로드 레이어 수. 24GB 통합메모리 맥에서 30B 모델(~18GB)을 전 레이어 GPU에 올리면
# GPU 워킹셋이 꽉 차 연산용 command buffer 할당이 실패한다
# (Metal: kIOGPUCommandBufferCallbackErrorOutOfMemory → 이후 모든 요청 Compute error).
# 일부 레이어를 CPU로 내려 GPU에 연산 여유를 남긴다. 메모리가 넉넉한 환경(집)에서는
# LLM_NUM_GPU=999(전체 오프로드)로 덮어쓰면 더 빠르다.
NUM_GPU = int(os.environ.get("LLM_NUM_GPU", "32"))

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


_CONN_BACKOFF_MAX = 30.0   # 연결 재시도 최대 대기(초)
_TIMEOUT_RETRIES = 3       # 응답 타임아웃 시 재시도 횟수


def ollama(prompt: str, timeout: int = 120) -> str:
    body = json.dumps({
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "think": False,
        "format": "json",
        "keep_alive": "15m",
        "options": {"temperature": 0, "num_ctx": 2048, "num_predict": NUM_PREDICT, "num_gpu": NUM_GPU},
    }).encode()
    backoff = 2.0
    timeouts_left = _TIMEOUT_RETRIES
    while True:
        req = urllib.request.Request(OLLAMA_URL, data=body, headers={"Content-Type": "application/json"})
        try:
            resp = json.loads(urllib.request.urlopen(req, timeout=timeout).read())
            return resp.get("response", "")
        except urllib.error.HTTPError:
            # 서버가 응답은 했으나 HTTP 에러(잘못된 요청 등) -> 재시도 무의미, 호출부에서 skip
            raise
        except (urllib.error.URLError, ConnectionError, socket.timeout, TimeoutError) as e:
            reason = getattr(e, "reason", e)
            is_timeout = isinstance(e, (socket.timeout, TimeoutError)) or isinstance(reason, (socket.timeout, TimeoutError))
            if is_timeout:
                # 응답 타임아웃: 모델이 느리거나 멈춤 -> 제한 재시도 후 포기(skip)
                timeouts_left -= 1
                if timeouts_left < 0:
                    raise
                print(f"  [retry] 응답 타임아웃, 재시도 ({_TIMEOUT_RETRIES - timeouts_left}/{_TIMEOUT_RETRIES})", flush=True)
                time.sleep(2)
                continue
            # 연결 거부/서버 다운/슬립: Ollama가 돌아올 때까지 무한 대기 후 재시도
            print(f"  [wait] Ollama 연결 실패 ({reason}); {backoff:.0f}s 후 재시도...", flush=True)
            time.sleep(backoff)
            backoff = min(backoff * 2, _CONN_BACKOFF_MAX)


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
    "You are an oncology conference abstract classifier. Your job is to identify THERAPEUTIC AGENTS "
    "(drugs/treatments that are developed, tested, or administered) and what they target.\n"
    "Output STRICT JSON only:\n"
    '{"modality_list": <modalities of therapeutic agents ACTUALLY STUDIED as treatments, chosen ONLY from: '
    "ADC, Bispecific Antibody, CAR-T, Monoclonal Antibody, Small Molecule, mRNA, Peptide, Cell Therapy, "
    "Oncolytic Virus, Radiopharmaceutical; [] if no specific therapeutic agent is studied>, "
    '"target_list": <gene/protein symbols that a STUDIED therapeutic agent acts ON (its drug target), '
    'e.g. ["HER2","EGFR"]; [] if none>, '
    '"biomarkers": <genes/markers used for patient selection, stratification, monitoring, or prognosis, '
    'e.g. ["PD-L1","MSI-H","ctDNA"]; [] if none>, '
    '"summary_ko": <2 sentences in Korean conveying the study subject/core, the problem it addresses, '
    "the approach, and the key result. Keep gene/protein/drug names and standard medical abbreviations in "
    "their original English form (e.g. TRAIL, HER2, EGFR, durvalumab, ctDNA) — NEVER transliterate them "
    "phonetically into Korean. Translate general medical terms accurately "
    "(e.g. neoadjuvant=수술 전 보조요법, cutaneous=피부, soft tissue sarcoma=연조직 육종). "
    "Be specific and factual, no filler>, "
    '"confidence": <0.0-1.0>}\n'
    "CRITICAL RULES:\n"
    "1. modality_list and target_list describe a THERAPEUTIC AGENT only. If the abstract is basic biology, "
    "a signaling/mechanism study, genomic/molecular profiling, epidemiology, a detection/diagnostic or "
    "computational method, or a prognostic/biomarker-discovery study with NO drug given as treatment "
    "-> modality_list=[] and target_list=[].\n"
    "1b. An antibody/peptide/molecule developed ONLY for detection, imaging, diagnosis, or as a research "
    "reagent (not administered to treat) is NOT a therapeutic -> modality_list=[] and target_list=[].\n"
    "2. A gene/protein belongs in target_list ONLY if a studied drug acts on it. Genes studied as biology, "
    "signaling pathways, prognostic/monitoring markers, or detection targets are NOT drug targets "
    "-> put selection/stratification markers in biomarkers, otherwise omit them.\n"
    "3. Do not infer standard-of-care drugs the abstract does not actually study. Extract only what is "
    "explicitly investigated.\n"
    "4. Never list a modality unless you are specifically confident it is studied; never list most/all modalities.\n"
    "Do not invent."
)


# num_predict 상한에 걸려 JSON이 중간에 잘리면(주로 biomarker 목록 폭주) 닫히지 않은
# 문자열/배열/객체를 보정해 부분 결과라도 건진다. (data, truncated) 반환.
def _loads_lenient(raw: str):
    raw = (raw or "").strip()
    try:
        return json.loads(raw), False
    except json.JSONDecodeError:
        pass
    stack, in_str, esc = [], False, False
    for ch in raw:
        if esc:
            esc = False
        elif in_str:
            if ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch in "[{":
            stack.append("]" if ch == "[" else "}")
        elif ch in "]}" and stack:
            stack.pop()
    s = raw + ('"' if in_str else "")  # 열린 문자열 닫기
    s = s.rstrip()
    if s.endswith(":"):                # key 뒤 값이 잘림 → null
        s += "null"
    s = s.rstrip().rstrip(",")         # 미완성 요소 앞 콤마 제거
    s += "".join(reversed(stack))      # 열린 배열/객체를 역순으로 닫기
    try:
        return json.loads(s), True
    except json.JSONDecodeError:
        return None, True


# 폭주 시 모델이 가짜 유전자명을 수십~수백 개 지어낸다. 잘린 응답에서는 목록을 절단한다.
_RUNAWAY_CAP = 20


def classify_abstract(title: str, body: str) -> dict:
    txt = f"Title: {title or 'n/a'}\nAbstract: {(body or '')[:3000]}"
    raw = ollama(f"{SYSTEM_ABS}\n\n{txt}\n\nJSON:", timeout=180)
    data, truncated = _loads_lenient(raw)
    if data is None:
        # 복구 불가한 응답(드묾)도 빈 결과로 캐시한다. 그래야 진행이 막히지 않고
        # 매 실행마다 같은 초록을 재시도하지 않는다. (네트워크 오류는 ollama()가 raise
        # → run 루프의 try/except가 _error로 잡아 캐시 없이 재시도하므로 여기선 콘텐츠 문제만.)
        return {"modality_list": [], "target_list": [], "biomarkers": [],
                "summary_ko": "", "confidence": 0.0, "_unparsed": True}

    def _clean_list(v):
        lst = [str(x).strip() for x in v if str(x).strip()] if isinstance(v, list) else []
        return lst[:_RUNAWAY_CAP] if truncated else lst

    mods = [normalize_modality(m) for m in _clean_list(data.get("modality_list"))]
    mods = [m for m in mods if m != "Unknown"]
    return {
        "modality_list": list(dict.fromkeys(mods)),
        "target_list": list(dict.fromkeys(_clean_list(data.get("target_list")))),
        "biomarkers": list(dict.fromkeys(_clean_list(data.get("biomarkers")))),
        "summary_ko": (data.get("summary_ko") or "").strip() if isinstance(data.get("summary_ko"), str) else "",
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


def _save_abstract_cache(cache: dict) -> None:
    tmp = ABSTRACT_CACHE + ".tmp"
    os.makedirs(os.path.dirname(ABSTRACT_CACHE), exist_ok=True)
    json.dump(cache, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, ABSTRACT_CACHE)  # 원자적 교체 → 중단돼도 캐시 손상 없음


def run_abstracts(limit: int | None) -> None:
    """전 학회·연도 초록(data/parsed/abstracts_*.json)을 uid 캐시 기반으로 보강.
    중단(Ctrl-C/종료/슬립) 후 재실행하면 캐시된 uid는 건너뛰고 이어서 진행."""
    import glob
    # 학회 초록 + 저널 논문 둘 다 (동일 uid 캐시; 논문 uid = pub-YYYY-PMID)
    files = sorted(glob.glob("data/parsed/abstracts_*.json") + glob.glob("data/parsed/publications_*.json"))
    cache = {}
    if os.path.exists(ABSTRACT_CACHE):
        cache = json.load(open(ABSTRACT_CACHE, encoding="utf-8"))

    # 전 파일에서 미캐시 초록 수집 (uid는 학회·연도 포함이라 전역 유일)
    todo = []
    for fp in files:
        for a in json.load(open(fp, encoding="utf-8"))["abstracts"]:
            if a["uid"] not in cache and (a.get("title") or a.get("abstract_text")):
                todo.append(a)
    if limit:
        todo = todo[:limit]
    print(f"파일 {len(files)}개 · 미처리 {len(todo)}개 (캐시됨 {len(cache)}) — 재실행하면 이어서 진행")

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
            _save_abstract_cache(cache)
            rate = i / (time.time() - t0)
            eta = (len(todo) - i) / rate if rate else 0
            print(f"  {i}/{len(todo)}  {rate:.2f}/s  ETA {eta/3600:.1f}h | {a['uid']}", flush=True)
            print(f"      mod={res['modality_list']} tgt={res['target_list']} bio={res['biomarkers']}", flush=True)
            print(f"      요약: {res.get('summary_ko', '')}", flush=True)
    _save_abstract_cache(cache)
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
