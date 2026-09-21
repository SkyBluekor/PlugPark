# PlugPark v0.2.2 EV API fix

- EV upstream URL: HTTPS only
- `ServiceKey` and `serviceKey` both sent for compatibility with current portal + attached v1.25 guide
- `dataType` no longer forced; XML/JSON both parsed
- EV page size automatically shrinks on 522/524/timeout-like failures
- EV requests fetched in small batches after the first successful page
- short in-memory cache for EV info
- `/api/ev-diagnostics` endpoint added (10-row info/status probes, no secret values exposed)
- frontend now shows the real upstream failure reason before falling back to demo data

## Verify after deploy

1. `/api/ev-diagnostics`
2. `/api/chargers`
3. `/api/places`
4. main page
