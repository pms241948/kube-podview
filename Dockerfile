# 빌드 이미지는 보안 패치가 들어간 버전으로 고정한다 (떠다니는 태그는 로컬 캐시의 옛 이미지가 쓰일 수 있음).
# 패치 릴리스가 나오면 아래 버전을 올린다: Node.js 24 LTS ≥ 24.22.1, Go ≥ 1.26.10 (go.mod와 맞춤).

# ── 1단계: 프론트엔드 빌드 ──────────────────────────────
FROM node:24.22.1-alpine AS frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── 2단계: 백엔드 빌드 (프론트엔드 임베드) ──────────────
FROM golang:1.26.10-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /app/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /podview ./cmd/server

# ── 3단계: 실행 이미지 ──────────────────────────────────
# 정적 Go 바이너리라 OpenSSL 등 OS 라이브러리를 쓰지 않으므로 Debian 13 기반으로 그대로 교체 가능
FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=backend /podview /podview
EXPOSE 8080
ENTRYPOINT ["/podview"]
