// ===== 정적 R 집계 데이터 레이어 (백엔드) =====
// 원칙: 기존 JSON을 그대로 읽기만 한다. 새 수치를 생성하거나 다른 기간으로 복제하지 않는다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HANDOFF = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../Antigravity_개발인계')

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(HANDOFF, rel), 'utf8'))

let cache = null

export function loadData() {
  if (cache) return cache
  const files = {
    demand_trend: 'data/demand_trend.json',
    industry_structure: 'data/industry_structure.json',
    business_structure_2024: 'data/business_structure_2024.json',
    industry_youth: 'data/industry_youth.json',
    youth_totals: 'data/youth_totals.json',
    mdis_reconciliation: 'data/mdis_reconciliation.json',
    mdis_sector_stats: 'data/mdis_sector_stats.json',
    imbalance_candidates: 'data/imbalance_candidates.json'
  }
  const data = {}
  for (const [k, rel] of Object.entries(files)) data[k] = readJson(rel)
  const metadata = {
    catalog: readJson('metadata/catalog.json'),
    dimensions: readJson('metadata/dimensions.json'),
    ui_policy: readJson('metadata/ui_policy.json'),
    sources: readJson('metadata/sources.json'),
    metrics: readJson('metadata/metrics.json')
  }
  cache = { data, metadata, snapshot_date: metadata.catalog.snapshot_date }
  return cache
}

// 데이터셋 무결성 검증 (요청마다 재검증하지 않고 로드 시 1회)
export function verifyIntegrity() {
  const { data, metadata } = loadData()
  const results = []
  for (const ds of metadata.catalog.datasets) {
    const rows = data[ds.id]
    const okRows = Array.isArray(rows) && rows.length === ds.rows
    const bytes = fs.readFileSync(path.join(HANDOFF, ds.file))
    const sha = createHash('sha256').update(bytes).digest('hex')
    const keys = okRows ? rows.map((r) => JSON.stringify(ds.keys.map((k) => r[k]))) : []
    const uniqueKeys = new Set(keys).size === keys.length
    results.push({
      id: ds.id,
      rows_ok: okRows,
      sha256_ok: sha === ds.sha256,
      keys_unique: uniqueKeys
    })
  }
  return {
    passed: results.every((r) => r.rows_ok && r.sha256_ok && r.keys_unique),
    datasets: results
  }
}

// ===== 조건 조회 (키 = catalog.keys) =====

export function findRow(datasetId, keyObj) {
  const { data, metadata } = loadData()
  const ds = metadata.catalog.datasets.find((d) => d.id === datasetId)
  if (!ds) throw new Error(`unknown dataset: ${datasetId}`)
  // 허용되지 않은 키 필드가 들어오면 거부 (임의 키 조작 방지)
  for (const k of Object.keys(keyObj)) {
    if (!ds.keys.includes(k) && k !== 'period') throw new Error(`key not allowed: ${k}`)
  }
  // period는 implicit_period로 보완 가능
  const keys = ds.keys
  const matches = (data[datasetId] || []).filter((r) =>
    keys.every((k) => {
      const want = keyObj[k] ?? (k === 'period' ? ds.implicit_period : undefined)
      if (want === undefined) return true
      // city는 id(cheonan/asan) 또는 한글명 모두 허용
      if (k === 'city') return r[k] === want || cityIdToName(want) === r[k]
      return r[k] === want
    })
  )
  // 중복키면 오류로 중지 (docs/01 공통 조회 규약)
  if (matches.length > 1) throw new Error(`duplicate key match in ${datasetId}`)
  return matches[0] ?? null
}

export function cityIdToName(id) {
  const { metadata } = loadData()
  const c = metadata.dimensions.cities.find((x) => x.id === id)
  return c ? c.name : id
}

export function cityNameToId(name) {
  const { metadata } = loadData()
  const c = metadata.dimensions.cities.find((x) => x.name === name)
  return c ? c.id : name
}

// ===== 진단 판단 (ui_policy.json 우선순위 — verify_package.mjs의 judge와 동일) =====

export function judgeDiagnosis(row, period, threshold = 30) {
  if (!row) return 'unavailable'
  if (period !== '202502') return 'unavailable'
  if (row.vacancy_excess_pp == null || row.youth_participation_gap_pp == null) return 'unavailable'
  if (row.no_sample || row.youth_wage_n === 0) return 'no_sample'
  if (row.youth_wage_n == null) return 'unavailable'
  if (row.youth_wage_n < threshold) return 'insufficient_precision'
  return row.review_flag ? 'exploratory_signal' : 'no_selected_signal'
}

