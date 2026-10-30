import { useEffect, useState } from 'react'
import type {
  BusinessStructure2024Row,
  Catalog,
  DataBundle,
  DemandTrendRow,
  Dimensions,
  ImbalanceCandidateRow,
  IndustryStructureRow,
  IndustryYouthRow,
  MdisSectorStatsRow,
  MetricsMeta,
  SourcesMeta,
  UiPolicy,
  YouthTotalsRow
} from './types'

// ===== 정적 JSON 로딩 레이어 =====
// 원칙: 정적 데이터만으로 대시보드가 즉시 실행된다.
// 외부 API(Gemini/KOSIS/MCP)는 별도 비차단 요청이며 이 레이어를阻断하지 않는다.

export interface StaticDataState {
  bundle: DataBundle | null
  dimensions: Dimensions | null
  uiPolicy: UiPolicy | null
  sources: SourcesMeta | null
  catalog: Catalog | null
  metrics: MetricsMeta | null
  loading: boolean
  error: string | null
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} 로드 실패 (HTTP ${res.status})`)
  return res.json() as Promise<T>
}

export function useStaticData(): StaticDataState {
  const [state, setState] = useState<StaticDataState>({
    bundle: null,
    dimensions: null,
    uiPolicy: null,
    sources: null,
    catalog: null,
    metrics: null,
    loading: true,
    error: null
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [
          demand_trend,
          industry_structure,
          business_structure_2024,
          industry_youth,
          youth_totals,
          mdis_reconciliation,
          mdis_sector_stats,
          imbalance_candidates,
          dimensions,
          uiPolicy,
          sources,
          catalog,
          metrics
        ] = await Promise.all([
          fetchJson<DemandTrendRow[]>('/data/demand_trend.json'),
          fetchJson<IndustryStructureRow[]>('/data/industry_structure.json'),
          fetchJson<BusinessStructure2024Row[]>('/data/business_structure_2024.json'),
          fetchJson<IndustryYouthRow[]>('/data/industry_youth.json'),
          fetchJson<YouthTotalsRow[]>('/data/youth_totals.json'),
          fetchJson<unknown[]>('/data/mdis_reconciliation.json'),
          fetchJson<MdisSectorStatsRow[]>('/data/mdis_sector_stats.json'),
          fetchJson<ImbalanceCandidateRow[]>('/data/imbalance_candidates.json'),
          fetchJson<Dimensions>('/metadata/dimensions.json'),
          fetchJson<UiPolicy>('/metadata/ui_policy.json'),
          fetchJson<SourcesMeta>('/metadata/sources.json'),
          fetchJson<Catalog>('/metadata/catalog.json'),
          fetchJson<MetricsMeta>('/metadata/metrics.json')
        ])
        if (cancelled) return
        setState({
          bundle: {
            demand_trend,
            industry_structure,
            business_structure_2024,
            industry_youth,
            youth_totals,
            mdis_reconciliation,
            mdis_sector_stats,
            imbalance_candidates
          },
          dimensions,
          uiPolicy,
          sources,
          catalog,
          metrics,
          loading: false,
          error: null
        })
      } catch (e) {
        if (cancelled) return
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : '데이터 로드 실패'
        }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

// ===== 서버 기능 상태 (Gemini/KOSIS/MCP) - 비차단 조회 =====

export interface ServiceStatus {
  gemini: { configured: boolean; status: 'unknown' | 'ok' | 'unavailable'; detail: string }
  kosis: {
    configured: boolean
    status: 'unknown' | 'ok' | 'unavailable' | 'auth_required'
    detail: string
  }
  mcp: { running: boolean; tools: string[]; detail: string }
}

export const INITIAL_SERVICE_STATUS: ServiceStatus = {
  gemini: { configured: false, status: 'unknown', detail: '확인 중' },
  kosis: { configured: false, status: 'unknown', detail: '확인 중' },
  mcp: { running: false, tools: [], detail: '확인 중' }
}

// 개별 상태를 독립 fetch - 한 곳 실패가 다른 곳을 차단하지 않음
export function useServiceStatus(): {
  status: ServiceStatus
  refresh: () => void
} {
  const [status, setStatus] = useState<ServiceStatus>(INITIAL_SERVICE_STATUS)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    // Gemini 상태
    fetch('/api/ai/status', { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled)
          setStatus((s) => ({
            ...s,
            gemini: {
              configured: !!j.configured,
              status: j.configured ? 'ok' : 'unavailable',
              detail: j.detail ?? ''
            }
          }))
      })
      .catch(() => {
        if (!cancelled)
          setStatus((s) => ({
            ...s,
            gemini: { configured: false, status: 'unavailable', detail: '서버 미실행 또는 통신 실패' }
          }))
      })

    // KOSIS 상태
    fetch('/api/kosis/status', { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled)
          setStatus((s) => ({
            ...s,
            kosis: {
              configured: !!j.configured,
              status: j.configured ? 'ok' : 'auth_required',
              detail: j.detail ?? ''
            }
          }))
      })
      .catch(() => {
        if (!cancelled)
          setStatus((s) => ({
            ...s,
            kosis: { configured: false, status: 'unavailable', detail: '서버 미실행 또는 통신 실패' }
          }))
      })

    // MCP 상태
    fetch('/api/mcp/status', { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled)
          setStatus((s) => ({
            ...s,
            mcp: { running: !!j.running, tools: j.tools ?? [], detail: j.detail ?? '' }
          }))
      })
      .catch(() => {
        if (!cancelled)
          setStatus((s) => ({
            ...s,
            mcp: { running: false, tools: [], detail: 'MCP 서버 상태 조회 실패 (대시보드는 정상 동작)' }
          }))
      })

    return () => {
      cancelled = true
    }
  }, [tick])

  return { status, refresh: () => setTick((t) => t + 1) }
}
