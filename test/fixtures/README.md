# test/fixtures

- `manifest-published-v1.19.0.json` — `extension/manifest.json` exactly as published at
  tag `v1.19.0` (the store lane). It is the **baseline for X1**
  (`scripts/verify-manifest-diff.js`) in the history-free MIT repository, where that store
  tag does not exist. The comparison code is unchanged; only the data source differs, and
  the script prints when it falls back to this file. Do not hand-edit it — extract the
  manifest from a real published tag when the baseline moves.
