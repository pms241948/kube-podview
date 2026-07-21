// Package gateway는 다른 폐쇄망의 podview 인스턴스로 요청을 중계한다.
//
//	GET /proxy/{cluster}/api/...  →  <원격 URL>/api/...  (Bearer GATEWAY_TOKEN)
//
// SSE·로그 follow 같은 스트리밍 응답도 그대로 통과시킨다 (FlushInterval=-1).
package gateway

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/pms241948/CC-K8s-podview/internal/store"
)

type Gateway struct {
	settings *store.Manager
}

func New(settings *store.Manager) *Gateway {
	return &Gateway{settings: settings}
}

func (g *Gateway) Register(mux *http.ServeMux) {
	mux.HandleFunc("/proxy/{cluster}/", g.handleProxy)
}

func (g *Gateway) handleProxy(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("cluster")

	var target *store.Cluster
	for _, c := range g.settings.Get().Clusters {
		if c.Name == name {
			target = &c
			break
		}
	}
	if target == nil {
		http.Error(w, "등록되지 않은 클러스터: "+name, http.StatusNotFound)
		return
	}

	base, err := url.Parse(target.URL)
	if err != nil {
		http.Error(w, "클러스터 URL이 잘못되었습니다", http.StatusBadGateway)
		return
	}

	prefix := "/proxy/" + name
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(base)
			pr.Out.URL.Path = strings.TrimPrefix(pr.In.URL.Path, prefix)
			if pr.Out.URL.Path == "" {
				pr.Out.URL.Path = "/"
			}
			// 원격 인스턴스에는 서비스 토큰으로 인증하고, 브라우저 쿠키는 넘기지 않는다.
			pr.Out.Header.Del("Cookie")
			if target.Token != "" {
				pr.Out.Header.Set("Authorization", "Bearer "+target.Token)
			}
		},
		FlushInterval: -1, // SSE/로그 스트리밍 즉시 플러시
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			slog.Warn("클러스터 프록시 실패", "cluster", name, "error", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"클러스터에 연결할 수 없습니다"}`))
		},
	}
	proxy.ServeHTTP(w, r)
}
