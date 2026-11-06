# K8s PodView

[English](README.md) | **한국어**

Kubernetes 클러스터의 **네임스페이스별 Pod 상태를 실시간으로 시각화**하는 웹 서비스입니다. 폐쇄망/온프렘 환경(외부 CDN·인터넷 의존 없음)을 염두에 두고 설계했습니다.

## 주요 기능

- **네임스페이스별 Pod 상태 조회** — Running / Pending / CrashLoopBackOff 등 상태를 색상으로 표시
- **문제 Pod 필터와 발생 시점 강조** — "이상 N" 클릭으로 문제 Pod만 보기(최근 발생순 정렬). Pod 카드는 발생 시점 배지, 토폴로지는 24시간 이내 발생 Pod에 맥동 후광을 둘러 방치된(만성) Pod보다 강조
- **네임스페이스 요약 카드 → 토폴로지** — 전체 화면은 네임스페이스별 요약 카드(상태별 개수 칩·최근 문제 Pod 이름·CPU/메모리 합계), 카드를 누르면 해당 네임스페이스의 토폴로지로, 문제 Pod를 누르면 바로 상세 패널로 이동
- **토폴로지 뷰** — Ingress→Service→Pod(노드별 배치) 계층을 애니메이션으로 시각화, Pod에 CPU 사용량 링 표시
- **토폴로지 배치 조정** — 노드 박스를 드래그로 이동, 핸들로 폭·높이 조절(Pod 자동 재정렬). 배치는 브라우저에 저장되며 초기화 가능
- **실측 트래픽 (선택)** — Prometheus 연동 시 흐름 애니메이션의 **점 속도·개수(1~4개)가 실측 트래픽량에 비례**하고, 트래픽 없는 경로는 흐리게 표시. Pod↔Pod 실측 플로우 곡선과 송수신량 툴팁 제공. CNI 무관 설계 (아래 참고)
- **실시간 갱신** — K8s Watch(인포머) → SSE로 변경 사항이 즉시 화면에 반영
- **Pod 로그 보기** — 컨테이너 선택, 실시간 follow 지원
- **Pod 환경 정보** — 환경변수(시크릿 값은 출처만 표시), 포트, 볼륨, 컨디션, K8s 이벤트
- **리소스 사용량** — metrics-server 연동으로 Pod/컨테이너별 CPU·메모리 표시 (미설치 시 자동 비활성화)
- **GPU** — Pod의 GPU 할당 개수(nvidia/amd/intel/habana 확장 리소스)는 기본 표시, DCGM Exporter가 있으면 실측 사용률·GPU 메모리를 링/배지로 표시
- **이중 인증 방식** — Keycloak SSO(OIDC)와 로컬 ID/PW(bcrypt) 중 하나 이상 선택, 병행 가능
- **멀티클러스터 게이트웨이** — 다른 (폐쇄)망의 podview 인스턴스를 등록하면 하나의 웹에서 클러스터를 선택해 조회
- **관리자 설정 탭** — 클러스터 등록(이름·URL·토큰), 로컬 계정·SSO 사용자 역할(admin/viewer), AI 분석 엔드포인트를 웹에서 관리
- **AI 분석 (선택)** — 자체 LLM 엔드포인트를 등록하면 Pod 상세에서 상태·이벤트·로그 기반 장애 분석 보고서를 생성
- **화면 언어 (English / 한국어)** — 기본은 영어. 설정(⚙) → 일반 또는 로그인 화면에서 바꾸며 브라우저에 저장. 서버 오류 메시지와 AI 분석 보고서 언어에도 적용

## 화면 구성

