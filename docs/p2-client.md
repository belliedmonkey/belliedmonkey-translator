# P2 client · route selection and the hosted contract

This note covers the **client half** of BEL-174 that this order owns. The hosted service
(billing, ledger, relay, sync, webhooks) is the growth lane's; this repository ships only
the client call points, the public contract, and a runnable mock.

## 1 · What the client does

- The own-key path is the default and is complete without an account, a subscription, or
  a hosted backend.
- The optional **free credit** and any **subscription quota** are explicit opt-ins. Their
  token is a `bmg_...` grant token; the upstream provider key is never in this repository
  or on the client.
- The quota card names the path it is on (`free`, `monthly`, `yearly`) and always offers
  **use my own key** on the active/low/exhausted states.
- A `402`/`429` is a local fallback decision: the client switches to BYOK if a key is
  configured; it never asks the server to reroute a BYOK request and never turns the
  error into a forced subscription.

The pure selection rule is in [`src/shared/hosted-contract.js`](../src/shared/hosted-contract.js):

```js
chooseRoute({ hasOwnKey, signedIn, product, remaining, prefer })
// → 'byok' | 'subscription' | 'none'
fallbackAfterQuota({ hasOwnKey })   // → 'byok' | 'none'
```

`grant-view.jsx` writes the chosen route onto the card as `data-route`; the copy and the
action links come from `cardFor()` in `src/shared/grant.js`.

## 2 · Contract call points

`contracts/hosted-gateway.v0.1.yaml` is the machine-readable contract (growth owns it).
The client knows only these paths, and only in `src/shared/hosted-contract.js`:

| Surface | Path | Client behaviour |
|---|---|---|
| plans | `GET /v0/billing/plans` | read the catalogue; enterprise is a placeholder |
| checkout | `POST /v0/billing/checkout` | open the hosted URL; never returns a payment secret |
| portal | `GET /v0/billing/portal` | open the hosted portal; `409` = no billing account |
| balance | `GET /v0/grant/balance` | `product ∈ free|monthly|yearly`, `remaining`, `unit` |
| consume | `POST /v0/grant/consume` | `Idempotency-Key` required; replay is free |
| relay | `POST /v0/relay` | `bmg_` bearer only; a BYOK key in the body → `400` |
| sync | `GET/PUT /v0/sync/{collection}` | settings/session-meta; body may not contain `api_key` |

The real base is injected at build time. The public mock is
`mocks/hosted-gateway/` (`npm run mock:hosted-gateway`); CI and this order use the mock
only. No real Stripe key, upstream provider key, `service_role`, or `GRANT_KEK` is in
this tree.

## 3 · Dependency status (this order)

**RESOLVED.** The growth lane delivered the v0.1 contract and mock gate in commit
`b14992f1` ("feat(contracts): hosted gateway v0.1 — billing, sync, account + mock gate").
This order consumes it by cherry-picking that commit onto the orphan tip (the resulting
tip is recorded in RESULT). The delivered files are:

- `contracts/hosted-gateway.v0.1.yaml` — billing/plans, checkout, portal, balance with
  the `free|monthly|yearly` product enum, idempotent consume, BYOK-rejecting relay,
  minimal sync, account deletion/export;
- `mocks/hosted-gateway/server.js` — the v0.1 mock (with the v0 aliases);
- `mocks/hosted-gateway/selftest.mjs` — the mock's own gate;
- `mocks/hosted-gateway/README.md` — the runnable samples.

The client call points and path constants in `src/shared/hosted-contract.js` match this
contract. The network half is exercised against the v0.1 mock; the BYOK half is exercised
against a local fake provider. If a later contract revision moves a path, update the
constants in that one module and re-run the mock self-test.

This **does not** block ACCEPT-P1-1…P1-6: the P1 docs/build/stranger path does not need a
hosted backend, and the P2 network evidence uses only `127.0.0.1`.

## 4 · JG-3 evidence

`node scripts/verify-jg3-routes.js` starts a fake BYOK provider and the public hosted
mock, then proves on one built `dist/`:

1. the registry has both a grant route and ordinary own-key providers;
2. a BYOK request reaches the provider directly and never touches the hosted mock;
3. a `bmg_` token reads a `monthly` balance, relays, and consumes idempotently;
4. a BYOK key in the hosted body is rejected with `400`;
5. the quota fallback is `byok`.

The script needs no real credential and no network egress beyond `127.0.0.1`.

## 5 · What this order does not do

- No hosted implementation, Stripe wiring, ledger, or webhook in the public tree.
- No enterprise seats/SSO/invoicing — a placeholder only when the hosted lane ships one.
- No marketing announcement of MIT, no store submission, no `Done` on BEL-173/174/175.
- No new full-screen selection layout: this order changes copy and state inside the
  existing quota card. A new screen would need the Pencil-draft review first.
