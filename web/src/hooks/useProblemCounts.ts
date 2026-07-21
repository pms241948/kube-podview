import { useEffect, useState } from 'react'
import { fetchPods } from '../lib/api'

const POLL_INTERVAL_MS = 15_000

/**
 * 클러스터 전체 Pod를 주기적으로 조회해서 네임스페이스별 문제 Pod 수를 센다.
 * 사이드바 배지용 (인포머 캐시에서 나오므로 API 서버 부담 없음).
 */
export function useProblemCounts(cluster: string) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    let stopped = false

    const poll = async () => {
      try {
        const res = await fetchPods('', cluster)
        if (stopped) return
        const next = new Map<string, number>()
        for (const p of res.pods) {
          if (p.problemSince) next.set(p.namespace, (next.get(p.namespace) ?? 0) + 1)
        }
        setCounts(next)
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
  }, [cluster])

  return counts
}
