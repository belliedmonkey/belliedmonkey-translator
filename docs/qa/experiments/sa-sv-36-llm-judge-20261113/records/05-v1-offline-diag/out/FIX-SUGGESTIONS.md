# Pack / prompt fix suggestions (do not apply in this offline step)

Do not edit the frozen pack or the translator repo here. Hand these to the existing cloud stream if a new protocol version is authorized later.

## 1. Prompt (root cause of 35 GPT object-slots)
The sent rubric says: "Return one JSON object... The object keys are only schema, itemId, and slots." then "slots has one object for slot-1 and one for slot-2." It never says that slots is a JSON array, and it never gives a JSON example. "has one object for slot-1 and one for slot-2" is readable as either an array of two objects or a dict keyed by slot name. All 35 well-formed GPT replies used the dict form, with inner `slot` already equal to the key. This is prompt-induced, not a random parser glitch.
Candidate wording for a **new** prompt version (not a silent v1 change, not for backfill):
  - "slots MUST be a JSON array of length 2, not an object or dictionary."
  - "The two array elements are objects whose slot fields are slot-1 and slot-2 (unique, both required; order may be either)."
  - Include one minimal example: `{"schema":"belliedmonkey.llm-judge.verdict.v1","itemId":"example-id","slots":[{"slot":"slot-1","abstain":true,"confidence":0,"note":"why","findings":[]},{"slot":"slot-2","abstain":true,"confidence":0,"note":"why","findings":[]}]}`
  - State the parser caps in the prompt: note and reason are strings of length <= 400 (currently enforced only in parse.js; the sent rubric never mentions 400).
  - Keep the allowed kind list explicit. Do not add punctuation unless a new version defines it; do not alias it to format-only without a written rule.

## 2. parse.js
Keep frozen v1 parse rejecting a slots object (correct for the original protocol). A candidate parse version may apply the documented lossless object→array adapter (see spec-object-to-array.json) and then the **unchanged** quote/note/kind checks. That is a new protocol version. It must not backfill the official 20261113-2253 run and must reject key/inner-slot conflicts, extra keys, and invalid JSON.

## 3. Minimal fixtures for later tests (real failure summaries, not repaired verdicts)
- object-slots: a verdict whose slots is `{"slot-1":{"slot":"slot-1",...},"slot-2":{"slot":"slot-2",...}}` — v1 parse code `slots`; candidate adapter then official checks.
- key conflict: `{"slot-1":{"slot":"slot-2",...},...}` must be rejected.
- extra key: slots object with slot-3 or typo key must be rejected (do not drop).
- bad-json extra bracket: `"slots":{"slot-1":{...}],"slot-2":{...}}` (extra `]` after first object), modeled on judge-a ascend/00066; must stay bad-json; do not auto-repair.
- note 401: official parse code `note`; do not truncate to 400 in a helper to force ok. Real item ascend/00028 slot-1 noteLen=429.
- quote not in reference: refQuote `运动。` (U+3002) against a reference that contains `运动` but no ideographic full stop. Real item ascend/00055 slot-2. Do not rewrite the quote.
- quote from the other slot: hypQuote `5倍` on a slot whose candidate has `五倍` (the other slot has `5倍`). Real item fleurs-public-candidates/cmn_hans_cn/1680 slot-2. Do not swap slots or quotes.
- kind `punctuation`: official parse code `finding-kind`. Real item fleurs-public-candidates/en_us/1675 slot-2. Do not remap to format-only.
- quote invented comma: after a legal object→array adapt, official parse code `quote`. Real item fleurs-public-candidates/cmn_hans_cn/1681 judge-a slot-2: refQuote has a U+FF0C not present in the reference (the comma exists only in the other slot). Do not rewrite the quote; the shape adapt is valid, the verdict stays null.

## 4. Out of scope but already observed
Official sidecar filenames used `req.itemId || req.model` while the pack request object has no itemId, so per-call provider sidecars overwrote to one file per model. Not fixed here; no paid rerun.
