# K8s PodView

**English** | [한국어](README.ko.md)

A web service that **visualizes Kubernetes Pod status per namespace in real time** — designed for air-gapped / on-prem clusters (no external CDN or internet dependency).

## Features

- **Per-namespace Pod status** — Running / Pending / CrashLoopBackOff and more, color-coded
- **Problem-Pod filter & recency emphasis** — click "problem N" to show only problem Pods (sorted newest-first). Cards show a recency badge; in the topology view, Pods that turned abnormal within 24h get a pulsing halo so they stand out from long-standing (chronic) ones
- **Namespace summary cards → topology** — the all-namespaces screen shows one summary card per namespace (per-status count chips, the latest problem Pods by name, CPU/memory totals); click a card to open that namespace's topology, or a problem Pod to open its details
- **Topology view** — Ingress→Service→Pod (grouped by node) hierarchy, animated, with a CPU-usage ring on each Pod
- **Adjustable topology layout** — drag node boxes to move them, drag the handle to resize (Pods auto-reflow). Layout is saved in the browser and can be reset
- **Measured traffic (optional)** — with Prometheus, flow-animation **dot speed and count (1–4) scale with real traffic**, and idle paths fade out. Pod↔Pod measured-flow curves with rx/tx tooltips. CNI-agnostic design (see below)
- **Live updates** — K8s Watch (informers) → SSE pushes changes to the screen instantly
- **Pod logs** — container selection, live follow
- **Pod environment** — env vars (secret values shown as source only), ports, volumes, conditions, K8s events
- **Resource usage** — CPU/memory per Pod/container via metrics-server (auto-disabled if absent)
- **GPU** — Pod GPU allocation count (nvidia/amd/intel/habana extended resources) shown by default; with DCGM Exporter, live utilization / GPU memory shown as rings & badges
- **Dual authentication** — Keycloak SSO (OIDC) and local ID/PW (bcrypt); pick one or both
- **Multi-cluster gateway** — register podview instances in other (air-gapped) networks and switch between clusters from one web UI
- **Admin settings tab** — manage clusters (name·URL·token), local accounts & SSO user roles (admin/viewer), and AI-analysis endpoints from the web
- **AI analysis (optional)** — register an in-house LLM endpoint to generate a failure-analysis report from a Pod's status/events/logs
- **UI language (English / 한국어)** — English by default. Switch it in Settings (⚙) → General or on the sign-in page; saved in the browser. Also applies to server error messages and AI analysis reports

## UI Overview

| Screen | Contents |
|---|---|
| Login | podview's own ID/PW form + an **SSO (Keycloak) login** button below (only configured methods appear) |
| Sidebar | Namespace list + live search + red problem-Pod-count badge (15s refresh). Collapse with « to widen the monitoring area; drag the right edge to resize (160–480px) — all persisted |
| All namespaces (overview) | Namespace summary card grid — per-status count chips (only non-zero, error→pending→healthy→completed), up to 2 most recent problem Pods (name · status · recency, then "+N more"), CPU·memory totals, GPU allocation. Namespaces with problems sort to the top, newest first. Clicking a card opens that namespace's topology; clicking a problem Pod opens its detail panel directly. A filter bar picks **All / With problems / Last 24h** (excludes namespaces with only chronic problems), plus "Hide empty namespaces" (choice saved in the browser). "problem N" or a search shows matching Pod cards across the cluster (status color, Ready/restarts/Age, CPU·memory, GPU, recency badge) |
| Topology view (namespace selected) | Ingress→Service→Node→**namespace box**→Pod hierarchy. Routing-flow animation (Not Ready = red dashed), CPU ring (blue·relative) · GPU ring (green·absolute %), pulsing halo on problems within 24h. Hovering a node / namespace box / Pod / flow line highlights the related elements and the sidebar namespace. Node boxes drag-move & resize (Pods auto-reflow, layout saved/reset). With Prometheus, dot speed·count reflect measured traffic. Pods not matching the search are dimmed |
| Pod detail panel | Info / Env (env vars·ports·volumes) / Logs (live follow) / Events (K8s events·conditions) / AI analysis (selectable model) tabs |
| Settings (⚙) | Everyone: General (UI language). Admin role only: add/remove clusters, manage local accounts, assign SSO user roles, manage AI models (add/edit/delete/default) |
| Top bar | Cluster selector dropdown, "problem N" filter toggle, Pod name/status search, live connection status, logout |

## How a Problem Pod Is Determined

