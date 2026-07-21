# PodView Install Guide (K8s)

**English** | [한국어](install-guide.ko.md)

The full procedure to install PodView on an air-gapped Kubernetes cluster and enable each feature.
For a multi-cluster (cross-network) setup, also see the [Multi-cluster Proxy Guide](multi-cluster-proxy-guide.md).

## Overview

```
1. Build image (internet-connected build box) → save to tar → carry into air-gap → push to internal registry
2. Prepare credentials (Keycloak client and/or a local admin account)
3. kubectl apply: RBAC → Secret → Deployment → Ingress
4. Verify access → register users/clusters/AI models from Admin settings (⚙)
5. (optional) integrate metrics-server / Prometheus·Hubble·DCGM
```

---

## What to Transfer — Only One Image (PodView)

The **only container image you transfer into the air-gap is the PodView app image**. Everything else is
connected **by config (env vars) to what you already have** — no extra images or sidecars.

| Component | Transfer needed? | How to connect |
|---|---|---|
| **PodView app** | ✅ 1 image (tar) | push to internal registry → Deployment |
| Prometheus (for traffic·GPU) | ❌ use existing | `PROMETHEUS_URL` env var (§6-2·6-3) |
| Keycloak (SSO) | ❌ use existing | `OIDC_*` env vars + client registration (§2-2) |
| metrics-server (CPU/memory) | ❌ usually already in cluster | auto-detected, no config (§6-1) |
| DCGM Exporter (GPU) | ❌ use existing | automatic via Prometheus (§6-3) |
| In-house LLM (AI analysis) | ❌ use existing | register address in admin settings (§7) |

> The node·golang images used for building are only used in the **internet-connected build box** and are not
> in the final image. The runtime base (distroless) and the frontend are all inside the final image tar, so
> the single transfer file is `podview-*.tar`.

## 1. Build & Air-gap Transfer

On the internet-connected build box:

```bash
git clone https://github.com/pms241948/CC-K8s-podview.git && cd CC-K8s-podview
make docker IMAGE=k8s-podview TAG=v0.1.0

# create the transfer tar
docker save k8s-podview:v0.1.0 -o podview-v0.1.0.tar
```

After transferring into the air-gap:

```bash
docker load -i podview-v0.1.0.tar
docker tag k8s-podview:v0.1.0 registry.example.com/k8s-podview:v0.1.0
docker push registry.example.com/k8s-podview:v0.1.0
```

> The image is a single distroless container with the frontend embedded in the binary, so there is no
> external CDN dependency. This one image is all you transfer.

## 2. Prepare Credentials

Prepare at least one of the two methods (both can be used).

### 2-1. Local admin account (bootstrap — always recommended)

Create the first admin via env var; manage the rest from the web admin settings.

```bash
# generate a bcrypt hash (on the build box or anywhere with Go)
go run ./cmd/hashpw 'password'
# → use the $2a$10$... value in the Secret's local-users below

# session cookie signing key
openssl rand -hex 32
```

### 2-2. Keycloak (SSO) client registration

1. In your realm → **Clients → Create client**
   - Client type: `OpenID Connect`, Client ID: `podview`
   - **Client authentication: On** (confidential)
2. Get the Client Secret from the Credentials tab
3. Valid redirect URIs: `https://<podview-host>/auth/callback`
4. issuer URL: `https://<keycloak-host>/realms/<realm-name>`
5. Prepare the list of admin emails (`OIDC_ADMIN_EMAILS`)

## 3. Apply Manifests

### 3-1. Write the Secret

Copy `deploy/secret-example.yaml` and fill in real values (never commit the filled file):

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: podview-auth
  namespace: podview
type: Opaque
stringData:
  cookie-secret: "<result of openssl rand -hex 32>"

  # If using Keycloak (delete these keys if unused)
  issuer-url: "https://keycloak.example.com/realms/myrealm"
  client-id: "podview"
  client-secret: "<Keycloak client secret>"
  redirect-url: "https://podview.example.com/auth/callback"

  # Local bootstrap admin (delete if unused)
  local-users: "admin:$2a$10$..."

  # Only if this instance is a remote target of another network's gateway
  gateway-token: "<result of openssl rand -hex 32>"
