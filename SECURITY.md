# Security

If you find a vulnerability — a way for a page to read the API key, a way to make the
extension send text somewhere the user did not choose, anything in the sync backend that
lets one account see another's data — please **do not open a public issue**.

Email **belliedmonkey@gmail.com** with what you found and how to reproduce it. You will get
a reply within a few days, and a fix in the next release with credit if you want it.

What the threat model looks like, so you know what counts:

- The API key lives in `chrome.storage.local` and is only ever sent to the provider the user
  configured. Any path that gets it anywhere else is a vulnerability.
- Translation text goes from the browser straight to that provider. A server of ours in that
  path is a vulnerability, not a feature.
- Sync stores learning material under row-level security scoped to the account. Cross-account
  reads are the thing to look for.
- Anonymous usage events carry a random per-install id and a whitelist of event names
  (`build/telemetry.config.js`). Anything that smuggles page content, URLs, keys or account
  identity into them is a vulnerability.

Supported: the latest release on each store. Older versions are not patched.
