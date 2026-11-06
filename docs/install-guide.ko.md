# PodView 설치·적용 가이드 (K8s)

[English](install-guide.md) | **한국어**

폐쇄망 Kubernetes 클러스터에 PodView를 설치하고 각 기능을 활성화하는 전체 절차입니다.
멀티클러스터(여러 망 통합) 구성은 [멀티클러스터 프록시 구성 가이드](multi-cluster-proxy-guide.ko.md)를 함께 참고하세요.

## 전체 순서 요약

```
1. 이미지 빌드 (인터넷 가능 구간) → tar 저장 → 폐쇄망 반입 → 내부 레지스트리 push
2. 인증 정보 준비 (Keycloak 클라이언트 또는 로컬 admin 계정)
3. kubectl apply: RBAC → Secret → Deployment → Ingress
4. 접속 확인 → 관리자 설정(⚙)에서 사용자/클러스터/AI 모델 등록
5. (선택) metrics-server / Prometheus·Hubble·DCGM 연동
```

---

## 반입 대상 요약 — 이미지는 PodView 1개뿐

폐쇄망에 **새로 반입할 컨테이너 이미지는 PodView 앱 이미지 1개**입니다. 나머지 구성요소는
이미 있는 것을 **환경변수/설정으로 주소만 연결**하며, 별도 이미지·사이드카 반입이 없습니다.

| 구성요소 | 반입 필요? | 연결 방법 |
|---|---|---|
| **PodView 앱** | ✅ 이미지 1개 (tar) | 내부 레지스트리 push → Deployment |
| Prometheus (트래픽·GPU용) | ❌ 기존 사용 | `PROMETHEUS_URL` 환경변수 (6-2·6-3) |
| Keycloak (SSO) | ❌ 기존 사용 | `OIDC_*` 환경변수 + 클라이언트 등록 (2-2) |
| metrics-server (CPU/메모리) | ❌ 보통 클러스터에 이미 존재 | 자동 감지, 설정 불필요 (6-1) |
| DCGM Exporter (GPU) | ❌ 기존 사용 | Prometheus 통해 자동 (6-3) |
| 자체 LLM (AI 분석) | ❌ 기존 사용 | 관리자 설정에서 주소 등록 (7) |

> 빌드에 쓰이는 node·golang 이미지는 **인터넷 되는 빌드 구간에서만** 사용되고 최종 이미지에는
> 포함되지 않습니다. 실행 베이스(distroless)와 프론트엔드는 최종 이미지 tar 안에 모두 담기므로,
> 반입 파일은 `podview-*.tar` 하나입니다.

## 1. 이미지 빌드와 폐쇄망 반입

인터넷이 되는 빌드 구간에서:

```bash
git clone https://github.com/pms241948/kube-podview.git && cd kube-podview
make docker IMAGE=k8s-podview TAG=v0.1.0

# 반입용 tar 생성
docker save k8s-podview:v0.1.0 -o podview-v0.1.0.tar
```

폐쇄망 반입 후:

```bash
docker load -i podview-v0.1.0.tar
docker tag k8s-podview:v0.1.0 registry.example.com/k8s-podview:v0.1.0
docker push registry.example.com/k8s-podview:v0.1.0
```

> 이미지는 distroless 기반 단일 컨테이너이고 프론트엔드가 바이너리에 내장되어
> 외부 CDN 의존이 없습니다. 반입할 것은 이 이미지 하나입니다.

## 2. 인증 정보 준비

두 방식 중 하나 이상을 준비합니다 (병행 가능).

### 2-1. 로컬 admin 계정 (부트스트랩 — 항상 권장)

최초 관리자 계정 하나는 환경변수로 만들어두고, 이후 일반 계정은 웹 관리자 설정에서 관리합니다.

```bash
# bcrypt 해시 생성 (빌드 구간 또는 Go가 있는 곳에서)
go run ./cmd/hashpw '비밀번호'
# → $2a$10$... 값을 아래 Secret의 local-users에 사용

# 세션 쿠키 서명 키
openssl rand -hex 32
```

### 2-2. Keycloak(SSO) 클라이언트 등록

1. 사용할 Realm → **Clients → Create client**
   - Client type: `OpenID Connect`, Client ID: `podview`
   - **Client authentication: On** (confidential)
2. **Valid redirect URIs**: `https://<podview 호스트>/auth/callback`
3. Credentials 탭의 Client Secret 확보
4. issuer URL: `https://<keycloak 호스트>/realms/<realm 이름>`
5. 관리자 권한을 줄 사용자 이메일 목록 준비 (`OIDC_ADMIN_EMAILS`)

