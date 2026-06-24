"""
퍼블리케이션 저자/소속/회사 보강 (OpenAlex).

수정사항:
  1) 제1저자 → 교신저자(연구 책임자). OpenAlex is_corresponding(없으면 마지막=책임저자).
  2) 소속 정규화: OpenAlex institution display_name(이미 기관 단위로 정규화됨).
  3) 회사: 본문 텍스트가 아니라 '저자 소속 기관' 중 institution type=='company'만 → companies_normalized.
     (정부/대학/병원/시설은 회사 아님 — OpenAlex type이 판정 기준)
  다중 소속: 책임저자의 모든 소속을 authors[0].affiliations에 보존(프론트 토글용), 대표는 [0].

용법: python scripts/enrich_pub_authors.py
"""

import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_entities import normalize_companies  # noqa: E402

MAILTO = "oncology-dashboard@example.com"
BATCH = 50

ISO = {
    "US": "USA", "GB": "United Kingdom", "CN": "China", "JP": "Japan", "DE": "Germany",
    "FR": "France", "IT": "Italy", "ES": "Spain", "CA": "Canada", "AU": "Australia",
    "KR": "South Korea", "NL": "Netherlands", "CH": "Switzerland", "SE": "Sweden",
    "BE": "Belgium", "DK": "Denmark", "AT": "Austria", "BR": "Brazil", "IN": "India",
    "IL": "Israel", "NO": "Norway", "FI": "Finland", "PL": "Poland", "RU": "Russia",
    "TR": "Turkey", "TW": "Taiwan", "SG": "Singapore", "HK": "Hong Kong", "IE": "Ireland",
    "PT": "Portugal", "GR": "Greece", "CZ": "Czech Republic", "MX": "Mexico", "AR": "Argentina",
    "ZA": "South Africa", "SA": "Saudi Arabia", "TH": "Thailand", "NZ": "New Zealand",
}


def openalex_batch(dois):
    flt = "doi:" + "|".join(dois)
    params = {"filter": flt, "per-page": str(len(dois)),
              "select": "doi,authorships", "mailto": MAILTO}
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": f"OncologyDashboard (mailto:{MAILTO})"})
    for attempt in range(5):  # 429 백오프 재시도
        try:
            data = json.loads(urllib.request.urlopen(req, timeout=90).read())
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    out = {}
    for w in data.get("results", []):
        doi = (w.get("doi") or "").replace("https://doi.org/", "").lower()
        out[doi] = parse_work(w)
    return out


def parse_work(w):
    aus = w.get("authorships") or []
    if not aus:
        return None
    # 연구 책임자: 마지막 교신저자, 없으면 마지막 저자(=시니어)
    corr = [a for a in aus if a.get("is_corresponding")]
    lead = corr[-1] if corr else aus[-1]
    name = (lead.get("author") or {}).get("display_name") or ""
    insts = lead.get("institutions") or []
    affs, country = [], None
    for i in insts:
        dn = i.get("display_name")
        if dn and dn not in affs:
            affs.append(dn)
        if country is None and i.get("country_code"):
            country = ISO.get(i["country_code"].upper(), i["country_code"].upper())
    if not affs:  # institution 없으면 raw 소속에서
        raw = lead.get("raw_affiliation_strings") or []
        if raw:
            affs = [raw[0]]

    # 회사: 모든 저자 소속 중 type=='company' (산업 관여 신호)
    comp_names = []
    for a in aus:
        for i in a.get("institutions") or []:
            if i.get("type") == "company" and i.get("display_name"):
                if i["display_name"] not in comp_names:
                    comp_names.append(i["display_name"])
    companies = []
    for c in comp_names:
        c = re.sub(r"\s*\([^)]*\)\s*$", "", c).strip()  # OpenAlex의 "(United States)" 등 국가 접미사 제거
        for x in (normalize_companies(c) or [c]):
            if x and x not in companies:
                companies.append(x)

    return {"name": name, "affiliations": affs, "country": country, "companies": companies}


def main(glob_pattern="data/parsed/publications_*.json"):
    files = sorted(glob.glob(glob_pattern))
    doi_to_recs = {}
    for fp in files:
        for a in json.load(open(fp, encoding="utf-8"))["abstracts"]:
            doi = (a.get("source") or {}).get("doi")
            if doi:
                doi_to_recs.setdefault(doi.lower(), 0)
    dois = list(doi_to_recs)
    print(f"논문 DOI {len(dois)}개 → OpenAlex 조회 (배치 {BATCH})")

    info = {}
    for i in range(0, len(dois), BATCH):
        chunk = dois[i:i + BATCH]
        try:
            info.update(openalex_batch(chunk))
        except Exception as e:
            time.sleep(2)
            try:
                info.update(openalex_batch(chunk))
            except Exception as e2:
                print(f"  배치 {i} 실패: {e2}")
        if i % (BATCH * 20) == 0:
            print(f"  ...{min(i + BATCH, len(dois))}/{len(dois)}  매칭 {len(info)}", flush=True)
        time.sleep(0.3)
    print(f"OpenAlex 매칭: {len(info)}/{len(dois)}")

    for fp in files:
        d = json.load(open(fp, encoding="utf-8"))
        n_lead = n_comp = 0
        for a in d["abstracts"]:
            doi = ((a.get("source") or {}).get("doi") or "").lower()
            hit = info.get(doi) if doi else None
            if not hit or not hit["name"]:
                # OpenAlex 매칭 실패 시: 본문기반 회사 오염만 제거(소속에서 재도출)
                aff = (a.get("authors") or [{}])[0].get("affiliation") or ""
                a["companies_normalized"] = normalize_companies(aff)
                continue
            affs = hit["affiliations"]
            primary = affs[0] if affs else ""
            a["authors"] = [{
                "name": hit["name"], "affiliation": primary, "affiliations": affs,
                "country": hit["country"], "role": "corresponding", "order": 0,
            }]
            a["author_raw"] = f"{hit['name']}, {primary}" if primary else hit["name"]
            a["companies_normalized"] = hit["companies"]
            n_lead += 1
            if hit["companies"]:
                n_comp += 1
        json.dump(d, open(fp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"  {fp.split('/')[-1]}: 책임저자 {n_lead}/{len(d['abstracts'])}, 회사 {n_comp}")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--glob", default="data/parsed/publications_*.json",
                    help="대상 파일 (conference: 'data/parsed/abstracts_*.json')")
    main(ap.parse_args().glob)
