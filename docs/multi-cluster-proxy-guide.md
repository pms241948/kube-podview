# Multi-cluster Proxy Guide

**English** | [한국어](multi-cluster-proxy-guide.ko.md)

How to configure the nginx proxy so podview instances installed in separate (air-gapped) networks can be
viewed from one web UI.

## Architecture

```
                        [Admin browser]
                              │  log in once
                              ▼
              ┌─ main network ─────────────────────────┐
              │  podview.example.com                    │  ← gateway podview
              │        │ (server-side relay, GATEWAY_TOKEN)
              │        ▼                                 │
              │  [main-network nginx cross-net proxy]    │
              │   podview-net-a.example.com ────────────┼──→ net A   podview.net-a.internal
              │   podview-net-b.example.com ────────────┼──→ net B   podview.net-b.internal
              └──────────────────────────────────────────┘
```

Key principles:

- **Users connect & log in to the gateway only** (`podview.example.com`). Switch clusters from the top dropdown.
- The gateway → remote relay happens **on the gateway Pod (server), not the browser**. So the proxy address
  must be *reachable from the gateway Pod* (resolvable via cluster DNS + egress allowed).
- Gateway → remote auth uses **`GATEWAY_TOKEN`** (a server-to-server Bearer token) independent of the user
  session. Browser cookies are never forwarded to the remote.

## Step 1 — Deploy podview in each network

Apply the `deploy/` manifests with the same image in every network. Only the env vars differ.

**Remote instances (net A, net B):**

```bash
# generate a token (different per network)
openssl rand -hex 32
```

Put it in the `podview-auth` Secret under the `gateway-token` key. This minimal config is enough:

| Env var | Value |
|---|---|
| `AUTH_ENABLED` | `true` |
| `COOKIE_SECRET` | any (`openssl rand -hex 32`) |
| `GATEWAY_TOKEN` | the token generated above |

> Remote instances need no local account/Keycloak. Token-less access is all 401-blocked, and only the
> gateway's relay requests pass. To let that network's own users access it directly, also configure a
> local account/Keycloak.

**Gateway instance (main network):**

Configure an admin login method (local `LOCAL_USERS` or Keycloak). `GATEWAY_TOKEN` is not needed here.

## Step 2 — main-network nginx cross-net proxy

Add a hostname-based proxy per remote podview.

```nginx
# relay to net A podview
server {
    listen 443 ssl;
    server_name podview-net-a.example.com;

    ssl_certificate     /etc/nginx/certs/podview-net-a.example.com.crt;
    ssl_certificate_key /etc/nginx/certs/podview-net-a.example.com.key;

    location / {
        proxy_pass https://podview.net-a.internal;

        # ★ Required 1: the remote Ingress routes by Host header, so rewrite to the target host
        proxy_set_header Host podview.net-a.internal;

        # ★ Required 2: SSE (live updates) and log follow are long-lived streams
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_http_version 1.1;

        # Recommended: pass client info (logged by the remote podview)
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# relay to net B podview (same pattern)
server {
    listen 443 ssl;
    server_name podview-net-b.example.com;

    ssl_certificate     /etc/nginx/certs/podview-net-b.example.com.crt;
    ssl_certificate_key /etc/nginx/certs/podview-net-b.example.com.key;

    location / {
        proxy_pass https://podview.net-b.internal;
        proxy_set_header Host podview.net-b.internal;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Checklist:

- [ ] `podview-net-a.example.com` / `podview-net-b.example.com` are registered in the **main-network DNS**,
      and resolvable **from inside the gateway Pod** specifically
      (the distroless image has no shell, so use a temp debug Pod:
      `kubectl run dns-test --rm -it --image=busybox -- nslookup podview-net-a.example.com`)
- [ ] the gateway cluster's egress policy allows traffic to the nginx proxy
- [ ] if the upstream (remote Ingress) uses a private CA cert, nginx trusts it (`proxy_ssl_trusted_certificate`)

## Step 3 — register clusters in the gateway web UI

1. Open `https://podview.example.com` → log in as admin
2. Top-right **⚙ (Admin settings)** → **Cluster management**
3. Register:

| Name (your choice) | URL | Token |
|---|---|---|
| net-a | `https://podview-net-a.example.com` | net A instance's GATEWAY_TOKEN |
| net-b | `https://podview-net-b.example.com` | net B instance's GATEWAY_TOKEN |

4. Selecting a cluster from the top dropdown shows that network's Pod status·topology·logs.

Registrations are stored in the gateway namespace's `podview-settings` Secret, so they survive Pod restarts.

## Hardening (recommended)

The `podview-net-*` proxy addresses are used only server-side by the gateway. To block direct access by
regular users, restrict the source IP in nginx:

```nginx
location / {
    # allow only the gateway cluster's egress IP range
    allow 10.10.0.0/16;
    deny all;
    ...
}
```

- Issue a different token per network; on leak, rotate just that network's Secret and re-register in the gateway.
- The gateway's viewer accounts can also view all registered clusters. Per-cluster access restriction would
  need a separate feature.

## Troubleshooting

| Symptom | Cause / check |
|---|---|
| "cannot connect to cluster" on dropdown select | URL unreachable from the gateway Pod — check DNS, egress, whether nginx is up. From the gateway Pod: `curl <URL>/api/healthz` |
| 404 or a different service responds | nginx `proxy_set_header Host` missing or wrong (remote Ingress routes by Host) |
| Pod list loads but no live updates | missing `proxy_buffering off` — SSE stuck in a buffer |
| Connection drops after a while, needs refresh | `proxy_read_timeout` too short (default 60s) — extend to 3600s |
| 401 unauthorized | registered token ≠ the remote instance's `GATEWAY_TOKEN` |
| TLS error | nginx doesn't trust the remote Ingress's private CA — set `proxy_ssl_trusted_certificate` |

## Appendix: request flow detail

```
Browser ── GET /proxy/net-a/api/pods (session cookie) ──→ gateway podview
                                                          │ 1. verify session
                                                          │ 2. strip cookie, add Authorization: Bearer <token>
                                                          │ 3. strip /proxy/net-a from the path
                                                          ▼
                                            https://podview-net-a.example.com/api/pods
                                                          │ (main-network nginx, Host rewrite)
                                                          ▼
                                     net A Ingress → podview Pod → verify token → respond
```
