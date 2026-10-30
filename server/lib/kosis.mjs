// ===== KOSIS 공식 OpenAPI 모듈 (DT_118N_MONA59 지역별사업체노동력조사) =====
// 공식 문서: https://kosis.kr/openapi/index/index.jsp
// 실호출 검증 완료 (2026-10-30):
//   - 엔드포인트: https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList
//   - 항목코드: 16118z1(전체종사자) z3(빈일자리) z5(빈일자리율) z7(입직자) z11(이직자)
//   - 분류: objL1=지역(ZONE2017Axxxxxx), objL2=산업(IND2017xx)
//   - 시점: prdSe=S(반기), startPrdDe/endPrdDe=YYYYMM형식의 반기코드(202502)
//   - 천안 202502 전산업 API값 = R 스냅샷값과 정확 일치 확인
// 원칙:
// - 인증키는 KOSIS_API_KEY 환경변수로만 관리 (응답·로그에 키 미포함)
// - 실제 API 성공 증빙이 있을 때만 "연결 성공" 표시
// - 응답의 지역(C1)·기간(PRD_DE)·항목(ITM_ID)·단위(UNIT_NM) 검증
// - 정적 R 스냅샷과 출처·기준시점·조회방식을 구분하고 임의 결합하지 않음
import { createHash } from 'node:crypto'
import { cityIdToName } from './data.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KOSIS_BASE = 'https://kosis.kr/openapi/Param/statisticsParameterData.do'
const TABLE_ID = 'DT_118N_MONA59'
const ORG_ID = '118'
const CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.kosis-cache')
const CACHE_TTL_MS = 1000 * 60 * 30 // 30분
const TIMEOUT_MS = Number(process.env.KOSIS_TIMEOUT_MS || 20000)

// KOSIS 실제 항목 코드 (getMeta/getList 실호출로 확인한 값)
export const KOSIS_ITEMS = {
  employees: { itm: '16118z1', label: '전체종사자', unit: '명' },
  vacancies: { itm: '16118z3', label: '빈일자리', unit: '명' },
  vacancy_rate: { itm: '16118z5', label: '빈일자리율', unit: '%' },
  hires: { itm: '16118z7', label: '입직자', unit: '명' },
  separations: { itm: '16118z11', label: '이직자', unit: '명' }
}

// 기간 → KOSIS 반기 수록시점 코드 (실호출로 확인: 202502 형식)
export const PERIOD_TO_PRD = {
  '202401': { start: '202401', end: '202401', label: '2024년 상반기' },
  '202402': { start: '202402', end: '202402', label: '2024년 하반기' },
  '202501': { start: '202501', end: '202501', label: '2025년 상반기' },
  '202502': { start: '202502', end: '202502', label: '2025년 하반기' },
  '202601': { start: '202601', end: '202601', label: '2026년 상반기' }
}

// 산업군 → KOSIS 실제 산업 분류코드 (IND2017xx)
export const GROUP_TO_CODE = {
  ALL: 'IND201700',
  BC: 'IND201701',
  F: 'IND201702',
  GI: 'IND201703',
  DHJK: 'IND201705',
  ELS: 'IND201704'
}

const CITY_META = {
  cheonan: { name: '천안시', kosisZone: 'ZONE2017A343401' },
  asan: { name: '아산시', kosisZone: 'ZONE2017A343404' }
}

export function isKosisConfigured() {
  return Boolean(process.env.KOSIS_API_KEY)
}

// ===== 캐시 =====
function cachePath(key) {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24)
  return path.join(CACHE_DIR, `${hash}.json`)
}
function readCache(key) {
  try {
    const p = cachePath(key)
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (Date.now() - raw.cached_at < CACHE_TTL_MS) return raw
    return null
  } catch {
    return null
  }
}
function writeCache(key, value) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(cachePath(key), JSON.stringify(value, null, 2))
  } catch {
    /* 캐시 실패는 치명적이지 않음 */
  }
}

