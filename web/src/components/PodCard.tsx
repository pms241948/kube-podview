import type { GPUUsage, PodSummary, PodUsage } from '../lib/types'
import { formatAge, formatCPU, formatMemory, problemLabel, problemRecency, statusClass } from '../lib/format'
import { useI18n } from '../lib/i18n'

interface Props {
  pod: PodSummary
  usage?: PodUsage
  gpu?: GPUUsage
  selected: boolean
  onClick: () => void
}

export function PodCard({ pod, usage, gpu, selected, onClick }: Props) {
  const { t } = useI18n()
  const cls = statusClass(pod.status, pod.phase)
  return (
    <button className={`pod-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="pod-card-head">
        <span className={`status-dot ${cls}`} />
        <span className="pod-name" title={pod.name}>
          {pod.name}
        </span>
        {(pod.gpu ?? 0) > 0 && <span className="gpu-badge">GPU×{pod.gpu}</span>}
      </div>
      <div className={`pod-status text-${cls}`}>
        {pod.status}
        {pod.problemSince && (
          <span className={`problem-badge ${problemRecency(pod.problemSince)}`}>
            {problemLabel(pod.problemSince, t)}
          </span>
        )}
      </div>
      <div className="pod-meta">
        <span>{pod.ready} ready</span>
        <span>{pod.restarts > 0 ? `↻ ${pod.restarts}` : ''}</span>
        <span>{formatAge(pod.startTime)}</span>
      </div>
      {usage && (
        <div className="pod-usage">
          <span>CPU {formatCPU(usage.cpuMilli)}</span>
          <span>MEM {formatMemory(usage.memoryBytes)}</span>
        </div>
      )}
      {gpu && (
        <div className="pod-usage gpu">
          <span>GPU {gpu.utilPercent.toFixed(0)}%</span>
          <span>GMEM {formatMemory(gpu.memUsedBytes)}</span>
        </div>
      )}
      <div className="pod-ns">{pod.namespace}</div>
    </button>
  )
}