- **Problem Pod**: any Pod that is not (Running + all-Ready) and not a clean termination (Succeeded/Completed)
- **Onset time**: when the Ready condition flipped to False. Exception: for Pods with ≥5 restarts (crash loops), Ready is refreshed each cycle and always looks "just now", so the Pod start time is used instead — long-standing crash loops are then correctly classified as chronic
- **Classification & emphasis**: within 1h (fresh — urgent) / within 24h (recent) / chronic (>24h, knowingly left alone)
  - Cards: recency badge on namespace and Pod cards — red (fresh) / amber (recent) / grey (chronic)
  - Topology view: fresh·recent get a pulsing halo ring (fresh pulses faster); chronic has no halo and is dimmed → new incidents stand out over neglected ones

## Architecture

```
                          [Browser]
                              │ log in once (local ID/PW or Keycloak OIDC)
                              ▼
 ┌─ main network ───────────────────────────────────────┐
 │  podview (gateway)                                     │
 │   ├─(Watch/List)→ K8s API        ← own cluster         │
 │   ├─(poll)→ metrics-server        ← CPU/memory         │
 │   ├─(poll)→ Prometheus            ← traffic·GPU(DCGM)  │
 │   └─(/proxy/{cluster}, GATEWAY_TOKEN)                  │
 │         │                                              │
 └─────────┼──────────────────────────────────────────────┘
           │ nginx cross-network proxy
           ├──────────→ [other-network podview] ──→ its K8s API
           └──────────→ [another-network podview] → its K8s API
```

- Backend: Go + client-go (shared informers minimize API-server load), SSE for live push
- Frontend: React + Vite → embedded in the binary via `go:embed` (**no external CDN, air-gap ready**)
- Deploy: single distroless container image, read-only ClusterRole
- External integrations (Prometheus·DCGM·Hubble) are all optional — each feature silently disables itself when unconfigured

## Local Development

Requires Go 1.26.10+, Node 24.22.1+ (security patch releases).

```bash
# full build then run (uses current kubeconfig context, auth disabled)
make run

# frontend dev server (proxies API to backend :8080)
cd web && npm run dev
```

## Build & Air-gap Transfer

```bash
make docker IMAGE=k8s-podview TAG=v0.1.0

# transfer: save image to tar → carry in → push to internal registry
docker save k8s-podview:v0.1.0 -o podview.tar
# (after transfer)
docker load -i podview.tar
docker tag k8s-podview:v0.1.0 registry.example.com/k8s-podview:v0.1.0
docker push registry.example.com/k8s-podview:v0.1.0
```

Only **one image** needs to be transferred (the podview app). Prometheus, Keycloak, metrics-server, DCGM, and your LLM are external — connect them by config, no extra images. See the [Install Guide](docs/install-guide.md).

## Cluster Deployment

> The full procedure from image transfer to per-feature integration is in the **[Install Guide](docs/install-guide.md)**.

1. Decide the auth method (see "Authentication & Accounts") and apply `deploy/secret-example.yaml` filled with real values
2. Update the image address in `deploy/deployment.yaml` to your registry
3. Apply:

```bash
kubectl apply -f deploy/rbac.yaml
kubectl apply -f deploy/secret.yaml        # your filled-in copy of secret-example.yaml
kubectl apply -f deploy/deployment.yaml
kubectl apply -f deploy/ingress.yaml       # after editing the hostname
```

## Authentication & Accounts

Two login methods, usable together. The login page (`/login`) shows only configured methods; if only OIDC is set, it skips the login page and goes straight to Keycloak.

**Role model** — every account is `admin` (can access admin settings) or `viewer` (read-only).

| Account type | How to register | Role |
|---|---|---|
| Bootstrap account | `LOCAL_USERS` env var | always admin |
| Web-managed (local) | Admin settings (⚙) → User management: add/remove/reset password | set on creation |
| Keycloak (SSO) user | Admin settings (⚙) → SSO user roles: assign per email | admin/viewer if assigned, otherwise viewer |

**Assigning SSO roles** — SSO users only exist after they log in, so register their email under **SSO user roles** in advance. Role priority at login:

1. `OIDC_ADMIN_EMAILS` env var (deploy-time bootstrap admin — cannot be demoted from the UI)
2. Per-email role registered in admin settings
3. Otherwise `viewer`

Typical operation: set only one or two bootstrap admins via `OIDC_ADMIN_EMAILS`, then manage all other SSO roles from the web.

### Keycloak Client Setup

1. In your realm: **Clients → Create client**
   - Client type: `OpenID Connect`, Client ID: `podview`
   - **Client authentication: On** (confidential)
