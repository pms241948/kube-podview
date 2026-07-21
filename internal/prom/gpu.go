package prom

import (
	"context"
)

// GPUUsage는 Pod 하나의 GPU 실측 사용량이다 (DCGM Exporter 기준).
type GPUUsage struct {
	Namespace    string  `json:"namespace"`
	Name         string  `json:"name"`
	UtilPercent  float64 `json:"utilPercent"`  // 0~100 (Pod에 GPU가 여러 개면 평균)
	MemUsedBytes float64 `json:"memUsedBytes"` // GPU 메모리 사용량
}

type GPUSnapshot struct {
	Available bool       `json:"available"`
	Items     []GPUUsage `json:"items"`
}

// DCGM Exporter 기본 쿼리. namespace/pod 레이블은 DCGM Exporter의
// Kubernetes 연동(kubernetes: true)이 켜져 있으면 붙는다.
// DCGM_FI_DEV_FB_USED는 MiB 단위라 PromQL에서 바이트로 변환한다.
const (
	defaultGPUUtilQuery = `avg by (namespace, pod) (DCGM_FI_DEV_GPU_UTIL{pod!=""})`
	defaultGPUMemQuery  = `sum by (namespace, pod) (DCGM_FI_DEV_FB_USED{pod!=""}) * 1024 * 1024`
)

// GPU는 Pod별 GPU 사용률/메모리를 조회한다.
// 쿼리 실패(DCGM 미설치 등) 시 Available=false를 반환한다.
func (p *Provider) GPU(ctx context.Context, namespace string) GPUSnapshot {
	snap := GPUSnapshot{Items: []GPUUsage{}}

	util, err := p.query(ctx, p.gpuUtilQuery)
	if err != nil {
		return snap
	}
	snap.Available = true

	items := map[string]*GPUUsage{}
	for _, s := range util {
		ns, pod := s.Metric["namespace"], s.Metric["pod"]
		if pod == "" || (namespace != "" && ns != namespace) {
			continue
		}
		items[ns+"/"+pod] = &GPUUsage{Namespace: ns, Name: pod, UtilPercent: s.Value}
	}

	if mem, err := p.query(ctx, p.gpuMemQuery); err == nil {
		for _, s := range mem {
			ns, pod := s.Metric["namespace"], s.Metric["pod"]
			if pod == "" || (namespace != "" && ns != namespace) {
				continue
			}
			if it, ok := items[ns+"/"+pod]; ok {
				it.MemUsedBytes = s.Value
			} else {
				items[ns+"/"+pod] = &GPUUsage{Namespace: ns, Name: pod, MemUsedBytes: s.Value}
			}
		}
	}

	for _, it := range items {
		snap.Items = append(snap.Items, *it)
	}
	return snap
}