| 화면 | 내용 |
|---|---|
| 로그인 | podview 자체 ID/PW 폼 + 아래 **SSO(Keycloak) 로그인** 버튼 (설정된 방식만 노출) |
| 사이드바 | 네임스페이스 목록 + 실시간 검색 + 문제 Pod 수 빨간 배지(15초 갱신). « 버튼으로 접어서 모니터링 영역 확대, 오른쪽 가장자리 드래그로 폭 조절(160~480px) — 모두 저장됨 |
| 전체 네임스페이스 (개요) | 네임스페이스 요약 카드 그리드 — 상태별 개수 칩(0이 아닌 상태만, 오류→대기→정상→완료 순), 최근 문제 Pod 최대 2개(이름·상태·발생 시점, 나머지는 "외 N개"), CPU·메모리 합계, GPU 할당 수. 문제 있는 네임스페이스가 최근 발생순으로 위에 표시. 카드 클릭 시 해당 네임스페이스 토폴로지로, 문제 Pod 클릭 시 바로 상세 패널로 이동. 상단 필터로 **전체 / 문제 있음 / 최근 24시간**(만성 문제만 있는 곳 제외) 중 선택, "빈 네임스페이스 숨기기" 지원(선택은 브라우저에 저장). "이상 N" 또는 검색 시 클러스터 전체에서 해당 Pod 카드(상태 색상, Ready/재시작/Age, CPU·메모리, GPU, 발생 시점 배지)를 표시 |
| 토폴로지 뷰 (네임스페이스 선택 시) | Ingress→Service→노드→**네임스페이스 박스**→Pod 계층. 라우팅 흐름 애니메이션(Not Ready는 빨간 점선), CPU 링(파랑·상대)·GPU 링(녹색·절대 %), 24시간 이내 발생 문제 Pod 맥동 후광 강조. 노드·네임스페이스 박스·Pod·플로우 선 호버 시 관련 요소와 사이드바 네임스페이스 동시 강조. 노드 박스는 드래그 이동·크기 조절(Pod 자동 재정렬, 배치 저장/초기화). Prometheus 연동 시 점 속도·개수가 실측 트래픽 반영. 검색어와 일치하지 않는 Pod는 흐리게 |
| Pod 상세 패널 | 정보 / 환경(환경변수·포트·볼륨) / 로그(실시간 follow) / 이벤트(K8s 이벤트·컨디션) / AI 분석(모델 선택 가능) 탭 |
| 설정 (⚙) | 모든 사용자: 일반(화면 언어). admin 역할만: 클러스터 등록·삭제, 로컬 계정 관리, SSO 사용자 역할 지정, AI 모델 등록·수정·삭제·기본 지정 |
| 상단바 | 클러스터 선택 드롭다운, "이상 N" 문제 필터 토글, Pod 이름/상태 검색, 실시간 연결 상태, 로그아웃 |

## 문제 Pod 판정 기준

- **문제 Pod**: Running+전체 Ready 또는 정상 종료(Succeeded/Completed)가 아닌 모든 Pod
- **발생 시점**: Ready 컨디션이 False로 전환된 시각. 단, 재시작 5회 이상(크래시 루프)은 Ready가 사이클마다 갱신되어 항상 "방금 발생"으로 보이므로 Pod 시작 시각 기준으로 판정 — 오래 방치된 크래시 루프가 만성으로 올바르게 분류됩니다
- **분류와 강조**: 1시간 이내(fresh — 긴급) / 24시간 이내(recent) / 만성(chronic — 24시간 초과, 알고 방치 중)
  - 카드: 네임스페이스 카드와 Pod 카드에 발생 시점 배지 — 빨강(fresh)/주황(recent)/회색(만성)
  - 토폴로지 뷰: fresh·recent는 맥동 후광 링으로 강조(fresh가 더 빠른 맥동), 만성은 후광 없이 흐리게 → 새로 터진 장애가 방치된 Pod보다 눈에 띔

## 아키텍처

```
                          [브라우저]
                              │ 로그인 1회 (로컬 ID/PW 또는 Keycloak OIDC)
                              ▼
 ┌─ 메인 망 ────────────────────────────────────────────┐
 │  podview (게이트웨이)                                  │
 │   ├─(Watch/List)→ K8s API        ← 자기 클러스터 조회   │
 │   ├─(폴링)→ metrics-server        ← CPU/메모리          │
 │   ├─(폴링)→ Prometheus            ← 트래픽·GPU(DCGM)    │
 │   └─(/proxy/{클러스터}, GATEWAY_TOKEN)                 │
 │         │                                             │
 └─────────┼─────────────────────────────────────────────┘
           │ nginx 망간 프록시
           ├──────────→ [다른 망 podview] ──→ 그 망의 K8s API
           └──────────→ [또다른 망 podview] ─→ 그 망의 K8s API
```

