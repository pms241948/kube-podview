import { useEffect, useMemo, useRef, useState } from 'react'
import type { GPUUsage, IngressSummary, NodeSummary, PodSummary, PodUsage, ServiceSummary, TrafficSnapshot } from '../lib/types'
import { formatCPU, formatMemory, problemLabel, problemRecency, statusClass } from '../lib/format'
import { useI18n } from '../lib/i18n'

interface Props {
  pods: PodSummary[]
  services: ServiceSummary[]
  nodes: NodeSummary[]
  ingresses: IngressSummary[]
  usage: Map<string, PodUsage>
  gpuUsage: Map<string, GPUUsage>
  traffic: TrafficSnapshot | null
  problemsOnly: boolean
  searchQuery?: string // Pod 이름/상태 검색어 — 일치하지 않는 Pod는 흐리게
  layoutKey: string
  onHoverNamespace?: (ns: string | null) => void
  onSelectPod: (pod: PodSummary) => void
  selectedPodKey?: string
}

// 노드에 아직 배치되지 않은 Pod 그룹의 내부 키 (화면에는 번역된 이름으로 표시)
const UNASSIGNED = '__unassigned__'

// ── 레이아웃 상수 ──────────────────────────────
const ING_W = 170
const ING_H = 48
const ING_GAP = 18
const SVC_W = 180
const SVC_H = 52
const SVC_GAP = 18
const COL_GAP = 130 // 열 사이 간격 (연결선 공간)
const NODE_W_MIN = 320
const NODE_GAP = 24
const NODE_HEAD = 34
const NS_HEAD = 22 // 네임스페이스 박스 헤더(라벨) 높이
const NS_GAP = 10 // 네임스페이스 박스 사이 간격
const NSBOX_PAD = 8 // 네임스페이스 박스 내부 좌우 여백
const POD_R = 16
const POD_CELL = 92
const POD_ROW_H = 74
const PODS_PER_ROW = 4
const RING_R = POD_R + 5 // CPU 사용량 링
const GPU_RING_R = POD_R + 9 // GPU 사용률 링 (절대 0~100%)

const EDGE_COLORS = ['#4d8dff', '#9d6bff', '#2fb3a8', '#e08b3e', '#d15b9e', '#7a9e2f']

const MAX_NS_BOX_W = 240 // 네임스페이스 박스 최대 폭 (넘으면 라벨을 2줄로)
const NS_LABEL_PAD = 20 // 라벨 좌우 여백 합

// 11px/600 텍스트의 대략적 픽셀 폭 (한글은 약 2배). DOM 측정 없이 근사한다.
function estTextW(s: string): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 10.5 : 6.2
  return w
}

// 라벨을 maxW 폭에 맞춰 1~2줄로 나눈다 (2번째 줄도 넘치면 말줄임).
function wrapLabel(label: string, maxW: number): string[] {
  if (estTextW(label) <= maxW) return [label]
  const chars = [...label]
  let line1 = ''
  let i = 0
  while (i < chars.length && estTextW(line1 + chars[i]) <= maxW) {
    line1 += chars[i]
    i++
  }
  let line2 = chars.slice(i).join('')
  while (line2.length > 1 && estTextW(line2 + '…') > maxW) line2 = line2.slice(0, -1)
  if (estTextW(chars.slice(i).join('')) > maxW) line2 += '…'
  return [line1, line2]
}

// 네임스페이스 박스 크기 결정. 박스는 항상 Pod 내용 폭(podW) 이상을 보장한다.
// 라벨이 그보다 길면 넓히되 MAX_NS_BOX_W까지만, 그 이상이면 라벨을 2줄로 감싼다.
function nsBoxLayout(label: string, podW: number): { boxW: number; lines: string[]; headerH: number } {
  const labelW = estTextW(label) + NS_LABEL_PAD
  if (labelW <= podW) return { boxW: podW, lines: [label], headerH: NS_HEAD }
  if (labelW <= MAX_NS_BOX_W) return { boxW: labelW, lines: [label], headerH: NS_HEAD }
  const boxW = Math.max(podW, MAX_NS_BOX_W)
  const lines = wrapLabel(label, boxW - NS_LABEL_PAD)
  return { boxW, lines, headerH: lines.length > 1 ? NS_HEAD + 14 : NS_HEAD }
}

// 모든 컨테이너가 Ready인 Running Pod만 Service 트래픽을 받는다.
function isReceivingTraffic(pod: PodSummary): boolean {
  if (pod.status !== 'Running') return false
  const [ready, total] = pod.ready.split('/')
  return ready === total
}

