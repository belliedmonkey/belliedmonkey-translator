# LLM judge bundle

Dry-run is the default. It does not read keys and does not call a model.
Two judge model ids must be different. A missing endpoint or key is blocked, not a second copy of the same model.
This archive has no audio and no hypothesis. Edit rates are not produced.
The 1675 parallel strings are not translation gold. The translation task exits translation-not-open.

```bash
node run-judge.js --synthetic --input input.json --config config.json --out /tmp/judge-dry
node run-judge.js --run --synthetic --input input.json --config config.json --out /tmp/judge-run
```
