// Package ai는 관리자가 등록한 LLM 엔드포인트로 Pod 상태 분석을 요청한다.
//
// 폐쇄망의 자체 서빙 모델을 대상으로 하므로 두 가지 와이어 형식을 지원한다:
//   - "openai":    OpenAI Chat Completions 호환 — vLLM, Ollama, LiteLLM 등 대부분의 사내 서빙
//   - "anthropic": Anthropic Messages API 호환
//
// 엔드포인트 URL·모델·API 키는 웹 관리자 설정에서 등록한다 (store.AISettings).
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/pms241948/kube-podview/internal/i18n"
	"github.com/pms241948/kube-podview/internal/store"
)

// 보고서 언어는 화면 언어(요청의 Accept-Language)를 따른다.
const systemPromptEN = `You are a Kubernetes operations expert. Analyze the given Pod's status, conditions, events, and recent logs
and write a concise report in English that an operator can take in quickly.

Format:
## Status summary
(1–2 sentences. If the Pod is healthy, say so clearly.)

## Root cause
(Only if there is a problem. Quote specific evidence from the events and logs.)

## Recommended actions
(Numbered list in priority order. Include kubectl commands for verification where useful.)

Avoid unsupported guesses — base the analysis only on facts found in the data.`

const systemPromptKO = `당신은 Kubernetes 운영 전문가입니다. 주어진 Pod의 상태 정보, 컨디션, 이벤트, 최근 로그를 분석해서
운영자가 빠르게 파악할 수 있는 간결한 한국어 보고서를 작성하세요.

형식:
## 상태 요약
(1~2문장. 정상이면 정상이라고 명확히)

## 원인 분석
(문제가 있는 경우만. 이벤트·로그의 구체적 근거를 인용)

## 권장 조치
(우선순위 순 번호 목록. 확인용 kubectl 명령이 있으면 포함)

근거 없는 추측은 피하고, 데이터에서 확인되는 사실만 기반으로 분석하세요.`

var httpClient = &http.Client{Timeout: 120 * time.Second}

// Analyze는 수집된 Pod 데이터를 LLM에 보내 분석 텍스트를 받는다. lang은 보고서와 오류 메시지 언어.
func Analyze(ctx context.Context, cfg store.AIModel, podData string, lang i18n.Lang) (string, error) {
	if !cfg.Configured() {
		return "", errors.New(i18n.Pick(lang, "AI analysis isn't configured", "AI 분석이 설정되지 않았습니다"))
	}
	prompt := i18n.Pick(lang, systemPromptEN, systemPromptKO)
	switch cfg.Provider {
	case "anthropic":
		return callAnthropic(ctx, cfg, prompt, podData, lang)
	default: // "openai" 및 미지정
		return callOpenAI(ctx, cfg, prompt, podData, lang)
	}
}

func modelError(lang i18n.Lang, msg string) error {
	return fmt.Errorf(i18n.Pick(lang, "model error: %s", "모델 오류: %s"), msg)
}

func emptyResponse(lang i18n.Lang) error {
	return errors.New(i18n.Pick(lang, "the model returned an empty response", "모델이 빈 응답을 반환했습니다"))
}

// ── OpenAI Chat Completions 호환 (vLLM/Ollama/LiteLLM 등) ──

func callOpenAI(ctx context.Context, cfg store.AIModel, prompt, podData string, lang i18n.Lang) (string, error) {
	body := map[string]any{
		"model": cfg.Model,
		"messages": []map[string]string{
			{"role": "system", "content": prompt},
			{"role": "user", "content": podData},
		},
		"max_tokens": 2000,
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	headers := map[string]string{}
	if cfg.APIKey != "" {
		headers["Authorization"] = "Bearer " + cfg.APIKey
	}
	if err := post(ctx, strings.TrimRight(cfg.URL, "/")+"/v1/chat/completions", headers, body, &out, lang); err != nil {
		return "", err
	}
	if out.Error != nil {
		return "", modelError(lang, out.Error.Message)
	}
	if len(out.Choices) == 0 {
		return "", emptyResponse(lang)
	}
	return out.Choices[0].Message.Content, nil
}

// ── Anthropic Messages API 호환 ──

func callAnthropic(ctx context.Context, cfg store.AIModel, prompt, podData string, lang i18n.Lang) (string, error) {
	body := map[string]any{
		"model":      cfg.Model,
		"max_tokens": 2000,
		"system":     prompt,
		"messages": []map[string]string{
			{"role": "user", "content": podData},
		},
	}
	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
		Error      *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	headers := map[string]string{"anthropic-version": "2023-06-01"}
	if cfg.APIKey != "" {
		headers["x-api-key"] = cfg.APIKey
	}
	if err := post(ctx, strings.TrimRight(cfg.URL, "/")+"/v1/messages", headers, body, &out, lang); err != nil {
		return "", err
	}
	if out.Error != nil {
		return "", modelError(lang, out.Error.Message)
	}
	if out.StopReason == "refusal" {
		return "", errors.New(i18n.Pick(lang, "the model declined the request", "모델이 요청을 거부했습니다"))
	}
	var sb strings.Builder
	for _, c := range out.Content {
		if c.Type == "text" {
			sb.WriteString(c.Text)
		}
	}
	if sb.Len() == 0 {
		return "", emptyResponse(lang)
	}
	return sb.String(), nil
}

func post(ctx context.Context, url string, headers map[string]string, body, out any, lang i18n.Lang) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf(i18n.Pick(lang, "couldn't connect to the AI endpoint: %w", "AI 엔드포인트 연결 실패: %w"), err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf(i18n.Pick(lang, "AI endpoint returned %d: %s", "AI 엔드포인트 응답 %d: %s"), res.StatusCode, truncate(string(raw), 300))
	}
	return json.Unmarshal(raw, out)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
