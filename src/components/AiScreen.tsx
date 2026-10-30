import { useState } from 'react'
import type { DataBundle, Dimensions, DiagnosisStatus, SourcesMeta } from '../types'
import { fmtPct, fmtPersons, fmtPp, fmtSampleN, periodLabel } from '../types'
import { Card, EmptyState, MetricCard, Select, SourceNote, Spinner, StatusBadge, WarnNote } from './ui'

interface AiReport {
  schema_version: string
  status: DiagnosisStatus
  observations: { text: string; evidence_ids: string[] }[]
  limitations: string[]
  hypotheses: { text: string; evidence_ids: string[]; label: string; validation_needed: string }[]
  proposals: {
    text: string
    basis_evidence_ids: string[]
    validation_needed: string
    effect_estimate: null
    verified_effect: false
  }[]
  unknowns: string[]
  causal_claims_allowed: false
}

interface EvidenceItem {
  id: string
  dataset_id: string
  row_key: Record<string, unknown>
  field: string
  value: number | boolean | null
  unit: string
  source_ids: { id: string; agency: string; survey: string; url: string }[]
  precision: string
}

interface ReportResponse {
  ok: boolean
  reason: string | null
  detail: string | null
  validation_errors: string[] | null
  model: string | null
  generated_at: string | null
  ai_source: string
  report: AiReport | null
  evidence_request: { selection: { city: string; period: string; basis: string; group: string }; evidence: EvidenceItem[]; warnings: string[]; status: DiagnosisStatus | null; mode: string; snapshot_date: string; task: string }
}

interface Props {
  bundle: DataBundle
  dimensions: Dimensions
  sources: SourcesMeta
  geminiConfigured: boolean | null
}

const GROUPS = ['ALL', 'BC', 'F', 'GI', 'DHJK', 'ELS'] as const

