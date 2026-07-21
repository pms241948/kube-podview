// Package web은 Vite로 빌드된 React 프론트엔드(dist/)를 바이너리에 임베드한다.
// 폐쇄망 배포를 위해 모든 정적 자원은 이 바이너리 하나에 포함된다.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// Register는 SPA 정적 파일 서빙을 등록한다.
// 존재하지 않는 경로는 index.html로 폴백한다 (클라이언트 라우팅 지원).
func Register(mux *http.ServeMux) {
	dist, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(dist))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if f, err := dist.Open(path); err == nil {
				_ = f.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// SPA 폴백
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}
