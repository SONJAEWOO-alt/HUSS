// ===== 천안·아산 고용 미스매치 서비스 백엔드 =====
// 설계 원칙: 정적 데이터만으로 웹서비스가 동작하며, Gemini/KOSIS/MCP 실패는 각각 독립적으로 처리된다.
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadData, verifyIntegrity, findRow, cityIdToName, judgeDiagnosis } from './lib/data.mjs'
import { isGeminiConfigured, generateAiReport, buildAiRequest, validateAiResponse } from './lib/gemini.mjs'
import { isKosisConfigured, fetchKosisEmployment, PERIOD_TO_PRD } from './lib/kosis.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT || 8787)
// MCP 서버 URL: 로컬은 8788, 배포 환경은 MCP_URL 환경변수로 오버라이드
const MCP_URL = process.env.MCP_URL || `http://localhost:${Number(process.env.MCP_PORT || 8788)}/mcp`

app.use(cors())
app.use(express.json({ limit: '256kb' }))

const startedAt = new Date().toISOString()
let integrity = null
try {
  integrity = verifyIntegrity()
  if (!integrity.passed) {
    console.error('[data] 데이터 무결성 검증 실패:', JSON.stringify(integrity.datasets.filter((d) => !(d.rows_ok && d.sha256_ok && d.keys_unique))))
  } else {
    console.log('[data] 인계 패키지 무결성 검증 통과 (SHA256·행수·키유일성)')
  }
} catch (e) {
  console.error('[data] 데이터 로드 실패:', e.message)
}

// ===== 헬스체크 =====
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    started_at: startedAt,
    data_integrity: integrity ? integrity.passed : false,
    gemini_configured: isGeminiConfigured(),
    kosis_configured: isKosisConfigured()
  })
})

// ===== 정적 데이터 API =====

