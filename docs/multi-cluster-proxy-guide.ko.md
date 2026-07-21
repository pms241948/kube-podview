# 멀티클러스터 프록시 구성 가이드

[English](multi-cluster-proxy-guide.md) | **한국어**

여러 (폐쇄)망에 각각 설치된 podview를 하나의 웹에서 통합 조회하기 위한 nginx 프록시 구성 가이드입니다.

## 전체 구조

```
                        [관리자 브라우저]
                              │  로그인 1회
                              ▼
              ┌─ 메인 망 ────────────────────────────────┐
              │  podview.example.com                     │  ← 게이트웨이 podview
              │        │ (서버 측 중계, GATEWAY_TOKEN)     │
              │        ▼                                  │
              │  [메인 망 nginx 망간 프록시]               │
              │   podview-net-a.example.com ─────────────┼──→ A망  podview.net-a.internal
              │   podview-net-b.example.com ─────────────┼──→ B망  podview.net-b.internal
              └────────────────────────────────────────────┘
```

핵심 원칙:

- **사용자는 게이트웨이(`podview.example.com`) 한 곳에만 접속·로그인**합니다. 상단 드롭다운으로 클러스터를 전환합니다.
- 게이트웨이 → 원격 podview 중계는 **브라우저가 아니라 게이트웨이 Pod(서버)에서** 일어납니다.
  따라서 프록시 주소는 *게이트웨이 Pod가 도달 가능한 주소*여야 합니다 (클러스터 내부 DNS 해석 + egress 허용).
- 게이트웨이 → 원격 인증은 사용자 세션과 무관한 **`GATEWAY_TOKEN`**(서버 간 Bearer 토큰)으로 합니다.
  브라우저 쿠키는 원격으로 전달되지 않습니다.

## 1단계 — 각 망에 podview 배포

모든 망에 동일 이미지로 `deploy/` 매니페스트를 적용합니다. 차이는 환경변수뿐입니다.

**원격이 될 인스턴스 (A망, B망):**

```bash
# 토큰 생성 (망마다 다르게)
openssl rand -hex 32
```

`podview-auth` Secret에 `gateway-token` 키로 넣습니다. 최소 구성은 다음이면 충분합니다:

| 환경변수 | 값 |
|---|---|
| `AUTH_ENABLED` | `true` |
| `COOKIE_SECRET` | 임의 값 (`openssl rand -hex 32`) |
| `GATEWAY_TOKEN` | 위에서 생성한 토큰 |

> 원격 인스턴스에는 로컬 계정/Keycloak을 설정하지 않아도 됩니다.
> 토큰 없는 접근은 전부 401로 차단되고, 게이트웨이의 중계 요청만 통과합니다.
> 해당 망 내부 사용자가 직접 쓰게 하려면 로컬 계정/Keycloak을 병행 설정하면 됩니다.

**게이트웨이 인스턴스 (메인 망):**

관리자 로그인 수단(로컬 계정 `LOCAL_USERS` 또는 Keycloak)을 설정합니다. `GATEWAY_TOKEN`은 필요 없습니다.

## 2단계 — 메인 망 nginx 망간 프록시 설정

원격 podview마다 호스트명 기반 프록시를 추가합니다.

