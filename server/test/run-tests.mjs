// ===== 백엔드·데이터 통합 테스트 러너 =====
// MCP 테스트는 서버 실행 후 별도 파일(mcp-client-test.mjs)에서 수행한다.
import { loadData, verifyIntegrity, findRow, judgeDiagnosis, buildEvidence, buildWarnings } from '../lib/data.mjs'
import { buildAiRequest, validateAiResponse, isGeminiConfigured } from '../lib/gemini.mjs'
import { isKosisConfigured, fetchKosisEmployment } from '../lib/kosis.mjs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HANDOFF = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../Antigravity_개발인계')

let pass = 0
let fail = 0
const lines = []
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    lines.push(`  ✅ ${name}`)
  } else {
    fail++
    lines.push(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(t) {
  lines.push(`\n${t}`)
}

console.log('=== 백엔드 통합 테스트 ===')

// ===== 1. 데이터 무결성 =====
section('[1] 데이터 무결성')
const integrity = verifyIntegrity()
check('8개 데이터셋 SHA256·행수·키유일성', integrity.passed)

const { data, metadata } = loadData()
check('demand_trend 60행', data.demand_trend.length === 60)
check('imbalance_candidates 20행', data.imbalance_candidates.length === 20)
check('industry_youth 84행', data.industry_youth.length === 84)
check('youth_totals 4행', data.youth_totals.length === 4)

// ===== 2. 핵심 판정 통제값 (docs/05 검증 내역 기준) =====
section('[2] 판정 통제값')
const asanDhjk = findRow('imbalance_candidates', { city: '아산시', basis: 'workplace', period: '202502', group: 'DHJK' })
check('아산 DHJK youth_wage_n=4', asanDhjk?.youth_wage_n === 4)
check('아산 DHJK 진단=insufficient_precision', judgeDiagnosis(asanDhjk, '202502') === 'insufficient_precision')
check('아산 DHJK review_flag=true', asanDhjk?.review_flag === true)

const cheonanDhjk = findRow('imbalance_candidates', { city: '천안시', basis: 'workplace', period: '202502', group: 'DHJK' })
check('천안 DHJK youth_wage_n=13 → 판단 유보', judgeDiagnosis(cheonanDhjk, '202502') === 'insufficient_precision')

const cheonanF = findRow('imbalance_candidates', { city: '천안시', basis: 'workplace', period: '202502', group: 'F' })
check('천안 F review=true·n=8 → 판단 유보', judgeDiagnosis(cheonanF, '202502') === 'insufficient_precision')

// 근무지 조건 충족 3행 모두 n<30
const wpCandidates = data.imbalance_candidates.filter((r) => r.basis === 'workplace' && r.review_flag)
check('근무지 탐색조건 충족 3개 행', wpCandidates.length === 3)
check('3개 행 모두 판단 유보', wpCandidates.every((r) => judgeDiagnosis(r, '202502') === 'insufficient_precision'))

// 202601 진단 요청 → unavailable (기간 불일치 방지)
check('202601 진단 요청 → unavailable', judgeDiagnosis(asanDhjk, '202601') === 'unavailable')

// ===== 3. NULL/0 구분 =====
section('[3] NULL과 0 구분')
const workplaceTotal = data.youth_totals.find((r) => r.basis === 'workplace' && r.city === '아산시')
check('근무지 population=NULL', workplaceTotal?.population === null)
check('근무지 rate_pct=NULL', workplaceTotal?.rate_pct === null)

const noSampleRow = data.industry_youth.find((r) => r.basis === 'residence' && r.city === '천안시' && r.industry === 'B')
check('표본 없는 산업 estimate=NULL', noSampleRow?.estimate_persons === null)
check('표본 없는 산업 no_sample=true·sample_n=0', noSampleRow?.no_sample === true && noSampleRow?.sample_n === 0)

// no_sample 진단
check('no_sample 진단', judgeDiagnosis({ ...asanDhjk, youth_wage_n: 0, no_sample: true }, '202502') === 'no_sample')
// 경계값 30 → 조건 충족 시 exploratory_signal
check('n=30+조건충족 → exploratory_signal', judgeDiagnosis({ ...asanDhjk, youth_wage_n: 30 }, '202502') === 'exploratory_signal')
// n=30+조건미충족 → no_selected_signal (균형 아님)
check('n=30+조건미충족 → no_selected_signal', judgeDiagnosis({ ...asanDhjk, youth_wage_n: 30, review_flag: false }, '202502') === 'no_selected_signal')

// ===== 4. AI evidence 구성 =====
section('[4] AI evidence 구성·검증')
const ev1 = buildEvidence({ city: 'asan', period: '202502', basis: 'workplace', group: 'DHJK' })
check('아산 DHJK 진단 evidence 생성', ev1.evidence.length >= 8)
check('evidence status=insufficient_precision', ev1.status === 'insufficient_precision')
const ids = new Set(ev1.evidence.map((e) => e.id))
check('evidence ID 유일', ids.size === ev1.evidence.length)
check('출처 확장 포함 (agency)', ev1.evidence.every((e) => e.source_ids.length > 0 && e.source_ids[0].agency))

// 202601 → 현황 범위로 제한 (청년 진단 미결합)
const ev2 = buildEvidence({ city: 'cheonan', period: '202601', basis: 'workplace', group: 'BC' })
check('202601은 현황(overview) 범위', ev2.scope === 'overview')
check('202601 evidence에 청년 지표 없음', ev2.evidence.every((e) => !['youth_wage_n', 'youth_participation_gap_pp'].includes(e.field)))

// ALL 그룹은 진단 대상 아님 → overview
const ev3 = buildEvidence({ city: 'asan', period: '202502', basis: 'workplace', group: 'ALL' })
check('ALL 그룹은 현황 범위', ev3.scope === 'overview')

// 존재하지 않는 조합 → unavailable (예: 존재하지 않는 산업군 조합)
const ev4 = buildEvidence({ city: 'asan', period: '202502', basis: 'residence', group: 'ZZZ' })
check('존재하지 않는 조합 → unavailable', ev4.status === 'unavailable' && ev4.evidence.length === 0)
// 202601 청년 진단 조합은 demand_trend 현황으로만 제한됨(자동 결합 금지 확인)
const ev4b = buildEvidence({ city: 'asan', period: '202601', basis: 'workplace', group: 'DHJK' })
check('202601은 현황 범위로 제한 (청년 진단 미결합)', ev4b.scope === 'overview')

// ===== 5. AI 응답 검증기 =====
section('[5] AI 응답 검증기')
const request = buildAiRequest({ city: 'asan', period: '202502', basis: 'workplace', group: 'DHJK' })

// 올바른 응답 통과
const goodResponse = JSON.parse(readFileSync(path.join(HANDOFF, 'ai/response.example.json'), 'utf8'))
const goodErrors = validateAiResponse(goodResponse, request)
check('정상 응답 통과 (인계 예시 응답)', goodErrors.length === 0, goodErrors.join('; '))

// 없는 evidence ID → 차단
const badId = JSON.parse(JSON.stringify(goodResponse))
badId.observations[0].evidence_ids.push('nonexistent_id_123')
check('존재하지 않는 근거 ID 차단', validateAiResponse(badId, request).length > 0)

// status 위조 → 차단
const badStatus = JSON.parse(JSON.stringify(goodResponse))
badStatus.status = 'exploratory_signal'
check('status 위조 차단', validateAiResponse(badStatus, request).length > 0)

// 금지 표현 → 차단
const forbidden = JSON.parse(JSON.stringify(goodResponse))
forbidden.observations[0].text = '이는 통계적으로 유의한 미스매치 심각 사례입니다.'
check('금지 표현 차단', validateAiResponse(forbidden, request).length > 0)

// effect_estimate != null → 차단
const badEffect = JSON.parse(JSON.stringify(goodResponse))
badEffect.proposals[0].effect_estimate = 100
check('효과 추정 수치 차단', validateAiResponse(badEffect, request).length > 0)

// 소표본 경고 삭제 → 차단
const noLimit = JSON.parse(JSON.stringify(goodResponse))
noLimit.limitations = ['일반적인 한계입니다.']
check('소표본 경고 누락 차단', validateAiResponse(noLimit, request).length > 0)

// ===== 6. KOSIS =====
section('[6] KOSIS 모듈')
check('키 미설정 감지 정확', isKosisConfigured() === Boolean(process.env.KOSIS_API_KEY))
if (!process.env.KOSIS_API_KEY) {
  const r = await fetchKosisEmployment({ cityId: 'cheonan', period: '202502', group: 'BC' })
  check('키 미설정 시 auth_required', r.status === 'auth_required')
  check('api_called=false', r.api_called === false)
  check('안내 문구에 미설정 명시', String(r.detail).includes('미설정'))
} else {
  const r = await fetchKosisEmployment({ cityId: 'cheonan', period: '202502', group: 'BC' })
  check('응답 상태 반환', typeof r.status === 'string')
  console.log(`  실제 KOSIS 호출 결과: ${r.status}${r.detail ? ` — ${r.detail}` : ''}`)
}

// ===== 7. 서비스 상태 =====
section('[7] 서비스 설정 상태')
console.log(`  Gemini: ${isGeminiConfigured() ? '설정됨' : '미설정 (근거표만 제공)'}`)
console.log(`  KOSIS: ${isKosisConfigured() ? '설정됨' : '미설정 (인증 필요·미검증)'}`)
check('Gemini 키 상태 불일치 없음', isGeminiConfigured() === Boolean(process.env.GEMINI_API_KEY))

console.log(lines.join('\n'))
console.log(`\n=== 결과: ${pass} 통과 / ${fail} 실패 ===`)
process.exit(fail > 0 ? 1 : 0)
