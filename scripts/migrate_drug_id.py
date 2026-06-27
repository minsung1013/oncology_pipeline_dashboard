"""drug_id 마이그레이션 — uuid4 → stable_drug_id (결정적 해시).

현재 pipeline.json의 랜덤 drug_id를 안정 해시로 바꾸고, 그 매핑으로 캐시
(llm_pipeline_cache·llm_xref_cache)를 re-key 한다. 이러면 이후 재파싱(같은 해시 생성)
해도 요약/xref 캐시가 그대로 매칭된다. 멱등(두 번 돌려도 안전).

⚠️ xref가 캐시를 쓰는 중이면 실행 금지 — xref 완료 후 실행.
용법: python scripts/migrate_drug_id.py
"""
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from parse_fields import stable_drug_id  # noqa: E402

PIPELINE = "data/parsed/pipeline.json"
CACHES = ["data/cache/llm_pipeline_cache.json", "data/cache/llm_xref_cache.json"]


def main():
    data = json.load(open(PIPELINE, encoding="utf-8"))
    drugs = data["drugs"]

    # 새 stable id 계산 + 충돌 검사
    new_ids = [stable_drug_id(d) for d in drugs]
    if len(set(new_ids)) != len(new_ids):
        sys.exit(f"중단: stable_id 충돌 {len(new_ids) - len(set(new_ids))}건 — 마이그레이션 불가")

    old2new = {}
    for d, nid in zip(drugs, new_ids):
        old = d.get("drug_id")
        if old:
            old2new[old] = nid
    already_stable = sum(1 for d, nid in zip(drugs, new_ids) if d.get("drug_id") == nid)
    print(f"엔트리 {len(drugs)} · 충돌 0 · 이미 안정 {already_stable}")

    # pipeline.json drug_id 교체 (백업 후)
    ts = time.strftime("%Y%m%d_%H%M%S")
    shutil.copy(PIPELINE, f"{PIPELINE}.bak_migrate_{ts}")
    for d, nid in zip(drugs, new_ids):
        d["drug_id"] = nid
    json.dump(data, open(PIPELINE, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"pipeline.json drug_id 교체 완료 (백업: .bak_migrate_{ts})")

    # 캐시 re-key
    valid_new = set(new_ids)
    for cf in CACHES:
        if not os.path.exists(cf):
            print(f"  {cf}: 없음 — 건너뜀")
            continue
        cache = json.load(open(cf, encoding="utf-8"))
        shutil.copy(cf, f"{cf}.bak_migrate_{ts}")
        out, rekeyed, kept = {}, 0, 0
        for k, v in cache.items():
            nk = old2new.get(k, k)  # 옛 uuid면 매핑, 아니면(이미 stable) 유지
            out[nk] = v
            if k in old2new:
                rekeyed += 1
            else:
                kept += 1
        # 검증: 캐시 키가 새 pipeline drug_id와 매칭되는 비율
        covered = sum(1 for nid in valid_new if nid in out)
        json.dump(out, open(cf, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"  {cf}: {len(cache)}개 (re-key {rekeyed}, 유지 {kept}) "
              f"→ pipeline 엔트리 {covered}/{len(drugs)} 매칭")

    print("마이그레이션 완료.")


if __name__ == "__main__":
    main()
