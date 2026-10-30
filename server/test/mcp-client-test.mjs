// ===== MCP 클라이언트 통합 테스트 =====
// 실제 MCP 서버(http://localhost:8788/mcp)에 대해 initialize → tools/list → tools/call을
// 실제 수행하고 반환값의 출처·상태를 검증한다.
// 사용법: 1) node mcp/server.mjs (별도 터미널)  2) node test/mcp-client-test.mjs
import 'dotenv/config'
const MCP_URL = process.env.MCP_URL || 'http://localhost:8788/mcp'

let passCount = 0
let failCount = 0
const results = []

function check(name, cond, detail = '') {
  if (cond) {
    passCount++
    results.push(`  ✅ ${name}`)
  } else {
    failCount++
    results.push(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  results.push(`\n${title}`)
}

async function rpc(body, sessionId) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  })
  const text = await res.text()
  // Streamable HTTP 응답: JSON 또는 SSE
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    const dataLines = text.split(/\r?\n/).filter((l) => l.startsWith('data:'))
    for (const line of dataLines) {
      try {
        const obj = JSON.parse(line.replace(/^data:\s*/, ''))
        if (!json || (body.id != null && obj.id === body.id)) json = obj
      } catch {}
    }
  }
  return { status: res.status, json, raw: text, session: res.headers.get('mcp-session-id') }
}

function extractToolResult(json) {
  // tools/call 결과에서 text content 파싱
  const content = json?.result?.content
  if (!Array.isArray(content)) return null
  const textItem = content.find((c) => c.type === 'text')
  if (!textItem?.text) return null
  try {
    return JSON.parse(textItem.text)
  } catch {
    return null
  }
}

