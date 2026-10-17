# Privacy note

The deck processes personal data only as far as signing a person in requires, and only inside the
client's cloud.

| Data | Where it lives | How long | Why |
|---|---|---|---|
| The person's identity claims (`sub`, `name`) in the id token | the browser tab's memory | until sign-out, the token's expiry or the tab closes | to show who is signed in and to call the client's platform as that person |
| Tokens | the browser tab's memory | the same | to call the platform |
| `state`, `nonce`, PKCE verifier, return path | `sessionStorage`, during the redirect only | deleted on the callback, or after the pending TTL | to complete the sign-in safely |
| The person's own entries (wells typed in, designs, analyses) | the browser's storage for the deck's origin | until the person clears them | the person's own work |
| Request logs on the deck host | the client's own logging | the client's retention | operations |

The deck sends nothing to us. The diagnostics bundle a person may copy for support carries no name,
no subject, no token and no well.

Per-user separation of browser storage (a hash of `sub`) and "Clear local data on sign-out" are
planned with the browser-state phase (P6).

Data subject requests about identity data go to the client, who runs the identity provider and the
platform. We hold no copy.