## 3. 매니페스트 적용

### 3-1. Secret 작성

`deploy/secret-example.yaml`을 복사해 실제 값으로 채웁니다 (실값 파일은 커밋 금지):

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: podview-auth
  namespace: podview
type: Opaque
stringData:
  cookie-secret: "<openssl rand -hex 32 결과>"

  # Keycloak 사용 시 (미사용이면 키 삭제)
  issuer-url: "https://keycloak.example.com/realms/myrealm"
  client-id: "podview"
  client-secret: "<Keycloak 클라이언트 시크릿>"
  redirect-url: "https://podview.example.com/auth/callback"

  # 로컬 부트스트랩 admin (미사용이면 키 삭제)
  local-users: "admin:$2a$10$..."

  # 이 인스턴스가 다른 망 게이트웨이의 원격 대상이 되는 경우에만
  gateway-token: "<openssl rand -hex 32 결과>"
```

### 3-2. 배포

```bash
# deploy/deployment.yaml의 이미지 주소를 내부 레지스트리로 수정한 뒤
kubectl apply -f deploy/rbac.yaml        # 네임스페이스 + 읽기전용 ClusterRole + 설정 Secret용 Role
kubectl apply -f secret.yaml             # 위에서 작성한 파일
kubectl apply -f deploy/deployment.yaml  # Deployment + Service
# deploy/ingress.yaml의 호스트명 수정 후
kubectl apply -f deploy/ingress.yaml
```

Ingress에는 SSE(실시간 갱신)·로그 스트리밍을 위한 어노테이션이 이미 포함되어 있습니다
(`proxy-buffering: off`, `proxy-read-timeout: 3600`). 다른 Ingress 컨트롤러를 쓰면 동등한 설정이 필요합니다.

### 3-3. 확인

```bash
kubectl -n podview get pods                 # Running 확인
kubectl -n podview logs deploy/podview      # "서버 시작" + "인증 활성화" 로그 확인
curl -k https://podview.example.com/api/healthz   # ok
```

브라우저에서 접속 → 로그인 페이지에 ID/PW 폼과 SSO 버튼(설정한 방식만) 표시 →
admin 로그인 → 네임스페이스별 Pod가 보이면 기본 설치 완료입니다.

## 4. 웹 관리자 설정 (⚙)

배포 후 admin 계정으로 접속해서 웹에서 설정합니다. 여기서 바꾼 값은
`podview-settings` Secret에 저장되어 Pod 재시작에도 유지됩니다.

| 설정 | 내용 |
|---|---|
| 사용자 관리 | 로컬 계정 추가 (admin=관리 가능 / viewer=조회만), 비밀번호 재설정 |
| SSO 사용자 역할 | SSO 로그인 사용자의 이메일별 admin/viewer 지정 (미지정 시 viewer, `OIDC_ADMIN_EMAILS`는 항상 admin) |
| 클러스터 관리 | 다른 망 podview 등록 → 상단 드롭다운으로 전환 (5장 참고) |
| AI 분석 설정 | 자체 LLM 엔드포인트 등록 — 여러 개 등록·기본 지정 가능 (7장 참고) |

## 5. 멀티클러스터 (여러 망 통합 조회)

각 망에 1~3장을 반복해 배포하되:

- **원격이 될 망**: Secret에 `gateway-token`만 있으면 됩니다 (로컬 계정/Keycloak 불필요 —
  게이트웨이의 중계 요청만 토큰으로 인증)
- **관리자가 접속할 메인 망(게이트웨이)**: 로그인 수단 설정 + 관리자 설정에서
  원격 망의 이름·URL·토큰 등록

망간 nginx 프록시 설정(Host 헤더 재작성, 버퍼링 해제 등)은
[멀티클러스터 프록시 구성 가이드](multi-cluster-proxy-guide.ko.md)에 상세히 정리되어 있습니다.

## 6. 선택 연동 — 리소스·트래픽·GPU

모두 선택 사항이며, 미설정 시 해당 기능만 조용히 꺼집니다.

### 6-1. CPU/메모리 (metrics-server)

클러스터에 metrics-server만 있으면 됩니다. 대부분의 클러스터에 이미 설치되어 있고,
없으면 카드/토폴로지에 사용량 대신 안내 배너가 표시됩니다.

### 6-2. 실측 트래픽 (Prometheus + Hubble)

토폴로지의 흐름 애니메이션(점 속도·개수)과 Pod↔Pod 실측 곡선을 활성화합니다.

1. **Hubble 메트릭 활성화** (Cilium helm values) — pod 컨텍스트 옵션이 핵심:

```yaml
hubble:
  enabled: true
  metrics:
    enableOpenMetrics: true
    enabled:
      - flow:sourceContext=namespace|pod;destinationContext=namespace|pod
