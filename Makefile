IMAGE ?= k8s-podview
TAG   ?= latest

.PHONY: all frontend backend build run docker clean

all: build

frontend:
	cd web && npm install && npm run build

backend:
	go build -o bin/podview ./cmd/server

## 프론트엔드 빌드 후 바이너리에 임베드하여 전체 빌드
build: frontend backend

## 로컬 실행 (kubeconfig 사용, 인증 비활성화)
run: build
	AUTH_ENABLED=false ./bin/podview

docker:
	docker build -t $(IMAGE):$(TAG) .

clean:
	rm -rf bin web/dist web/node_modules