// ===== AI 요청 evidence 구성 (ai/request.example.json 구조) =====
// 서버가 허용된 JSON에서만 evidence를 만든다. 사용자가 보낸 숫자는 신뢰하지 않는다.

export function buildEvidence({ city, period, basis, group }) {
  const { data, metadata } = loadData()
  const cityName = cityIdToName(city)
  const sourceExpansion = (ids) => ids.map((id) => ({ id, ...metadata.sources[id] })).filter(Boolean)

  const evidence = []
  const push = (datasetId, rowKey, field, unit, value) => {
    const ds = metadata.catalog.datasets.find((d) => d.id === datasetId)
    if (value === undefined) return
    const id = `${city}_${group}_${field}`
    evidence.push({
      id,
      dataset_id: datasetId,
      row_key: rowKey,
      field,
      value,
      unit,
      source_ids: sourceExpansion(ds?.source_ids ?? []),
      precision: 'unverified'
    })
  }

  const isDiagnosis = period === '202502'
  const key = { city: cityName, period, basis, group }

  // 진단 조건(202502)이면 imbalance_candidates 사용, 그 외엔 demand_trend로 현황 설명으로 제한
  if (isDiagnosis && group !== 'ALL') {
    const row = findRow('imbalance_candidates', { basis, city: cityName, period, group })
    if (!row) return { evidence: [], status: 'unavailable', scope: 'diagnosis' }
    const rk = { city: cityName, basis, period, group }
    push('imbalance_candidates', rk, 'vacancy_rate', '%', row.vacancy_rate)
    push('imbalance_candidates', rk, 'overall_vacancy_rate', '%', row.overall_vacancy_rate)
    push('imbalance_candidates', rk, 'vacancy_excess_pp', '%p', row.vacancy_excess_pp)
    push('imbalance_candidates', rk, 'youth_within_industry_pct', '%', row.youth_within_industry_pct)
    push('imbalance_candidates', rk, 'city_youth_baseline_pct', '%', row.city_youth_baseline_pct)
    push('imbalance_candidates', rk, 'youth_participation_gap_pp', '%p', row.youth_participation_gap_pp)
    push('imbalance_candidates', rk, 'youth_wage_n', '명(표본)', row.youth_wage_n)
    push('imbalance_candidates', rk, 'review_flag', 'boolean', row.review_flag)
    push('imbalance_candidates', rk, 'youth_estimate', '명(추정)', row.youth_estimate)
    push('imbalance_candidates', rk, 'employees', '명', row.employees)
    push('imbalance_candidates', rk, 'vacancies', '명', row.vacancies)
    return { evidence, status: judgeDiagnosis(row, period), scope: 'diagnosis' }
  }

  // 현황(산업 개요) — demand_trend
  const row = findRow('demand_trend', { city: cityName, period, group })
  if (!row) return { evidence: [], status: 'unavailable', scope: 'overview' }
  const rk = { city: cityName, period, group }
  push('demand_trend', rk, 'employees', '명', row.employees)
  push('demand_trend', rk, 'vacancies', '명', row.vacancies)
  push('demand_trend', rk, 'vacancy_rate', '%', row.vacancy_rate)
  push('demand_trend', rk, 'hires', '명', row.hires)
  push('demand_trend', rk, 'separations', '명', row.separations)
  push('demand_trend', rk, 'net_hires', '명', row.net_hires)
  push('demand_trend', rk, 'previous_half_change_pp', '%p', row.previous_half_change_pp)
  return { evidence, status: null, scope: 'overview' }
}

export function buildWarnings({ period, basis, group, scope }) {
  const warnings = [
    '정적 R 집계 스냅샷(2026-10-30 확인)이며 실시간 조회 결과가 아닙니다.',
    '청년 취업자는 청년 구직자가 아닙니다.',
    '탐색 조건은 인과관계·통계적 유의성 검정이 아닙니다.'
  ]
  if (scope === 'diagnosis') {
    warnings.push('MDIS 추정치의 SE/RSE/신뢰구간은 미검증입니다. n<30 기준은 비공식 선별 경고입니다.')
    warnings.push('가구조사 주간과 사업체조사 월말의 기준시점 차이가 있습니다.')
  }
  if (scope === 'overview') {
    warnings.push('지역별사업체노동력조사는 표본수·RSE 미확보이며 202501부터 잠정치입니다.')
  }
  return warnings
}