```

### 3-2. Deploy

```bash
# after updating the image address in deploy/deployment.yaml to your registry
kubectl apply -f deploy/rbac.yaml        # namespace + read-only ClusterRole + Role for settings Secret
kubectl apply -f secret.yaml             # the file you wrote above
kubectl apply -f deploy/deployment.yaml  # Deployment + Service
# after editing the hostname in deploy/ingress.yaml
kubectl apply -f deploy/ingress.yaml
```

The Ingress already includes annotations for SSE (live updates) and log streaming
(`proxy-buffering: off`, `proxy-read-timeout: 3600`). Other Ingress controllers need equivalent settings.

### 3-3. Verify

```bash
kubectl -n podview get pods                 # Running
kubectl -n podview logs deploy/podview      # "server started" + "auth enabled" logs
curl -k https://podview.example.com/api/healthz   # ok
```

In the browser → the login page shows the ID/PW form and SSO button (only configured methods) →
log in as admin → if Pods appear per namespace, the base install is done.

## 4. Web Admin Settings (⚙)

After deploy, log in as admin and configure from the web. Changes here are saved to the
`podview-settings` Secret and survive Pod restarts.

| Setting | Contents |
|---|---|
| User management | add local accounts (admin=can manage / viewer=read-only), reset passwords |
| SSO user roles | assign admin/viewer per SSO login email (viewer if unassigned; `OIDC_ADMIN_EMAILS` is always admin) |
| Cluster management | register other-network podviews → switch from the top dropdown (see §5) |
| AI analysis | register in-house LLM endpoints — multiple, with a default (see §7) |

## 5. Multi-cluster (unified view across networks)

Repeat §1–3 in each network, but:

- **Networks that will be remote**: the Secret only needs `gateway-token` (no local account/Keycloak —
  only the gateway's relay requests are authenticated by token)
- **Main network the admin connects to (gateway)**: configure a login method + register the remote
  networks' name·URL·token in admin settings

The cross-network nginx proxy setup (Host header rewrite, buffering off, etc.) is detailed in the
[Multi-cluster Proxy Guide](multi-cluster-proxy-guide.md).

## 6. Optional Integrations — Resources·Traffic·GPU

All optional; each feature silently turns off when unconfigured.

### 6-1. CPU/Memory (metrics-server)

You just need metrics-server in the cluster. Most clusters already have it; without it, cards/topology
show an info banner instead of usage.

### 6-2. Measured traffic (Prometheus + Hubble)

Enables the topology flow animation (dot speed·count) and Pod↔Pod measured-flow curves.

1. **Enable Hubble metrics** (Cilium helm values) — the pod context option is key:

```yaml
hubble:
  enabled: true
  metrics:
    enableOpenMetrics: true
    enabled:
      - flow:sourceContext=namespace|pod;destinationContext=namespace|pod
```

2. **Have Prometheus scrape hubble-metrics (:9965)** (a single ServiceMonitor with Prometheus Operator).
   Verify: `hubble_flows_processed_total` returns results in Prometheus.

3. **Add the env var to the podview Deployment:**

```yaml
- name: PROMETHEUS_URL
  value: "http://prometheus.monitoring:9090"
```

For non-Cilium CNIs (e.g. Retina), just swap the PromQL via `TRAFFIC_EDGE_QUERY` (no code change).
Per-Pod rx/tx (cAdvisor) works with any CNI as long as Prometheus is present.

### 6-3. GPU utilization (DCGM Exporter)

If DCGM Exporter already exists and Prometheus scrapes it, setting `PROMETHEUS_URL` alone shows GPU
rings·badges automatically. Make sure DCGM metrics carry `namespace`/`pod` labels (on by default with
GPU Operator). The GPU allocation-count badge shows even without Prometheus.

## 7. AI Analysis (in-house LLM)

Register under Admin settings (⚙) → AI analysis. No infra work — you only need the address of your
LLM serving (vLLM/Ollama/LiteLLM etc.).

| Field | Value |
|---|---|
| Provider | `openai` (most serving) or `anthropic` (Messages API format) |
| URL | base address only (e.g. `http://vllm.ai-infra:8000`) |
| Model | the served model name |
| API key | optional |

Register multiple models and set a default; the AI analysis tab in Pod detail lets you pick which to run.
On analysis the Pod's status·events·recent logs are sent; **no sensitive data such as env-var values is sent.**
In multi-cluster, register an LLM on each network (a proxied request uses that network's setting).

## 8. Upgrade

```bash
# after transferring the new image
kubectl -n podview set image deploy/podview podview=registry.example.com/k8s-podview:v0.2.0
```

Web-registered settings (users·clusters·AI models) live in the `podview-settings` Secret and persist.

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| Pod in CrashLoopBackOff | `kubectl -n podview logs deploy/podview` — usually a missing/malformed Secret (e.g. `AUTH_ENABLED=true` with no auth method) |
| Empty Pod list after login | RBAC applied? `kubectl auth can-i list pods --as=system:serviceaccount:podview:podview` |
| Live updates need a refresh | missing `proxy-buffering: off` on the Ingress (SSE stuck in a buffer) |
| SSO button missing | the four `OIDC_*` env vars unset — check "auth enabled oidc=false" in `kubectl -n podview logs` |
| Callback error after Keycloak login | redirect-url mismatch with Keycloak Valid redirect URIs, or the podview Pod can't reach the issuer URL |
| Resource-usage banner shown | metrics-server not installed — check whether `kubectl top pods` works |
| Traffic flow is uniform (not measured) | `PROMETHEUS_URL` unset, or Hubble metrics lack pod context |
| Remote cluster "cannot connect" | reachability of the registered URL from the gateway Pod (DNS/egress/token) — see the proxy guide's troubleshooting table |
