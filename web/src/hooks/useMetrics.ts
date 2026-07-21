import { useEffect, useState } from 'react'
import { fetchMetrics } from '../lib/api'
import type { PodUsage } from '../lib/types'

const POLL_INTERVAL_MS = 15_000

/** metrics-server의 Pod 사용량을 주기적으로 폴링한다. 미설치 시 available=false. */
export function useMetrics(namespace: string, cluster = '') {
  const [usage, setUsage] = useState<Map<string, PodUsage>>(new Map())
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    let stopped = false

    const poll = async () => {
      try {
        const res = await fetchMetrics(namespace, cluster)
        if (stopped) return
        setAvailable(res.available)
        setUsage(new Map(res.items.map((u) => [`${u.namespace}/${u.name}`, u])))
      } catch {
        /* 일시적 실패는 다음 폴링에서 복구 */
      }
    }

    poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [namespace, cluster])

  return { usage, metricsAvailable: available }
}
