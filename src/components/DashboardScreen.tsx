import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { DataBundle, Dimensions, GroupId, SourcesMeta } from '../types'
import { fmtInt, fmtPct, fmtPp, periodLabel } from '../types'
import { Card, ChartTooltip, EmptyState, MetricCard, Select, SourceNote, WarnNote } from './ui'
import { KosisLookupCard } from './KosisLookupCard'

const GROUP_COLORS: Record<string, string> = {
  BC: '#1d67f0',
  F: '#f59e0b',
  GI: '#10b981',
  DHJK: '#8b5cf6',
  ELS: '#ec4899'
}
const GROUP_ORDER: GroupId[] = ['BC', 'F', 'GI', 'DHJK', 'ELS']

interface Props {
  bundle: DataBundle
  dimensions: Dimensions
  sources: SourcesMeta
}

type ViewMode = 'overview' | 'business2024'

export function DashboardScreen({ bundle, dimensions, sources }: Props) {
  const [cityId, setCityId] = useState('both')
  const [period, setPeriod] = useState('202601')
  const [group, setGroup] = useState('ALL')
  const [view, setView] = useState<ViewMode>('overview')

  const cityName = (id: string) => dimensions.cities.find((c) => c.id === id)?.name ?? id
  const cityNames = cityId === 'both' ? ['천안시', '아산시'] : [cityName(cityId)]

  const demandBy = useMemo(() => {
    const map = new Map<string, (typeof bundle.demand_trend)[number]>()
    for (const r of bundle.demand_trend) map.set(`${r.city}|${r.period}|${r.group}`, r)
    return map
  }, [bundle.demand_trend])

  const periodOptions = dimensions.periods.map((p) => ({ value: p.id, label: p.label }))

  // ===== 화면①: 개요 탭 (지역별 고용노동부 지역별사업체노동력조사) =====

  // 선택 지역·기간·산업군 행 (ALL은 지역 카드용)
  const selectedRows = useMemo(() => {
    return cityNames.flatMap((c) => {
      const all = demandBy.get(`${c}|${period}|ALL`)
      const rows = GROUP_ORDER.map((g) => ({ g, row: demandBy.get(`${c}|${period}|${g}`) }))
      return [{ city: c, all, rows }]
    })
  }, [cityNames, period, demandBy])

  // 구성비: 202601은 industry_structure 사전계산값, 그 외는 동일 도시·시점 5군 합계 분모로 계산(산식 메타데이터 표시)
  const shareRows = useMemo(() => {
    const out: { city: string; group: GroupId; sector: string; employees: number | null; share: number | null }[] = []
    for (const { city, rows } of selectedRows) {
      const total = rows.reduce((s, r) => s + (r.row?.employees ?? 0), 0)
      for (const { g, row } of rows) {
        if (period === '202601') {
          const pre = bundle.industry_structure.find((r) => r.city === city && r.period === period && r.group === g)
          out.push({
            city,
            group: g,
            sector: row?.sector ?? pre?.sector ?? g,
            employees: row?.employees ?? null,
            share: pre ? pre.employee_share_pct : null
          })
        } else {
          out.push({
            city,
            group: g,
            sector: row?.sector ?? g,
            employees: row?.employees ?? null,
            share: total > 0 && row?.employees != null ? (100 * row.employees) / total : null
          })
        }
      }
    }
    return out
  }, [selectedRows, period, bundle.industry_structure])

  // 시계열: 빈 일자리율 변화 (5개 군 + 전산업)
  const trendSeries = useMemo(() => {
    return dimensions.periods.map((p) => {
      const point: Record<string, string | number | null> = { period: p.label }
      for (const c of cityNames) {
        for (const g of ['ALL', ...GROUP_ORDER] as GroupId[]) {
          const row = demandBy.get(`${c}|${p.id}|${g}`)
          point[`${c}|${g}`] = row?.vacancy_rate ?? null
        }
      }
      return point
    })
  }, [cityNames, demandBy, dimensions.periods])

  // 지역 비교: 산업구조 비교 차트 (5군 종사자 구성비)
  const compareData = useMemo(() => {
    return GROUP_ORDER.map((g) => {
      const point: Record<string, string | number | null> = { sector: dimensions.group_labels[g] ?? g }
      for (const c of ['천안시', '아산시']) {
        if (cityId === 'both' || c === cityName(cityId)) {
          const row = shareRows.find((r) => r.city === c && r.group === g)
          point[c] = row?.share ?? null
        }
      }
      return point
    })
  }, [shareRows, cityId, cityName, dimensions.group_labels])

  const sel = selectedRows[0]
  const selGroupRow =
    group === 'ALL' ? sel?.all : sel?.rows.find((r) => r.g === group)?.row

  const laborSrc = sources['regional_labor']
  const bizSrc = sources['business2024']

  // ===== 화면①: 2024 사업체노동실태현황 탭 =====
  const [bizRegion, setBizRegion] = useState('천안시')
  const bizRows = useMemo(
    () => bundle.business_structure_2024.filter((r) => r.region === bizRegion),
    [bundle.business_structure_2024, bizRegion]
  )
  const bizTop = useMemo(
    () => [...bizRows].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [bizRows]
  )

  return (
    <div className="space-y-5">
      {/* 필터 바 */}
      <Card
        title="조건 선택"
        subtitle="기준: 사업체 소재지(근무지) · 지역별사업체노동력조사 5개 공표 산업군"
        right={
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            <button
              onClick={() => setView('overview')}
              className={`rounded-md px-3 py-1.5 ${view === 'overview' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}
            >
              고용 현황
            </button>
            <button
              onClick={() => setView('business2024')}
              className={`rounded-md px-3 py-1.5 ${view === 'business2024' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}
            >
              2024 산업대분류
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-3">
          <Select
            label="지역"
            value={cityId}
            onChange={setCityId}
            options={[
              { value: 'both', label: '천안+아산 비교' },
              ...dimensions.cities.map((c) => ({ value: c.id, label: c.name }))
            ]}
          />
          <Select
            label="제공 기간"
            value={period}
            onChange={setPeriod}
            options={periodOptions}
            hint="상반기=4월, 하반기=10월 기준"
          />
          <Select
            label="산업군"
            value={group}
            onChange={setGroup}
            options={[
              { value: 'ALL', label: '전산업(조사 범위)' },
              ...GROUP_ORDER.map((g) => ({
                value: g,
                label: dimensions.group_labels[g] ?? g
              }))
            ]}
            hint={group === 'ALL' ? 'ALL은 지역 카드용이며 5개 산업군에 더하지 않음' : undefined}
          />
        </div>
      </Card>

      {view === 'overview' ? (
        <>
          {/* 지표 카드 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {selectedRows.map(({ city, all }) => (
              <div key={city} className="contents">
                <MetricCard
                  label={`${city} ${group === 'ALL' ? '전산업' : dimensions.group_labels[group]} 종사자`}
                  value={fmtInt(sel2(group, city).employees)}
                  unit="명"
                  note="월말 기준"
                />
                <MetricCard
                  label={`${city} 빈 일자리`}
                  value={fmtInt(sel2(group, city).vacancies)}
                  unit="명"
                />
                <MetricCard
                  label={`${city} 빈 일자리율`}
                  value={fmtPct(sel2(group, city).vacancy_rate)}
                  note="원표 공표율 그대로 사용"
                />
                <MetricCard
                  label={`${city} 순입직`}
                  value={fmtInt(sel2(group, city).net_hires)}
                  unit="명"
                  note="입직자−이직자 (월중 흐름)"
                />
                <MetricCard
                  label={`${city} 전기 대비 공석률`}
                  value={fmtPp(sel2(group, city).previous_half_change_pp)}
                  note="당기−직전 반기 공석률"
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:hidden">
            {selectedRows.map(({ city }) => (
              <Card key={city} title={`${city} 지표`} className="lg:hidden">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>종사자: <b>{fmtInt(sel2(group, city).employees)}</b>명</div>
                  <div>빈 일자리: <b>{fmtInt(sel2(group, city).vacancies)}</b>명</div>
                  <div>빈 일자리율: <b>{fmtPct(sel2(group, city).vacancy_rate)}</b></div>
                  <div>순입직: <b>{fmtInt(sel2(group, city).net_hires)}</b>명</div>
                  <div>입직: <b>{fmtInt(sel2(group, city).hires)}</b>명</div>
                  <div>이직: <b>{fmtInt(sel2(group, city).separations)}</b>명</div>
                </div>
              </Card>
            ))}
          </div>

          {/* 구성비 + 시계열 */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card
              title="산업별 종사자 구성비"
              subtitle={`${periodLabel(period, dimensions)} · 5개 산업군 종사자 합계 분모 기준`}
            >
              {shareRows.every((r) => r.share == null) ? (
                <EmptyState title="선택 조건에 구성비 자료가 없습니다" />
              ) : (
                <div className="space-y-4">
                  {cityNames.map((c) => (
                    <div key={c}>
                      <div className="mb-1 text-xs font-semibold text-slate-600">{c}</div>
                      <ResponsiveContainer width="100%" height={cityNames.length > 1 ? 220 : 300}>
                        <BarChart data={shareRows.filter((r) => r.city === c)} layout="vertical" margin={{ left: 8, right: 24 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis type="number" tick={{ fontSize: 11 }} unit="%" />
                          <YAxis
                            type="category"
                            dataKey="sector"
                            tick={{ fontSize: 11 }}
                            width={130}
                          />
                          <Tooltip
                            content={<ChartTooltip formatter={(v) => (v == null ? '자료 없음' : `${Number(v).toFixed(1)}%`)} />}
                          />
                          <Bar dataKey="share" name="구성비" radius={[0, 4, 4, 0]}>
                            {shareRows
                              .filter((r) => r.city === c)
                              .map((r) => (
                                <Cell key={r.group} fill={GROUP_COLORS[r.group] ?? '#94a3b8'} />
                              ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2">
                <SourceNote>
                  {period === '202601'
                    ? '구성비 출처: industry_structure(202601 사전계산값). 산식 = 해당 산업군 종사자 ÷ 동일 도시·시점 5개 산업군 종사자 합계 × 100.'
                    : `구성비 산식: 동일 도시·시점 5개 산업군 종사자 합계 분모로 앱에서 계산(${periodLabel(period, dimensions)}). 일부 산업만 선택해도 분모는 바뀌지 않음.`}
                </SourceNote>
              </div>
            </Card>

            <Card
              title="산업별 빈 일자리율 변화"
              subtitle={`${cityNames.join(' vs ')} · 기간별 공표 빈 일자리율(%)
              `}
            >
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={trendSeries} margin={{ left: 0, right: 16, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" domain={['auto', 'auto']} />
                  <Tooltip content={<ChartTooltip formatter={(v) => (v == null ? '자료 없음' : `${Number(v).toFixed(1)}%`)} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {cityNames.flatMap((c) =>
                    (group === 'ALL' ? ['ALL'] : [group]).map((g) => (
                      <Line
                        key={`${c}|${g}`}
                        type="monotone"
                        dataKey={`${c}|${g}`}
                        name={`${c} ${g === 'ALL' ? '전산업' : (dimensions.group_labels[g] ?? g)}`}
                        stroke={c === '천안시' ? (g === 'ALL' ? '#0f172a' : GROUP_COLORS[g]) : (g === 'ALL' ? '#64748b' : GROUP_COLORS[g])}
                        strokeWidth={2}
                        strokeDasharray={c === '아산시' ? '6 3' : undefined}
                        connectNulls={false}
                        dot={{ r: 3 }}
                      />
                    ))
                  )}
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-2">
                <SourceNote>
                  빈 일자리율 = 원표 공표율. 202501부터 잠정치. 종사자·빈 일자리는 월말 기준, 입직·이직은 월중 합계.
                </SourceNote>
              </div>
            </Card>
          </div>

          {/* 지역 비교 */}
          {cityId === 'both' && (
            <Card
              title="지역별 산업구조 비교"
              subtitle="천안·아산 5개 산업군 종사자 구성비 대조 · 202601"
            >
              {period !== '202601' && (
                <WarnNote>
                  현재 선택 기간({periodLabel(period, dimensions)})의 구성비입니다. 아래 비교는 선택 기간 기준으로 계산됩니다.
                </WarnNote>
              )}
              <div className="mt-3">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={compareData} margin={{ left: 8, right: 16, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="sector" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" />
                    <YAxis tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip content={<ChartTooltip formatter={(v) => (v == null ? '자료 없음' : `${Number(v).toFixed(1)}%`)} />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {['천안시', '아산시'].map((c) => (
                      <Bar key={c} dataKey={c} name={c} radius={[4, 4, 0, 0]}>
                        {compareData.map((d, i) => (
                          <Cell key={i} fill={c === '천안시' ? '#1d67f0' : '#10b981'} />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2">
                <SourceNote>
                  첫 화면 요약: 아산은 광·제조업(BC) 비중이 천안보다 높고, 천안은 사업·개인서비스 등(ELS) 비중이 상대적으로 높은 산업구조 차이가 관측됩니다. 5개 산업군 합계 분모 기준이며 전체 산업과는 다릅니다.
                </SourceNote>
              </div>
            </Card>
          )}

          {/* 근거 테이블 */}
          <Card title="선택 조건 원본 수치" subtitle="demand_trend JSON 행 그대로 (NULL은 자료 없음)">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-3 font-medium">지역</th>
                    <th className="py-2 pr-3 font-medium">산업군</th>
                    <th className="py-2 pr-3 text-right font-medium">종사자</th>
                    <th className="py-2 pr-3 text-right font-medium">빈 일자리</th>
                    <th className="py-2 pr-3 text-right font-medium">빈 일자리율</th>
                    <th className="py-2 pr-3 text-right font-medium">입직</th>
                    <th className="py-2 pr-3 text-right font-medium">이직</th>
                    <th className="py-2 pr-3 text-right font-medium">순입직</th>
                    <th className="py-2 text-right font-medium">전기 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRows.flatMap(({ city, rows }) =>
                    (group === 'ALL'
                      ? [{ g: 'ALL' as GroupId, row: demandBy.get(`${city}|${period}|ALL`) }]
                      : rows.filter((r) => r.g === group)
                    ).map(({ g, row }) => (
                      <tr key={`${city}|${g}`} className="border-b border-slate-100">
                        <td className="py-1.5 pr-3 font-medium text-slate-700">{city}</td>
                        <td className="py-1.5 pr-3">{g === 'ALL' ? '전산업' : (dimensions.group_labels[g] ?? g)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtInt(row?.employees ?? null)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtInt(row?.vacancies ?? null)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtPct(row?.vacancy_rate ?? null)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtInt(row?.hires ?? null)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtInt(row?.separations ?? null)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtInt(row?.net_hires ?? null)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtPp(row?.previous_half_change_pp ?? null)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-2">
              <SourceNote>
                출처: {laborSrc?.agency} {laborSrc?.survey} ({laborSrc?.table_id}). 기준기간:{' '}
                {periodLabel(period, dimensions)}. 지역기준: 사업체 소재지. 단위: 인원(명), 빈 일자리율(%).
                {Number(period.slice(0, 4)) >= 2025 ? ' 잠정치 포함.' : ''} 표본수·RSE 미확보.
              </SourceNote>
              <WarnNote>
                이 화면의 거주지 기준 선택은 제공되지 않습니다(수요 통계는 사업체 소재지 기준). 전산업 ALL과 5개 산업군은
                분모가 다르며 ALL을 산업군 합계에 더하지 않습니다.
              </WarnNote>
            </div>
          </Card>

          {/* KOSIS 공식 OpenAPI 실시간 조회 (정적 스냅샷과 구분) */}
          <KosisLookupCard cityId={cityId} period={period} group={group} />
        </>
      ) : (
        /* ===== 2024 사업체노동실태현황 탭 ===== */
        <>
          <Card
            title="2024년 산업대분류별 종사자"
            subtitle="사업체노동실태현황 (DT_118N_SAUPM78) · 고용 현황 탭의 지역별사업체노동력조사와 다른 조사입니다"
            right={
              <Select
                label=""
                value={bizRegion}
                onChange={setBizRegion}
                options={dimensions.cities.map((c) => ({ value: c.name, label: c.name }))}
              />
            }
          >
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={bizTop} margin={{ left: 8, right: 16, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="industry"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                  height={70}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as (typeof bizTop)[number]
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg">
                        <div className="font-semibold text-slate-700">
                          {d.industry}. {dimensions.ksic11_names[d.industry] ?? ''}
                        </div>
                        <div className="mt-1 text-slate-600">
                          종사자: <b>{fmtInt(d.value)}</b>명
                        </div>
                        <div className="text-slate-600">
                          확보 18개 산업 내 구성비:{' '}
                          <b>{d.share_pct == null ? '자료 없음' : `${d.share_pct.toFixed(1)}%`}</b>
                        </div>
                      </div>
                    )
                  }}
                />
                <ReferenceLine y={0} stroke="#cbd5e1" />
                <Bar dataKey="value" name="종사자" fill="#3385fb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-2">
              <SourceNote>
                출처: {bizSrc?.agency} {bizSrc?.survey} ({bizSrc?.table_id}). 기준: 2024년 연간, 사업체 소재지.
                단위: 명. KSIC11 확보 18개 대분류(A~S 중 O 제외, T/U 없음) 기준이며 전국사업체조사 전체가 아닙니다.
              </SourceNote>
              <WarnNote>
                이 탭의 수치는 고용 현황 탭(지역별사업체노동력조사, 5개 공표 산업군)과 조사·분류·기간이 모두 다릅니다.
                두 자료를 서로 결합하거나 직접 비교하지 않습니다.
              </WarnNote>
            </div>
          </Card>
        </>
      )}
    </div>
  )

  // 그룹/전체 선택 행 헬퍼 (지역별)
  function sel2(g: string, city: string) {
    if (g === 'ALL') return demandBy.get(`${city}|${period}|ALL`) ?? emptyRow()
    return demandBy.get(`${city}|${period}|${g}`) ?? emptyRow()
  }
}

function emptyRow() {
  return {
    employees: null,
    vacancies: null,
    vacancy_rate: null,
    net_hires: null,
    previous_half_change_pp: null,
    hires: null,
    separations: null
  } as {
    employees: number | null
    vacancies: number | null
    vacancy_rate: number | null
    net_hires: number | null
    previous_half_change_pp: number | null
    hires: number | null
    separations: number | null
  }
}
