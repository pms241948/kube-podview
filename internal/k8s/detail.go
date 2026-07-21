package k8s

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// EnvEntry는 컨테이너 환경변수다. 시크릿/컨피그맵 참조는 값 대신 출처만 노출한다.
type EnvEntry struct {
	Name   string `json:"name"`
	Value  string `json:"value,omitempty"`
	Source string `json:"source,omitempty"` // 예: "secret: podview-oidc/client-id"
}

type ContainerDetail struct {
	Name  string     `json:"name"`
	Image string     `json:"image"`
	Env   []EnvEntry `json:"env"`
	Ports []string   `json:"ports"`  // "8080/TCP (http)" 형태
	Mounts []string  `json:"mounts"` // "볼륨명 → 마운트경로" 형태
}

type VolumeDetail struct {
	Name string `json:"name"`
	Type string `json:"type"` // configMap / secret / emptyDir / pvc / hostPath / 기타
}

type ConditionDetail struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message,omitempty"`
}

type EventDetail struct {
	Type     string     `json:"type"` // Normal / Warning
	Reason   string     `json:"reason"`
	Message  string     `json:"message"`
	Count    int32      `json:"count"`
	LastSeen *time.Time `json:"lastSeen,omitempty"`
}

// PodDetail은 상세 패널의 "환경" 및 "이벤트" 탭 데이터다.
type PodDetail struct {
	ServiceAccount string            `json:"serviceAccount"`
	QOSClass       string            `json:"qosClass"`
	Containers     []ContainerDetail `json:"containers"`
	Volumes        []VolumeDetail    `json:"volumes"`
	Conditions     []ConditionDetail `json:"conditions"`
	Events         []EventDetail     `json:"events"`
}

// Detail은 캐시된 Pod 스펙과 K8s 이벤트를 모아 상세 정보를 만든다.
func (h *Hub) Detail(ctx context.Context, client kubernetes.Interface, namespace, name string) (*PodDetail, error) {
	pod, err := h.podLister.Pods(namespace).Get(name)
	if err != nil {
		return nil, err
	}

	d := &PodDetail{
		ServiceAccount: pod.Spec.ServiceAccountName,
		QOSClass:       string(pod.Status.QOSClass),
	}

	for _, c := range pod.Spec.Containers {
		cd := ContainerDetail{Name: c.Name, Image: c.Image}
		for _, e := range c.Env {
			cd.Env = append(cd.Env, envEntry(e))
		}
		for _, src := range c.EnvFrom {
			switch {
			case src.ConfigMapRef != nil:
				cd.Env = append(cd.Env, EnvEntry{Name: "(전체)", Source: "configMap: " + src.ConfigMapRef.Name})
			case src.SecretRef != nil:
				cd.Env = append(cd.Env, EnvEntry{Name: "(전체)", Source: "secret: " + src.SecretRef.Name})
			}
		}
		for _, p := range c.Ports {
			s := fmt.Sprintf("%d/%s", p.ContainerPort, p.Protocol)
			if p.Name != "" {
				s += " (" + p.Name + ")"
			}
			cd.Ports = append(cd.Ports, s)
		}
		for _, m := range c.VolumeMounts {
			cd.Mounts = append(cd.Mounts, m.Name+" → "+m.MountPath)
		}
		d.Containers = append(d.Containers, cd)
	}

	for _, v := range pod.Spec.Volumes {
		d.Volumes = append(d.Volumes, VolumeDetail{Name: v.Name, Type: volumeType(v)})
	}

	for _, cond := range pod.Status.Conditions {
		d.Conditions = append(d.Conditions, ConditionDetail{
			Type:    string(cond.Type),
			Status:  string(cond.Status),
			Reason:  cond.Reason,
			Message: cond.Message,
		})
	}

	// 이벤트는 캐시하지 않고 요청 시점에 조회한다.
	events, err := client.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{
		FieldSelector: fmt.Sprintf("involvedObject.kind=Pod,involvedObject.name=%s", name),
	})
	if err == nil {
		for _, ev := range events.Items {
			ed := EventDetail{Type: ev.Type, Reason: ev.Reason, Message: ev.Message, Count: ev.Count}
			if !ev.LastTimestamp.IsZero() {
				t := ev.LastTimestamp.Time
				ed.LastSeen = &t
			}
			d.Events = append(d.Events, ed)
		}
	}
	return d, nil
}

// envEntry는 환경변수를 표시용으로 변환한다. 시크릿 참조 값은 절대 노출하지 않는다.
func envEntry(e corev1.EnvVar) EnvEntry {
	entry := EnvEntry{Name: e.Name, Value: e.Value}
	if e.ValueFrom == nil {
		return entry
	}
	switch {
	case e.ValueFrom.SecretKeyRef != nil:
		entry.Source = "secret: " + e.ValueFrom.SecretKeyRef.Name + "/" + e.ValueFrom.SecretKeyRef.Key
	case e.ValueFrom.ConfigMapKeyRef != nil:
		entry.Source = "configMap: " + e.ValueFrom.ConfigMapKeyRef.Name + "/" + e.ValueFrom.ConfigMapKeyRef.Key
	case e.ValueFrom.FieldRef != nil:
		entry.Source = "fieldRef: " + e.ValueFrom.FieldRef.FieldPath
	case e.ValueFrom.ResourceFieldRef != nil:
		entry.Source = "resourceFieldRef: " + e.ValueFrom.ResourceFieldRef.Resource
	}
	return entry
}

func volumeType(v corev1.Volume) string {
	switch {
	case v.ConfigMap != nil:
		return "configMap: " + v.ConfigMap.Name
	case v.Secret != nil:
		return "secret: " + v.Secret.SecretName
	case v.EmptyDir != nil:
		return "emptyDir"
	case v.PersistentVolumeClaim != nil:
		return "pvc: " + v.PersistentVolumeClaim.ClaimName
	case v.HostPath != nil:
		return "hostPath: " + v.HostPath.Path
	case v.Projected != nil:
		return "projected"
	case v.DownwardAPI != nil:
		return "downwardAPI"
	}
	return "기타"
}