export function AiScreen({ bundle, dimensions, sources, geminiConfigured }: Props) {
  const [cityId, setCityId] = useState('asan')
  const [period, setPeriod] = useState('202502')
  const [basis, setBasis] = useState('workplace')
  const [group, setGroup] = useState('DHJK')
  const [result, setResult] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cityName = (id: string) => dimensions.cities.find((c) => c.id === id)?.name ?? id

  const isDiagnosisPeriod = period === '202502'

  async function generate() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/ai/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: cityId, period, basis, group }),
        signal: AbortSignal.timeout(60000)
      })
      if (!res.ok) throw new Error(`서버 오류 (HTTP ${res.status})`)
      const j = (await res.json()) as ReportResponse
      setResult(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 보고서 요청 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card
        title="AI 분석 조건 선택"
        subtitle="선택 조건의 실제 데이터를 서버가 검증해 Gemini에 근거로 전달합니다. 사용자가 입력한 숫자는 사용하지 않습니다."
      >
        <div className="flex flex-wrap gap-3">
          <Select
            label="지역"
            value={cityId}
            onChange={setCityId}
            options={dimensions.cities.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Select
            label="기간"
            value={period}
            onChange={setPeriod}
            options={dimensions.periods.map((p) => ({
              value: p.id,
              label: p.label + (p.id === '202502' ? ' (진단 가능)' : ' (현황 설명만)')
            }))}
            hint="202502만 청년 징후 진단 결합 가능"
          />
          <Select
            label="지역 기준"
            value={basis}
            onChange={setBasis}
            options={[
              { value: 'workplace', label: '근무지 기준' },
              { value: 'residence', label: '거주지 기준' }
            ]}
          />
          <Select
            label="산업군"
            value={group}
            onChange={setGroup}
            options={GROUPS.map((g) => ({
              value: g,
              label: g === 'ALL' ? '전산업(현황)' : (dimensions.group_labels[g] ?? g)
            }))}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={loading}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loading ? '생성 중…' : 'AI 보고서 생성'}
          </button>
          <span
            className={`text-xs font-medium ${
              geminiConfigured === null
                ? 'text-slate-400'
                : geminiConfigured
                  ? 'text-emerald-600'
                  : 'text-amber-600'
            }`}
          >
            {geminiConfigured === null
              ? 'AI 연결 상태 확인 중…'
              : geminiConfigured
                ? '● Gemini 연결됨 (서버 키 설정됨)'
                : '● AI 미연결 — GEMINI_API_KEY 미설정. 생성 시 근거표만 제공됩니다.'}
          </span>
        </div>
      </Card>

      {loading && (
        <Card>
          <Spinner label="Gemini가 근거 데이터를 바탕으로 보고서를 작성 중" />
          <p className="text-center text-xs text-slate-400">
            서버가 evidence를 구성하고 모델 응답의 근거 ID·금지어를 검증합니다 (최대 60초).
          </p>
        </Card>
      )}

      {error && (
        <Card>
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            요청 실패: {error}
            <div className="mt-1 text-xs text-red-600">
              서버(8787)가 실행 중인지 확인하세요. 서버 미실행 시에도 화면①·②의 정적 분석은 정상 동작합니다.
            </div>
          </div>
        </Card>
      )}

      {result && !result.ok && (
        <Card title="AI 보고서 생성 불가" subtitle={result.reason ?? undefined}>
          <div className="space-y-2">
            <WarnNote>{result.detail ?? '알 수 없는 오류'}</WarnNote>
            {result.validation_errors && (
              <SourceNote>검증 오류: {result.validation_errors.join(' / ')}</SourceNote>
            )}
            <p className="text-xs text-slate-500">
              검증된 근거표는 아래 정상 제공됩니다. AI 생성 문장이 아닌 서버 구성 데이터입니다.
            </p>
          </div>
        </Card>
      )}

      {result?.report && result.ok && (
        <>
          <Card
            title="AI 보고서"
            subtitle={`모델: ${result.model} · 생성: ${result.generated_at ?? ''}`}
            right={result.report.status ? <StatusBadge status={result.report.status} /> : undefined}
          >
            <div className="space-y-5">
              <section>
                <h4 className="mb-2 text-sm font-bold text-slate-800">1. 관측된 사실 (근거 연결)</h4>
                <ul className="space-y-2">
                  {result.report.observations.map((o, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-sm leading-relaxed text-slate-700">
                      {o.text}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {o.evidence_ids.map((id) => (
                          <span key={id} className="rounded bg-primary-50 px-1.5 py-0.5 font-mono text-[10px] text-primary-700">
                            {id}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h4 className="mb-2 text-sm font-bold text-slate-800">2. 통계적 한계</h4>
                <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600">
                  {result.report.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </section>

              {result.report.hypotheses.length > 0 && (
                <section>
                  <h4 className="mb-2 text-sm font-bold text-slate-800">
                    3. 추가 검증이 필요한 원인 가설 <span className="font-normal text-amber-600">(검증 전 가설)</span>
                  </h4>
                  <ul className="space-y-2">
                    {result.report.hypotheses.map((h, i) => (
                      <li key={i} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                        <div className="text-sm leading-relaxed text-slate-700">{h.text}</div>
                        <div className="mt-1.5 text-xs text-amber-800">추가 자료: {h.validation_needed}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {h.evidence_ids.map((id) => (
                            <span key={id} className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-800">
                              {id}
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h4 className="mb-2 text-sm font-bold text-slate-800">
                  4. 개선 전략 제안 <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">검증 전 제안</span>
                </h4>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {result.report.proposals.map((p, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-3">
                      <div className="text-sm leading-relaxed text-slate-700">{p.text}</div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        <span className="font-semibold">검증 필요:</span> {p.validation_needed}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        효과 추정: 없음(정책 효과 미검증) · 근거:{' '}
                        {p.basis_evidence_ids.map((id) => (
                          <span key={id} className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px]">
                            {id}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-sm font-bold text-slate-800">5. 추가로 조사해야 할 항목</h4>
                <div className="flex flex-wrap gap-1.5">
                  {result.report.unknowns.map((u, i) => (
                    <span key={i} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600">
                      {u}
                    </span>
                  ))}
                </div>
              </section>

              <WarnNote>
                이 보고서의 모든 개선 전략은 <b>검증 전 제안</b>입니다. 고용 증가 수치·취업 확률·정책 효과 크기는
                제시되지 않습니다. 현재 자료로 실제 구인·구직 미스매치 규모나 인과관계를 확정할 수 없습니다.
              </WarnNote>
            </div>
          </Card>
        </>
      )}

      {/* 근거표 - AI 연결 여부와 무관하게 항상 표시 */}
      {result?.evidence_request && (
        <Card
          title="근거 데이터 (서버 검증)"
          subtitle="AI 보고서의 수치 근거가 된 실제 데이터 행 · 사용자 입력이 아닌 서버가 구성"
        >
          <div className="mb-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="선택 지역" value={cityName(cityId)} />
            <MetricCard label="기간" value={periodLabel(period, dimensions)} />
            <MetricCard label="기준" value={basis === 'workplace' ? '근무지' : '거주지'} />
            <MetricCard
              label="산업군"
              value={group === 'ALL' ? '전산업' : (dimensions.group_labels[group] ?? group)}
            />
            <MetricCard
              label="모드"
              value={result.evidence_request.mode === 'static_r_snapshot' ? '정적 스냅샷' : result.evidence_request.mode}
              note={`스냅샷: ${result.evidence_request.snapshot_date}`}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">근거 ID</th>
                  <th className="py-2 pr-3 font-medium">데이터셋</th>
                  <th className="py-2 pr-3 font-medium">필드</th>
                  <th className="py-2 pr-3 text-right font-medium">값</th>
                  <th className="py-2 pr-3 font-medium">단위</th>
                  <th className="py-2 font-medium">출처</th>
                </tr>
              </thead>
              <tbody>
                {result.evidence_request.evidence.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-primary-700">{e.id}</td>
                    <td className="py-1.5 pr-3">{e.dataset_id}</td>
                    <td className="py-1.5 pr-3">{e.field}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">
                      {typeof e.value === 'number'
                        ? e.unit === '%'
                          ? fmtPct(e.value)
                          : e.unit === '%p'
                            ? fmtPp(e.value)
                            : e.unit.includes('표본')
                              ? fmtSampleN(e.value)
                              : fmtPersons(e.value)
                        : String(e.value)}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-500">{e.unit}</td>
                    <td className="py-1.5 text-[11px] text-slate-500">
                      {e.source_ids.map((s) => `${s.agency} ${s.survey}`).join(' + ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.evidence_request.evidence.length === 0 && (
            <EmptyState
              title="선택 조건에 근거 데이터가 없습니다"
              description="해당 조합의 데이터 행이 존재하지 않습니다. 다른 기간·산업군을 선택하세요."
            />
          )}
          <div className="mt-3 space-y-2">
            {result.evidence_request.warnings.map((w, i) => (
              <SourceNote key={i}>{w}</SourceNote>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
