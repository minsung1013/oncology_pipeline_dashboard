"""
LLM 제목 정밀화 — 구조 파서가 제목을 잘못 잡은 초록만 LLM으로 재추출.

구조 파서(parse_asco) 결과에서 제목이 너무 짧거나/길거나/헤더·그랜트로 오염된
abstract만 골라, 컬럼 인식 블록 텍스트를 LLM에 주고 깨끗한 제목을 뽑는다.

용법: python scripts/refine_titles.py            # 미리보기
      python scripts/refine_titles.py --write    # abstracts JSON 갱신
"""

import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from parse_asco import (  # noqa: E402
    column_aware_stream, NUM_LINE_RE, SESSION_START_RE, FOOTER_RE, PDF_PATH,
)

ABSTRACTS = "data/parsed/abstracts_asco2026.json"
MODEL = "qwen3:30b-a3b-q4_K_M"
STREAM_CACHE = "/tmp/asco_stream.json"


def ollama(prompt: str) -> str:
    body = json.dumps({
        "model": MODEL, "prompt": prompt, "stream": False, "think": False,
        "keep_alive": "15m", "options": {"temperature": 0, "num_ctx": 4096},
    }).encode()
    req = urllib.request.Request("http://localhost:11434/api/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=120).read()).get("response", "")


def is_bad(t: str) -> bool:
    t = (t or "").strip()
    return bool(
        re.match(r"^[0-9]{0,2}[a-z]{2,}[0-9]{6,}", t)
        or re.search(r"CLINICAL SCIENCE|SYMPOSI|^[A-Z ]{25,}", t)
        or len(t) > 300 or len(t) < 8
    )


def get_blocks() -> dict:
    """abstract_id -> 블록 원문 텍스트 (parse_asco와 동일 세그먼트)."""
    if Path(STREAM_CACHE).exists():
        stream = json.load(open(STREAM_CACHE))
    else:
        stream = column_aware_stream(PDF_PATH)
        json.dump(stream, open(STREAM_CACHE, "w"))
    starts = [
        k for k in range(len(stream) - 1)
        if NUM_LINE_RE.match(stream[k]) and SESSION_START_RE.match(stream[k + 1].strip())
    ]
    blocks = {}
    for idx, k in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(stream)
        num = stream[k]
        if num in blocks:
            continue
        body = " ".join(b for b in stream[k + 1:end] if not FOOTER_RE.search(b))
        blocks[num] = body[:2500]
    return blocks


def extract_title(block: str) -> str:
    prompt = (
        "Below is the raw text of one oncology conference abstract (may contain a session "
        "label, a results table, author/affiliation, and body). Return ONLY the abstract's "
        "TITLE as a single line, nothing else. The title is the descriptive study name that "
        "appears right before 'First Author:'.\n\n"
        f"{block}\n\nTITLE:"
    )
    out = ollama(prompt).strip()
    out = out.splitlines()[0].strip().strip('"').strip()
    # LLM이 가끔 붙이는 'TITLE:'·세션 라벨 제거
    out = re.sub(r"^(TITLE|Title)\s*:?\s*", "", out)
    out = SESSION_START_RE.sub("", out).strip().strip('"').strip()
    return out


def main(write: bool) -> None:
    data = json.load(open(ABSTRACTS, encoding="utf-8"))
    abstracts = data["abstracts"]
    flagged = [a for a in abstracts if is_bad(a.get("title"))]
    print(f"flagged titles: {len(flagged)} / {len(abstracts)}")

    blocks = get_blocks()
    fixed = 0
    t0 = time.time()
    for i, a in enumerate(flagged, 1):
        block = blocks.get(a["abstract_id"])
        if not block:
            continue
        try:
            new = extract_title(block)
        except Exception as e:
            print(f"  [skip] {a['abstract_id']}: {e}")
            continue
        if new and 8 <= len(new) <= 320 and not is_bad(new):
            a["title_rule"] = a["title"]
            a["title"] = new
            a["title_src"] = "llm"
            fixed += 1
        if i % 20 == 0:
            print(f"  {i}/{len(flagged)}  {i/(time.time()-t0):.2f}/s  | {a['abstract_id']}: {a['title'][:50]}")

    print(f"\nrefined: {fixed} / {len(flagged)}")
    if write:
        with open(ABSTRACTS, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"saved -> {ABSTRACTS}")
    else:
        print("(preview — use --write)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    main(ap.parse_args().write)