type Hover =
  | { type: 'svc'; key: string }
  | { type: 'pod'; key: string }
  | { type: 'ing'; key: string }
  | { type: 'ns'; key: string }
  | { type: 'svcEdge'; svcKey: string; podKey: string }
  | { type: 'ingEdge'; ingKey: string; svcKey: string }
  | { type: 'flowEdge'; fromKey: string; toKey: string }
  | null

/**
 * 계층형 토폴로지: Ingress → Service → Pod(노드 박스 안).
 * Service→Pod 연결선은 셀렉터 기반 라우팅 경로이고,
 * traffic이 주어지면 Pod↔Pod 실측 플로우(회색 선)와 송수신량 툴팁이 추가된다.
 */
export function TopologyView({ pods, services, nodes, ingresses, usage, gpuUsage, traffic, problemsOnly, searchQuery, layoutKey, onHoverNamespace, onSelectPod, selectedPodKey }: Props) {
  const { t } = useI18n()
  const [hover, setHover] = useState<Hover>(null)
  const query = (searchQuery ?? '').trim().toLowerCase()

  // ── 노드 박스 드래그/크기 조절 ──────────────────────
  // 사용자가 옮기거나 크기를 바꾼 박스만 기록한다. 폭이 바뀌면 안의 Pod는 자동 재정렬.
  type BoxOverride = { x: number; y: number; w: number; h?: number }
  const storageKey = `podview-topo-layout:${layoutKey}`
  const [overrides, setOverrides] = useState<Record<string, BoxOverride>>({})
  const dragRef = useRef<null | {
    mode: 'move' | 'resize'
    name: string
    startX: number
    startY: number
    orig: { x: number; y: number; w: number; h: number }
    prevH?: number // 이전에 사용자가 지정한 높이 (이동 시 유지용)
  }>(null)

  useEffect(() => {
    try {
      setOverrides(JSON.parse(localStorage.getItem(storageKey) ?? '{}'))
    } catch {
      setOverrides({})
    }
  }, [storageKey])

  const startDrag = (
    e: React.MouseEvent,
    mode: 'move' | 'resize',
    name: string,
    box: { x: number; y: number; w: number; h: number },
  ) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      mode,
      name,
      startX: e.clientX,
      startY: e.clientY,
      orig: box,
      prevH: overrides[name]?.h,
    }
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      setOverrides((prev) => ({
        ...prev,
        [d.name]:
          d.mode === 'move'
            ? { x: Math.max(0, d.orig.x + dx), y: Math.max(0, d.orig.y + dy), w: d.orig.w, h: d.prevH }
            : {
                x: d.orig.x,
                y: d.orig.y,
                w: Math.max(150, d.orig.w + dx),
                h: Math.max(60, d.orig.h + dy),
              },
      }))
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setOverrides((prev) => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(prev))
        } catch {
          /* 저장 실패는 무시 */
        }
        return prev
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [storageKey])

  const resetLayout = () => {
    setOverrides({})
    try {
      localStorage.removeItem(storageKey)
    } catch {
      /* 무시 */
    }
  }

  const hasIngress = ingresses.length > 0
  const ING_COL_X = 20
  const SVC_COL_X = hasIngress ? ING_COL_X + ING_W + COL_GAP : 20
  const NODE_X = SVC_COL_X + SVC_W + COL_GAP

  const layout = useMemo(() => {
    // Pod를 노드별로 묶는다. 스케줄 전 Pod는 UNASSIGNED 그룹 (표시 이름은 언어별로 번역).
    const byNode = new Map<string, PodSummary[]>()
    for (const p of pods) {
      const key = p.nodeName || UNASSIGNED
      if (!byNode.has(key)) byNode.set(key, [])
      byNode.get(key)!.push(p)
    }

    const nodeOrder: { name: string; ready: boolean; roles: string }[] = nodes
      .filter((n) => byNode.has(n.name))
      .map((n) => ({ name: n.name, ready: n.ready, roles: n.roles }))
    for (const name of byNode.keys()) {
      if (!nodeOrder.some((n) => n.name === name)) {
        nodeOrder.push({ name, ready: true, roles: name === UNASSIGNED ? 'pending' : 'worker' })
      }
    }

    type NsBox = {
      ns: string
      x: number
      y: number
      w: number
      h: number
      count: number
      lines: string[]
      headerH: number
    }
    const nodeBoxes: {
      node: (typeof nodeOrder)[0]
      x: number
      y: number
      w: number
      h: number
      nsBoxes: NsBox[]
    }[] = []
    const podPos = new Map<string, { pod: PodSummary; x: number; y: number }>()
    let y = 20

    const LEFT_PAD = 12 // 노드 안쪽 좌우 여백
    for (const n of nodeOrder) {
      const groupPods = byNode.get(n.name) ?? []
      const ov = overrides[n.name]

      // 노드 안에서 네임스페이스별로 묶고, 그룹·Pod 모두 이름순 정렬
      const byNs = new Map<string, PodSummary[]>()
      for (const p of groupPods) {
        if (!byNs.has(p.namespace)) byNs.set(p.namespace, [])
        byNs.get(p.namespace)!.push(p)
      }
      const nsNames = [...byNs.keys()].sort()
      for (const list of byNs.values()) list.sort((a, b) => a.name.localeCompare(b.name))

      // 기본 폭: 가장 넓은 네임스페이스 박스가 들어가도록 (Pod 수 + 라벨 길이 고려)
      let widest = NODE_W_MIN
      for (const ns of nsNames) {
        const cnt = byNs.get(ns)!.length
        const cols = Math.min(cnt, PODS_PER_ROW)
        const podW = cols * POD_CELL + NSBOX_PAD * 2
        const { boxW } = nsBoxLayout(`${ns} · ${cnt}`, podW)
        widest = Math.max(widest, boxW + LEFT_PAD * 2)
      }
      const w = ov?.w ?? widest
      // 노드 폭에 들어가는 Pod 열 수 (네임스페이스 박스 내부 최대 열)
      const maxCols = Math.max(1, Math.floor((w - LEFT_PAD * 2 - NSBOX_PAD * 2) / POD_CELL))
      const bx = ov?.x ?? NODE_X
      const by = ov?.y ?? y

      // 네임스페이스 박스를 왼→오로 흐름 배치, 노드 폭을 넘으면 줄바꿈
      const nsBoxes: NsBox[] = []
      let cx = LEFT_PAD
      let cy = NODE_HEAD + 4
      let lineH = 0
      for (const ns of nsNames) {
        const nsPods = byNs.get(ns)!
        const cols = Math.max(1, Math.min(nsPods.length, PODS_PER_ROW, maxCols))
        const rows = Math.ceil(nsPods.length / cols)
        const podW = cols * POD_CELL + NSBOX_PAD * 2
        // 박스는 Pod 폭 이상을 보장하고, 라벨이 길면 넓히거나 2줄로 감싼다
        const { boxW, lines, headerH } = nsBoxLayout(`${ns} · ${nsPods.length}`, podW)
        const boxH = headerH + rows * POD_ROW_H + 6
        if (cx + boxW > w - LEFT_PAD && cx > LEFT_PAD) {
          cx = LEFT_PAD // 줄바꿈
          cy += lineH + NS_GAP
          lineH = 0
        }
        const boxX = bx + cx
        const boxY = by + cy
        nsBoxes.push({ ns, x: boxX, y: boxY, w: boxW, h: boxH, count: nsPods.length, lines, headerH })
        nsPods.forEach((p, i) => {
          const row = Math.floor(i / cols)
          const col = i % cols
          podPos.set(`${p.namespace}/${p.name}`, {
            pod: p,
            x: boxX + NSBOX_PAD + col * POD_CELL + POD_CELL / 2 - POD_R,
            y: boxY + headerH + row * POD_ROW_H + 26,
          })
        })
        cx += boxW + NS_GAP
        lineH = Math.max(lineH, boxH)
      }

      const requiredH = cy + lineH + 10
      const h = Math.max(requiredH, ov?.h ?? 0)
      nodeBoxes.push({ node: n, x: bx, y: by, w, h, nsBoxes })
      // 기본 흐름은 항상 진행시켜서, 박스 하나를 옮겨도 나머지가 밀리지 않게 한다
      y += h + NODE_GAP
    }

    const svcPos = new Map<string, { svc: ServiceSummary; x: number; y: number }>()
    let sy = 20
    for (const svc of services) {
      svcPos.set(`${svc.namespace}/${svc.name}`, { svc, x: SVC_COL_X, y: sy })
      sy += SVC_H + SVC_GAP
    }

    const ingPos = new Map<string, { ing: IngressSummary; x: number; y: number }>()
    let iy = 20
    for (const ing of ingresses) {
      ingPos.set(`${ing.namespace}/${ing.name}`, { ing, x: ING_COL_X, y: iy })
      iy += ING_H + ING_GAP
    }

    const width = Math.max(...nodeBoxes.map((b) => b.x + b.w), NODE_X + NODE_W_MIN, 860) + 40
    const height = Math.max(y, sy, iy, ...nodeBoxes.map((b) => b.y + b.h + 20)) + 20
    return { nodeBoxes, podPos, svcPos, ingPos, width, height }
  }, [pods, services, nodes, ingresses, SVC_COL_X, NODE_X, overrides])

  // Service → Pod 연결선
  const svcEdges = useMemo(() => {
    const out: { key: string; svcKey: string; podKey: string; d: string; color: string; healthy: boolean }[] = []
    let colorIdx = 0
    for (const [svcKey, sp] of layout.svcPos) {
      const color = EDGE_COLORS[colorIdx++ % EDGE_COLORS.length]
      for (const podKey of sp.svc.podKeys) {
        const pp = layout.podPos.get(podKey)
        if (!pp) continue
        const x1 = sp.x + SVC_W
        const y1 = sp.y + SVC_H / 2
        const x2 = pp.x - POD_R - 4
        const y2 = pp.y
        const mx = (x1 + x2) / 2
        out.push({
          key: `${svcKey}->${podKey}`,
          svcKey,
          podKey,
          d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
          color,
          healthy: isReceivingTraffic(pp.pod),
        })
      }
    }
    return out
  }, [layout])

  // Ingress → Service 연결선
  const ingEdges = useMemo(() => {
    const out: { key: string; ingKey: string; svcKey: string; d: string }[] = []
    for (const [ingKey, ip] of layout.ingPos) {
      for (const svcKey of ip.ing.svcKeys) {
        const sp = layout.svcPos.get(svcKey)
        if (!sp) continue
        const x1 = ip.x + ING_W
        const y1 = ip.y + ING_H / 2
        const x2 = sp.x - 4
        const y2 = sp.y + SVC_H / 2
        const mx = (x1 + x2) / 2
        out.push({
          key: `${ingKey}->${svcKey}`,
          ingKey,
          svcKey,
          d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
        })
      }
    }
    return out
  }, [layout])

  // 실측 Pod↔Pod 플로우 (traffic.edges의 양끝이 화면에 있을 때만)
  const flowEdges = useMemo(() => {
    if (!traffic?.available || traffic.edges.length === 0) return []
    const maxRate = Math.max(...traffic.edges.map((e) => e.rate), 1e-9)
    const out: { key: string; fromKey: string; toKey: string; d: string; frac: number; rate: number }[] = []
    for (const e of traffic.edges) {
      const from = layout.podPos.get(e.fromKey)
      const to = layout.podPos.get(e.toKey)
      if (!from || !to || e.fromKey === e.toKey) continue
      // Pod 사이를 위로 볼록한 곡선으로 연결해 서비스 연결선과 구분
      const mx = (from.x + to.x) / 2
      const my = Math.min(from.y, to.y) - 36
      out.push({
        key: `${e.fromKey}=>${e.toKey}`,
        fromKey: e.fromKey,
        toKey: e.toKey,
        d: `M ${from.x} ${from.y - POD_R} Q ${mx} ${my}, ${to.x} ${to.y - POD_R}`,
        frac: e.rate / maxRate,
        rate: e.rate,
      })
    }
    return out
  }, [traffic, layout])

  // CPU 사용량 링: 화면 내 최대 CPU 대비 비율
  const podRateMap = useMemo(() => {
    const m = new Map<string, { rx: number; tx: number }>()
    for (const r of traffic?.podRates ?? []) m.set(`${r.namespace}/${r.name}`, { rx: r.rxBytesSec, tx: r.txBytesSec })
    return m
  }, [traffic])

  // 실측 수신량 최대값 — Service→Pod 흐름 점 속도의 기준
  const maxRx = useMemo(() => {
    let max = 0
    for (const r of podRateMap.values()) if (r.rx > max) max = r.rx
    return max
  }, [podRateMap])
  const trafficOn = !!traffic?.available && podRateMap.size > 0

  const maxCPU = useMemo(() => {
    let max = 0
    for (const { pod } of layout.podPos.values()) {
      const u = usage.get(`${pod.namespace}/${pod.name}`)
      if (u && u.cpuMilli > max) max = u.cpuMilli
    }
    return max
  }, [layout, usage])

  // 커서 위치 기준 강조 집합
  const highlight = useMemo(() => {
    if (!hover) return null
    const ingKeys = new Set<string>()
    const svcKeys = new Set<string>()
    const podKeys = new Set<string>()
    const nsKeys = new Set<string>()
    const addSvcPods = (svcKey: string) => {
      layout.svcPos.get(svcKey)?.svc.podKeys.forEach((k) => podKeys.add(k))
    }
    switch (hover.type) {
      case 'svc':
        svcKeys.add(hover.key)
        addSvcPods(hover.key)
        for (const [key, ip] of layout.ingPos) if (ip.ing.svcKeys.includes(hover.key)) ingKeys.add(key)
        break
      case 'pod':
        podKeys.add(hover.key)
        for (const [key, sp] of layout.svcPos) {
          if (sp.svc.podKeys.includes(hover.key)) {
            svcKeys.add(key)
            for (const [ik, ip] of layout.ingPos) if (ip.ing.svcKeys.includes(key)) ingKeys.add(ik)
          }
        }
        break
      case 'ns':
        // 네임스페이스: 그 안의 Pod 전체 + 그 Pod를 대상으로 하는 서비스/Ingress
        nsKeys.add(hover.key)
        for (const key of layout.podPos.keys()) {
          if (key.slice(0, key.indexOf('/')) === hover.key) podKeys.add(key)
        }
        for (const [key, sp] of layout.svcPos) {
          if (sp.svc.podKeys.some((pk) => podKeys.has(pk))) {
            svcKeys.add(key)
            for (const [ik, ip] of layout.ingPos) if (ip.ing.svcKeys.includes(key)) ingKeys.add(ik)
          }
        }
        break
      case 'ing':
        ingKeys.add(hover.key)
        for (const svcKey of layout.ingPos.get(hover.key)?.ing.svcKeys ?? []) {
          svcKeys.add(svcKey)
          addSvcPods(svcKey)
        }
        break
      // ── 플로우 선 호버: 그 선의 양 끝만 강조 ──
      case 'svcEdge':
        svcKeys.add(hover.svcKey)
        podKeys.add(hover.podKey)
        break
      case 'ingEdge':
        ingKeys.add(hover.ingKey)
        svcKeys.add(hover.svcKey)
        break
      case 'flowEdge':
        podKeys.add(hover.fromKey)
        podKeys.add(hover.toKey)
        break
    }
    // 강조된 Pod들의 네임스페이스도 함께 강조 대상에 포함
    for (const pk of podKeys) nsKeys.add(pk.slice(0, pk.indexOf('/')))
    return { ingKeys, svcKeys, podKeys, nsKeys }
  }, [hover, layout])

  if (pods.length === 0) {
    return <div className="empty">{t('app.noPods')}</div>
  }

  const dimSvcEdge = (e: { svcKey: string; podKey: string }) =>
    highlight !== null && !(highlight.svcKeys.has(e.svcKey) && highlight.podKeys.has(e.podKey))
  const dimIngEdge = (e: { ingKey: string; svcKey: string }) =>
    highlight !== null && !(highlight.ingKeys.has(e.ingKey) && highlight.svcKeys.has(e.svcKey))
  const dimFlowEdge = (e: { fromKey: string; toKey: string }) =>
    highlight !== null && !highlight.podKeys.has(e.fromKey) && !highlight.podKeys.has(e.toKey)

  return (
    <div className="topology-wrap">
      <div className="topo-legend">
        <span>
          <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="#4d8dff" strokeWidth="1.5" /><circle cx="13" cy="4" r="3" fill="#4d8dff" /></svg>
          {t('topo.routing')}
        </span>
        <span>
          <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="#e05c5c" strokeWidth="1.5" strokeDasharray="4 4" /></svg>
          {t('topo.excluded')}
        </span>
        {maxCPU > 0 && (
          <span>
            <svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="#4d8dff" strokeWidth="2" strokeDasharray="16 32" /></svg>
            {t('topo.cpuRing')}
          </span>
        )}
        {gpuUsage.size > 0 && (
          <span>
            <svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="#76b900" strokeWidth="2" strokeDasharray="16 32" /></svg>
            {t('topo.gpuRing')}
          </span>
        )}
        {flowEdges.length > 0 && (
          <span>
            <svg width="26" height="8"><path d="M 0 7 Q 13 0, 26 7" fill="none" stroke="#8b96ad" strokeWidth="1.2" /><circle cx="13" cy="3.5" r="2.5" fill="#8b96ad" /></svg>
            {t('topo.flowLegend')}
          </span>
        )}
        <span className="topo-legend-note">
          {Object.keys(overrides).length > 0 && (
            <button className="link-btn" onClick={resetLayout} style={{ marginRight: 12 }}>
              {t('topo.resetLayout')}
            </button>
          )}
          {t(trafficOn ? 'topo.noteMeasured' : 'topo.noteSelector')}
        </span>
      </div>
      <svg width={layout.width} height={layout.height} className="topology">
        {/* Ingress → Service 연결선 */}
        {ingEdges.map((e) => (
          <g
            key={e.key}
            className={dimIngEdge(e) ? 'edge dim' : 'edge'}
            onMouseEnter={() => setHover({ type: 'ingEdge', ingKey: e.ingKey, svcKey: e.svcKey })}
            onMouseLeave={() => setHover(null)}
          >
            <title>{t('topo.ingSvc', { ing: e.ingKey, svc: e.svcKey })}</title>
            <path d={e.d} fill="none" stroke="#6f7f9f" strokeWidth={1.5} strokeOpacity={0.5} />
            <circle r={3} fill="#6f7f9f">
              <animateMotion dur="2.4s" repeatCount="indefinite" path={e.d} />
            </circle>
            <path d={e.d} className="flow-hit" />
          </g>
        ))}

        {/* Service → Pod 연결선. Not Ready Pod는 점선(트래픽 제외) */}
        {svcEdges.map((e, i) => {
          // 실측 트래픽이 있으면 점 속도·개수로 세기를 표현한다 (선 굵기는 고정)
          const rx = trafficOn ? podRateMap.get(e.podKey)?.rx : undefined
          const measured = rx !== undefined
          const frac = measured && maxRx > 0 ? Math.min(1, rx / maxRx) : null
          const idle = measured && rx < 50 // 초당 50B 미만이면 사실상 트래픽 없음
          const durNum = frac !== null ? Math.max(0.7, 3.6 - 3.0 * frac) : 2.4
          // 트래픽량에 비례해 점 1~4개 (경로 위 균등 간격)
          const dotCount = idle ? 0 : frac !== null ? 1 + Math.round(frac * 3) : 1
          const baseBegin = (i % 8) * 0.3
          const podRate = podRateMap.get(e.podKey)
          const svcTip = [
            t('topo.svcPod', { svc: e.svcKey, pod: e.podKey }),
            t(e.healthy ? 'topo.routing' : 'topo.notReady'),
            podRate
              ? t('topo.rxtx', { rx: formatMemory(podRate.rx), tx: formatMemory(podRate.tx) }) + (idle ? t('topo.noTraffic') : '')
              : null,
          ]
            .filter(Boolean)
            .join('\n')
          return (
            <g
              key={e.key}
              className={dimSvcEdge(e) ? 'edge dim' : 'edge'}
              onMouseEnter={() => setHover({ type: 'svcEdge', svcKey: e.svcKey, podKey: e.podKey })}
              onMouseLeave={() => setHover(null)}
            >
              <title>{svcTip}</title>
              {e.healthy ? (
                <>
                  <path
                    d={e.d}
                    fill="none"
                    stroke={e.color}
                    strokeWidth={1.5}
                    strokeOpacity={idle ? 0.15 : 0.45}
                  />
                  {Array.from({ length: dotCount }, (_, k) => (
                    <circle key={k} r={3.5} fill={e.color}>
                      <animateMotion
                        dur={`${durNum.toFixed(2)}s`}
                        begin={`${(baseBegin + (durNum * k) / dotCount).toFixed(2)}s`}
                        repeatCount="indefinite"
                        path={e.d}
                      />
                    </circle>
                  ))}
                </>
              ) : (
                <path d={e.d} fill="none" className="edge-broken" strokeWidth={1.5} strokeDasharray="5 5" />
              )}
              <path d={e.d} className="flow-hit" />
            </g>
          )
        })}

        {/* 실측 Pod↔Pod 플로우 (Prometheus/Hubble) */}
        {flowEdges.map((e) => {
          const frac = Math.min(1, e.frac)
          const durNum = Math.max(0.7, 3.2 - 2.5 * frac)
          const dotCount = 1 + Math.round(frac * 3)
          const fromRate = podRateMap.get(e.fromKey)
          const toRate = podRateMap.get(e.toKey)
          const flowTip = [
            t('topo.flow', { from: e.fromKey, to: e.toKey }),
            `${e.rate.toFixed(2)} ${traffic?.edgeUnit ?? ''}`,
            fromRate ? t('topo.fromTx', { v: formatMemory(fromRate.tx) }) : null,
            toRate ? t('topo.toRx', { v: formatMemory(toRate.rx) }) : null,
          ]
            .filter(Boolean)
            .join('\n')
          return (
            <g
              key={e.key}
              className={dimFlowEdge(e) ? 'edge dim' : 'edge'}
              onMouseEnter={() => setHover({ type: 'flowEdge', fromKey: e.fromKey, toKey: e.toKey })}
              onMouseLeave={() => setHover(null)}
            >
              <title>{flowTip}</title>
              <path d={e.d} fill="none" className="flow-edge" strokeWidth={1.2} />
              {Array.from({ length: dotCount }, (_, k) => (
                <circle key={k} r={3} className="flow-dot">
                  <animateMotion
                    dur={`${durNum.toFixed(2)}s`}
                    begin={`${((durNum * k) / dotCount).toFixed(2)}s`}
                    repeatCount="indefinite"
                    path={e.d}
                  />
                </circle>
              ))}
              <path d={e.d} className="flow-hit" />
            </g>
          )
        })}

        {/* Ingress 박스 */}
        {[...layout.ingPos.values()].map(({ ing, x, y }) => {
          const key = `${ing.namespace}/${ing.name}`
          const dim = highlight !== null && !highlight.ingKeys.has(key)
          return (
            <g
              key={key}
              className={dim ? 'ing-box dim' : 'ing-box'}
              onMouseEnter={() => setHover({ type: 'ing', key })}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={x} y={y} width={ING_W} height={ING_H} rx={8} />
              <text x={x + 12} y={y + 20} className="svc-name">
                {ing.name}
              </text>
              <text x={x + 12} y={y + 37} className="svc-meta">
                ingress · {ing.hosts[0] ?? t('topo.noHost')}
              </text>
              <title>{`Ingress ${key}\nhosts: ${ing.hosts.join(', ') || '-'}`}</title>
            </g>
          )
        })}

        {/* 서비스 박스 */}
        {[...layout.svcPos.values()].map(({ svc, x, y }) => {
          const key = `${svc.namespace}/${svc.name}`
          const dim = highlight !== null && !highlight.svcKeys.has(key)
          return (
            <g
              key={key}
              className={dim ? 'svc-box dim' : 'svc-box'}
              onMouseEnter={() => setHover({ type: 'svc', key })}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={x} y={y} width={SVC_W} height={SVC_H} rx={8} />
              <text x={x + 12} y={y + 21} className="svc-name">
                {svc.name}
              </text>
              <text x={x + 12} y={y + 39} className="svc-meta">
                svc · {svc.ports.map((p) => p.port).join(', ') || '-'} · {svc.podKeys.length} pods
              </text>
            </g>
          )
        })}

        {/* 노드 박스와 Pod */}
        {layout.nodeBoxes.map(({ node, x, y, w, h, nsBoxes }) => (
          <g key={node.name}>
            <rect x={x} y={y} width={w} height={h} rx={12} className="node-box" />
            <circle cx={x + 16} cy={y + 17} r={4} className={node.ready ? 'node-dot ok' : 'node-dot error'} />
            <text x={x + 28} y={y + 21} className="node-name">
              {node.name === UNASSIGNED ? t('topo.unassigned') : node.name}
            </text>
            <text x={x + w - 12} y={y + 21} textAnchor="end" className="node-role">
              {node.roles}
            </text>
            {/* 노드 안 네임스페이스 박스 (Pod는 별도 레이어로 위에 그려짐) */}
            {nsBoxes.map((g) => {
              const nsCls = [
                'ns-box',
                highlight !== null && !highlight.nsKeys.has(g.ns) ? 'dim' : '',
                hover?.type === 'ns' && hover.key === g.ns ? 'hovered' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <g
                  key={g.ns}
                  onMouseEnter={() => {
                    setHover({ type: 'ns', key: g.ns })
                    onHoverNamespace?.(g.ns)
                  }}
                  onMouseLeave={() => {
                    setHover(null)
                    onHoverNamespace?.(null)
                  }}
                >
                  <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={8} className={nsCls} />
                  {g.lines.map((line, li) => (
                    <text key={li} x={g.x + 10} y={g.y + 15 + li * 13} className="ns-group-label">
                      {line}
                    </text>
                  ))}
                </g>
              )
            })}
            {/* 헤더 영역 드래그 → 위치 이동 */}
            <rect
              x={x}
              y={y}
              width={w}
              height={NODE_HEAD}
              className="node-drag"
              onMouseDown={(e) => startDrag(e, 'move', node.name, { x, y, w, h })}
            >
              <title>{t('topo.dragMove')}</title>
            </rect>
            {/* 우하단 핸들 드래그 → 폭 조절 (Pod 자동 재정렬) */}
            <path
              d={`M ${x + w - 14} ${y + h - 3} L ${x + w - 3} ${y + h - 14} M ${x + w - 8} ${y + h - 3} L ${x + w - 3} ${y + h - 8}`}
              className="node-resize"
              onMouseDown={(e) => startDrag(e, 'resize', node.name, { x, y, w, h })}
            >
              <title>{t('topo.dragResize')}</title>
            </path>
          </g>
        ))}
        {[...layout.podPos.values()].map(({ pod, x, y }) => {
          const key = `${pod.namespace}/${pod.name}`
          const cls = statusClass(pod.status, pod.phase)
          // 발생 시점 분류: 24시간 이내(fresh/recent)는 만성(chronic)보다 강조
          const recency = pod.problemSince ? problemRecency(pod.problemSince) : null
          const shortName = pod.name.length > 12 ? pod.name.slice(0, 11) + '…' : pod.name
          const dim =
            (highlight !== null && !highlight.podKeys.has(key)) ||
            (problemsOnly && !pod.problemSince) ||
            (query !== '' && !pod.name.toLowerCase().includes(query) && !pod.status.toLowerCase().includes(query))
          const u = usage.get(key)
          const gpu = gpuUsage.get(key)
          const rate = podRateMap.get(key)
          const ringFrac = u && maxCPU > 0 ? Math.max(u.cpuMilli / maxCPU, 0.03) : 0
          const ringCirc = 2 * Math.PI * RING_R
          const gpuFrac = gpu ? Math.max(gpu.utilPercent / 100, 0.02) : 0
          const gpuCirc = 2 * Math.PI * GPU_RING_R
          const tooltip = [
            pod.name,
            t('topo.podStatus', { status: pod.status, ready: pod.ready }),
            pod.problemSince ? t('topo.problem', { label: problemLabel(pod.problemSince, t) }) : null,
            u ? `CPU ${formatCPU(u.cpuMilli)} · MEM ${formatMemory(u.memoryBytes)}` : null,
            (pod.gpu ?? 0) > 0 ? t('topo.gpuAlloc', { n: pod.gpu ?? 0 }) : null,
            gpu ? `GPU ${gpu.utilPercent.toFixed(0)}% · GPU MEM ${formatMemory(gpu.memUsedBytes)}` : null,
            rate ? t('topo.rxtx', { rx: formatMemory(rate.rx), tx: formatMemory(rate.tx) }) : null,
          ]
            .filter(Boolean)
            .join('\n')
          return (
            <g
              key={key}
              className={dim ? 'pod-node dim' : 'pod-node'}
              onClick={() => onSelectPod(pod)}
              onMouseEnter={() => {
                setHover({ type: 'pod', key })
                onHoverNamespace?.(pod.namespace)
              }}
              onMouseLeave={() => {
                setHover(null)
                onHoverNamespace?.(null)
              }}
            >
              {ringFrac > 0 && (
                <circle
                  cx={x}
                  cy={y}
                  r={RING_R}
                  className="cpu-ring"
                  strokeDasharray={`${ringFrac * ringCirc} ${ringCirc}`}
                  transform={`rotate(-90 ${x} ${y})`}
                />
              )}
              {gpu && (
                <circle
                  cx={x}
                  cy={y}
                  r={GPU_RING_R}
                  className="gpu-ring"
                  strokeDasharray={`${gpuFrac * gpuCirc} ${gpuCirc}`}
                  transform={`rotate(-90 ${x} ${y})`}
                />
              )}
              {(pod.gpu ?? 0) > 0 && !gpu && (
                <text x={x + POD_R + 2} y={y - POD_R - 2} className="gpu-mark">
                  G
                </text>
              )}
              {/* 24시간 이내 발생한 비정상 Pod는 맥동하는 후광으로 강조 */}
              {(recency === 'fresh' || recency === 'recent') && (
                <circle cx={x} cy={y} r={POD_R + 6} className={`problem-halo ${recency}`} />
              )}
              <circle
                cx={x}
                cy={y}
                r={POD_R}
                className={`pod-circle ${cls} ${recency ? `prob-${recency}` : ''} ${
                  selectedPodKey === key ? 'selected' : ''
                }`}
              />
              {pod.restarts > 0 && (
                <text x={x} y={y + 4} textAnchor="middle" className="pod-restarts">
                  ↻{pod.restarts}
                </text>
              )}
              <title>{tooltip}</title>
              <text x={x} y={y + POD_R + 14} textAnchor="middle" className="pod-label">
                {shortName}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
