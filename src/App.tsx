import { useState } from 'react'
import { useStaticData, useServiceStatus } from './data'
import { DashboardScreen } from './components/DashboardScreen'
import { YouthScreen } from './components/YouthScreen'
import { AiScreen } from './components/AiScreen'
import { EmptyState, ServicePill, Spinner } from './components/ui'

type Tab = 'dashboard' | 'youth' | 'ai'

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: 'dashboard', label: '산업별 고용 현황', desc: '종사자·빈 일자리·순입직' },
  { id: 'youth', label: '청년 고용구조·징후', desc: '15~29세 취업자·불균형 징후' },
  { id: 'ai', label: 'AI 분석·개선 전략', desc: '근거 기반 보고서' }
]

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const { bundle, dimensions, uiPolicy, sources, loading, error } = useStaticData()
  const { status: services } = useServiceStatus()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <Spinner label="공공데이터 로딩 중" />
          <p className="mt-2 text-xs text-slate-400">정적 R 집계 스냅샷(2026-10-30)을 불러옵니다</p>
        </div>
      </div>
    )
  }

  if (error || !bundle || !dimensions || !uiPolicy || !sources) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg">
          <EmptyState
            title="데이터 로드 실패"
            description={`${error ?? '알 수 없는 오류'} — public/data 및 public/metadata JSON이 존재하는지 확인하세요.`}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* 헤더 */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-sm font-bold text-white">
                CA
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-900 sm:text-base">
                  천안·아산 고용 불균형 징후 탐색
                </h1>
                <p className="text-[11px] text-slate-500">
                  지역 산업별 AI 고용 미스매치 진단·개선 서비스 · 공공데이터 기반
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <ServicePill
                name="정적 데이터"
                ok={true}
                label="정상"
                detail="R 집계 스냅샷 8개 데이터셋 로드 완료"
              />
              <ServicePill
                name="Gemini"
                ok={services.gemini.configured}
                label={services.gemini.configured ? '연결됨' : '미연결'}
                detail={services.gemini.detail}
              />
              <ServicePill
                name="KOSIS"
                ok={services.kosis.configured}
                label={services.kosis.configured ? '키 설정됨' : '인증 필요·미검증'}
                detail={services.kosis.detail}
              />
              <ServicePill
                name="MCP"
                ok={services.mcp.running}
                label={services.mcp.running ? '실행 중' : '미실행'}
                detail={services.mcp.detail}
              />
            </div>
          </div>
          {/* 탭 */}
          <nav className="flex gap-1 overflow-x-auto pb-px">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-t-lg border-b-2 px-3 py-2.5 text-left transition sm:px-4 ${
                  tab === t.id
                    ? 'border-primary-600 bg-primary-50/50 text-primary-800'
                    : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <div className="text-xs font-semibold sm:text-sm">{t.label}</div>
                <div className="hidden text-[10px] text-slate-400 sm:block">{t.desc}</div>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* 배너 */}
      <div className="border-b border-amber-100 bg-amber-50/60">
        <div className="mx-auto max-w-7xl px-4 py-2 text-[11px] leading-relaxed text-amber-900 sm:px-6">
          <b>데이터 성격 안내:</b> 본 서비스의 수치는 2026-10-30에 확인한 정적 R 집계 스냅샷입니다. 청년 통계의
          진단 가능 기간은 <b>2025년 하반기뿐</b>이며, 모든 MDIS 추정치의 오차(SE/RSE/신뢰구간)는{' '}
          <b>미검증</b>입니다. 현재 자료로 실제 구인·구직 미스매치 규모나 인과관계를 확정할 수 없습니다. 청년
          취업자는 청년 구직자가 아닙니다.
        </div>
      </div>

      {/* 본문 */}
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        {tab === 'dashboard' && (
          <DashboardScreen bundle={bundle} dimensions={dimensions} sources={sources} />
        )}
        {tab === 'youth' && <YouthScreen bundle={bundle} dimensions={dimensions} sources={sources} />}
        {tab === 'ai' && (
          <AiScreen
            bundle={bundle}
            dimensions={dimensions}
            sources={sources}
            geminiConfigured={
              services.gemini.status === 'unknown' ? null : services.gemini.configured
            }
          />
        )}
      </main>

      {/* 푸터 */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 text-[11px] leading-relaxed text-slate-500 sm:px-6">
          <p className="font-semibold text-slate-600">데이터 출처</p>
          <p className="mt-1">
            고용노동부 지역별사업체노동력조사(DT_118N_MONA59) · 고용노동부 사업체노동실태현황(DT_118N_SAUPM78) ·
            국가데이터처(MDIS) 지역별고용조사 2025년 하반기 공공용 A형 · 국가데이터처 지역별고용조사
            연령별 취업자(DT_1ES3A03_A01S)
          </p>
          <p className="mt-2">
            본 서비스는 집계 통계만 사용하며 개인별 MDIS 원자료를 포함하지 않습니다. 통계 지표의 정밀도(표본오차)는
            미검증이며, n&lt;30 기준은 비공식 선별 경고입니다. 실시간 API 배지는 실제 성공 응답 증빙이 있는 경우에만
            표시됩니다.
          </p>
          <p className="mt-2 text-slate-400">
            천안·아산 지역 산업별 AI 고용 미스매치 진단·개선 서비스 v1.0 · 데이터 스냅샷 2026-10-30
          </p>
        </div>
      </footer>
    </div>
  )
}