2. **Valid redirect URIs**: `https://podview.example.com/auth/callback`
3. Put the Client Secret from the Credentials tab into `client-secret` of `deploy/secret.yaml`
4. `issuer-url` format: `https://<keycloak-host>/realms/<realm-name>`
5. Register only the first admin email in `OIDC_ADMIN_EMAILS` (bootstrap); manage the rest from admin settings (⚙)

### Local ID/PW Bootstrap Account

```bash
# generate a bcrypt hash
go run ./cmd/hashpw password
# → $2a$10$...

# set via env var (comma-separated for multiple)
LOCAL_USERS="admin:$2a$10$..."

# or via file (one "name:hash" per line, # comments allowed)
LOCAL_USERS_FILE=/etc/podview/users
```

Create only the first admin via env var; manage the rest from the web admin settings (the server hashes web-added accounts with bcrypt, so the `hashpw` tool isn't needed there).

## Multi-cluster (unified view across networks)

Deploy podview in each network, then in the admin settings (⚙) of the "gateway" instance the admin connects to, register the other networks' podview instances. Switch clusters from the top dropdown.

```
[Browser] ── [main podview (gateway)] ── nginx cross-network proxy ── [other-network podview]
```

1. **Remote-network instance**: set `GATEWAY_TOKEN=<long random token>` (`openssl rand -hex 32`). The gateway authenticates with this token as a Bearer header, so the remote needs no separate account.
2. **Gateway instance**: in admin settings → cluster management, register the name (e.g. "cluster-2"), URL (reachable via the cross-network proxy), and that instance's GATEWAY_TOKEN.
3. The cross-network nginx needs `proxy_buffering off` and a long `proxy_read_timeout` for SSE/log streaming (same as the annotations in `deploy/ingress.yaml`).

See the **[Multi-cluster Proxy Guide](docs/multi-cluster-proxy-guide.md)** for detailed nginx setup.

You log in only once at the gateway. Web-changed settings are stored in the `podview-settings` Secret in-cluster, or `DATA_DIR/settings.json` when running outside a cluster.

## AI Analysis (optional)

Register an in-house LLM endpoint under Admin settings (⚙) → **AI analysis** to enable the **AI analysis** tab in Pod detail. You can register **multiple models** (add/edit/delete) and mark one as **default**; the tab's dropdown lets you pick which model to run, so you can compare results. On run, the backend collects the Pod's status·containers·conditions·K8s events·recent logs (80 lines per container, including the previous container's log on crash), sends them to the model, and shows a report (status summary · cause analysis · recommended actions) in the current UI language. **No sensitive data such as env-var values is sent.**

| Setting | Description |
|---|---|
| Provider | `openai` — OpenAI Chat Completions compatible (vLLM·Ollama·LiteLLM etc., default) / `anthropic` — Anthropic Messages API format |
| URL | base address only (e.g. `http://vllm.ai-infra:8000`) — the path (`/v1/chat/completions` or `/v1/messages`) is appended automatically |
| Model | the served model name |
| API key | optional (openai: `Authorization: Bearer`, anthropic: `x-api-key`) |

Settings are per-instance — analyzing a remote cluster's Pod uses the model registered on that network's instance, so register a model endpoint on each network.

## Measured Traffic (optional)

Topology edges are selector-based **routing paths** by default. To see real traffic, integrate Prometheus. Using Prometheus as the common integration point makes it **CNI-agnostic**:

| Data | Source | Requirement |
|---|---|---|
| Pod rx/tx bytes/s | kubelet cAdvisor metrics | Prometheus only (any CNI) |
| Pod↔Pod flow (who↔who) | Hubble (Cilium) or Retina etc. eBPF metrics in Prometheus | that tool installed |

```bash
# minimal — show per-Pod rx/tx
PROMETHEUS_URL=http://prometheus.monitoring:9090

# Cilium + Hubble — also show Pod↔Pod flows.
# Hubble metrics need the pod context enabled:
#   hubble.metrics.enabled[flow]: sourceContext=namespace|pod;destinationContext=namespace|pod
# The default query is hubble_flows_processed_total; for other tools (Retina etc.),
# swap the query so source/destination labels are "namespace/pod":
TRAFFIC_EDGE_QUERY='sum by (source, destination) (rate(hubble_flows_processed_total{source!="",destination!=""}[2m]))'
TRAFFIC_EDGE_UNIT='flows/s'
```

When integrated, topology **dot speed and count (1–4) scale with traffic**, and paths under 50 B/s fade out (dots disappear) — revealing "configured but unused" paths. Pod↔Pod curves use the same scheme (fixed thickness + dot speed·count) with exact figures in the tooltip.

Without `PROMETHEUS_URL` this feature silently turns off (uniform structural animation remains); on clusters without Hubble metrics, only per-Pod rx/tx is shown.

### GPU Usage (DCGM Exporter)

If `PROMETHEUS_URL` is set and DCGM Exporter metrics are being scraped, GPU utilization/memory appear automatically. DCGM Exporter's Kubernetes integration (Pod attribution) must be on so `namespace`/`pod` labels are attached (enabled by default with GPU Operator). Default queries:

```
GPU_UTIL_QUERY: avg by (namespace, pod) (DCGM_FI_DEV_GPU_UTIL{pod!=""})
GPU_MEM_QUERY:  sum by (namespace, pod) (DCGM_FI_DEV_FB_USED{pod!=""}) * 1024 * 1024
```

For non-NVIDIA GPUs (AMD ROCm etc.), swap the two queries for the corresponding exporter metrics. The GPU allocation-count badge is always shown from the Pod spec (limits) even without Prometheus.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | server listen address |
| `KUBECONFIG` | (in-cluster) | kubeconfig path when running outside the cluster |
| `AUTH_ENABLED` | `false` | enable auth (needs at least one of OIDC / local) |
| `COOKIE_SECRET` | - | session cookie signing key (`openssl rand -hex 32`) |
| `COOKIE_SECURE` | `true` | HTTPS-only cookie (set `false` only for http testing) |
| `OIDC_ISSUER_URL` | - | Keycloak realm issuer URL |
| `OIDC_CLIENT_ID` | - | client ID |
| `OIDC_CLIENT_SECRET` | - | client secret |
| `OIDC_REDIRECT_URL` | - | `https://<host>/auth/callback` |
| `OIDC_ADMIN_EMAILS` | - | OIDC emails to grant admin (comma-separated) |
| `LOCAL_USERS` | - | local users `name:bcrypthash,...` |
| `LOCAL_USERS_FILE` | - | local users file path |
| `PROMETHEUS_URL` | - | Prometheus address for measured traffic (empty = off) |
| `TRAFFIC_EDGE_QUERY` | (Hubble default) | Pod↔Pod flow PromQL |
| `TRAFFIC_EDGE_UNIT` | `flows/s` | flow display unit |
| `GPU_UTIL_QUERY` | (DCGM default) | GPU utilization PromQL |
| `GPU_MEM_QUERY` | (DCGM default) | GPU memory PromQL (bytes result) |
| `GATEWAY_TOKEN` | - | token authenticating gateway relay requests (set on remote instances) |
| `POD_NAMESPACE` | - | namespace of the settings Secret (injected via Downward API) |
| `DATA_DIR` | `data` | settings file directory when running outside a cluster |

## API

| Method/Path | Description |
|---|---|
| `GET /api/namespaces` | namespace list |
| `GET /api/pods?namespace=` | Pod summary list (all if omitted) |
| `GET /api/topology?namespace=` | topology (nodes/Pods/services + selector matches) |
| `GET /api/events?namespace=` | SSE stream (snapshot + incremental events) |
| `GET /api/namespaces/{ns}/pods/{pod}/logs?container=&tailLines=&follow=` | Pod logs |
| `GET /api/namespaces/{ns}/pods/{pod}/detail` | env vars·volumes·conditions·events |
| `GET /api/metrics/pods?namespace=` | Pod CPU/memory usage |
| `GET /api/traffic?namespace=` | measured traffic (when Prometheus integrated) |
| `GET /api/gpu?namespace=` | per-Pod GPU utilization/memory (DCGM) |
| `GET /api/healthz` | health check (excluded from auth) |
| `GET /auth/methods` | available login methods |
| `POST /auth/local` | local ID/PW login |
| `GET /auth/login` `/auth/callback` | Keycloak OIDC flow |
| `GET /auth/me` `/auth/logout` | session check / logout |
| `GET /api/clusters` | registered cluster names |
| `/proxy/{cluster}/...` | relay to a remote podview (SSE included) |
| `GET·POST /api/admin/clusters` `DELETE /api/admin/clusters/{name}` | cluster management (admin) |
| `GET·POST /api/admin/users` `DELETE /api/admin/users/{username}` | local user management (admin) |
| `GET·POST /api/admin/oidc-users` `DELETE /api/admin/oidc-users/{email}` | SSO user role management (admin) |
| `GET /api/ai/status` | whether AI analysis is configured |
| `POST /api/namespaces/{ns}/pods/{pod}/analyze` | run Pod AI analysis |
| `GET·POST /api/admin/ai` `DELETE /api/admin/ai/{name}` `POST /api/admin/ai/active` | AI model management (admin) |

## License

MIT
