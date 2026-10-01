# Employee browser sign-in diagnostic — 2026-10-01

The owner authorized an actual Hadeel/Maram browser walkthrough before staff rollout. This note records a tool-environment blocker, not a CRM security-policy change or a failed employee password.

- Live static bootstrap served `20260930-operations-v6b`; `main` was `e9bd1d5` at inspection. `app-base-v15.html` still calls `supa.auth.signInWithPassword`; the recent commits changed no login handler or browser allowlist.
- Hadeel and Maram have active, confirmed `auth.users` and active agent profiles, without bans. Supabase project status is `ACTIVE_HEALTHY`.
- A non-credential shell request reached `/auth/v1/settings` with HTTP 200 and `Access-Control-Allow-Origin: https://omanvilla.github.io`. The password-token OPTIONS preflight returned 200 with POST, apikey, authorization, content-type, and x-client-info allowed. These checks do not prove reachability from the cloud browser itself.
- A secure browserAuth credential handoff was submitted in the cloud browser, but the CRM displayed `Failed to fetch` and remained on the login form. No corresponding login attempt appeared in the Auth logs in the checked interval. Do not interpret this as an invalid password. Subsequent cloud-browser inspection/handoff calls reported native credential protection and remained blocked even after navigation/closing the tab. No credentials were read or stored by the agent.
- Native Node suite on the latest checkout passed 54/54 tests on 2026-10-01. This is not a substitute for real employee UI sessions.

Next: obtain a browser connection that can reach Supabase Auth and use secure user-entered credentials, then test Hadeel and Maram separately including account switching, branch data, inbox, details and exports. Do not weaken CRM authentication/RLS or mint production staff tokens to work around a browser-tool failure. If this same `Failed to fetch` reproduces in an ordinary employee browser, investigate network/proxy/DNS and capture the request-level error before changing code.
