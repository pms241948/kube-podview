export interface ContainerSummary {
  name: string
  image: string
  ready: boolean
  restarts: number
  state: string
}

export interface PodSummary {
  name: string
  namespace: string
  phase: string
  status: string
  ready: string
  restarts: number
  nodeName: string
  podIP: string
  gpu?: number
  startTime?: string
  problemSince?: string
  containers: ContainerSummary[]
  labels?: Record<string, string>
}

export interface PodEvent {
  type: 'ADDED' | 'MODIFIED' | 'DELETED'
  pod: PodSummary
}

export interface ContainerUsage {
  name: string
  cpuMilli: number
  memoryBytes: number
}

export interface PodUsage {
  name: string
  namespace: string
  cpuMilli: number
  memoryBytes: number
  containers: ContainerUsage[]
}

export interface MetricsResponse {
  available: boolean
  items: PodUsage[]
}

export interface UserInfo {
  authenticated: boolean
  email?: string
  name?: string
  method?: string
  role?: string
}

export interface AuthMethods {
  enabled: boolean
  oidc: boolean
  local: boolean
}

export interface NodeSummary {
  name: string
  ready: boolean
  roles: string
}

export interface ServicePort {
  port: number
  targetPort: string
  protocol: string
}

export interface ServiceSummary {
  name: string
  namespace: string
  type: string
  clusterIP: string
  ports: ServicePort[]
  podKeys: string[]
}

export interface IngressSummary {
  name: string
  namespace: string
  hosts: string[]
  svcKeys: string[]
}

export interface Topology {
  nodes: NodeSummary[]
  pods: PodSummary[]
  services: ServiceSummary[]
  ingresses: IngressSummary[]
}

export interface PodRate {
  namespace: string
  name: string
  rxBytesSec: number
  txBytesSec: number
}

export interface EdgeRate {
  fromKey: string
  toKey: string
  rate: number
}

export interface TrafficSnapshot {
  available: boolean
  podRates: PodRate[]
  edges: EdgeRate[]
  edgeUnit?: string
}

export interface GPUUsage {
  namespace: string
  name: string
  utilPercent: number
  memUsedBytes: number
}

export interface GPUSnapshot {
  available: boolean
  items: GPUUsage[]
}

export interface EnvEntry {
  name: string
  value?: string
  source?: string
}

export interface ContainerDetail {
  name: string
  image: string
  env: EnvEntry[] | null
  ports: string[] | null
  mounts: string[] | null
}

export interface PodDetailInfo {
  serviceAccount: string
  qosClass: string
  containers: ContainerDetail[] | null
  volumes: { name: string; type: string }[] | null
  conditions: { type: string; status: string; reason?: string; message?: string }[] | null
  events: { type: string; reason: string; message: string; count: number; lastSeen?: string }[] | null
}