- 백엔드: Go + client-go (공유 인포머로 API 서버 부하 최소화), SSE로 실시간 푸시
- 프론트엔드: React + Vite → `go:embed`로 바이너리에 포함 (**외부 CDN 의존 없음, 폐쇄망 대응**)
- 배포: distroless 기반 단일 컨테이너 이미지, 읽기 전용 ClusterRole
- 외부 연동(Prometheus·DCGM·Hubble)은 전부 선택 사항 — 미설정 시 해당 기능만 조용히 비활성화

## 로컬 개발

Go 1.26.10+, Node 24.22.1+ 필요 (보안 패치 버전).

```bash
# 전체 빌드 후 실행 (현재 kubeconfig 컨텍스트 사용, 인증 비활성화)
make run

# 프론트엔드 개발 서버 (백엔드 :8080 프록시)
cd web && npm run dev
```

## 빌드 및 폐쇄망 반입

```bash
make docker IMAGE=k8s-podview TAG=v0.1.0

# 반입: 이미지를 tar로 저장 → 반입 → 내부 레지스트리에 push
docker save k8s-podview:v0.1.0 -o podview.tar
# (반입 후)
docker load -i podview.tar
docker tag k8s-podview:v0.1.0 registry.example.com/k8s-podview:v0.1.0
docker push registry.example.com/k8s-podview:v0.1.0
```

반입할 이미지는 **podview 앱 1개**뿐입니다. Prometheus·Keycloak·metrics-server·DCGM·LLM은 외부 구성요소로, 설정으로 주소만 연결하며 추가 이미지가 없습니다. [설치 가이드](docs/install-guide.ko.md) 참고.

## 클러스터 배포

> 이미지 반입부터 기능별 연동까지 전체 절차는 **[설치 가이드](docs/install-guide.ko.md)** 에 단계별로 정리되어 있습니다.

1. 인증 방식 결정 (아래 "인증과 계정 관리" 참고) 후 `deploy/secret-example.yaml`을 실제 값으로 채워 적용
2. `deploy/deployment.yaml`의 이미지 주소를 내부 레지스트리로 수정
3. 적용:

```bash
kubectl apply -f deploy/rbac.yaml
kubectl apply -f deploy/secret.yaml        # secret-example.yaml을 채운 파일
kubectl apply -f deploy/deployment.yaml
kubectl apply -f deploy/ingress.yaml       # 호스트명 수정 후
```

## 인증과 계정 관리

로그인 방식은 두 가지이며 병행 가능합니다. 로그인 페이지(`/login`)에는 설정된 방식만 노출되고,
OIDC만 설정된 경우 로그인 페이지를 거치지 않고 바로 Keycloak으로 이동합니다.

**역할 체계** — 모든 계정은 `admin`(관리자 설정 접근 가능) 또는 `viewer`(조회만) 역할을 가집니다.

| 계정 유형 | 등록 방법 | 역할 |
|---|---|---|
| 부트스트랩 계정 | `LOCAL_USERS` 환경변수 | 항상 admin |
| 웹 관리 계정(로컬) | 관리자 설정(⚙) → 사용자 관리에서 추가/삭제/비밀번호 재설정 | 등록 시 지정 |
| Keycloak(SSO) 사용자 | 관리자 설정(⚙) → SSO 사용자 역할에서 이메일별 지정 | 지정 시 admin/viewer, 미지정 시 viewer |

**SSO 사용자 역할 지정** — SSO 사용자는 로그인해야 계정이 생기므로, 관리자 설정의 **SSO 사용자 역할**에
이메일을 미리 등록해 admin/viewer를 지정합니다. 로그인 시 역할 결정 우선순위:

1. `OIDC_ADMIN_EMAILS` 환경변수 (배포 시 지정하는 부트스트랩 관리자 — UI에서 강등 불가)
2. 관리자 설정에 등록된 이메일별 역할
3. 둘 다 없으면 `viewer`

보통 **최초 관리자 한두 명만 `OIDC_ADMIN_EMAILS`로 잡고, 나머지 SSO 사용자 역할은 웹에서 관리**합니다.

### Keycloak 클라이언트 설정