// 데이터셋 조회 (허용된 dataset_id만)
app.get('/api/data/:datasetId', (req, res) => {
  const { datasetId } = req.params
  try {
    const { data, metadata } = loadData()
    const ds = metadata.catalog.datasets.find((d) => d.id === datasetId)
    if (!ds) return res.status(404).json({ error: `unknown dataset: ${datasetId}` })
    res.json({
      dataset_id: datasetId,
      rows: data[datasetId],
      row_count: data[datasetId].length,
      meta: {
        keys: ds.keys,
        periods: ds.periods,
        implicit_period: ds.implicit_period,
        source_ids: ds.source_ids,
        scope_warning: ds.scope_warning,
        sample_fields_note: ds.sample_fields_note,
        snapshot_date: metadata.catalog.snapshot_date
      }
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 스냅샷 조회: 조건에 맞는 행 + 메타데이터 + 경고
app.get('/api/snapshot', (req, res) => {
  const { dataset_id, city, period, basis, group } = req.query
  try {
    const { metadata } = loadData()
    const ds = metadata.catalog.datasets.find((d) => d.id === dataset_id)
    if (!ds) return res.status(400).json({ error: `unknown dataset: ${dataset_id}` })
    // period 없는 데이터셋은 implicit_period 적용
    const effPeriod = period ?? ds.implicit_period
    const keyObj = {}
    if (city) keyObj.city = cityIdToName(String(city))
    if (basis) keyObj.basis = String(basis)
    if (group) keyObj.group = String(group)
    if (effPeriod) keyObj.period = effPeriod
    const row = findRow(String(dataset_id), keyObj)
    res.json({
      request_id: `snap_${Date.now().toString(36)}`,
      tool_name: 'get_analysis_snapshot',
      status: row ? 'success' : 'empty',
      source_mode: 'static_r_snapshot',
      api_called: false,
      api_success: null,
      retrieved_at: null,
      snapshot_date: metadata.catalog.snapshot_date,
      dataset_id,
      row,
      units: { employment: 'persons', rates: 'percent', gaps: 'percentage_points' },
      classification: metadata.dimensions.group_labels[group ?? ''] ?? null,
      warnings: [
        ds.scope_warning,
        ds.sample_fields_note,
        ...(row?.precision ? [`정밀도: ${row.precision}`] : [])
      ]
    })
  } catch (e) {
    res.status(400).json({ status: 'error', error: e.message })
  }
})

// ===== AI (Gemini) =====

app.get('/api/ai/status', (_req, res) => {
  res.json({
    configured: isGeminiConfigured(),
    model: isGeminiConfigured() ? (process.env.GEMINI_MODEL || 'gemini-3.5-flash') : null,
    detail: isGeminiConfigured()
      ? 'Gemini API 키가 서버에 설정되어 있습니다.'
      : 'GEMINI_API_KEY 미설정 — AI 보고서 생성 불가. 검증된 정적 근거표는 정상 제공됩니다.'
  })
})

// AI 보고서 생성
app.post('/api/ai/report', async (req, res) => {
  const { city, period, basis, group } = req.body ?? {}
  // 입력 검증: 허용 도시·기간·산업군만
  const { metadata } = loadData()
  const cityOk = metadata.dimensions.cities.some((c) => c.id === city)
  const periodOk = metadata.dimensions.periods.some((p) => p.id === period)
  const groupOk = group === 'ALL' || metadata.catalog.datasets.find((d) => d.id === 'demand_trend')
  const basisOk = basis === 'workplace' || basis === 'residence'
  if (!cityOk || !periodOk || !basisOk || !groupOk) {
    return res.status(400).json({
      ok: false,
      reason: 'bad_request',
      detail: '허용되지 않은 조회 조건입니다.'
    })
  }

  const result = await generateAiReport({ city, period, basis, group })
  // 요청 evidence는 항상 반환 (AI 미연결 시에도 근거표 제공)
  const evidenceRequest = result.request ?? buildAiRequest({ city, period, basis, group })
  res.json({
    ok: result.ok,
    reason: result.ok ? null : result.reason,
    detail: result.ok ? null : result.detail,
    validation_errors: result.validation_errors ?? null,
    model: result.model ?? null,
    generated_at: result.ok ? new Date().toISOString() : null,
    ai_source: result.ok ? 'gemini_live' : 'none',
    report: result.report ?? null,
    evidence_request: evidenceRequest
  })
})

// AI 응답 검증 데모 (개발·테스트용): 임의 응답의 근거 ID·금지어 검사
app.post('/api/ai/validate', (req, res) => {
  const { report, selection } = req.body ?? {}
  if (!report || !selection) return res.status(400).json({ error: 'report와 selection 필요' })
  const request = buildAiRequest(selection)
  const errors = validateAiResponse(report, request)
  res.json({ valid: errors.length === 0, errors })
})

// ===== KOSIS =====

app.get('/api/kosis/status', (_req, res) => {
  res.json({
    configured: isKosisConfigured(),
    table_id: 'DT_118N_MONA59',
    detail: isKosisConfigured()
      ? 'KOSIS_API_KEY가 설정되어 있습니다. 실제 호출 성공 시에만 연결 성공으로 표시됩니다.'
      : 'KOSIS_API_KEY 미설정 — 인증 필요·실제 호출 미검증 상태. 조회 코드·오류 처리는 구현 완료.'
  })
})

app.post('/api/kosis/employment', async (req, res) => {
  const { city, period, group } = req.body ?? {}
  const { metadata } = loadData()
  const cityOk = metadata.dimensions.cities.some((c) => c.id === city)
  const periodOk = Boolean(PERIOD_TO_PRD[period])
  const groupOk = ['ALL', 'BC', 'F', 'GI', 'DHJK', 'ELS'].includes(group)
  if (!cityOk || !periodOk || !groupOk) {
    return res.status(400).json({
      status: 'error',
      detail: '허용되지 않은 조회 조건 (city: cheonan/asan, period: 202401~202601, group: ALL/BC/F/GI/DHJK/ELS)'
    })
  }
  const result = await fetchKosisEmployment({ cityId: city, period, group })
  res.json(result)
})

// ===== MCP 상태 =====

app.get('/api/mcp/status', async (_req, res) => {
  try {
    const r = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'status-probe', version: '1.0' } } }),
      signal: AbortSignal.timeout(4000)
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json().catch(() => null)
    res.json({ running: true, tools: [], detail: `MCP 서버 응답 정상 (server: ${j?.result?.serverInfo?.name ?? 'unknown'})` })
  } catch (e) {
    res.json({ running: false, tools: [], detail: 'MCP 서버 미실행 (기본 웹서비스는 영향 없음)' })
  }
})

// MCP 도구 호출 프록시 (Streamable HTTP)
app.post('/api/mcp/call', async (req, res) => {
  const { tool, args } = req.body ?? {}
  if (!tool || typeof tool !== 'string') return res.status(400).json({ error: 'tool 필요' })
  const ALLOWED_TOOLS = ['get_analysis_snapshot', 'fetch_kosis_employment', 'compare_employment_signals', 'get_indicator_metadata']
  if (!ALLOWED_TOOLS.includes(tool)) return res.status(400).json({ error: `허용되지 않은 도구: ${tool}` })

  try {
    // 1) initialize
    const initRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'web-proxy', version: '1.0' } } }),
      signal: AbortSignal.timeout(6000)
    })
    const session = initRes.headers.get('mcp-session-id')
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    if (session) headers['mcp-session-id'] = session
    // initialize 후 initialized notification
    await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      signal: AbortSignal.timeout(4000)
    }).catch(() => {})
    // 2) tools/call
    const callRes = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args ?? {} } }),
      signal: AbortSignal.timeout(20000)
    })
    const text = await callRes.text()
    // Streamable HTTP는 JSON 또는 SSE로 응답
    let payload = null
    try {
      payload = JSON.parse(text)
    } catch {
      const m = text.match(/data:\s*(\{[\s\S]*\})/g)
      if (m) {
        for (const chunk of m) {
          try {
            const obj = JSON.parse(chunk.replace(/^data:\s*/, ''))
            if (obj.id === 2) payload = obj
          } catch {}
        }
      }
    }
    if (!payload) throw new Error('MCP 응답 파싱 실패')
    res.json({ ok: true, tool, result: payload.result ?? payload, session_id: session })
  } catch (e) {
    res.status(502).json({ ok: false, tool, error: `MCP 호출 실패: ${e.message}` })
  }
})

// ===== 프로덕션 정적 서빙 (선택) =====
const distDir = path.resolve(__dirname, '../dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`[server] 백엔드 실행 중: http://localhost:${PORT}`)
  console.log(`[server] Gemini: ${isGeminiConfigured() ? '키 설정됨' : '미설정(근거표만 제공)'}`)
  console.log(`[server] KOSIS: ${isKosisConfigured() ? '키 설정됨' : '미설정(인증 필요·미검증)'}`)
  console.log(`[server] MCP 서버는 별도 실행: npm run mcp (MCP_URL)`)
})
