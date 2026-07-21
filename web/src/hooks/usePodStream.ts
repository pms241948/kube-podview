import { useEffect, useRef, useState } from 'react'
import type { PodEvent, PodSummary } from '../lib/types'

type ConnState = 'connecting' | 'open' | 'error'

const podKey = (p: PodSummary) => `${p.namespace}/${p.name}`

/**
 * SSE(/api/events)로 Pod 목록을 실시간 구독한다.
 * 접속 직후 snapshot 이벤트로 전체 상태를 받고, 이후 pod 이벤트로 증분 갱신한다.
 * 연결이 끊기면 EventSource가 자동 재접속하며, 재접속 시 snapshot으로 다시 동기화된다.
 */
export function usePodStream(namespace: string, cluster = '') {
  const [pods, setPods] = useState<Map<string, PodSummary>>(new Map())
  const [connState, setConnState] = useState<ConnState>('connecting')
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    setPods(new Map())
    setConnState('connecting')

    const q = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    const base = cluster ? `/proxy/${encodeURIComponent(cluster)}` : ''
    const source = new EventSource(`${base}/api/events${q}`)
    sourceRef.current = source

    source.onopen = () => setConnState('open')
    source.onerror = () => setConnState('error')

    source.addEventListener('snapshot', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { pods: PodSummary[] }
      setPods(new Map(data.pods.map((p) => [podKey(p), p])))
    })

    source.addEventListener('pod', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as PodEvent
      setPods((prev) => {
        const next = new Map(prev)
        if (ev.type === 'DELETED') next.delete(podKey(ev.pod))
        else next.set(podKey(ev.pod), ev.pod)
        return next
      })
    })

    return () => {
      source.close()
      sourceRef.current = null
    }
  }, [namespace, cluster])

  return { pods: [...pods.values()], connState }
}