1. 사용할 Realm에서 **Clients → Create client**
   - Client type: `OpenID Connect`, Client ID: `podview`
   - **Client authentication: On** (confidential)
2. **Valid redirect URIs**: `https://podview.example.com/auth/callback`
3. Credentials 탭의 Client Secret을 `deploy/secret.yaml`의 `client-secret`에 입력
4. `issuer-url`은 `https://<keycloak 호스트>/realms/<realm 이름>` 형식
5. 최초 관리자 이메일만 `OIDC_ADMIN_EMAILS`에 등록(부트스트랩), 이후 SSO 사용자 역할은 관리자 설정(⚙)에서 관리

### 로컬 ID/PW 부트스트랩 계정

```bash
# bcrypt 해시 생성
go run ./cmd/hashpw 비밀번호
# → $2a$10$...

# 환경변수로 지정 (쉼표로 여러 명)
LOCAL_USERS="admin:$2a$10$..."

# 또는 파일로 지정 (줄마다 "이름:해시", # 주석 가능)
LOCAL_USERS_FILE=/etc/podview/users
```

최초 관리자 계정만 환경변수로 만들고, 이후 일반 계정은 웹의 관리자 설정에서 관리하는 것을 권장합니다
(웹에서 추가하는 계정은 서버가 bcrypt 해시를 생성하므로 `hashpw` 도구가 필요 없습니다).

## 멀티클러스터 (여러 망 통합 조회)

각 망에 podview를 배포한 뒤, 관리자가 접속하는 "게이트웨이" 인스턴스의 관리자 설정(⚙)에서
다른 망의 podview를 등록하면 상단 드롭다운으로 클러스터를 전환하며 조회할 수 있습니다.

```
[브라우저] ── [메인 망 podview(게이트웨이)] ── nginx 망간 프록시 ── [다른 망 podview]
```

1. **원격 망 인스턴스**: `GATEWAY_TOKEN=<임의의 긴 토큰>` 설정 (`openssl rand -hex 32`).
   게이트웨이가 이 토큰의 Bearer 헤더로 인증하므로 원격 인스턴스에 별도 계정이 없어도 됩니다.
2. **게이트웨이 인스턴스**: 관리자 설정 → 클러스터 관리에서 이름(예: "cluster-2"),
   URL(망간 프록시로 도달 가능한 주소), 해당 인스턴스의 GATEWAY_TOKEN을 등록.
3. 망간 nginx에는 SSE/로그 스트리밍을 위해 `proxy_buffering off`와 긴 `proxy_read_timeout`이 필요합니다
   (`deploy/ingress.yaml`의 어노테이션과 동일한 설정).

망간 nginx 프록시 설정 방법과 상세 절차는 **[멀티클러스터 프록시 구성 가이드](docs/multi-cluster-proxy-guide.ko.md)** 를 참고하세요.

로그인은 게이트웨이에서 한 번만 하며, 웹에서 변경한 설정은 클러스터 안에서는 `podview-settings` Secret에, 로컬 실행 시에는 `DATA_DIR/settings.json`에 저장됩니다.

## AI 분석 연동 (선택)

관리자 설정(⚙) → **AI 분석 설정**에 자체 LLM 엔드포인트를 등록하면 Pod 상세에 **AI 분석** 탭이 활성화됩니다.
모델은 **여러 개 등록**할 수 있고(추가/수정/삭제), 그중 하나를 **기본**으로 지정합니다.
분석 탭의 드롭다운에서 실행할 모델을 선택할 수 있어 모델별 분석 결과를 비교할 수 있습니다.
분석 실행 시 백엔드가 Pod의 상태·컨테이너·컨디션·K8s 이벤트·최근 로그(컨테이너당 80줄, 크래시 시 직전 로그 포함)를
수집해 모델에 보내고, 상태 요약·원인 분석·권장 조치 형식의 보고서를 받습니다 (보고서 언어는 화면 언어를 따름).
**환경변수 값 등 민감정보는 전송하지 않습니다.**