// KOSIS 비표준 JSON (키에 따옴표 없음) 안전 파서
function parseKosisJson(text) {
  return JSON.parse(text.replace(/([{,])(\w+):/g, '$1"$2":'))
}

// ===== 공식 API 호출 =====

async function callKosis({ cityId, period, group }) {
  const prd = PERIOD_TO_PRD[period]
  const city = CITY_META[cityId]
  if (!prd) throw Object.assign(new Error(`지원하지 않는 기간: ${period}`), { code: 'bad_period' })
  if (!city) throw Object.assign(new Error(`지원하지 않는 지역: ${cityId}`), { code: 'bad_city' })

  const params = new URLSearchParams({
    method: 'getList',
    apiKey: process.env.KOSIS_API_KEY,
    orgId: ORG_ID,
    tblId: TABLE_ID,
    itmId: 'ALL',
    objL1: city.kosisZone,
    objL2: GROUP_TO_CODE[group] ?? 'ALL',
    prdSe: 'S',
    startPrdDe: prd.start,
    endPrdDe: prd.end,
    format: 'json'
  })

  const url = `${KOSIS_BASE}?${params.toString()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const retrievedAt = new Date().toISOString()
  try {
    const res = await fetch(url, { signal: controller.signal })
    const text = await res.text()
    const responseSha256 = createHash('sha256').update(text).digest('hex')
    if (!res.ok) {
      return { httpOk: false, httpStatus: res.status, bodyText: text.slice(0, 500), responseSha256, retrievedAt }
    }
    const trimmed = text.trim()
    // KOSIS는 오류를 200 + {err, errMsg} JSON으로 반환하기도 함
    if (trimmed.startsWith('{')) {
      let errObj = null
      try {
        errObj = parseKosisJson(trimmed)
      } catch {}
      if (errObj?.err) {
        return {
          httpOk: false,
          httpStatus: res.status,
          kosisError: errObj,
          bodyText: trimmed.slice(0, 300),
          responseSha256,
          retrievedAt
        }
      }
    }
    if (!trimmed.startsWith('[')) {
      // 200이더라도 HTML 로그인 화면 등 비정상 응답은 실패 처리
      return {
        httpOk: false,
        httpStatus: res.status,
        bodyText: trimmed.slice(0, 300),
        bodyLooksHtml: /^<!doctype|^<html/i.test(trimmed),
        responseSha256,
        retrievedAt
      }
    }
    return { httpOk: true, httpStatus: res.status, body: parseKosisJson(trimmed), responseSha256, retrievedAt }
  } finally {
    clearTimeout(timer)
  }
}

// ===== 응답 검증·정규화 =====

function validateAndNormalize(body, { cityId, period, group }) {
  const errors = []
  if (!Array.isArray(body)) {
    return { valid: false, errors: ['응답이 배열이 아님'] }
  }
  if (body.length === 0) return { valid: false, errors: ['빈 응답 행'] }

  const city = CITY_META[cityId]
  const prd = PERIOD_TO_PRD[period]
  const wantedItm = new Set(Object.values(KOSIS_ITEMS).map((i) => i.itm))
  const rows = []
  const seenKeys = new Set()

  for (const raw of body) {
    const itm = raw.ITM_ID
    if (!wantedItm.has(itm)) continue // RSE 등 다른 항목은 제외
    const c1 = raw.C1 ?? ''
    const c1Nm = raw.C1_NM ?? ''
    const prdDe = raw.PRD_DE ?? ''
    const unitNm = raw.UNIT_NM ?? ''
    const c2 = raw.C2 ?? ''
    const c2Nm = raw.C2_NM ?? ''
    const value = raw.DT

    // 지역 검증: C1이 요청 지역 ZONE 코드와 일치하는지
    if (c1 !== city.kosisZone) errors.push(`지역 불일치: C1=${c1}(${c1Nm})`)

    // 기간 검증: PRD_DE가 요청 반기 코드와 일치하는지
    if (prdDe !== prd.start) errors.push(`기간 불일치: PRD_DE=${prdDe} (요청 ${prd.start})`)

    // 산업 검증: C2가 요청 산업 코드와 일치하는지
    if (c2 && c2 !== GROUP_TO_CODE[group]) errors.push(`산업 불일치: C2=${c2}(${c2Nm})`)

    // 통계표 검증
    if (raw.TBL_ID && raw.TBL_ID !== TABLE_ID) errors.push(`통계표 불일치: TBL_ID=${raw.TBL_ID}`)

    // 값 검증
    if (value == null || value === '' || value === '-') {
      errors.push(`값 없음: ${itm} ${prdDe}`)
      continue
    }

    const key = `${itm}|${prdDe}`
    if (seenKeys.has(key)) errors.push(`중복키: ${key}`)
    seenKeys.add(key)

    const itemMeta = Object.entries(KOSIS_ITEMS).find(([, v]) => v.itm === itm)
    rows.push({
      item: itemMeta?.[0] ?? itm,
      item_label: itemMeta?.[1].label ?? raw.ITM_NM ?? itm,
      period: prdDe,
      value: Number(value),
      unit: unitNm || (itemMeta?.[1].unit ?? ''),
      raw_unit: unitNm
    })
  }

  // 단위 검증: 명/% 일치
  for (const r of rows) {
    const expected = r.item === 'vacancy_rate' ? '%' : '명'
    if (r.raw_unit && r.raw_unit !== expected) {
      errors.push(`단위 불일치: ${r.item}=${r.raw_unit} (기대 ${expected})`)
    }
  }

  return { valid: errors.length === 0 && rows.length > 0, errors: [...new Set(errors)], rows }
}

// ===== 공개 함수 =====

export async function fetchKosisEmployment({ cityId, period, group }) {
  if (!isKosisConfigured()) {
    return {
      status: 'auth_required',
      api_called: false,
      api_success: false,
      detail: 'KOSIS_API_KEY 미설정 — 인증 필요·실제 호출 미검증 상태입니다.',
      table_id: TABLE_ID,
      query_without_secret: null,
      source_mode: 'static_only'
    }
  }

  const cacheKey = JSON.stringify({ cityId, period, group, table: TABLE_ID })
  const cached = readCache(cacheKey)
  if (cached) {
    return { ...cached, source_mode: 'cache', api_called: false, cache_fetched_at: new Date().toISOString() }
  }

  let result
  try {
    result = await callKosis({ cityId, period, group })
  } catch (e) {
    const isTimeout = e?.name === 'AbortError' || /abort/i.test(String(e?.message))
    return {
      status: 'error',
      api_called: true,
      api_success: false,
      error_code: isTimeout ? 'timeout' : 'network_error',
      detail: isTimeout
        ? `KOSIS 호출 시간초과(${TIMEOUT_MS}ms). 정적 대시보드는 정상 동작합니다.`
        : `KOSIS 네트워크 오류: ${e?.message ?? 'unknown'}`,
      table_id: TABLE_ID,
      source_mode: 'static_only'
    }
  }

  if (!result.httpOk) {
    return {
      status: 'error',
      api_called: true,
      api_success: false,
      error_code: result.kosisError ? `kosis_err_${result.kosisError.err}` : result.bodyLooksHtml ? 'html_login_response' : 'http_error',
      detail: result.kosisError
        ? `KOSIS 기관 오류 응답: err=${result.kosisError.err} ${result.kosisError.errMsg ?? ''}`.trim()
        : `KOSIS 응답 오류 (HTTP ${result.httpStatus}). ${result.bodyLooksHtml ? '로그인/오류 화면 응답' : ''}`,
      response_sha256: result.responseSha256,
      retrieved_at: result.retrievedAt,
      table_id: TABLE_ID,
      source_mode: 'static_only'
    }
  }

  const norm = validateAndNormalize(result.body, { cityId, period, group })
  const responsePayload = {
    status: norm.valid ? 'success' : 'validation_failed',
    api_called: true,
    api_success: norm.valid,
    detail: norm.valid
      ? `KOSIS 공식 API 실제 호출 성공 (${cityIdToName(cityId)}, ${PERIOD_TO_PRD[period]?.label}, group=${group}). 응답 ${norm.rows.length}개 항목 정규화.`
      : `응답 검증 실패: ${norm.errors.join('; ')}`,
    validation_errors: norm.valid ? [] : norm.errors,
    rows: norm.rows,
    units: { employees: '명', vacancies: '명', vacancy_rate: '%', hires: '명', separations: '명' },
    table_id: TABLE_ID,
    table_name: result.body[0]?.TBL_NM ?? null,
    org_id: ORG_ID,
    source_url: 'https://kosis.kr/statHtml/statHtml.do?orgId=118&tblId=DT_118N_MONA59',
    data_reference_period: PERIOD_TO_PRD[period]?.label ?? null,
    retrieved_at: result.retrievedAt,
    response_sha256: result.responseSha256,
    last_changed_date: result.body[0]?.LST_CHN_DE ?? null,
    query_without_secret: {
      endpoint: KOSIS_BASE,
      method: 'getList',
      orgId: ORG_ID,
      tblId: TABLE_ID,
      objL1: CITY_META[cityId]?.kosisZone ?? null,
      objL2: GROUP_TO_CODE[group] ?? null,
      itmId: 'ALL',
      prdSe: 'S',
      startPrdDe: PERIOD_TO_PRD[period]?.start ?? null,
      endPrdDe: PERIOD_TO_PRD[period]?.end ?? null,
      format: 'json'
    },
    warnings: [
      '실시간 조회 성공과 통계 기준기간이 현재라는 것은 다른 개념입니다.',
      '정적 R 스냅샷과 이 API 응답은 조회 방식·수신시각이 다른 별개 자료이며 상호 결합하지 않습니다.'
    ],
    source_mode: 'official_api'
  }

  if (norm.valid) writeCache(cacheKey, responsePayload)
  return responsePayload
}
