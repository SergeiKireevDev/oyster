---
title: Security
description: Require TLS, protect bearer tokens, and understand the privileges of a remote coding-agent UI.
tags: security, tls, https, authentication
---

> **Remote access must use HTTPS with valid TLS.** Plain HTTP is acceptable only on a loopback interface for local development. Never expose Oyster directly to an untrusted network over unencrypted HTTP.

Oyster can execute coding-agent tools, edit workspace files, manage credentials, and start local services. Treat access to it like shell access to the host.

## TLS is required

The bearer token authenticates a client; it does **not** encrypt traffic. Without TLS, an observer can capture the token, prompts, transcripts, file contents, OAuth interactions, and API requests.

Terminate TLS before traffic crosses an untrusted network. Supported patterns include:

```text
browser ── HTTPS ──> cloudflared edge ── tunnel ──> 127.0.0.1:8080
browser ── HTTPS ──> TLS reverse proxy ── HTTP ──> 127.0.0.1:8080
```

An HTTP hop is acceptable only when it is confined to loopback or an equivalently trusted private boundary. Use a trusted certificate and verify that browsers show HTTPS without certificate warnings.

Do not publish port `8080` directly. Bind to `127.0.0.1` when a same-host tunnel or reverse proxy is the only intended entry point:

```bash
HOST=127.0.0.1 node server.mjs
```

## Protect the UI token

- Generate a strong, unique `PI_UI_TOKEN` and store it outside source control.
- Treat a URL containing the token like a password.
- Prefer the URL fragment used by `/#token=…`; fragments are not sent in HTTP requests, and the application removes it after capture.
- Do not place tokens in logs, screenshots, issue reports, query strings, or shell history.
- Rotate the token after suspected exposure and restart the service.
- Restrict access further with firewall rules, an identity-aware proxy, or a private network when possible.

## Credential boundaries

Provider credentials remain in pi's `auth.json`, but authenticated users can manage them and can run agents that use them. OAuth authorization data is transient, yet it still travels through the browser and server during an active flow. TLS protects that data in transit.

Removing a local API key or OAuth credential does not revoke it upstream. Revoke compromised keys and connected-app grants with the provider.

## Deployment checklist

1. Expose only an HTTPS URL with valid TLS.
2. Keep the Node listener on loopback or a trusted private interface.
3. Use a unique, high-entropy UI token.
4. Protect `.ui-token`, `auth.json`, SQLite files, and backups with host permissions.
5. Keep Oyster, pi, Node.js, the TLS proxy, and `cloudflared` updated.
6. Review tunnel and service logs without recording secrets.
7. Close tunnels when remote access is no longer needed.
