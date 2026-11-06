package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	corev1 "k8s.io/api/core/v1"

	"github.com/pms241948/CC-K8s-podview/internal/ai"
	"github.com/pms241948/CC-K8s-podview/internal/i18n"
	"github.com/pms241948/CC-K8s-podview/internal/k8s"
	"github.com/pms241948/CC-K8s-podview/internal/store"
)

// handleAIStatus는 프론트엔드에 등록된 모델 목록과 기본 모델을 알려준다.
func (s *Server) handleAIStatus(w http.ResponseWriter, _ *http.Request) {
	st := s.settings.Get()
	names := []string{}
	for _, m := range st.AIModels {
		names = append(names, m.Name)
	}
	active := ""
	if m, ok := st.ActiveModel(); ok {
		active = m.Name
	}
	writeJSON(w, map[string]any{
		"configured": len(names) > 0,
		"models":     names,
		"active":     active,
	})
}

// handleAnalyze는 Pod의 상태·컨디션·이벤트·최근 로그를 모아 LLM에 분석을 요청한다.
// 요청 본문의 {"model": "이름"}으로 등록된 모델 중 하나를 고를 수 있다 (생략 시 기본 모델).
func (s *Server) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	st := s.settings.Get()

	var req struct {
		Model string `json:"model"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req)

	var cfg store.AIModel
	var ok bool
	if req.Model != "" {
		if cfg, ok = st.FindModel(req.Model); !ok {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "unknown model: %s", "등록되지 않은 모델입니다: %s", req.Model))
			return
		}
	} else if cfg, ok = st.ActiveModel(); !ok {
		httpError(w, http.StatusServiceUnavailable,
			i18n.Errorf(r, "AI analysis isn't configured. Register a model endpoint in Settings", "AI 분석이 설정되지 않았습니다. 설정에서 모델 엔드포인트를 등록하세요"))
		return
	}

	ns, pod := r.PathValue("ns"), r.PathValue("pod")
	podData, err := s.collectPodData(r, ns, pod)
	if err != nil {
		httpError(w, http.StatusNotFound, err)
		return
	}

	analysis, err := ai.Analyze(r.Context(), cfg, podData, i18n.FromRequest(r))
	if err != nil {
		httpError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, map[string]string{"analysis": analysis, "model": cfg.Name})
}

// collectPodData는 분석 프롬프트에 넣을 Pod 데이터를 텍스트로 구성한다.
// 데이터 머리글은 영어로 고정한다 — 모델 입력용이며, 보고서 언어는 시스템 프롬프트가 정한다.
// 환경변수 값은 넣지 않는다 (시크릿 노출 방지 — 이름 수준 정보는 detail에 포함).
func (s *Server) collectPodData(r *http.Request, ns, name string) (string, error) {
	ctx := r.Context()
	pods, err := s.hub.Pods(ns)
	if err != nil {
		return "", err
	}
	var summary *k8s.PodSummary
	for i := range pods {
		if pods[i].Name == name {
			summary = &pods[i]
			break
		}
	}
	if summary == nil {
		return "", i18n.Errorf(r, "Pod not found: %s/%s", "Pod를 찾을 수 없습니다: %s/%s", ns, name)
	}

	detail, err := s.hub.Detail(ctx, s.clients.Core, ns, name)
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString("# Pod analysis request\n\n## Basics\n")
	writeKV(&sb, "Name", ns+"/"+name)
	writeKV(&sb, "Status", fmt.Sprintf("%s (phase=%s, ready=%s, restarts=%d)",
		summary.Status, summary.Phase, summary.Ready, summary.Restarts))
	writeKV(&sb, "Node", summary.NodeName)
	if summary.ProblemSince != nil {
		writeKV(&sb, "Problem since", summary.ProblemSince.Format("2006-01-02 15:04:05"))
	}

	sb.WriteString("\n## Containers\n")
	for _, c := range summary.Containers {
		fmt.Fprintf(&sb, "- %s: image=%s, state=%s, ready=%v, restarts=%d\n",
			c.Name, c.Image, c.State, c.Ready, c.Restarts)
	}

	if len(detail.Conditions) > 0 {
		sb.WriteString("\n## Conditions\n")
		for _, c := range detail.Conditions {
			fmt.Fprintf(&sb, "- %s=%s", c.Type, c.Status)
			if c.Reason != "" {
				fmt.Fprintf(&sb, " (%s: %s)", c.Reason, c.Message)
			}
			sb.WriteString("\n")
		}
	}

	if len(detail.Events) > 0 {
		sb.WriteString("\n## Recent K8s events\n")
		for _, ev := range detail.Events {
			fmt.Fprintf(&sb, "- [%s] %s ×%d: %s\n", ev.Type, ev.Reason, max(ev.Count, 1), ev.Message)
		}
	}

	sb.WriteString("\n## Recent logs\n")
	for _, c := range summary.Containers {
		logs := s.tailLogs(ctx, ns, name, c.Name, false)
		if logs == "" && c.Restarts > 0 {
			// 현재 로그가 없으면 직전(크래시한) 컨테이너의 로그를 시도
			logs = s.tailLogs(ctx, ns, name, c.Name, true)
			if logs != "" {
				logs = "(logs from the previous, crashed container)\n" + logs
			}
		}
		if logs == "" {
			logs = "(no logs)"
		}
		fmt.Fprintf(&sb, "### Container %s\n```\n%s\n```\n", c.Name, logs)
	}

	return sb.String(), nil
}

// tailLogs는 컨테이너의 최근 로그를 가져온다 (실패 시 빈 문자열).
func (s *Server) tailLogs(ctx context.Context, ns, pod, container string, previous bool) string {
	tail := int64(80)
	req := s.clients.Core.CoreV1().Pods(ns).GetLogs(pod, &corev1.PodLogOptions{
		Container: container,
		TailLines: &tail,
		Previous:  previous,
	})
	stream, err := req.Stream(ctx)
	if err != nil {
		return ""
	}
	defer stream.Close()
	data, err := io.ReadAll(io.LimitReader(stream, 16*1024))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func writeKV(sb *strings.Builder, k, v string) {
	fmt.Fprintf(sb, "- %s: %s\n", k, v)
}

// 관리자용 AI 모델 관리 API — RegisterAdmin에서 등록된다.
func (s *Server) registerAIAdmin(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/ai", func(w http.ResponseWriter, _ *http.Request) {
		st := s.settings.Get()
		models := []map[string]any{}
		for _, m := range st.AIModels {
			models = append(models, map[string]any{
				"name": m.Name, "provider": m.Provider, "url": m.URL,
				"model": m.Model, "hasKey": m.APIKey != "",
			})
		}
		active := ""
		if m, ok := st.ActiveModel(); ok {
			active = m.Name
		}
		writeJSON(w, map[string]any{"models": models, "active": active})
	})

	// 추가/수정 (이름이 같으면 갱신; 키를 비우면 기존 키 유지)
	mux.HandleFunc("POST /api/admin/ai", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name     string `json:"name"`
			Provider string `json:"provider"`
			URL      string `json:"url"`
			Model    string `json:"model"`
			APIKey   string `json:"apiKey"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
		req.Name = strings.TrimSpace(req.Name)
		req.Model = strings.TrimSpace(req.Model)
		req.URL = strings.TrimRight(strings.TrimSpace(req.URL), "/")
		if !validName.MatchString(req.Name) {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "name must be 40 characters or fewer: letters, digits, ._-", "이름은 한글/영문/숫자/._- 40자 이내여야 합니다"))
			return
		}
		if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "URL must start with http(s)://", "URL은 http(s)://로 시작해야 합니다"))
			return
		}
		if req.Model == "" {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "model name is required", "모델 이름이 필요합니다"))
			return
		}
		if req.Provider != "openai" && req.Provider != "anthropic" {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "provider must be openai or anthropic", "provider는 openai 또는 anthropic이어야 합니다"))
			return
		}
		err := s.settings.Update(func(st *store.Settings) error {
			for i, m := range st.AIModels {
				if m.Name == req.Name {
					if req.APIKey == "" {
						req.APIKey = m.APIKey
					}
					st.AIModels[i] = store.AIModel(req)
					return nil
				}
			}
			st.AIModels = append(st.AIModels, store.AIModel(req))
			if len(st.AIModels) == 1 { // 첫 모델은 자동으로 기본 지정
				st.ActiveAI = req.Name
			}
			return nil
		})
		if err != nil {
			httpError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})

	mux.HandleFunc("DELETE /api/admin/ai/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		err := s.settings.Update(func(st *store.Settings) error {
			for i, m := range st.AIModels {
				if m.Name == name {
					st.AIModels = append(st.AIModels[:i], st.AIModels[i+1:]...)
					if st.ActiveAI == name {
						st.ActiveAI = ""
						if len(st.AIModels) > 0 {
							st.ActiveAI = st.AIModels[0].Name
						}
					}
					return nil
				}
			}
			return i18n.Errorf(r, "model not found: %s", "모델을 찾을 수 없습니다: %s", name)
		})
		if err != nil {
			httpError(w, http.StatusNotFound, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})

	// 기본 모델 지정
	mux.HandleFunc("POST /api/admin/ai/active", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
		err := s.settings.Update(func(st *store.Settings) error {
			if _, ok := st.FindModel(req.Name); !ok {
				return i18n.Errorf(r, "model not found: %s", "모델을 찾을 수 없습니다: %s", req.Name)
			}
			st.ActiveAI = req.Name
			return nil
		})
		if err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
}
