// ===== 자체 MCP 서버: 천안·아산 고용 미스매치 진단 도구 =====
// 공식 MCP TypeScript SDK + Streamable HTTP 전송 (http://localhost:8788/mcp)
// 도구 4개:
//   1) get_analysis_snapshot      - 정적 R 집계 JSON 조회
//   2) fetch_kosis_employment     - KOSIS 공식 OpenAPI 직접 조회
//   3) compare_employment_signals - 상대 공석강도·청년 참여 차이 비교 (검증된 진단 규칙)
//   4) get_indicator_metadata     - 출처·산식·기준기간·한계 반환
import 'dotenv/config'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { z } from 'zod'
import { loadData, findRow, cityIdToName, judgeDiagnosis } from '../lib/data.mjs'
import { fetchKosisEmployment, PERIOD_TO_PRD } from '../lib/kosis.mjs'

const PORT = Number(process.env.MCP_PORT || 8788)
const { data, metadata } = loadData()
const uiPolicy = metadata.ui_policy

const server = new McpServer(
  { name: 'cheonan-asan-employment-mcp', version: '1.0.0' },
  {
    instructions:
      '천안·아산 지역 산업별 고용 미스매치 진단 도구. 정적 R 집계 스냅샷과 KOSIS 공식 API를 구분해 제공한다. ' +
      '청년=15~29세 취업자(구직자 아님). 모든 MDIS 추정치는 정밀도 미검증. n<30은 소표본·판단 유보.'
  }
)

// ===== 공통 반환 헬퍼 (docs/04 반환 계약) =====

function envelope(toolName, extra) {
  return {
    request_id: `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    tool_name: toolName,
    served_at: new Date().toISOString(),
    snapshot_date: metadata.catalog.snapshot_date,
    ...extra
  }
}

function rowToText(row) {
  if (!row) return '조건에 해당하는 행이 없습니다.'
  const entries = Object.entries(row)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v === null ? 'NULL' : JSON.stringify(v)}`)
    .join(', ')
  return entries
}

// ===== ① get_analysis_snapshot =====

const datasetEnum = z.enum([
  'demand_trend',
  'industry_structure',
  'business_structure_2024',
  'industry_youth',
  'youth_totals',
  'mdis_reconciliation',
  'mdis_sector_stats',
  'imbalance_candidates'
])

server.tool(
  'get_analysis_snapshot',
  '지역·산업·기간 조건의 정적 R 집계 스냅샷 행 조회. 출처·단위·표본 경고 포함. API 호출 아님.',
  {
    dataset_id: datasetEnum.describe('조회할 데이터셋 ID'),
    city: z.enum(['cheonan', 'asan']).describe('도시 ID'),
    period: z.string().regex(/^20\d{2}0[12]$/).describe('기간 (예: 202502)').optional(),
    basis: z.enum(['workplace', 'residence']).describe('근무지/거주지 기준').optional(),
    group: z.string().describe('산업군 코드 (ALL/BC/F/GI/DHJK/ELS 또는 상세산업 A~U)').optional()
  },
  async ({ dataset_id, city, period, basis, group }) => {
    try {
      const ds = metadata.catalog.datasets.find((d) => d.id === dataset_id)
      const effPeriod = period ?? ds.implicit_period
      const row = findRow(dataset_id, {
        city: cityIdToName(city),
        ...(basis ? { basis } : {}),
        ...(group ? { group } : {}),
        ...(effPeriod ? { period: effPeriod } : {})
      })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              envelope('get_analysis_snapshot', {
                status: row ? 'success' : 'empty',
                source_mode: 'static_r_snapshot',
                api_called: false,
                api_success: null,
                retrieved_at: null,
                dataset_id,
                selection: { city, period: effPeriod ?? null, basis: basis ?? null, group: group ?? null },
                row,
                units: { employment: 'persons', rates: 'percent', gaps: 'percentage_points' },
                classification: metadata.dimensions.group_labels[group ?? ''] ?? null,
                warnings: [
                  ds.scope_warning,
                  ds.sample_fields_note,
                  '정적 R 집계 스냅샷이며 실시간 API 조회 결과가 아님',
                  ...(row?.precision ? [`정밀도: ${row.precision}`] : [])
                ],
                sources: ds.source_ids.map((id) => metadata.sources[id]).filter(Boolean)
              }),
            ),
          },
        ]
      }
    } catch (e) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: e.message }) }],
        isError: true
      }
    }
  }
)

