# DCF Studio: the validator still reports failures

The server re-ran the canonical validator on your output in `{workdir}` and it
failed (attempt {attempt} of {max_attempts}). Fix these in `model.py` (never by
editing `dcf.json`, never by modifying `dcfkit/`), re-run
`python3 model.py && python3 dcfkit/validate.py dcf.json` until it prints `OK`,
and keep `report.md` consistent with any numbers that change.

```
{failures}
```

Do not change the valuation's substance except where a fix requires it; if a fix
moves the value, say so in `report.md`.
