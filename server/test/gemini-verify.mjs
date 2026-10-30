// Gemini 실제 생성 보고서의 수치·근거 정확성 검증
// (API 응답을 다시 받아 자동 검증)
const body = { city: 'asan', period: '202502', basis: 'workplace', group: 'DHJK' }
const res = await fetch('http://localhost:8787/api/ai/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(200000)
})
const j = await res.json()

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name) } else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')) }
}

console.log('=== Gemini 보고서 수치·근거 정확성 검증 ===')
console.log('ok:', j.ok, '/ model:', j.model)

const report = j.report
const ev = j.evidence_request.evidence
const evMap = new Map(ev.map(e => [e.id, e]))

check('보고서 생성 성공 (ai_source=gemini_live)', j.ok && j.ai_source === 'gemini_live')
check('status = insufficient_precision (서버 판단과 일치)', report.status === 'insufficient_precision')

// 근거 ID 존재 검증
const allIds = []
for (const o of report.observations) allIds.push(...o.evidence_ids)
for (const p of report.proposals) allIds.push(...p.basis_evidence_ids)
const invalid = allIds.filter(id => !evMap.has(id))
check('모든 근거 ID가 서버 evidence에 존재', invalid.length === 0, '무효: ' + invalid.join(','))

// 수치 정확성 — 보고서 문장에 나온 수치를 실제 evidence 값과 대조
const text = JSON.stringify(report)
const numberChecks = [
  ['빈일자리율 2.2% (실제 2.2)', text.includes('2.2%') && evMap.get('asan_DHJK_vacancy_rate')?.value === 2.2],
  ['전체 빈일자리율 0.8% (실제 0.8)', text.includes('0.8%') && evMap.get('asan_DHJK_overall_vacancy_rate')?.value === 0.8],
  ['초과 공석률 1.4%p (실제 1.4)', text.includes('1.4%p') && evMap.get('asan_DHJK_vacancy_excess_pp')?.value === 1.4],
  ['청년 비중 10.5253% (실제 10.5253)', text.includes('10.5253') && evMap.get('asan_DHJK_youth_within_industry_pct')?.value === 10.5253],
  ['지역 기준 15.2975% (실제 15.2975)', text.includes('15.2975') && evMap.get('asan_DHJK_city_youth_baseline_pct')?.value === 15.2975],
  ['참여 차이 -4.7722%p (실제 -4.7722)', text.includes('-4.7722') && evMap.get('asan_DHJK_youth_participation_gap_pp')?.value === -4.7722],
  ['표본 n=4 (실제 4)', text.includes('4명') && evMap.get('asan_DHJK_youth_wage_n')?.value === 4]
]
for (const [name, cond] of numberChecks) check('수치 일치: ' + name, cond)

// 보고서 문장 수치가 evidence에 없는 임의 숫자인지 검사 (근거 없는 수치 생성 방지)
// 쉼표 천단위(9,999→9999) 정규화, schema_version(1.0)은 비교 대상에서 제외
const evValues = new Set(ev.map(e => String(e.value)))
const evDerived = new Set(['1.4', '2.2', '0.8', '10.5253', '15.2975', '4.7722', '1042.35', '9999', '165', '4', '30', '1', '0', '1.0'])
const reportText = JSON.stringify({ ...report, schema_version: undefined })
const numsInText = (reportText.match(/\d[\d,]*(?:\.\d+)?/g) || [])
  .map(n => n.replace(/,/g, ''))
  .filter(n => !['1', '0', '2', '3', '2025', '2026', '15', '29', '202502', '11', '20'].includes(n) && n.length <= 7)
const orphan = [...new Set(numsInText)].filter(n => !evValues.has(n) && !evDerived.has(n))
check('근거 없는 임의 수치 없음', orphan.length === 0, '미확인 수치: ' + orphan.join(', '))

// 계약 준수
check('모든 제안 effect_estimate=null', report.proposals.every(p => p.effect_estimate === null))
check('모든 제안 verified_effect=false', report.proposals.every(p => p.verified_effect === false))
check('causal_claims_allowed=false', report.causal_claims_allowed === false)
check('한계에 소표본 경고 포함', report.limitations.some(l => /소표본|n<30|4명/.test(l)))

// 금지 표현
const forbidden = ['미스매치 심각', '미스매치 확정', '균형 확인', '통계적으로 유의', '통계적 유의', '청년 구직자 부족 규모', '검증된 정책 효과', '취업 확률']
const violated = forbidden.filter(f => text.includes(f))
check('금지 표현 없음', violated.length === 0, '위반: ' + violated.join(','))

// 가설 라벨
check('가설에 검증 전 라벨', report.hypotheses.every(h => h.label === '검증 전 가설'))
check('관측 사실 3개 (빈일자리·청년참여·표본)', report.observations.length >= 3)

console.log(`\n=== 결과: ${pass} 통과 / ${fail} 실패 ===`)
process.exit(fail > 0 ? 1 : 0)
