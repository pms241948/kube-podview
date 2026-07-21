export function formatCPU(milli: number): string {
  if (milli >= 1000) return `${(milli / 1000).toFixed(2)} cores`
  return `${milli}m`
}

export function formatMemory(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} Gi`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} Mi`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} Ki`
  return `${bytes} B`
}

/** Pod 시작 시각으로부터 경과 시간을 "3d4h" 같은 형태로 표시한다. */
export function formatAge(startTime?: string): string {
  if (!startTime) return '-'
  const ms = Date.now() - new Date(startTime).getTime()
  if (ms < 0) return '-'
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d${hours % 24}h`
  if (hours > 0) return `${hours}h${minutes % 60}m`
  if (minutes > 0) return `${minutes}m`
  return `${Math.floor(ms / 1000)}s`
}

/** 비정상 Pod 여부. 백엔드가 problemSince를 채운 Pod가 문제 Pod다. */
export function isProblemPod(pod: { problemSince?: string }): boolean {
  return !!pod.problemSince
}

export type ProblemRecency = 'fresh' | 'recent' | 'chronic'

/**
 * 문제 발생 시점 분류:
 * fresh(1시간 이내) — 방금 발생, 긴급 확인 대상
 * recent(24시간 이내) — 최근 발생
 * chronic(24시간 이상) — 만성 (방치 중인 Pod)
 */
export function problemRecency(problemSince: string): ProblemRecency {
  const elapsed = Date.now() - new Date(problemSince).getTime()
  if (elapsed < 60 * 60 * 1000) return 'fresh'
  if (elapsed < 24 * 60 * 60 * 1000) return 'recent'
  return 'chronic'
}

export function problemLabel(problemSince: string): string {
  const recency = problemRecency(problemSince)
  const age = formatAge(problemSince)
  if (recency === 'chronic') return `만성 · ${age} 경과`
  return `${age} 전 발생`
}

/** 상태 문자열을 색상 클래스로 매핑한다. */
export function statusClass(status: string, phase: string): string {
  if (status === 'Running') return 'ok'
  if (phase === 'Succeeded' || status === 'Completed') return 'done'
  const transient = ['Pending', 'ContainerCreating', 'PodInitializing', 'Terminating', 'Init']
  if (transient.some((t) => status.startsWith(t))) return 'warn'
  return 'error'
}
