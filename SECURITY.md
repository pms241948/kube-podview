# Security Policy

[English](#english) | [한국어](#한국어)

## English

### Supported versions

Security fixes are made on the `main` branch and included in the next release. Please use the latest `main` (or the latest release, once releases are published).

### Reporting a vulnerability

**Don't open a public issue for security problems.** Report them privately instead:

1. Go to this repository's **Security** tab and choose **Report a vulnerability** (GitHub private vulnerability reporting).
2. Include what you can of the following:
   - affected version or commit
   - steps to reproduce, or a proof of concept
   - impact (what an attacker can read, change, or break)
   - your deployment setup if relevant (auth method, multi-cluster gateway, AI analysis endpoint)

You'll get an acknowledgement within 7 days. Once the issue is confirmed, a fix is prepared privately and the advisory is published together with the fix. You'll be credited in the advisory unless you'd rather not be.

### Scope

In scope:

- authentication and session handling (local ID/password, Keycloak OIDC, session cookies)
- authorization (admin vs. viewer roles, `/api/admin/*`)
- the multi-cluster gateway (`/proxy/{cluster}`, `GATEWAY_TOKEN`)
- exposure of Kubernetes data beyond what the read-only ClusterRole in `deploy/rbac.yaml` allows
- leaking secret values (environment variables sourced from Secrets, tokens, API keys) to the browser or to the AI analysis endpoint
- vulnerable dependencies that are reachable from podview's code

Out of scope:

- running with `AUTH_ENABLED=false` (the binary default, meant for local development only — the manifests in `deploy/` enable authentication)
- issues that require cluster-admin access or control of the podview ServiceAccount
- the content of reports returned by an AI model you configured

### Hardening tips

- Keep `AUTH_ENABLED=true` and serve podview over HTTPS (`COOKIE_SECURE=true`).
- Use a long random `COOKIE_SECRET` and `GATEWAY_TOKEN` (`openssl rand -hex 32`), and a different `GATEWAY_TOKEN` per remote cluster.
- Restrict network access to remote podview instances to the gateway (see the multi-cluster proxy guide).

## 한국어

### 지원 버전

보안 수정은 `main` 브랜치에 반영되고 다음 릴리스에 포함됩니다. 최신 `main`(릴리스를 배포한 뒤에는 최신 릴리스)을 사용하세요.

### 취약점 신고

**보안 문제는 공개 이슈로 올리지 말고** 비공개로 신고해 주세요.

1. 이 저장소의 **Security** 탭에서 **Report a vulnerability**를 선택합니다 (GitHub 비공개 취약점 신고).
2. 가능한 범위에서 다음 내용을 적어 주세요.
   - 영향받는 버전 또는 커밋
   - 재현 방법 또는 PoC
   - 영향 (공격자가 읽거나 바꾸거나 망가뜨릴 수 있는 것)
   - 관련 있다면 배포 구성 (인증 방식, 멀티클러스터 게이트웨이, AI 분석 엔드포인트)

7일 안에 접수 확인 답변을 드립니다. 문제가 확인되면 비공개로 수정본을 준비하고, 수정본과 함께 보안 공지(advisory)를 공개합니다. 원하지 않으시는 경우가 아니면 공지에 신고자를 기재합니다.

### 대상 범위

대상:

- 인증과 세션 처리 (로컬 ID/PW, Keycloak OIDC, 세션 쿠키)
- 권한 (admin/viewer 역할, `/api/admin/*`)
- 멀티클러스터 게이트웨이 (`/proxy/{cluster}`, `GATEWAY_TOKEN`)
- `deploy/rbac.yaml`의 읽기 전용 ClusterRole이 허용하는 범위를 넘어선 Kubernetes 데이터 노출
- 시크릿 값(Secret에서 가져온 환경변수, 토큰, API 키)이 브라우저나 AI 분석 엔드포인트로 새어 나가는 문제
- podview 코드에서 실제로 호출되는 의존성의 취약점

대상 아님:

- `AUTH_ENABLED=false`로 실행하는 경우 (바이너리 기본값이며 로컬 개발용 — `deploy/`의 매니페스트는 인증을 켭니다)
- cluster-admin 권한이나 podview ServiceAccount 제어권이 있어야 가능한 문제
- 직접 등록한 AI 모델이 돌려준 보고서의 내용

### 보안 강화 팁

- `AUTH_ENABLED=true`를 유지하고 HTTPS로 서비스하세요 (`COOKIE_SECURE=true`).
- `COOKIE_SECRET`과 `GATEWAY_TOKEN`은 길고 무작위한 값(`openssl rand -hex 32`)을 쓰고, 원격 클러스터마다 다른 `GATEWAY_TOKEN`을 쓰세요.
- 원격 podview 인스턴스에는 게이트웨이만 접근할 수 있도록 네트워크를 제한하세요 (멀티클러스터 프록시 구성 가이드 참고).
