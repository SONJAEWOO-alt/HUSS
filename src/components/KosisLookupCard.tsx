import { useState } from 'react'
import { Card, EmptyState, Spinner, WarnNote } from './ui'

// ===== KOSIS 공식 OpenAPI 실시간 조회 카드 =====
// 정적 R 스냅샷과 공식 API 응답을 구분해서 표시한다. 서로 결합하지 않는다.

interface KosisRow {
  item: string
  item_label: string
  period: string
  value: number
  unit: string
}

interface KosisResult {
  status: string
  api_called: boolean
  api_success: boolean
  detail: string
  rows?: KosisRow[]
  table_id?: string
  table_name?: string
  data_reference_period?: string
  retrieved_at?: string
  response_sha256?: string
  last_changed_date?: string
  validation_errors?: string[]
  source_mode?: string
  cache_fetched_at?: string
  query_without_secret?: Record<string, unknown>
  warnings?: string[]
}

interface Props {
  cityId: string
  period: string
  group: string
}

export function KosisLookupCard({ cityId, period, group }: Props) {
  const [result, setResult] = useState<KosisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchKosis() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/kosis/employment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: cityId, period, group }),
        signal: AbortSignal.timeout(60000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setResult((await res.json()) as KosisResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }

  const isCache = result?.source_mode === 'cache'

  return (
    <Card
      title="KOSIS 공식 OpenAPI 실시간 조회"
      subtitle="현재 선택 조건으로 고용노동부 KOSIS 공식 API를 직접 호출합니다 · 정적 스냅샷과는 별개 자료"
      right={
        <button
          onClick={fetchKosis}
          disabled={loading || cityId === 'both'}
          className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? '조회 중…' : '공식 API 조회'}
        </button>
      }
    >
      {cityId === 'both' && (
        <p className="text-xs text-slate-500">
          지역을 천안시 또는 아산시로 선택하면 조회할 수 있습니다.
        </p>
      )}
      {loading && <Spinner label="KOSIS 공식 API 호출 중" />}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          조회 실패: {error} — 정적 대시보드는 정상 동작합니다.
        </div>
      )}
      {result && !loading && (
        <div className="space-y-3">
          {result.status === 'success' ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                  실제 API 호출 성공 {isCache ? '(캐시 반환)' : ''}
                </span>
                <span className="text-[11px] text-slate-500">
                  {result.table_id} · {result.table_name}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2 pr-3 font-medium">항목</th>
                      <th className="py-2 pr-3 text-right font-medium">값</th>
                      <th className="py-2 pr-3 font-medium">단위</th>
                      <th className="py-2 font-medium">수록시점</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows?.map((r) => (
                      <tr key={r.item} className="border-b border-slate-100">
                        <td className="py-1.5 pr-3 font-medium text-slate-700">{r.item_label}</td>
                        <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">
                          {r.value.toLocaleString('ko-KR')}
                        </td>
                        <td className="py-1.5 pr-3 text-slate-500">{r.unit}</td>
                        <td className="py-1.5 tabular-nums text-slate-500">{r.period}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                수신: {result.retrieved_at} · 기준기간: {result.data_reference_period}
                {result.last_changed_date ? ` · KOSIS 최종수정: ${result.last_changed_date}` : ''} · 응답해시:{' '}
                {result.response_sha256?.slice(0, 12)}…
                <br />
                조회조건(키 제외): {JSON.stringify(result.query_without_secret)}
              </div>
              <WarnNote>
                이 실시간 응답은 조회 방식·수신시각이 다른 별개 자료입니다. 위 정적 대시보드의 R 스냅샷과
                자동으로 결합·대체하지 않습니다. 값 차이는 잠정치 개정 등으로 발생할 수 있습니다.
              </WarnNote>
            </>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              <b>
                {result.status === 'auth_required'
                  ? '인증 필요·미검증'
                  : result.status === 'validation_failed'
                    ? '응답 검증 실패'
                    : '조회 실패'}
              </b>
              : {result.detail}
              {result.validation_errors && result.validation_errors.length > 0 && (
                <div className="mt-1">검증 오류: {result.validation_errors.join('; ')}</div>
              )}
              <div className="mt-1 text-[11px]">
                API 조회 실패 시 정적 대시보드는 그대로 동작합니다. 실패를 성공으로 표시하지 않습니다.
              </div>
            </div>
          )}
        </div>
      )}
      {!result && !loading && !error && cityId !== 'both' && (
        <p className="text-xs text-slate-500">
          버튼을 누르면 선택한 지역·기간·산업군으로 KOSIS 공식 API(DT_118N_MONA59)를 실제 호출합니다.
        </p>
      )}
    </Card>
  )
}
