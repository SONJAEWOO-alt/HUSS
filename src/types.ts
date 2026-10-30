// ===== 인계 패키지 데이터 계약 타입 (metadata/catalog.json 기준) =====
// 원본 JSON 구조를 그대로 반영. NULL과 0을 엄격히 구분하기 위해 null 허용.

export type Basis = 'residence' | 'workplace'
export type GroupId = 'ALL' | 'BC' | 'F' | 'GI' | 'DHJK' | 'ELS'
export type DiagnosisStatus =
  | 'unavailable'
  | 'no_sample'
  | 'insufficient_precision'
  | 'exploratory_signal'
  | 'no_selected_signal'

export interface DemandTrendRow {
  city: string
  period: string
  group: GroupId
  employees: number | null
  separations: number | null
  vacancies: number | null
  vacancy_rate: number | null
  hires: number | null
  sector: string
  net_hires: number | null
  prior_rate: number | null
  previous_half_change_pp: number | null
}

export interface IndustryStructureRow {
  city: string
  period: string
  group: GroupId
  employees: number
  separations: number
  vacancies: number
  vacancy_rate: number
  hires: number
  sector: string
  net_hires: number
  employee_share_pct: number
}

export interface BusinessStructure2024Row {
  source_file: string
  table_id: string
  period: string
  frequency_raw: string
  region_code_raw: string
  region: string
  dimension2_code: string
  dimension2: string
  dimension3_code: string
  dimension3: string
  item_code: string
  item: string
  unit: string
  raw_value: string
  value: number | null
  value_status: string
  source_url: string
  industry: string
  share_pct: number | null
}

export interface IndustryYouthRow {
  basis: Basis
  city: string
  industry: string
  sample_n: number
  estimate_persons: number | null
  effective_n: number | null
  share_pct: number | null
  small_sample: boolean | null
  precision: string | null
  no_sample: boolean
}

export interface YouthTotalsRow {
  basis: Basis
  city: string
  population: number | null
  employed: number | null
  employed_n: number | null
  rate_pct: number | null
}

export interface MdisSectorStatsRow {
  basis: Basis
  city: string
  group: GroupId
  all_n: number
  all_estimate: number
  youth_n: number
  youth_estimate: number
  youth_wage_n: number
  youth_wage_estimate: number
  all_wage_estimate: number
  youth_weight_sq: number
  youth_composition_pct: number
  all_composition_pct: number
  composition_gap_pp: number
  youth_within_industry_pct: number
  city_youth_baseline_pct: number
  small_sample: boolean
  small_wage_sample: boolean
  sector: string
}

export interface ImbalanceCandidateRow {
  basis: Basis
  city: string
  group: GroupId
  all_n: number
  all_estimate: number
  youth_n: number
  youth_estimate: number
  youth_wage_n: number
  youth_wage_estimate: number
  all_wage_estimate: number
  youth_weight_sq: number
  youth_composition_pct: number
  all_composition_pct: number
  composition_gap_pp: number
  youth_within_industry_pct: number
  city_youth_baseline_pct: number
  small_sample: boolean
  small_wage_sample: boolean
  sector: string
  period: string
  employees: number
  separations: number
  vacancies: number
  vacancy_rate: number
  hires: number
  sector_demand: string
  net_hires: number
  overall_vacancy_rate: number
  vacancy_excess_pp: number
  youth_participation_gap_pp: number
  review_flag: boolean
  interpretation: string
  precision: string
  no_sample?: boolean
}

export interface DataBundle {
  demand_trend: DemandTrendRow[]
  industry_structure: IndustryStructureRow[]
  business_structure_2024: BusinessStructure2024Row[]
  industry_youth: IndustryYouthRow[]
  youth_totals: YouthTotalsRow[]
  mdis_reconciliation: unknown[]
  mdis_sector_stats: MdisSectorStatsRow[]
  imbalance_candidates: ImbalanceCandidateRow[]
}

export interface Dimensions {
  cities: { id: string; name: string; mdis_code: string; kosis_demand_code: string }[]
  basis: Record<Basis, string>
  periods: { id: string; label: string; month: string }[]
  group_to_ksic_major: Record<string, string[]>
  group_labels: Record<string, string>
  excluded_for_common5: string[]
  ksic11_names: Record<string, string>
}

export interface UiPolicy {
  version: string
  diagnosis_periods: string[]
  diagnosis_default_basis: Basis
  allowed_statuses: DiagnosisStatus[]
  priority: string[]
  small_sample_threshold: number
  threshold_official: boolean
  confidence_for_every_mdis_row: string
  forbidden_labels: string[]
  null_label: string
  missing_period_policy: string
  sample_n_zero_policy: string
  live_badge_policy: string
  required_visible_context: string[]
}

