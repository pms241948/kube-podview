package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/pms241948/CC-K8s-podview/internal/k8s"
	"github.com/pms241948/CC-K8s-podview/internal/prom"
	"github.com/pms241948/CC-K8s-podview/internal/store"
)

// Server는 REST API 핸들러 집합이다.
type Server struct {
	clients  *k8s.Clients
	hub      *k8s.Hub
	traffic  *prom.Provider // nil이면 비활성
	settings *store.Manager
}

func New(clients *k8s.Clients, hub *k8s.Hub, trafficProvider *prom.Provider, settings *store.Manager) *Server {
	return &Server{clients: clients, hub: hub, traffic: trafficProvider, settings: settings}
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /api/namespaces", s.handleNamespaces)
	mux.HandleFunc("GET /api/pods", s.handlePods)
	mux.HandleFunc("GET /api/topology", s.handleTopology)
	mux.HandleFunc("GET /api/events", s.handleEvents)
	mux.HandleFunc("GET /api/namespaces/{ns}/pods/{pod}/logs", s.handleLogs)
	mux.HandleFunc("GET /api/namespaces/{ns}/pods/{pod}/detail", s.handleDetail)
	mux.HandleFunc("GET /api/metrics/pods", s.handlePodMetrics)
	mux.HandleFunc("GET /api/traffic", s.handleTraffic)
	mux.HandleFunc("GET /api/gpu", s.handleGPU)
	mux.HandleFunc("GET /api/ai/status", s.handleAIStatus)
	mux.HandleFunc("POST /api/namespaces/{ns}/pods/{pod}/analyze", s.handleAnalyze)
}

// handleGPU는 DCGM Exporter 메트릭 기반 Pod별 GPU 사용률/메모리를 반환한다.
func (s *Server) handleGPU(w http.ResponseWriter, r *http.Request) {
	if s.traffic == nil {
		writeJSON(w, map[string]any{"available": false, "items": []any{}})
		return
	}
	writeJSON(w, s.traffic.GPU(r.Context(), r.URL.Query().Get("namespace")))
}

// handleTraffic은 Prometheus에서 실측 트래픽(Pod 송수신량, Pod간 플로우)을 반환한다.
func (s *Server) handleTraffic(w http.ResponseWriter, r *http.Request) {
	if s.traffic == nil {
		writeJSON(w, map[string]any{"available": false, "podRates": []any{}, "edges": []any{}})
		return
	}
	writeJSON(w, s.traffic.Snapshot(r.Context(), r.URL.Query().Get("namespace")))
}

// handleTopology는 토폴로지 뷰용 노드/Pod/서비스 스냅샷을 반환한다.
func (s *Server) handleTopology(w http.ResponseWriter, r *http.Request) {
	topo, err := s.hub.Topology(r.URL.Query().Get("namespace"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, topo)
}

// handleDetail은 Pod의 환경변수·볼륨·컨디션·이벤트를 반환한다.
func (s *Server) handleDetail(w http.ResponseWriter, r *http.Request) {
	detail, err := s.hub.Detail(r.Context(), s.clients.Core, r.PathValue("ns"), r.PathValue("pod"))
	if err != nil {
		httpError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, detail)
}

func (s *Server) handleNamespaces(w http.ResponseWriter, _ *http.Request) {
	names, err := s.hub.Namespaces()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"namespaces": names})
}

func (s *Server) handlePods(w http.ResponseWriter, r *http.Request) {
	pods, err := s.hub.Pods(r.URL.Query().Get("namespace"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"pods": pods})
}

// handleEvents는 SSE로 Pod 변경 이벤트를 스트리밍한다.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, http.StatusInternalServerError, fmt.Errorf("스트리밍을 지원하지 않는 응답 writer"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, cancel := s.hub.Subscribe(r.URL.Query().Get("namespace"))
	defer cancel()

	// 접속 직후 현재 상태 스냅샷을 먼저 보낸다.
	if pods, err := s.hub.Pods(r.URL.Query().Get("namespace")); err == nil {
		writeSSE(w, "snapshot", map[string]any{"pods": pods})
		flusher.Flush()
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-ch:
			writeSSE(w, "pod", ev)
			flusher.Flush()
		}
	}
}

// handleLogs는 Pod 로그를 반환한다. follow=true면 스트리밍한다.
func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	ns, pod := r.PathValue("ns"), r.PathValue("pod")
	q := r.URL.Query()

	tailLines := int64(500)
	if t, err := strconv.ParseInt(q.Get("tailLines"), 10, 64); err == nil && t > 0 {
		tailLines = t
	}
	opts := &corev1.PodLogOptions{
		Container:  q.Get("container"),
		TailLines:  &tailLines,
		Follow:     q.Get("follow") == "true",
		Timestamps: q.Get("timestamps") == "true",
	}

	stream, err := s.clients.Core.CoreV1().Pods(ns).GetLogs(pod, opts).Stream(r.Context())
	if err != nil {
		httpError(w, http.StatusBadGateway, fmt.Errorf("로그 조회 실패: %w", err))
		return
	}
	defer stream.Close()

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Accel-Buffering", "no")
	if opts.Follow {
		flushCopy(r.Context(), w, stream)
	} else {
		_, _ = io.Copy(w, stream)
	}
}

// handlePodMetrics는 metrics-server에서 Pod별 CPU/메모리 사용량을 반환한다.
func (s *Server) handlePodMetrics(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	metricsList, err := s.clients.Metrics.MetricsV1beta1().PodMetricses(ns).List(r.Context(), metav1.ListOptions{})
	if err != nil {
		// metrics-server가 없는 클러스터에서도 나머지 기능은 동작해야 한다.
		slog.Warn("Pod 메트릭 조회 실패 (metrics-server 미설치?)", "error", err)
		writeJSON(w, map[string]any{"available": false, "items": []any{}})
		return
	}

	type containerUsage struct {
		Name        string `json:"name"`
		CPUMilli    int64  `json:"cpuMilli"`
		MemoryBytes int64  `json:"memoryBytes"`
	}
	type podUsage struct {
		Name        string           `json:"name"`
		Namespace   string           `json:"namespace"`
		CPUMilli    int64            `json:"cpuMilli"`
		MemoryBytes int64            `json:"memoryBytes"`
		Containers  []containerUsage `json:"containers"`
	}

	items := make([]podUsage, 0, len(metricsList.Items))
	for _, m := range metricsList.Items {
		u := podUsage{Name: m.Name, Namespace: m.Namespace}
		for _, c := range m.Containers {
			cu := containerUsage{
				Name:        c.Name,
				CPUMilli:    c.Usage.Cpu().MilliValue(),
				MemoryBytes: c.Usage.Memory().Value(),
			}
			u.CPUMilli += cu.CPUMilli
			u.MemoryBytes += cu.MemoryBytes
			u.Containers = append(u.Containers, cu)
		}
		items = append(items, u)
	}
	writeJSON(w, map[string]any{"available": true, "items": items})
}

// flushCopy는 로그 follow 스트림을 청크 단위로 즉시 내려보낸다.
func flushCopy(ctx context.Context, w http.ResponseWriter, r io.Reader) {
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 4096)
	for {
		if ctx.Err() != nil {
			return
		}
		n, err := r.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeSSE(w io.Writer, event string, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
}

func httpError(w http.ResponseWriter, code int, err error) {
	slog.Error("API 오류", "error", err)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}
