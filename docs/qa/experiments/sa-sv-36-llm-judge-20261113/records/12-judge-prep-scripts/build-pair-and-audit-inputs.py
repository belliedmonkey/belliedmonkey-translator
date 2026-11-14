#!/usr/bin/env python3
"""Build independent SA/SV pair ledger and anonymous judge input. Read-only on sources."""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path("/workspace/baseline-sa-sv-36-20261113")
PREP = ROOT / "judge-prep"
SA_DIR = ROOT / "results/aef9aa8f/sa-smoke-aef9aa8f-r1"
SV_DIR = ROOT / "results/f6ec838b-sv"
PKG_GZ = Path(
    "/cursor/stores/user/grok-bot/agents/e8195c0f-e3a2-46a7-bda6-acf61585317c/assets/01M7A2YMDT938TGQV83BY7T8KT.gz"
)
KEY_RE = re.compile(r"^[a-z][a-z0-9-]{2,31}$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./:-]{0,80}$")
TZ = ZoneInfo("Asia/Shanghai")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    return sha256_bytes(p.read_bytes())


def sha256_text(s: str) -> str:
    return sha256_bytes(s.encode("utf-8"))


def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
    p.write_text(text, encoding="utf-8")


def main() -> None:
    pack = load_json(ROOT / "PACK-MANIFEST.json")
    sa_hyps = {r["id"]: r["hypothesis"] for r in load_json(SA_DIR / "hypotheses.json")}
    sv_hyps = {r["id"]: r["hypothesis"] for r in load_json(SV_DIR / "run/hypotheses.json")}
    sa_score = load_json(SA_DIR / "score.json")
    sv_score = load_json(SV_DIR / "run/score.json")
    sa_sum = load_json(SA_DIR / "run-summary.json")
    sv_sum = load_json(SV_DIR / "run/run-summary.json")
    sa_items = {r["id"]: r for r in sa_score["items"]}
    sv_items = {r["id"]: r for r in sv_score["items"]}

    pack_by_run = {}
    for it in pack["items"]:
        if it["set"] == "fleurs":
            rid = f"fleurs-public-candidates/{it['config']}/{it['sentenceId']}"
        else:
            rid = f"ascend/{it['id']}"
        pack_by_run[rid] = it

    assert set(pack_by_run) == set(sa_hyps) == set(sv_hyps) == set(sa_items) == set(sv_items)
    assert len(pack_by_run) == 36

    # Preserve official SA run order (same as SV / pack interleave).
    order = [r["id"] for r in load_json(SA_DIR / "hypotheses.json")]
    assert order == [r["id"] for r in load_json(SV_DIR / "run/hypotheses.json")]
    assert len(order) == 36

    # Empty-hyp check
    empty_sa = [i for i, t in sa_hyps.items() if not isinstance(t, str) or t == ""]
    empty_sv = [i for i, t in sv_hyps.items() if not isinstance(t, str) or t == ""]
    assert not empty_sa and not empty_sv, (empty_sa, empty_sv)

    # Choose opaque keys that do not appear in ids, raw, normalized ref, or hyps.
    corpus_parts = []
    for rid in order:
        it = pack_by_run[rid]
        corpus_parts.extend([rid, it["raw"], it["reference"], sa_hyps[rid], sv_hyps[rid]])
    corpus = "\n".join(corpus_parts)
    key_sa, key_sv = "hx9q2w", "jt4m8c"
    for k in (key_sa, key_sv):
        assert KEY_RE.match(k), k
        assert k not in corpus, f"opaque key leaked into corpus: {k}"
        for rid in order:
            assert k not in rid

    rows = []
    strata = Counter()
    equal_text = 0
    for rid in order:
        it = pack_by_run[rid]
        sa_h = sa_hyps[rid]
        sv_h = sv_hyps[rid]
        sa_it = sa_items[rid]
        sv_it = sv_items[rid]
        lang = sa_it["lang"]
        if lang == "en":
            stratum = "fleurs-en"
        elif lang == "zh":
            stratum = "fleurs-zh"
        else:
            stratum = "ascend-mixed"
        strata[stratum] += 1
        texts_equal = sa_h == sv_h
        if texts_equal:
            equal_text += 1
        assert sa_it["length"] == sv_it["length"]
        rows.append(
            {
                "id": rid,
                "stratum": stratum,
                "lang": lang,
                "set": it["set"],
                "sentenceId": it.get("sentenceId"),
                "config": it["config"],
                "packId": it["id"],
                "audioSha256": it["audioSha256"],
                "packRawSha256": sha256_text(it["raw"]),
                "packReferenceSha256": sha256_text(it["reference"]),
                "saHypothesisSha256": sha256_text(sa_h),
                "svHypothesisSha256": sha256_text(sv_h),
                "hypothesesTextEqual": texts_equal,
                "svCopiedFromSa": False,
                "officialLength": sa_it["length"],
                "saV1": {
                    "metric": sa_it["metric"],
                    "errors": sa_it["errors"],
                    "length": sa_it["length"],
                    "rate": sa_it["rate"],
                },
                "svV1": {
                    "metric": sv_it["metric"],
                    "errors": sv_it["errors"],
                    "length": sv_it["length"],
                    "rate": sv_it["rate"],
                },
            }
        )

    assert strata == Counter({"fleurs-en": 15, "fleurs-zh": 15, "ascend-mixed": 6})
    for rid in order:
        assert ID_RE.match(rid), rid

    # Judge input uses pack raw (human-audited publisher text). Scorer gold is pack reference.
    judge_items = []
    for rid in order:
        it = pack_by_run[rid]
        judge_items.append(
            {
                "id": rid,
                "reference": it["raw"],
                "candidates": [
                    {"key": key_sa, "text": sa_hyps[rid]},
                    {"key": key_sv, "text": sv_hyps[rid]},
                ],
            }
        )

    judge_input = {
        "schema": "belliedmonkey.llm-judge.input.v1",
        "task": "asr",
        "items": judge_items,
    }

    # Forbidden leakage into the request object
    blob = json.dumps(judge_input, ensure_ascii=False)
    for banned in (
        "speech-analyzer",
        "sensevoice",
        "SenseVoice",
        "apple-speech",
        "backend",
        "aef9aa8f",
        "f6ec838b",
        "JUDGE_",
        "budgetUsd",
        "editRates",
        "WER",
        "CER",
        "MER",
    ):
        assert banned not in blob, banned
    # candidate keys only, not arm names as keys
    assert "\"sa\"" not in blob and "\"sv\"" not in blob

    arm_mapping = {
        "schema": "belliedmonkey.llm-judge.arm-mapping.v1",
        "note": "Controlled identity mapping. Do not copy this file into the judge request, prompt, or candidate keys.",
        "candidateKeys": {key_sa: "sa", key_sv: "sv"},
        "arms": {
            "sa": {
                "key": key_sa,
                "run": "aef9aa8f",
                "hypothesesRel": "results/aef9aa8f/sa-smoke-aef9aa8f-r1/hypotheses.json",
                "hypothesesSha256": sha256_file(SA_DIR / "hypotheses.json"),
                "component": "speech-analyzer",
            },
            "sv": {
                "key": key_sv,
                "run": "f6ec838b-sv",
                "hypothesesRel": "results/f6ec838b-sv/run/hypotheses.json",
                "hypothesesSha256": sha256_file(SV_DIR / "run/hypotheses.json"),
                "component": "sensevoice",
            },
        },
        "notInJudgeInput": True,
    }

    config = {
        "schema": "belliedmonkey.llm-judge.config.v1",
        "seed": 20261113,
        "temperature": 0,
        "sampleCount": 6,
        "maxItems": 36,
        "timeoutMs": 20000,
        "maxRetries": 2,
        "budgetUsd": None,
        "judges": [
            {
                "id": "judge-a",
                "model": "REPLACE_MODEL_A",
                "endpointEnv": "JUDGE_A_URL",
                "keyEnv": "JUDGE_A_KEY",
            },
            {
                "id": "judge-b",
                "model": "REPLACE_MODEL_B",
                "endpointEnv": "JUDGE_B_URL",
                "keyEnv": "JUDGE_B_KEY",
            },
        ],
    }

    now = datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S %z (%Z)")
    source_pins = {
        "builtAt": now,
        "timezone": "Asia/Shanghai",
        "judgePackageGz": {
            "path": str(PKG_GZ),
            "bytes": PKG_GZ.stat().st_size,
            "sha256": sha256_file(PKG_GZ),
            "expectedSha256": "f4a58b85f79c7e8da13d2049f987802bcd0fbebbdb70320c85b0aaf422302d55",
        },
        "packManifest": {
            "path": "PACK-MANIFEST.json",
            "sha256": sha256_file(ROOT / "PACK-MANIFEST.json"),
        },
        "saHypotheses": {
            "path": "results/aef9aa8f/sa-smoke-aef9aa8f-r1/hypotheses.json",
            "sha256": sha256_file(SA_DIR / "hypotheses.json"),
        },
        "saScore": {
            "path": "results/aef9aa8f/sa-smoke-aef9aa8f-r1/score.json",
            "sha256": sha256_file(SA_DIR / "score.json"),
        },
        "svHypotheses": {
            "path": "results/f6ec838b-sv/run/hypotheses.json",
            "sha256": sha256_file(SV_DIR / "run/hypotheses.json"),
        },
        "svScore": {
            "path": "results/f6ec838b-sv/run/score.json",
            "sha256": sha256_file(SV_DIR / "run/score.json"),
        },
        "svRunSummary": {
            "path": "results/f6ec838b-sv/run/run-summary.json",
            "sha256": sha256_file(SV_DIR / "run/run-summary.json"),
        },
        "checksumsVerified": {
            "packSHA256SUMS": True,
            "saResultsSHA256SUMS": True,
            "svResultsSHA256SUMS": True,
        },
    }

    pair = {
        "schema": "belliedmonkey.llm-judge.pair-manifest.v1",
        "builtAt": now,
        "timezoneLabel": "Asia/Shanghai (UTC+8)",
        "status": "paired",
        "blockedOnSecondArm": False,
        "blockedOnSecondArmResolvedAt": now,
        "realLlmCalled": False,
        "itemCount": 36,
        "alignment": {
            "fleursEn": 15,
            "fleursZh": 15,
            "ascendMixed": 6,
            "idsEqualAcrossPackSaSv": True,
            "idOrderMatchesSaAndSvHypotheses": True,
            "officialLengthsEqualAcrossArms": True,
            "emptyHypotheses": 0,
            "hypothesesTextEqualCount": equal_text,
            "svCopiedFromSa": False,
            "svEmptyStringUsed": False,
        },
        "judgeReference": {
            "field": "PACK-MANIFEST.items[].raw",
            "reason": "Human-audited publisher text (punctuation and parenthetical Latin preserved). Official v1 edit rates remain in SA/SV score.json and were computed from the scorer gold field, not re-derived here.",
        },
        "scorerGold": {
            "field": "PACK-MANIFEST.items[].reference",
            "saOfficialV1": sa_score["rates"],
            "svOfficialV1": sv_score["rates"],
            "svIndependentRescoreMatchesOfficial": True,
            "denominators": {"en": "29 or 36 / 363", "zh": "57/624", "ascend": "SA 24/42, SV 17/42"},
        },
        "svOfficial": {
            "processExit": sv_sum.get("processExit"),
            "ok": sv_sum.get("ok"),
            "code": sv_sum.get("code"),
            "senseVoiceResult": sv_sum.get("senseVoiceResult"),
            "denominator": sv_sum.get("denominator"),
            "synthetic": sv_sum.get("synthetic"),
            "nonemptyHypotheses": 36,
        },
        "saOfficial": {
            "processExit": sa_sum.get("processExit"),
            "ok": sa_sum.get("ok"),
            "code": sa_sum.get("code"),
            "appleResult": sa_sum.get("appleResult"),
            "denominator": sa_sum.get("denominator"),
            "synthetic": sa_sum.get("synthetic"),
            "nonemptyHypotheses": 36,
        },
        "sourcePins": source_pins,
        "armMappingFile": "arm-mapping.json",
        "judgeInputFile": "input-asr-36.json",
        "configPlaceholderFile": "config.placeholders.json",
        "items": rows,
    }

    # Formal-run field list (no provider chosen).
    formal_run = {
        "providerSelected": False,
        "realLlmCalled": False,
        "doNotRegisterOrSubscribe": True,
        "minimalConfigFields": {
            "schema": "belliedmonkey.llm-judge.config.v1",
            "seed": "integer (this dry-run used 20261113)",
            "temperature": "finite number in [0, 2] (proposed 0)",
            "sampleCount": "integer 0-36 (proposed 6 agreed-consistent samples)",
            "maxItems": "integer 1-200; must be >= 36 or the official set is item-cap incomplete",
            "timeoutMs": "integer 1-120000 (proposed 20000)",
            "maxRetries": "integer 0-2; retries only on timeout/network/429/5xx",
            "budgetUsd": "null, or a finite number > 0",
            "judges": "exactly two objects",
            "judges[].id": "distinct keys matching ^[a-z][a-z0-9-]{2,31}$",
            "judges[].model": "explicit vendor model id strings; the two must differ after trim; not placeholders at official run",
            "judges[].endpointEnv": "ENV NAME only, ^[A-Z][A-Z0-9_]{2,40}$, different from that judge's keyEnv",
            "judges[].keyEnv": "ENV NAME only, same pattern",
        },
        "operatorMustSupplyBeforeRun": [
            "Two explicit, different model ids (no REPLACE_ placeholders).",
            "Whether the two endpoints are different URLs or one gateway with two models; env names are recorded, values are not written to evidence.",
            "Estimated price information sufficient to set budgetUsd, or an explicit decision to set budgetUsd null.",
            "Confirmation that the chosen HTTP API will put a finite usage.usd (or top-level usd copied onto usage) in the JSON body. This package does not convert token counts to USD. If budgetUsd is set and usd is missing, the run stops after the first successful call with code budget-unknown.",
            "If the vendor only returns token counts, either wrap transport to compute usd from a recorded price table, or set budgetUsd to null and accept un-capped call spend accounting as costUnknown.",
            "Env vars named in endpointEnv/keyEnv must exist only at --run time; this verification stream did not read them and must not be asked to --run.",
        ],
        "placeholderConfigIsNotAnOfficialRun": True,
    }

    write_json(PREP / "input-asr-36.json", judge_input)
    write_json(PREP / "arm-mapping.json", arm_mapping)
    write_json(PREP / "config.placeholders.json", config)
    write_json(PREP / "source-pins.json", source_pins)
    write_json(PREP / "formal-run-config-requirements.json", formal_run)
    write_json(PREP / "pair-manifest.json", pair)

    # Synthetic two-candidate input (strictly synthetic, no real hyps/scores).
    synthetic_input = {
        "schema": "belliedmonkey.llm-judge.input.v1",
        "task": "asr",
        "items": [
            {
                "id": "fixture-1",
                "reference": "the cat sat on the mat",
                "candidates": [
                    {"key": "arm-a", "text": "the cat sat on the mat"},
                    {"key": "arm-b", "text": "the dog sat on the mat"},
                ],
            },
            {
                "id": "fixture-2",
                "reference": "there were 3 apples",
                "candidates": [
                    {"key": "arm-a", "text": "there were three apples"},
                    {"key": "arm-b", "text": "there were 5 apples"},
                ],
            },
        ],
    }
    write_json(PREP / "audit/fixtures/synthetic-input.json", synthetic_input)

    # Tiny configs used by fixture runner (placeholders only).
    write_json(
        PREP / "audit/fixtures/config-synthetic.json",
        {
            **config,
            "seed": 7,
            "sampleCount": 1,
            "maxItems": 36,
            "budgetUsd": 1,
        },
    )
    write_json(
        PREP / "audit/fixtures/config-item-cap.json",
        {**config, "seed": 7, "sampleCount": 1, "maxItems": 1, "budgetUsd": 1},
    )

    print("built", PREP)
    print("strata", dict(strata))
    print("equal_text", equal_text)
    print("input_sha_pending_after_write")


if __name__ == "__main__":
    main()