| 설정 | 내용 |
|---|---|
| 프로바이더 | `openai` — vLLM·Ollama·LiteLLM 등 OpenAI Chat Completions 호환 API (기본) / `anthropic` — Anthropic Messages API 형식 |
| URL | 베이스 주소만 (예: `http://vllm.ai-infra:8000`) — 경로(`/v1/chat/completions` 또는 `/v1/messages`)는 자동으로 붙습니다 |
| 모델 | 서빙 중인 모델 이름 |
| API 키 | 선택 (openai: `Authorization: Bearer`, anthropic: `x-api-key`로 전송) |

설정은 인스턴스별입니다 — 멀티클러스터 구성에서 원격 클러스터의 Pod를 분석하면
해당 망 인스턴스에 등록된 모델이 사용되므로, 망마다 자기 모델 엔드포인트를 등록하면 됩니다.

## 실측 트래픽 연동 (선택)

토폴로지의 기본 연결선은 셀렉터 기반 **라우팅 경로**입니다. 실제 트래픽을 보려면 Prometheus를 연동합니다.
Prometheus를 공용 연동 지점으로 삼아 **CNI에 종속되지 않습니다**:

| 데이터 | 출처 | 요구사항 |
|---|---|---|
| Pod별 송수신 바이트/초 | kubelet cAdvisor 메트릭 | Prometheus만 있으면 됨 (모든 CNI) |
| Pod간 플로우 (누가↔누구) | Hubble(Cilium) 또는 Retina 등 eBPF 도구의 Prometheus 메트릭 | 해당 도구 설치 |

```bash
# 최소 설정 — Pod별 송수신량 표시
PROMETHEUS_URL=http://prometheus.monitoring:9090

# Cilium + Hubble 환경 — Pod간 플로우까지 표시.
# Hubble 메트릭에 pod 컨텍스트 활성화 필요:
#   hubble.metrics.enabled[flow]: sourceContext=namespace|pod;destinationContext=namespace|pod
# 기본 쿼리는 hubble_flows_processed_total 기준이며, 다른 도구(Retina 등)를 쓰면
# source/destination 레이블이 "네임스페이스/파드" 형태가 되도록 쿼리를 교체:
TRAFFIC_EDGE_QUERY='sum by (source, destination) (rate(hubble_flows_processed_total{source!="",destination!=""}[2m]))'
TRAFFIC_EDGE_UNIT='flows/s'
```

연동되면 토폴로지에서 **점 속도와 개수(1~4개)가 트래픽량에 비례**해 빨라지고 늘어나며,
초당 50B 미만인 경로는 점이 사라지고 선이 흐려져 "설정만 있고 안 쓰이는 경로"를 식별할 수 있습니다.
Pod↔Pod 실측 곡선도 같은 방식(고정 굵기 + 점 속도·개수)으로 표시되고 정확한 수치는 툴팁에 나옵니다.

`PROMETHEUS_URL`이 없으면 이 기능은 조용히 꺼지고(균일한 구조도 애니메이션 유지), Hubble 메트릭이 없는 클러스터에서는 Pod 송수신량만 표시됩니다.

### GPU 사용량 (DCGM Exporter)

`PROMETHEUS_URL`이 설정되어 있고 DCGM Exporter 메트릭이 수집되고 있으면 GPU 사용률/메모리가 자동 표시됩니다.
DCGM Exporter의 Kubernetes 연동(Pod 귀속)이 켜져 있어야 `namespace`/`pod` 레이블이 붙습니다
(GPU Operator 기본 구성이면 활성화되어 있음). 기본 쿼리:

```
GPU_UTIL_QUERY: avg by (namespace, pod) (DCGM_FI_DEV_GPU_UTIL{pod!=""})
GPU_MEM_QUERY:  sum by (namespace, pod) (DCGM_FI_DEV_FB_USED{pod!=""}) * 1024 * 1024
```

