import { useEffect, useState } from 'react'
import { fetchGPU } from '../lib/api'
import type { GPUUsage } from '../lib/types'

const POLL_INTERVAL_MS = 15_000

/**
 * DCGM Exporter 기반 Pod별 GPU 사용량을 폴링한다.
 * Prometheus 미연동/DCGM 미설치면 available:false를 받고 폴링을 멈춘다.
 */
export function useGPU(namespace: string, cluster = '') {
  const [gpuUsage, setGpuUsage] = useState<Map<string, GPUUsage>>(new Map())
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setInterval> | undefined

    const poll = async () => {
      try {
        const res = await fetchGPU(namespace, cluster)
        if (stopped) return
        setAvailable(res.available)
        if (!res.available) {
          if (timer) clearInterval(timer)
          return
        }
        setGpuUsage(new Map(res.items.map((u) => [`${u.namespace}/${u.name}`, u])))
      } catch {
        /* 일시적 실패는 다음 폴링에서 복구 */
      }
    }

    poll()
    timer = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
    }
  }, [namespace, cluster])

  return { gpuUsage, gpuAvailable: available }
}