export interface SourcesMeta {
  [id: string]: {
    agency: string
    survey: string
    table_id: string | null
    url: string
    basis?: string
    population?: string
    classification?: string
    time?: string
    provisional_from?: string
    precision?: string
    [k: string]: unknown
  }
}

export interface CatalogDataset {
  id: string
  file: string
  rows: number
  keys: string[]
  periods: string[]
  implicit_period: string | null
  source_ids: string[]
  metric_fields: string[]
  sample_fields_note: string
  scope_warning: string
  fields: string[]
  sha256: string
  numeric_precision: string
  web_permission: string
}

export interface Catalog {
  version: string
  snapshot_date: string
  provenance_mode: string
  api_called_in_this_handoff: boolean
  data_base_path: string
  datasets: CatalogDataset[]
}

export interface MetricsMeta {
  metrics: {
    field: string
    label: string
    unit: string
    formula: string
    sample_n_field: string | null
    source_ids: string[]
  }[]
  other_units: Record<string, string>
  missing: string
  rounding: string
}

// ===== 화면①②③ 판단·표시 규칙 (ui_policy.json 우선) =====

export const DIAGNOSIS_STATUS_META: Record<
  DiagnosisStatus,
  { label: string; badge: string; dot: string; description: string }
> = {
  unavailable: {
    label: '자료 없음',
    badge: 'bg-slate-100 text-slate-700 border border-slate-300',
    dot: 'bg-slate-400',
    description: '해당 조합의 자료가 없습니다. 다른 기간으로 자동 대체하지 않습니다.'
  },
  no_sample: {
    label: '표본 관측 없음',
    badge: 'bg-slate-100 text-slate-600 border border-slate-300',
    dot: 'bg-slate-500',
    description: '표본이 관측되지 않아 추정치가 NULL입니다. 실제 취업자 0명이 아닙니다.'
  },
  insufficient_precision: {
    label: '소표본·판단 유보',
    badge: 'bg-amber-50 text-amber-800 border border-amber-300',
    dot: 'bg-amber-500',
    description: '청년 임금근로자 표본이 30명 미만입니다. 징후 판단을 유보합니다. (n≥30도 신뢰성이 입증된 것은 아닙니다)'
  },
  exploratory_signal: {
    label: '추가 확인할 징후',
    badge: 'bg-blue-50 text-blue-800 border border-blue-300',
    dot: 'bg-blue-600',
    description: '탐색 조건(공석률 초과 AND 청년 참여 미달)을 충족합니다. 인과·유의성 판정이 아닙니다.'
  },
  no_selected_signal: {
    label: '선택한 기준에서 징후 미확인',
    badge: 'bg-emerald-50 text-emerald-800 border border-emerald-300',
    dot: 'bg-emerald-600',
    description: '설정한 탐색 조건 미충족입니다. 고용 균형 또는 문제 없음을 뜻하지 않습니다.'
  }
}

// 판단 우선순위 (docs/01 기능명세 §화면2 판단 순서, verify_package.mjs의 judge와 동일 로직)
export function judgeDiagnosis(
  row: ImbalanceCandidateRow | undefined,
  period: string,
  threshold = 30
): DiagnosisStatus {
  if (!row) return 'unavailable'
  if (period !== '202502') return 'unavailable'
  if (row.vacancy_excess_pp == null || row.youth_participation_gap_pp == null) return 'unavailable'
  if (row.no_sample || row.youth_wage_n === 0) return 'no_sample'
  if (row.youth_wage_n == null) return 'unavailable'
  if (row.youth_wage_n < threshold) return 'insufficient_precision'
  return row.review_flag ? 'exploratory_signal' : 'no_selected_signal'
}

// ===== 표시 형식 유틸 =====

// 인원: "추정 약 10,471명" / 표본: "n=53" / 비율 1자리 / 차이 2자리 %p
export function fmtPersons(v: number | null | undefined): string {
  if (v == null) return '자료 없음'
  return `약 ${Math.round(v).toLocaleString('ko-KR')}명`
}

export function fmtSampleN(v: number | null | undefined): string {
  if (v == null) return '미확보'
  return `n=${v}`
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null) return '자료 없음'
  return `${v.toFixed(digits)}%`
}

export function fmtPp(v: number | null | undefined, digits = 2): string {
  if (v == null) return '자료 없음'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%p`
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null) return '자료 없음'
  return Math.round(v).toLocaleString('ko-KR')
}

export function periodLabel(period: string, dimensions: Dimensions | null): string {
  const p = dimensions?.periods.find((x) => x.id === period)
  return p ? p.label : period
}