NVIDIA가 아닌 GPU(AMD ROCm 등)는 위 두 쿼리를 해당 exporter 메트릭으로 교체하면 됩니다.
GPU 할당 개수 배지는 Prometheus 없이도 Pod 스펙(limits)에서 읽어 항상 표시됩니다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | 서버 리슨 주소 |
| `KUBECONFIG` | (in-cluster) | 클러스터 외부 실행 시 kubeconfig 경로 |
| `AUTH_ENABLED` | `false` | 인증 활성화 여부 (OIDC 또는 로컬 중 하나 이상 필요) |
| `COOKIE_SECRET` | - | 세션 쿠키 서명 키 (`openssl rand -hex 32`) |
| `COOKIE_SECURE` | `true` | HTTPS 전용 쿠키 (http 테스트 시에만 `false`) |
| `OIDC_ISSUER_URL` | - | Keycloak realm issuer URL |
| `OIDC_CLIENT_ID` | - | 클라이언트 ID |
| `OIDC_CLIENT_SECRET` | - | 클라이언트 시크릿 |
| `OIDC_REDIRECT_URL` | - | `https://<호스트>/auth/callback` |
| `OIDC_ADMIN_EMAILS` | - | admin 역할을 줄 OIDC 이메일 (쉼표 구분) |
| `LOCAL_USERS` | - | 로컬 사용자 목록 `이름:bcrypt해시,...` |
| `LOCAL_USERS_FILE` | - | 로컬 사용자 파일 경로 |
| `PROMETHEUS_URL` | - | 실측 트래픽용 Prometheus 주소 (비우면 비활성) |
| `TRAFFIC_EDGE_QUERY` | (Hubble 기본) | Pod간 플로우 PromQL |
| `TRAFFIC_EDGE_UNIT` | `flows/s` | 플로우 표시 단위 |
| `GPU_UTIL_QUERY` | (DCGM 기본) | GPU 사용률 PromQL |
| `GPU_MEM_QUERY` | (DCGM 기본) | GPU 메모리 PromQL (바이트 결과) |
| `GATEWAY_TOKEN` | - | 게이트웨이의 중계 요청을 인증하는 토큰 (원격 인스턴스에 설정) |
| `POD_NAMESPACE` | - | 설정 Secret 네임스페이스 (Downward API로 주입) |
| `DATA_DIR` | `data` | 클러스터 밖 실행 시 설정 파일 디렉토리 |

## API

| 메서드/경로 | 설명 |
|---|---|
| `GET /api/namespaces` | 네임스페이스 목록 |
| `GET /api/pods?namespace=` | Pod 요약 목록 (생략 시 전체) |
| `GET /api/topology?namespace=` | 토폴로지 (노드/Pod/서비스 및 셀렉터 매칭) |
| `GET /api/events?namespace=` | SSE 스트림 (snapshot + 증분 이벤트) |
| `GET /api/namespaces/{ns}/pods/{pod}/logs?container=&tailLines=&follow=` | Pod 로그 |
| `GET /api/namespaces/{ns}/pods/{pod}/detail` | 환경변수·볼륨·컨디션·이벤트 |
| `GET /api/metrics/pods?namespace=` | Pod CPU/메모리 사용량 |
| `GET /api/traffic?namespace=` | 실측 트래픽 (Prometheus 연동 시) |
| `GET /api/gpu?namespace=` | Pod별 GPU 사용률/메모리 (DCGM) |
| `GET /api/healthz` | 헬스체크 (인증 제외) |
| `GET /auth/methods` | 사용 가능한 로그인 방식 |
| `POST /auth/local` | 로컬 ID/PW 로그인 |
| `GET /auth/login` `/auth/callback` | Keycloak OIDC 플로우 |
| `GET /auth/me` `/auth/logout` | 세션 확인 / 로그아웃 |
| `GET /api/clusters` | 등록된 클러스터 이름 목록 |
| `/proxy/{cluster}/...` | 원격 podview로 중계 (SSE 포함) |
| `GET·POST /api/admin/clusters` `DELETE /api/admin/clusters/{name}` | 클러스터 관리 (admin) |
| `GET·POST /api/admin/users` `DELETE /api/admin/users/{username}` | 로컬 사용자 관리 (admin) |
| `GET·POST /api/admin/oidc-users` `DELETE /api/admin/oidc-users/{email}` | SSO 사용자 역할 관리 (admin) |
| `GET /api/ai/status` | AI 분석 설정 여부 |
| `POST /api/namespaces/{ns}/pods/{pod}/analyze` | Pod AI 분석 실행 |
| `GET·POST /api/admin/ai` `DELETE /api/admin/ai/{name}` `POST /api/admin/ai/active` | AI 모델 관리 (admin) |

## 라이선스

MIT
