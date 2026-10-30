import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from 'recharts'
import type { Basis, DataBundle, Dimensions, GroupId, ImbalanceCandidateRow, SourcesMeta } from '../types'
import {
  DIAGNOSIS_STATUS_META,
  fmtPersons,
  fmtPct,
  fmtPp,
  fmtSampleN,
  judgeDiagnosis,
  periodLabel
} from '../types'
import { Card, ChartTooltip, EmptyState, MetricCard, Select, SourceNote, StatusBadge, WarnNote } from './ui'

const GROUP_ORDER: GroupId[] = ['BC', 'F', 'GI', 'DHJK', 'ELS']
const CITY_COLOR: Record<string, string> = { 천안시: '#1d67f0', 아산시: '#10b981' }

interface Props {
  bundle: DataBundle
  dimensions: Dimensions
  sources: SourcesMeta
}

type YouthView = 'detail' | 'common5'

export function YouthScreen({ bundle, dimensions, sources }: Props) {
  const [cityId, setCityId] = useState('asan')
  const [basis, setBasis] = useState<Basis>('workplace')
  const [youthView, setYouthView] = useState<YouthView>('common5')

  const cityName = (id: string) => dimensions.cities.find((c) => c.id === id)?.name ?? id
  const city = cityName(cityId)

  // 청년 자료는 202502 고정 (진단 가능한 유일 보유 기간)
  const YOUTH_PERIOD = '202502'

  const mdisSrc = sources['mdis2025h2']

  // ===== 총계 카드 =====
  const totals = bundle.youth_totals.find((r) => r.basis === basis && r.city === city)
  const isResidence = basis === 'residence'

  // ===== 상세산업(A~U) 탭 =====
  const youthDetail = useMemo(
    () => bundle.industry_youth.filter((r) => r.basis === basis && r.city === city),
    [bundle.industry_youth, basis, city]
  )
  const detailTotal = useMemo(
    () => bundle.industry_youth
      .filter((r) => r.basis === basis && r.city === city && !r.no_sample)
      .reduce((s, r) => s + (r.estimate_persons ?? 0), 0),
    [bundle.industry_youth, basis, city]
  )

  // ===== 공통 5군 탭: 징후 진단 =====
  const candidateRows = useMemo(
    () => bundle.imbalance_candidates.filter((r) => r.basis === basis && r.city === city),
    [bundle.imbalance_candidates, basis, city]
  )
  const sectorRows = useMemo(
    () => bundle.mdis_sector_stats.filter((r) => r.basis === basis && r.city === city),
    [bundle.mdis_sector_stats, basis, city]
  )

  // 산점도 데이터: 상대 공석강도 vs 청년 임금근로자 참여 차이 (두 도시)
  const scatterData = useMemo(() => {
    return bundle.imbalance_candidates
      .filter((r) => r.basis === basis)
      .map((r) => ({
        x: r.vacancy_excess_pp,
        y: r.youth_participation_gap_pp,
        city: r.city,
        group: r.group,
        sector: r.sector,
        n: r.youth_wage_n,
        small: r.small_wage_sample,
        review: r.review_flag
      }))
  }, [bundle.imbalance_candidates, basis])

  const baseline = sectorRows[0]?.city_youth_baseline_pct ?? null

  return (
    <div className="space-y-5">
      <Card
        title="조건 선택"
        subtitle={`청년(만 15~29세) 취업자 자료의 진단 가능 기간은 ${periodLabel(YOUTH_PERIOD, dimensions)}뿐입니다 · 기간 고정`}
        right={
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            <button
              onClick={() => setYouthView('common5')}
              className={`rounded-md px-3 py-1.5 ${youthView === 'common5' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}
            >
              공통 5군 비교·징후
            </button>
            <button
              onClick={() => setYouthView('detail')}
              className={`rounded-md px-3 py-1.5 ${youthView === 'detail' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}
            >
              상세산업 A~U
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-3">
          <Select
            label="지역"
            value={cityId}
            onChange={setCityId}
            options={dimensions.cities.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Select
            label="지역 기준"
            value={basis}
            onChange={(v) => setBasis(v as Basis)}
            options={[
              { value: 'workplace', label: '근무지 기준 (기본)' },
              { value: 'residence', label: '거주지 기준' }
            ]}
            hint="기간: 2025년 하반기 고정 (MDIS 2025년 10월 조사)"
          />
        </div>
        {basis === 'residence' && (
          <div className="mt-3">
            <WarnNote>
              거주지 기준은 <b>주민의 취업구조</b>입니다. 지역 기업의 일자리 수요 통계(사업체 소재지 기준)와 위치 기준이
              다릅니다. 전환해도 수요 통계는 근무지 기준 그대로 표시됩니다.
            </WarnNote>
          </div>
        )}
      </Card>

      {/* 총계 카드 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={`${city} 청년 취업자 추정 (${periodLabel(YOUTH_PERIOD, dimensions)})`}
          value={fmtPersons(totals?.employed ?? null)}
          note={`${basis === 'workplace' ? '근무지' : '거주지'} 기준 · MDIS 가중 추정`}
        />
        <MetricCard
          label="실제 표본수"
          value={fmtSampleN(totals?.employed_n ?? null)}
          note="가중치 적용 전 실제 관측 명수"
          warn={totals?.employed_n != null && totals.employed_n < 30}
        />
        <MetricCard
          label="청년 인구 (거주지)"
          value={isResidence ? fmtPersons(totals?.population ?? null) : '해당 없음'}
          note={isResidence ? '거주지 추계인구' : '근무지 기준 population은 NULL · 0으로 표시하지 않음'}
        />
        <MetricCard
          label="청년 고용률 (거주지)"
          value={isResidence ? fmtPct(totals?.rate_pct ?? null) : '해당 없음'}
          note={isResidence ? '거주지 기준 취업자÷인구' : '근무지 기준 rate_pct는 NULL'}
        />
      </div>

      <WarnNote>
        모든 MDIS 추정치의 표본설계 오차(SE/RSE/신뢰구간)는 <b>미검증</b>입니다. 청년 = 15~29세 <b>취업자</b>이며
        구직자가 아닙니다. 표본 관측 없음(NULL)은 실제 0명과 다릅니다.
      </WarnNote>

      {youthView === 'detail' ? (
        /* ===== 상세산업 A~U 탭 ===== */
        <Card
          title="산업별 청년 취업자 추정치 (상세산업 A~U)"
          subtitle="MDIS 지역별고용조사 · KSIC11 대분류 · 전체산업(A~U) 청년 취업자 분모"
        >
          {youthDetail.length === 0 ? (
            <EmptyState title="자료 없음" description="선택한 조합의 청년 자료가 없습니다." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={youthDetail} margin={{ left: 8, right: 16, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="industry" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as (typeof youthDetail)[number]
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg">
                          <div className="font-semibold text-slate-700">
                            {d.industry}. {dimensions.ksic11_names[d.industry] ?? ''}
                          </div>
                          <div className="mt-1 text-slate-600">
                            추정: <b>{fmtPersons(d.estimate_persons)}</b>
                          </div>
                          <div className="text-slate-600">
                            전체산업 중 구성비:{' '}
                            <b>{d.share_pct == null ? '자료 없음' : `${d.share_pct.toFixed(1)}%`}</b>
                          </div>
                          <div className="text-slate-600">표본: <b>{fmtSampleN(d.sample_n)}</b></div>
                          {d.no_sample && (
                            <div className="mt-1 text-amber-700">표본 관측 없음 — 취업자 0명이 아님</div>
                          )}
                          {!d.no_sample && d.small_sample && (
                            <div className="mt-1 text-amber-700">n&lt;30 소표본 · 판단 유보</div>
                          )}
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="estimate_persons" name="청년 취업자 추정" radius={[4, 4, 0, 0]}>
                    {youthDetail.map((d) => (
                      <Cell
                        key={d.industry}
                        fill={d.no_sample ? '#cbd5e1' : d.small_sample ? '#fbbf24' : '#3385fb'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm bg-slate-300" /> 표본 관측 없음(NULL)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm bg-amber-400" /> n&lt;30 소표본
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm bg-blue-500" /> n≥30 (정밀도는 여전히 미검증)
                </span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[680px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2 pr-3 font-medium">산업</th>
                      <th className="py-2 pr-3 font-medium">청년 취업자 추정</th>
                      <th className="py-2 pr-3 text-right font-medium">구성비(A~U 분모)</th>
                      <th className="py-2 pr-3 text-right font-medium">표본 n</th>
                      <th className="py-2 text-right font-medium">비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {youthDetail.map((d) => (
                      <tr key={d.industry} className="border-b border-slate-100">
                        <td className="py-1.5 pr-3 font-medium text-slate-700">
                          {d.industry}. {dimensions.ksic11_names[d.industry] ?? ''}
                        </td>
                        <td className="py-1.5 pr-3">{fmtPersons(d.estimate_persons)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtPct(d.share_pct)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {d.no_sample ? '0 (관측 없음)' : fmtSampleN(d.sample_n)}
                        </td>
                        <td className="py-1.5 text-right">
                          {d.no_sample ? (
                            <span className="text-slate-500">표본 관측 없음</span>
                          ) : d.small_sample ? (
                            <span className="text-amber-700">소표본·판단 유보</span>
                          ) : (
                            <span className="text-slate-400">정밀도 미검증</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 space-y-2">
                <SourceNote>
                  출처: {mdisSrc?.agency} {mdisSrc?.survey}. 기준기간: 2025년 하반기(조사연월 2025-10). 가중 추정치.
                  share_pct 산식: 산업 청년 취업자 추정 ÷ A~U 전체 청년 취업자 추정 합계({fmtPersons(detailTotal)}) × 100.
                </SourceNote>
                <WarnNote>
                  제조업(C)은 상세산업 단일 대분류이고, 공통 5군 비교의 광·제조업(BC)은 B+C 합계로 분모가 다릅니다.
                  이 탭의 전체산업(A~U) 구성비와 공통 5군 구성비는 분모가 다릅니다. 수요 통계(BC/F/GI/DHJK/ELS)에
                  A/O/T/U 산업은 비교 대상이 아닙니다.
                </WarnNote>
              </div>
            </>
          )}
        </Card>
      ) : (
        /* ===== 공통 5군 비교·징후 탭 ===== */
        <>
          {/* 징후 후보 테이블 */}
          <Card
            title="산업별 불균형 징후 후보 (공통 5군)"
            subtitle="탐색 조건: 지역 전산업보다 공석률이 높고(+) 공통 5군 임금근로자 중 청년 비중이 더 낮은(−) 산업군"
          >
            {candidateRows.length === 0 ? (
              <EmptyState title="자료 없음" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2 pr-3 font-medium">산업군</th>
                      <th className="py-2 pr-3 text-right font-medium">공석률</th>
                      <th className="py-2 pr-3 text-right font-medium">지역 대비 공석률 차이</th>
                      <th className="py-2 pr-3 text-right font-medium">청년 임금근로자 비중</th>
                      <th className="py-2 pr-3 text-right font-medium">지역 기준과 차이</th>
                      <th className="py-2 pr-3 text-right font-medium">청년 임금 표본</th>
                      <th className="py-2 pr-3 font-medium">진단 상태</th>
                      <th className="py-2 font-medium">탐색 조건</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidateRows.map((r) => (
                      <CandidateRowView key={r.group} row={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 space-y-2">
              <SourceNote>
                근거 테이블(imbalance_candidates): 기간 {periodLabel(YOUTH_PERIOD, dimensions)}, {basis === 'workplace' ? '근무지' : '거주지'} 기준. 출처:{' '}
                고용노동부 지역별사업체노동력조사(수요) + {mdisSrc?.agency} 지역별고용조사(청년). 단위: %p.
                vacancy_excess_pp = 산업군 공표 공석률 − 동일 도시·시점 전산업 공표 공석률. youth_participation_gap_pp =
                산업군 임금근로자 중 청년 비중 − 공통 5군 임금근로자 중 청년 비중.
              </SourceNote>
              <WarnNote>
                review_flag(탐색 조건 충족)는 진단이 아니라 부가정보입니다. 진단 상태는 실제 표본수 우선 판단으로
                결정되며, 현재 근무지 기준 조건 충족 3개 행은 모두 청년 임금근로자 표본이 30명 미만입니다.
                두 지표를 점수로 합산하거나 심각도 순위로 사용하지 않습니다.
              </WarnNote>
            </div>
          </Card>

          {/* 산점도 */}
          <Card
            title="상대 공석강도 × 청년 임금근로자 참여 차이 산점도"
            subtitle={`근무지/거주지 기준별 · ${periodLabel(YOUTH_PERIOD, dimensions)} · 점 크기=청년 임금 표본수 · × 표시=n<30`}
          >
            <ResponsiveContainer width="100%" height={380}>
              <ScatterChart margin={{ left: 8, right: 24, top: 16, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="지역 대비 공석률 차이"
                  unit="%p"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="청년 참여 차이"
                  unit="%p"
                  tick={{ fontSize: 11 }}
                />
                <ZAxis type="number" dataKey="n" range={[40, 260]} />
                <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 4" />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as (typeof scatterData)[number]
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg">
                        <div className="font-semibold text-slate-700">
                          {d.city} · {d.sector}
                        </div>
                        <div className="mt-1 text-slate-600">
                          지역 대비 공석률 차이: <b>{fmtPp(d.x)}</b>
                        </div>
                        <div className="text-slate-600">
                          청년 참여 차이: <b>{fmtPp(d.y)}</b>
                        </div>
                        <div className="text-slate-600">청년 임금 표본: <b>{fmtSampleN(d.n)}</b></div>
                        <div className="text-slate-600">
                          탐색 조건: <b>{d.review ? '충족' : '미충족'}</b>
                        </div>
                        {d.small && <div className="mt-1 text-amber-700">n&lt;30 소표본 · 판단 유보</div>}
                      </div>
                    )
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {['천안시', '아산시'].map((c) => (
                  <Scatter
                    key={c}
                    name={c}
                    data={scatterData.filter((d) => d.city === c)}
                    fill={CITY_COLOR[c]}
                    shape={(props: { cx?: number; cy?: number; payload?: (typeof scatterData)[number] }) => {
                      const d = props.payload
                      if (!d) return <g />
                      const size = Math.max(6, Math.min(13, Math.sqrt(d.n ?? 0) * 1.8))
                      if (d.small) {
                        return (
                          <g>
                            <line x1={(props.cx ?? 0) - size} y1={(props.cy ?? 0) - size} x2={(props.cx ?? 0) + size} y2={(props.cy ?? 0) + size} stroke={CITY_COLOR[c]} strokeWidth={2} />
                            <line x1={(props.cx ?? 0) - size} y1={(props.cy ?? 0) + size} x2={(props.cx ?? 0) + size} y2={(props.cy ?? 0) - size} stroke={CITY_COLOR[c]} strokeWidth={2} />
                          </g>
                        )
                      }
                      return (
                        <circle
                          cx={props.cx ?? 0}
                          cy={props.cy ?? 0}
                          r={size}
                          fill={CITY_COLOR[c]}
                          fillOpacity={0.75}
                          stroke={CITY_COLOR[c]}
                        />
                      )
                    }}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
            <div className="mt-2">
              <SourceNote>
                ×(교차) 표시는 청년 임금근로자 표본 n&lt;30인 행입니다. 1사분면(우하단: 공석률 초과+청년 참여 미달)이
                탐색 조건 영역입니다. 지역 기준({basis === 'workplace' ? '근무지' : '거주지'}) 전환 시 청년 지표만
                바뀌며 수요 지표(공석률)는 사업체 소재지 기준 그대로입니다.
              </SourceNote>
            </div>
          </Card>

          {/* 공통 5군 청년 구성비 */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card
              title="공통 5군 청년 취업자 구성비"
              subtitle="전체 취업자 구성비와 청년 구성비 대조 · 분모=공통 5군"
            >
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={sectorRows.map((r) => ({
                    sector: r.sector,
                    youth: r.youth_composition_pct,
                    all: r.all_composition_pct
                  }))}
                  margin={{ left: 8, right: 16, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="sector" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip content={<ChartTooltip formatter={(v) => (v == null ? '자료 없음' : `${Number(v).toFixed(1)}%`)} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="youth" name="청년 구성비" fill="#3385fb" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="all" name="전체연령 구성비" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2">
                <SourceNote>
                  youth_composition_pct = 산업군 청년 취업자 추정 ÷ 공통 5군 청년 취업자 추정 합계 × 100. all_composition_pct는
                  전체연령 동일 산식. MDIS 전체산업(A~U) 비중과는 분모가 다릅니다.
                </SourceNote>
              </div>
            </Card>

            <Card
              title="산업 임금근로자 중 청년 비중"
              subtitle={`지역 공통 5군 기준(${baseline == null ? '자료 없음' : baseline.toFixed(1) + '%'}) 대비 차이`}
            >
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={sectorRows.map((r) => ({
                    sector: r.sector,
                    within: r.youth_within_industry_pct,
                    gap: r.youth_within_industry_pct - r.city_youth_baseline_pct
                  }))}
                  margin={{ left: 8, right: 16, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="sector" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as { sector: string; within: number; gap: number }
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg">
                          <div className="font-semibold text-slate-700">{d.sector}</div>
                          <div className="text-slate-600">청년 비중: <b>{d.within?.toFixed(1)}%</b></div>
                          <div className="text-slate-600">기준 대비: <b>{fmtPp(d.gap)}</b></div>
                        </div>
                      )
                    }}
                  />
                  <ReferenceLine y={baseline ?? 0} stroke="#f59e0b" strokeDasharray="5 3" label={{ value: '지역 기준', position: 'insideTopRight', fontSize: 10 }} />
                  <Bar dataKey="within" name="임금근로자 중 청년 비중" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2">
                <SourceNote>
                  youth_within_industry_pct = 산업군 청년 임금근로자 가중합 ÷ 산업군 전체연령 임금근로자 가중합 × 100.
                  '산업별 청년 고용률'이 아닙니다. 임금근로자는 상용·임시·일용(종사상지위 1·2·3) 범위입니다.
                </SourceNote>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function CandidateRowView({ row }: { row: ImbalanceCandidateRow }) {
  const status = judgeDiagnosis(row, row.period)
  const meta = DIAGNOSIS_STATUS_META[status]
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-2 pr-3 font-medium text-slate-700">{row.sector}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(row.vacancy_rate)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{fmtPp(row.vacancy_excess_pp)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(row.youth_within_industry_pct)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{fmtPp(row.youth_participation_gap_pp)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        <span className={row.small_wage_sample ? 'font-semibold text-amber-700' : ''}>
          {fmtSampleN(row.youth_wage_n)}
        </span>
      </td>
      <td className="py-2 pr-3">
        <div className="flex flex-col gap-1">
          <StatusBadge status={status} />
          <span className="text-[10px] leading-tight text-slate-400">{meta.description}</span>
        </div>
      </td>
      <td className="py-2 text-xs">
        {row.review_flag ? (
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
            충족 (부가정보)
          </span>
        ) : (
          <span className="text-slate-400">미충족</span>
        )}
      </td>
    </tr>
  )
}
