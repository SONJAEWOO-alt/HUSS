// MCP fetch_kosis_employment 도구 실호출 검증: MCP → KOSIS OpenAPI → 실제 통계 반환
const MCP_URL = 'http://localhost:8788/mcp'

async function rpc(body) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  })
  const text = await res.text()
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
  return json
}

function extract(json) {
  const content = json?.result?.content
  if (!Array.isArray(content)) return null
  const t = content.find((c) => c.type === 'text')
  if (!t?.text) return null
  try {
    return JSON.parse(t.text)
  } catch {
    return null
  }
}

// initialize
const init = await rpc({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'kosis-verify', version: '1.0' } } })
console.log('initialize:', init?.result?.serverInfo?.name, 'v' + init?.result?.serverInfo?.version)

// fetch_kosis_employment 실호출 (천안/202502/ALL)
const r1 = await rpc({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'fetch_kosis_employment', arguments: { city: 'cheonan', period: '202502', group: 'ALL' } }
})
const d1 = extract(r1)
console.log('\n=== fetch_kosis_employment (천안/202502/ALL) ===')
console.log('status:', d1?.status, '/ api_called:', d1?.api_called, '/ api_success:', d1?.api_success)
console.log('source_mode:', d1?.source_mode)
console.log('table:', d1?.table_id, '/', d1?.table_name)
console.log('detail:', d1?.detail)
if (d1?.rows) {
  d1.rows.forEach((r) => console.log(`  ${r.item_label} = ${r.value} ${r.unit} [${r.period}]`))
}
console.log('retrieved_at:', d1?.retrieved_at)
console.log('response_sha256:', String(d1?.response_sha256 || '').slice(0, 16) + '…')
console.log('query_without_secret:', JSON.stringify(d1?.query_without_secret))

// 아산 BC도 검증
const r2 = await rpc({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'fetch_kosis_employment', arguments: { city: 'asan', period: '202502', group: 'BC' } }
})
const d2 = extract(r2)
console.log('\n=== fetch_kosis_employment (아산/202502/BC) ===')
console.log('status:', d2?.status, '/ api_success:', d2?.api_success)
if (d2?.rows) {
  d2.rows.forEach((r) => console.log(`  ${r.item_label} = ${r.value} ${r.unit} [${r.period}]`))
}
