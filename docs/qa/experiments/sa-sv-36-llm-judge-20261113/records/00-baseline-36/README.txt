# Independent 36-clip original audio cache

This directory is a cache pack for a later SA / SenseVoice component-level
error-rate, latency, and failure experiment. It is not a product default, not
an evidence score archive, and not a human-review result.

Contents
- 30 FLEURS clips: sentence IDs 1668-1682, en_us and cmn_hans_cn.
- 6 ASCEND clips: 00004, 00009, 00028, 00055, 00066, 00068.
- Original publisher wav bytes only. Chat PCM16 listen copies are not included.
- FLEURS sentence 1663 and the legacy 16-clip SA smoke set are not included.

Licenses (see exact source copies under sources/)
- FLEURS: CC-BY-4.0 (google/fleurs, revision 70bb2e84b976b7e960aa89f1c648e09c59f894dd).
- ASCEND: CC-BY-SA-4.0 (CAiRE/ASCEND). The GitHub repository MIT license is not the data license.

sources/fleurs and sources/ascend are verbatim copies of the delivered pack
ATTRIBUTION, README, MANIFEST, and annotations, including blank human-review
fields. Do not treat those blanks as approvals.

Rebuild with scripts/build-sa-sv-36-pack.py. Verify with SHA256SUMS.
