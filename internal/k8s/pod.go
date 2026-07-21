package k8s

import (
	"strconv"
	"time"

	corev1 "k8s.io/api/core/v1"
)

// PodSummary는 프론트엔드에 내려주는 Pod 요약 정보다.
type PodSummary struct {
	Name       string             `json:"name"`
	Namespace  string             `json:"namespace"`
	Phase      string             `json:"phase"`  // Pending/Running/Succeeded/Failed/Unknown
	Status     string             `json:"status"` // 화면 표시용 상세 상태 (CrashLoopBackOff 등)
	Ready      string             `json:"ready"`  // "1/2" 형태
	Restarts   int32              `json:"restarts"`
	NodeName   string             `json:"nodeName"`
	PodIP      string             `json:"podIP"`
	GPU        int64              `json:"gpu,omitempty"` // 할당된 GPU 개수 (limits 기준)
	StartTime  *time.Time         `json:"startTime,omitempty"`
	// ProblemSince는 Pod가 비정상 상태가 된 시각이다 (정상이면 nil).
	// Ready 컨디션이 False로 전환된 시각 기준이므로 "언제부터 문제인지"를 나타낸다.
	ProblemSince *time.Time         `json:"problemSince,omitempty"`
	Containers   []ContainerSummary `json:"containers"`
	Labels       map[string]string  `json:"labels,omitempty"`
}

// gpuResourceNames는 GPU 확장 리소스로 취급할 이름들이다.
var gpuResourceNames = []corev1.ResourceName{
	"nvidia.com/gpu",
	"amd.com/gpu",
	"intel.com/gpu",
	"habana.ai/gaudi",
}

type ContainerSummary struct {
	Name     string `json:"name"`
	Image    string `json:"image"`
	Ready    bool   `json:"ready"`
	Restarts int32  `json:"restarts"`
	State    string `json:"state"` // Running/Waiting(사유)/Terminated(사유)
}

// Summarize는 corev1.Pod를 PodSummary로 변환한다.
func Summarize(pod *corev1.Pod) PodSummary {
	s := PodSummary{
		Name:      pod.Name,
		Namespace: pod.Namespace,
		Phase:     string(pod.Status.Phase),
		Status:    displayStatus(pod),
		NodeName:  pod.Spec.NodeName,
		PodIP:     pod.Status.PodIP,
		Labels:    pod.Labels,
	}
	if pod.Status.StartTime != nil {
		t := pod.Status.StartTime.Time
		s.StartTime = &t
	}

	for _, c := range pod.Spec.Containers {
		for _, name := range gpuResourceNames {
			if q, ok := c.Resources.Limits[name]; ok {
				s.GPU += q.Value()
			}
		}
	}

	readyCount := 0
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.Ready {
			readyCount++
		}
		s.Restarts += cs.RestartCount
		s.Containers = append(s.Containers, ContainerSummary{
			Name:     cs.Name,
			Image:    cs.Image,
			Ready:    cs.Ready,
			Restarts: cs.RestartCount,
			State:    containerState(cs.State),
		})
	}
	s.Ready = strconv.Itoa(readyCount) + "/" + strconv.Itoa(len(pod.Spec.Containers))
	s.ProblemSince = problemSince(pod, s, readyCount)
	return s
}

// problemSince는 Pod가 비정상이면 문제 시작 시각을, 정상이면 nil을 반환한다.
func problemSince(pod *corev1.Pod, s PodSummary, readyCount int) *time.Time {
	healthy := (s.Status == "Running" && readyCount == len(pod.Spec.Containers)) ||
		pod.Status.Phase == corev1.PodSucceeded || s.Status == "Completed"
	if healthy {
		return nil
	}

	// 재시작을 반복 중인 Pod(CrashLoopBackOff 등)는 Ready 컨디션이 사이클마다
	// 갱신되어 항상 "방금 발생"처럼 보이므로, 시작 시각을 문제 시작으로 본다
	// (오래 방치된 크래시 루프를 만성으로 분류하기 위한 휴리스틱).
	if s.Restarts >= 5 {
		if pod.Status.StartTime != nil {
			t := pod.Status.StartTime.Time
			return &t
		}
		t := pod.CreationTimestamp.Time
		return &t
	}

	// Ready 컨디션이 False가 된 시각이 가장 정확한 "문제 시작" 신호다.
	for _, cond := range pod.Status.Conditions {
		if cond.Type == corev1.PodReady && cond.Status != corev1.ConditionTrue &&
			!cond.LastTransitionTime.IsZero() {
			t := cond.LastTransitionTime.Time
			return &t
		}
	}
	// Pending 등 컨디션이 아직 없으면 생성 시각으로 대체
	t := pod.CreationTimestamp.Time
	return &t
}

// displayStatus는 kubectl get pods의 STATUS 열과 유사한 표시 문자열을 만든다.
func displayStatus(pod *corev1.Pod) string {
	if pod.DeletionTimestamp != nil {
		return "Terminating"
	}
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			return cs.State.Waiting.Reason
		}
		if cs.State.Terminated != nil && cs.State.Terminated.Reason != "" &&
			pod.Status.Phase != corev1.PodSucceeded {
			return cs.State.Terminated.Reason
		}
	}
	if pod.Status.Reason != "" {
		return pod.Status.Reason
	}
	return string(pod.Status.Phase)
}

func containerState(state corev1.ContainerState) string {
	switch {
	case state.Running != nil:
		return "Running"
	case state.Waiting != nil:
		if state.Waiting.Reason != "" {
			return "Waiting: " + state.Waiting.Reason
		}
		return "Waiting"
	case state.Terminated != nil:
		if state.Terminated.Reason != "" {
			return "Terminated: " + state.Terminated.Reason
		}
		return "Terminated"
	}
	return "Unknown"
}