// ===== ② fetch_kosis_employment =====

server.tool(
  'fetch_kosis_employment',
  'KOSIS 공식 OpenAPI(DT_118N_MONA59) 직접 조회. 응답의 지역·기간·항목·단위 검증 후 정규화해 반환. 키 미설정 시 auth_required.',
  {
    city: z.enum(['cheonan', 'asan']).describe('도시 ID'),
    period: z.enum(['202401', '202402', '202501', '202502', '202601']).describe('기간'),
    group: z.enum(['ALL', 'BC', 'F', 'GI', 'DHJK', 'ELS']).describe('산업군')
  },
  async ({ city, period, group }) => {
    const result = await fetchKosisEmployment({ cityId: city, period, group })
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(envelope('fetch_kosis_employment', result))
        }
      ]
    }
  }
)

// ===== ③ compare_employment_signals =====

server.tool(
  'compare_employment_signals',
  '상대 공석강도(vacancy_excess_pp)와 청년 임금근로자 참여 차이(youth_participation_gap_pp) 비교. 검증된 진단 규칙 우선순위 적용, 불충분 표본은 판단 유보.',
  {
    city: z.enum(['cheonan', 'asan']).describe('도시 ID'),
    period: z.literal('202502').describe('진단 가능 기간: 202502만 허용'),
    basis: z.literal('workplace').describe('근무지 기준만 허용'),
    group: z.enum(['BC', 'F', 'GI', 'DHJK', 'ELS']).describe('공통 5개 산업군')
  },
  async ({ city, period, basis, group }) => {
    // 진단 규칙: 202502 근무지 기준 외에는 unavailable
    if (period !== '202502') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              envelope('compare_employment_signals', {
                status: 'empty',
                source_mode: 'static_r_snapshot',
                api_called: false,
                reason: `진단 비교는 202502 근무지 기준만 지원 (요청: ${period})`,
                policy: uiPolicy.missing_period_policy
              })
            )
          }
        ]
      }
    }
    const row = findRow('imbalance_candidates', {
      city: cityIdToName(city),
      basis,
      period,
      group
    })
    const status = judgeDiagnosis(row, period, uiPolicy.small_sample_threshold)
    const statusMeta = {
      unavailable: '자료 없음',
      no_sample: '표본 관측 없음 (취업자 0명이 아님)',
      insufficient_precision: '소표본·판단 유보',
      exploratory_signal: '추가 확인할 징후 (인과·유의성 아님)',
      no_selected_signal: '선택한 기준에서 징후 미확인 (균형 확인 아님)'
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            envelope('compare_employment_signals', {
              status: row ? 'success' : 'empty',
              source_mode: 'static_r_snapshot',
              api_called: false,
              api_success: null,
              retrieved_at: null,
              selection: { city, period, basis, group },
              row,
              diagnosis: {
                status,
                status_label: statusMeta[status],
                youth_wage_n: row?.youth_wage_n ?? null,
                review_flag: row?.review_flag ?? null,
                review_flag_note: '탐색 조건 충족 여부는 부가정보이며 진단이 아님',
                small_sample_threshold: uiPolicy.small_sample_threshold,
                threshold_official: uiPolicy.threshold_official
              },
              signals: row
                ? {
                    vacancy_excess_pp: row.vacancy_excess_pp,
                    youth_participation_gap_pp: row.youth_participation_gap_pp,
                    formula: 'review_flag = vacancy_excess_pp>0 AND youth_participation_gap_pp<0'
                  }
                : null,
              warnings: [
                '청년 취업자는 구직자가 아님',
                'MDIS 추정치의 SE/RSE/CI는 미검증',
                '탐색 조건은 인과·유의성 검정이 아님',
                '가구조사 주간과 사업체조사 월말의 기준시점 차이 존재'
              ],
              forbidden_labels: uiPolicy.forbidden_labels
            })
          )
        }
      ]
    }
  }
)