```nginx
# A망 podview 중계
server {
    listen 443 ssl;
    server_name podview-net-a.example.com;

    ssl_certificate     /etc/nginx/certs/podview-net-a.example.com.crt;
    ssl_certificate_key /etc/nginx/certs/podview-net-a.example.com.key;

    location / {
        proxy_pass https://podview.net-a.internal;

        # ★ 필수 1: 원격 망의 Ingress는 Host 헤더로 라우팅하므로 대상 호스트명으로 재작성
        proxy_set_header Host podview.net-a.internal;

        # ★ 필수 2: SSE(실시간 갱신)·로그 follow는 장기 스트리밍 연결
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_http_version 1.1;

        # 권장: 접속자 정보 전달 (원격 podview 로그에 기록)
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# B망 podview 중계 (동일 패턴)
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

체크리스트:

- [ ] `podview-net-a.example.com` / `podview-net-b.example.com`이 **메인 망 DNS**에 등록되어 있고,
      특히 **게이트웨이 Pod 내부에서** 해석되는지 확인
      (distroless 이미지는 셸이 없으므로 임시 디버그 Pod에서:
      `kubectl run dns-test --rm -it --image=busybox -- nslookup podview-net-a.example.com`)
- [ ] 게이트웨이 클러스터의 egress 정책이 nginx 프록시로의 통신을 허용하는지
- [ ] upstream(원격 Ingress)이 사설 CA 인증서면 nginx가 신뢰하는지 (`proxy_ssl_trusted_certificate`)

## 3단계 — 게이트웨이 웹에서 클러스터 등록

1. `https://podview.example.com` 접속 → admin 계정 로그인
2. 우측 상단 **⚙(관리자 설정)** → **클러스터 관리**
3. 등록:

| 이름 (관리자 자유) | URL | 토큰 |
|---|---|---|
| net-a | `https://podview-net-a.example.com` | A망 인스턴스의 GATEWAY_TOKEN |
| net-b | `https://podview-net-b.example.com` | B망 인스턴스의 GATEWAY_TOKEN |

4. 상단 드롭다운에서 클러스터를 선택하면 해당 망의 Pod 상태·토폴로지·로그가 표시됩니다.

등록 정보는 게이트웨이 네임스페이스의 `podview-settings` Secret에 저장되므로 Pod가 재시작해도 유지됩니다.

## 보안 강화 (권장)

`podview-net-*` 프록시 주소는 게이트웨이가 서버 측에서만 사용하는 경로입니다.
일반 사용자의 직접 접근을 막으려면 nginx에서 소스 IP를 제한합니다:

```nginx
location / {
    # 게이트웨이 클러스터의 egress IP 대역만 허용
    allow 10.10.0.0/16;
    deny all;
    ...
}
```

- 토큰은 망마다 다르게 발급하고, 유출 시 해당 망의 Secret만 교체 후 게이트웨이에서 재등록하면 됩니다.
- 게이트웨이의 viewer 계정도 등록된 모든 클러스터를 조회할 수 있습니다.
  클러스터별 접근 제한이 필요하면 별도 기능 추가가 필요합니다.

## 문제 해결

| 증상 | 원인/확인 |
|---|---|
| 드롭다운 선택 시 "클러스터에 연결할 수 없습니다" | 게이트웨이 Pod에서 URL 도달 불가 — DNS, egress, nginx 기동 여부 확인. 게이트웨이 Pod에서 `curl <URL>/api/healthz` |
| 404 또는 다른 서비스 응답이 옴 | nginx `proxy_set_header Host`가 빠졌거나 잘못됨 (원격 Ingress가 Host로 라우팅) |
| Pod 목록은 나오는데 실시간 갱신이 안 됨 | `proxy_buffering off` 누락 — SSE가 버퍼에 갇힘 |
| 잠시 후 연결이 끊기고 새로고침해야 함 | `proxy_read_timeout`이 짧음 (기본 60s) — 3600s로 연장 |
| 401 unauthorized | 등록한 토큰과 원격 인스턴스의 `GATEWAY_TOKEN` 불일치 |
| TLS 오류 | 원격 Ingress의 사설 CA를 nginx가 신뢰하지 않음 — `proxy_ssl_trusted_certificate` 설정 |

## 참고: 요청 흐름 상세

```
브라우저 ── GET /proxy/net-a/api/pods (세션 쿠키) ──→ 게이트웨이 podview
                                                          │ 1. 세션 검증
                                                          │ 2. 쿠키 제거, Authorization: Bearer <토큰> 부착
                                                          │ 3. 경로에서 /proxy/net-a 제거
                                                          ▼
                                            https://podview-net-a.example.com/api/pods
                                                          │ (메인 망 nginx, Host 재작성)
                                                          ▼
                                     A망 Ingress → podview Pod → 토큰 검증 → 응답
```
