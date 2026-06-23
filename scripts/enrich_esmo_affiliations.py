"""
ESMO 저자 소속 보강 (OpenAlex).

Crossref는 ESMO(Annals of Oncology) 저자 소속을 비워둔다(affiliation: []).
OpenAlex는 같은 DOI에 대해 소속을 파싱해 보유하므로, DOI로 조회해
제1저자의 소속·국가를 채우고 companies_normalized를 재도출한다.

용법: python scripts/enrich_esmo_affiliations.py
"""

import glob
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_asco import parse_author  # noqa: E402
from normalize_entities import normalize_companies  # noqa: E402

MAILTO = "oncology-dashboard@example.com"
BATCH = 50


def openalex_batch(dois):
    """DOI 리스트 → {doi: (first_author_name, raw_affiliation)}"""
    flt = "doi:" + "|".join(dois)
    params = {"filter": flt, "per-page": str(len(dois)),
              "select": "doi,authorships", "mailto": MAILTO}
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": f"OncologyDashboard (mailto:{MAILTO})"})
    data = json.loads(urllib.request.urlopen(req, timeout=90).read())
    out = {}
    for w in data.get("results", []):
        doi = (w.get("doi") or "").replace("https://doi.org/", "").lower()
        aus = w.get("authorships") or []
        if not aus:
            continue
        first = aus[0]
        name = (first.get("author") or {}).get("display_name") or ""
        raw = first.get("raw_affiliation_strings") or []
        out[doi] = (name, raw[0] if raw else "")
    return out


def main():
    files = sorted(glob.glob("data/parsed/abstracts_esmo*.json"))
    # 전체 DOI 수집
    doi_to_recs = {}
    for fp in files:
        for a in json.load(open(fp, encoding="utf-8"))["abstracts"]:
            doi = (a.get("source") or {}).get("doi")
            if doi:
                doi_to_recs.setdefault(doi.lower(), []).append(None)
    dois = list(doi_to_recs)
    print(f"ESMO DOI {len(dois)}개 → OpenAlex 조회 (배치 {BATCH})")

    doi_map = {}
    for i in range(0, len(dois), BATCH):
        chunk = dois[i:i + BATCH]
        try:
            doi_map.update(openalex_batch(chunk))
        except Exception as e:
            print(f"  배치 {i} 오류: {e} — 재시도")
            time.sleep(2)
            try:
                doi_map.update(openalex_batch(chunk))
            except Exception as e2:
                print(f"  재시도 실패: {e2}")
        if i % (BATCH * 10) == 0:
            print(f"  ...{min(i + BATCH, len(dois))}/{len(dois)}  매칭 {len(doi_map)}", flush=True)
        time.sleep(0.2)
    print(f"OpenAlex 매칭: {len(doi_map)}/{len(dois)}")

    # 적용
    for fp in files:
        d = json.load(open(fp, encoding="utf-8"))
        n_aff = 0
        for a in d["abstracts"]:
            doi = (a.get("source") or {}).get("doi", "").lower()
            hit = doi_map.get(doi)
            if not hit or not hit[1]:
                continue
            name, aff = hit
            name = name or (a.get("authors") or [{}])[0].get("name") or a.get("author_raw") or ""
            raw = f"{name}, {aff}"
            parsed = parse_author(raw)
            if not parsed or not parsed.get("affiliation"):
                continue
            a["authors"] = [parsed]
            a["author_raw"] = raw
            a["companies_normalized"] = normalize_companies(parsed["affiliation"])
            n_aff += 1
        json.dump(d, open(fp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"  {fp.split('/')[-1]}: 소속 채움 {n_aff}/{len(d['abstracts'])}")


if __name__ == "__main__":
    main()
