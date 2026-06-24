"""
parsed 코퍼스(학회 초록 + 논문)를 R2에 번들로 동기화.

CI(주간 Action)는 git에 없는 과거 parsed 데이터가 필요하므로,
로컬 빌드 때 R2에 parsed_corpus.tar.gz로 올리고 Action이 받아 전체 재빌드한다.
(pipeline.json은 run_pipeline가 매번 새로 생성하므로 번들 제외)

용법:
  python scripts/sync_parsed.py upload                 # 로컬 → R2
  python scripts/sync_parsed.py download <R2_BASE_URL> # R2 → 로컬(CI)
"""

import glob
import io
import os
import sys
import tarfile
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

KEY = "parsed_corpus.tar.gz"


def _files():
    return sorted(glob.glob("data/parsed/abstracts_*.json")) + \
        sorted(glob.glob("data/parsed/publications_*.json"))


def upload():
    from upload_r2 import load_env, put_object
    env = load_env()
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for fp in _files():
            t.add(fp)
    body = buf.getvalue()
    put_object(env, KEY, body, content_type="application/gzip")
    print(f"[sync] uploaded {KEY} ({len(body) / 1024 / 1024:.0f} MB, {len(_files())} files)")


def download(base_url):
    url = f"{base_url.rstrip('/')}/{KEY}"
    print(f"[sync] downloading {url}")
    data = urllib.request.urlopen(url, timeout=600).read()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
        t.extractall(".")
    print(f"[sync] extracted parsed corpus ({len(_files())} files)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "upload":
        upload()
    elif cmd == "download":
        base = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("R2_BASE_URL", "")
        download(base)
    else:
        sys.exit("usage: sync_parsed.py upload | download <R2_BASE_URL>")