async function main() {
  console.log(`=== MCP 클라이언트 통합 테스트 (대상: ${MCP_URL}) ===`)

  // ===== 1. initialize =====
  section('[1] MCP 서버 초기화 (initialize)')
  let sessionId = null
  let init
  try {
    init = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'integration-test-client', version: '1.0.0' }
      }
    })
  } catch (e) {
    console.log(`❌ MCP 서버에 연결할 수 없습니다: ${e.message}`)
    console.log('   먼저 다른 터미널에서 MCP 서버를 실행하세요: cd server && npm run mcp')
    process.exit(1)
  }
  sessionId = init.session
  check('initialize 응답 수신', init.json?.result?.serverInfo != null)
  check(
    '서버 이름 확인',
    init.json?.result?.serverInfo?.name === 'cheonan-asan-employment-mcp',
    `name=${init.json?.result?.serverInfo?.name}`
  )
  console.log(`  서버: ${init.json?.result?.serverInfo?.name} v${init.json?.result?.serverInfo?.version}`)

  // initialized notification
  if (sessionId) {
    await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)
  }

  // ===== 2. tools/list =====
  section('[2] tools/list')
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sessionId)
  const tools = list.json?.result?.tools ?? []
  const toolNames = tools.map((t) => t.name)
  check('도구 4개 등록', tools.length === 4, `count=${tools.length}`)
  for (const expected of [
    'get_analysis_snapshot',
    'fetch_kosis_employment',
    'compare_employment_signals',
    'get_indicator_metadata'
  ]) {
    check(`도구 존재: ${expected}`, toolNames.includes(expected))
  }
  for (const t of tools) {
    check(`도구 설명 있음: ${t.name}`, typeof t.description === 'string' && t.description.length > 10)
  }

  // ===== 3. tools/call: get_analysis_snapshot (정적) =====
  section('[3] tools/call — get_analysis_snapshot (정적 스냅샷)')
  const snap = await rpc(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_analysis_snapshot',
        arguments: { dataset_id: 'imbalance_candidates', city: 'asan', period: '202502', basis: 'workplace', group: 'DHJK' }
      }
    },
    sessionId
  )
  const snapData = extractToolResult(snap.json)
  check('응답 파싱 성공', snapData != null)
  if (snapData) {
    check('status=success', snapData.status === 'success')
    check('source_mode=static_r_snapshot', snapData.source_mode === 'static_r_snapshot')
    check('api_called=false (정적 조회는 API 호출 아님)', snapData.api_called === false)
    check('snapshot_date 존재', typeof snapData.snapshot_date === 'string')
    check('아산시 DHJK 행 반환', snapData.row?.city === '아산시' && snapData.row?.group === 'DHJK')
    check('청년 임금 표본 n=4', snapData.row?.youth_wage_n === 4, `youth_wage_n=${snapData.row?.youth_wage_n}`)
    check('경고 배열 포함', Array.isArray(snapData.warnings) && snapData.warnings.length > 0)
    check('출처 정보 포함', Array.isArray(snapData.sources) && snapData.sources.length > 0)
  }

  // ===== 4. tools/call: compare_employment_signals =====
  section('[4] tools/call — compare_employment_signals (진단 규칙)')
  const cmp = await rpc(
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'compare_employment_signals',
        arguments: { city: 'asan', period: '202502', basis: 'workplace', group: 'DHJK' }
      }
    },
    sessionId
  )
  const cmpData = extractToolResult(cmp.json)
  check('응답 파싱 성공', cmpData != null)
  if (cmpData) {
    check('아산 DHJK 진단 = insufficient_precision', cmpData.diagnosis?.status === 'insufficient_precision')
    check(
      '진단 라벨 = 소표본·판단 유보',
      cmpData.diagnosis?.status_label?.includes('소표본'),
      cmpData.diagnosis?.status_label
    )
    check('review_flag=true 부가정보 유지', cmpData.diagnosis?.review_flag === true)
    check('금지 라벨 목록 포함', Array.isArray(cmpData.forbidden_labels) && cmpData.forbidden_labels.length > 0)
  }

  // 진단 불가 기간 테스트 (202601 → unavailable, 자동대체 금지)
  const cmp2 = await rpc(
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'compare_employment_signals',
        arguments: { city: 'asan', period: '202502', basis: 'workplace', group: 'BC' }
      }
    },
    sessionId
  )
  const cmp2Data = extractToolResult(cmp2.json)
  check('아산 BC(조건 미충족) = no_selected_signal', cmp2Data?.diagnosis?.status === 'no_selected_signal')

  // ===== 5. tools/call: get_indicator_metadata =====
  section('[5] tools/call — get_indicator_metadata')
  const meta = await rpc(
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'get_indicator_metadata', arguments: { metric_id: 'vacancy_rate' } }
    },
    sessionId
  )
  const metaData = extractToolResult(meta.json)
  check('응답 파싱 성공', metaData != null)
  if (metaData) {
    check('vacancy_rate 산식 반환', typeof metaData.metric?.formula === 'string')
    check('한계 정보 포함', metaData.limits?.diagnosis_periods?.includes('202502'))
    check('n<30 비공식 기준 명시', metaData.limits?.threshold_official === false)
  }

  // ===== 6. tools/call: fetch_kosis_employment =====
  section('[6] tools/call — fetch_kosis_employment (KOSIS 공식 API)')
  const kosis = await rpc(
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'fetch_kosis_employment', arguments: { city: 'cheonan', period: '202502', group: 'BC' } }
    },
    sessionId
  )
  const kosisData = extractToolResult(kosis.json)
  check('응답 파싱 성공', kosisData != null)
  if (kosisData) {
    const hasKey = Boolean(process.env.KOSIS_API_KEY)
    if (!hasKey) {
      check('키 미설정 시 status=auth_required', kosisData.status === 'auth_required')
      check('api_called=false', kosisData.api_called === false)
      check('인증 필요·미검증 안내', typeof kosisData.detail === 'string' && kosisData.detail.includes('미설정'))
      console.log('  (KOSIS_API_KEY 미설정 — 코드·오류처리 구현 확인, 실제 호출은 미검증)')
    } else {
      check('status reported', typeof kosisData.status === 'string')
      if (kosisData.status === 'success') {
        check('api_called=true & api_success=true', kosisData.api_called === true && kosisData.api_success === true)
        check('rows 반환', Array.isArray(kosisData.rows) && kosisData.rows.length > 0)
        check('retrieved_at 기록', typeof kosisData.retrieved_at === 'string')
        check('response_sha256 기록', typeof kosisData.response_sha256 === 'string')
      } else {
        console.log(`  실제 호출 결과: ${kosisData.status} — ${kosisData.detail}`)
      }
    }
  }

  // ===== 7. 입력 제한 테스트 =====
  section('[7] 입력 검증 (임의 값 차단)')
  // SDK는 zod 검증 실패를 JSON-RPC error 또는 isError=true 결과로 반환한다 — 둘 다 차단으로 간주
  const isBlocked = (r) =>
    r.json?.error != null || r.json?.result?.isError === true

  const badTool = await rpc(
    {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'not_a_real_tool', arguments: {} }
    },
    sessionId
  )
  check('미등록 도구 호출 차단', isBlocked(badTool))

  const badArgs = await rpc(
    {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'get_analysis_snapshot',
        arguments: { dataset_id: '../../etc/passwd', city: 'asan' }
      }
    },
    sessionId
  )
  check('허용 외 dataset_id 차단 (enum 검증)', isBlocked(badArgs))

  const badCity = await rpc(
    {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'fetch_kosis_employment',
        arguments: { city: 'seoul', period: '202502', group: 'BC' }
      }
    },
    sessionId
  )
  check('허용 외 도시 차단', isBlocked(badCity))

  // ===== 결과 =====
  console.log(results.join('\n'))
  console.log(`\n=== 결과: ${passCount} 통과 / ${failCount} 실패 ===`)
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('테스트 러너 오류:', e)
  process.exit(1)
})