// ===== ④ get_indicator_metadata =====

server.tool(
  'get_indicator_metadata',
  '지표·데이터셋의 출처·변수·산식·기준기간·표본 필드·분석 한계 반환.',
  {
    dataset_id: datasetEnum.describe('데이터셋 ID').optional(),
    metric_id: z.string().describe('지표 필드명 (예: vacancy_rate)').optional()
  },
  async ({ dataset_id, metric_id }) => {
    const out = envelope('get_indicator_metadata', { status: 'success', source_mode: 'metadata' })
    if (dataset_id) {
      const ds = metadata.catalog.datasets.find((d) => d.id === dataset_id)
      if (!ds) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: `unknown dataset: ${dataset_id}` }) }],
          isError: true
        }
      }
      out.dataset = {
        id: ds.id,
        file: ds.file,
        keys: ds.keys,
        periods: ds.periods,
        implicit_period: ds.implicit_period,
        fields: ds.fields,
        metric_fields: ds.metric_fields,
        sample_fields_note: ds.sample_fields_note,
        scope_warning: ds.scope_warning,
        numeric_precision: ds.numeric_precision,
        web_permission: ds.web_permission,
        sources: ds.source_ids.map((s) => metadata.sources[s]).filter(Boolean)
      }
    }
    if (metric_id) {
      const m = metadata.metrics.metrics.find((x) => x.field === metric_id)
      if (!m) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: `unknown metric: ${metric_id}` }) }],
          isError: true
        }
      }
      out.metric = { ...m, sources: m.source_ids.map((s) => metadata.sources[s]).filter(Boolean) }
    }
    if (!dataset_id && !metric_id) {
      out.available_datasets = metadata.catalog.datasets.map((d) => ({ id: d.id, rows: d.rows, keys: d.keys }))
      out.available_metrics = metadata.metrics.metrics.map((m) => ({ field: m.field, label: m.label, unit: m.unit }))
    }
    out.limits = {
      diagnosis_periods: uiPolicy.diagnosis_periods,
      small_sample_threshold: uiPolicy.small_sample_threshold,
      threshold_official: uiPolicy.threshold_official,
      confidence: uiPolicy.confidence_for_every_mdis_row,
      null_semantics: metadata.metrics.missing,
      guards: data.data_contract_guards ?? null
    }
    return { content: [{ type: 'text', text: JSON.stringify(out) }] }
  }
)

// ===== Streamable HTTP 전송 =====

// SDK 공식 createMcpExpressApp: Host 검증 미들웨어 + express.json() 구성 포함
const app = createMcpExpressApp({ host: 'localhost' })

// 세션리스 모드: 요청마다 새 transport (stateless)
// SDK 규약: express.json()이 파싱한 req.body를 handleRequest 세 번째 인자로 전달해야
// 소비된 스트림을 다시 읽지 않는다.
app.post('/mcp', async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // 세션리스 (상태 없음)
      enableJsonResponse: true
    })
    res.on('close', () => {
      transport.close().catch(() => {})
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e) {
    console.error('[mcp] 요청 처리 오류:', e.message)
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' } })
    }
  }
})

app.get('/mcp', (_req, res) => {
  res.status(405).json({ error: 'GET /mcp는 지원하지 않음 (세션리스 모드)' })
})
app.delete('/mcp', (_req, res) => {
  res.status(405).json({ error: 'DELETE /mcp는 세션리스 모드에서 지원하지 않음' })
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, server: 'cheonan-asan-employment-mcp', version: '1.0.0', transport: 'streamable-http' })
})

app.listen(PORT, () => {
  console.log(`[mcp] 자체 MCP 서버 실행 중: http://localhost:${PORT}/mcp`)
  console.log('[mcp] 도구: get_analysis_snapshot, fetch_kosis_employment, compare_employment_signals, get_indicator_metadata')
})