```

2. **Prometheus가 hubble-metrics(:9965)를 스크레이프**하도록 설정
   (Prometheus Operator면 ServiceMonitor 1개). 확인:
   Prometheus에서 `hubble_flows_processed_total` 쿼리가 결과를 반환하면 됩니다.

3. **podview Deployment에 환경변수 추가:**

```yaml
- name: PROMETHEUS_URL
  value: "http://prometheus.monitoring:9090"
```

Cilium이 아닌 CNI(예: Retina)는 `TRAFFIC_EDGE_QUERY`로 PromQL만 교체하면 됩니다
(코드 수정 불필요). Pod별 송수신량(cAdvisor)은 Prometheus만 있으면 CNI와 무관하게 표시됩니다.

### 6-3. GPU 사용률 (DCGM Exporter)

DCGM Exporter가 이미 있고 Prometheus가 수집 중이면 `PROMETHEUS_URL` 설정만으로
GPU 링·배지가 자동 표시됩니다. DCGM 메트릭에 `namespace`/`pod` 레이블이 붙어 있는지 확인하세요
(GPU Operator 기본 구성이면 활성). GPU 할당 개수 배지는 Prometheus 없이도 항상 표시됩니다.

## 7. AI 분석 (자체 LLM)

관리자 설정(⚙) → AI 분석 설정에서 등록합니다. 인프라 작업은 없습니다 —
자체 LLM 서빙(vLLM/Ollama/LiteLLM 등)의 주소만 있으면 됩니다.

| 항목 | 값 |
|---|---|
| 프로바이더 | `openai`(대부분의 서빙) 또는 `anthropic`(Messages API 형식) |
| URL | 베이스 주소만 (예: `http://vllm.ai-infra:8000`) |
| 모델 | 서빙 중인 모델 이름 |
| API 키 | 선택 |

여러 모델을 등록해 기본 모델을 지정하고, Pod 상세의 AI 분석 탭에서 모델을 골라 실행할 수 있습니다.
분석 시 Pod 상태·이벤트·최근 로그가 전송되며 **환경변수 값 등 민감정보는 전송되지 않습니다.**
멀티클러스터에서는 망마다 자기 LLM을 등록하면 됩니다 (프록시 경유 시 해당 망 설정 사용).

## 8. 업그레이드

```bash
# 새 이미지 반입 후
kubectl -n podview set image deploy/podview podview=registry.example.com/k8s-podview:v0.2.0
```

웹에서 등록한 설정(사용자·클러스터·AI 모델)은 `podview-settings` Secret에 있어 유지됩니다.

## 9. 문제 해결

| 증상 | 확인 |
|---|---|
| Pod가 CrashLoopBackOff | `kubectl -n podview logs deploy/podview` — 대부분 Secret 누락/형식 오류 (예: `AUTH_ENABLED=true`인데 인증 수단 없음) |
| 로그인 후 Pod 목록이 비어 있음 | RBAC 적용 여부: `kubectl auth can-i list pods --as=system:serviceaccount:podview:podview` |
| 실시간 갱신이 안 되고 새로고침해야 반영 | Ingress의 `proxy-buffering: off` 누락 (SSE가 버퍼에 갇힘) |
| SSO 버튼이 안 보임 | OIDC_* 환경변수 4개 미설정 — `kubectl -n podview logs`에서 "인증 활성화 oidc=false" 확인 |
| Keycloak 로그인 후 콜백 오류 | redirect-url과 Keycloak Valid redirect URIs 불일치, 또는 podview Pod에서 issuer URL 도달 불가 |
| 리소스 사용량 배너 표시 | metrics-server 미설치 — `kubectl top pods` 동작 여부로 확인 |
| 트래픽 흐름이 균일(실측 아님) | `PROMETHEUS_URL` 미설정 또는 Hubble 메트릭에 pod 컨텍스트 없음 |
| 원격 클러스터 "연결할 수 없습니다" | 게이트웨이 Pod에서 등록 URL 도달성 (DNS/egress/토큰) — 프록시 가이드의 문제 해결 표 참고 |
