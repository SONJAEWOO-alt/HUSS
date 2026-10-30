import type { ReactNode } from 'react'
import { DIAGNOSIS_STATUS_META, type DiagnosisStatus } from '../types'

// ===== 공용 UI 컴파운드 =====

export function Card({
  title,
  subtitle,
  right,
  children,
  className = ''
}: {
  title?: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-800 sm:text-base">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

export function MetricCard({
  label,
  value,
  unit,
  note,
  warn
}: {
  label: string
  value: string
  unit?: string
  note?: string
  warn?: boolean
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        warn ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      {note && <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{note}</div>}
    </div>
  )
}

export function StatusBadge({ status }: { status: DiagnosisStatus }) {
  const meta = DIAGNOSIS_STATUS_META[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badge}`}
    >
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </span>
  )
}

export function WarnNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
      <span className="mr-1 font-bold">⚠</span>
      {children}
    </div>
  )
}

export function SourceNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
      {children}
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
      <div className="text-sm font-semibold text-slate-600">{title}</div>
      {description && <div className="mt-1 max-w-md text-xs text-slate-500">{description}</div>}
    </div>
  )
}

export function Spinner({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
      {label}…
    </div>
  )
}

export function ServicePill({
  name,
  ok,
  label,
  detail
}: {
  name: string
  ok: boolean | null
  label: string
  detail?: string
}) {
  const color =
    ok === true
      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
      : ok === false
        ? 'bg-slate-100 text-slate-600 border-slate-300'
        : 'bg-slate-50 text-slate-500 border-slate-200'
  return (
    <span
      title={detail}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${color}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          ok === true ? 'bg-emerald-500' : ok === false ? 'bg-slate-400' : 'bg-slate-300'
        }`}
        aria-hidden
      />
      {name} {label}
    </span>
  )
}

export function Select({
  label,
  value,
  onChange,
  options,
  disabled,
  hint
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; disabled?: boolean }[]
  disabled?: boolean
  hint?: string
}) {
  return (
    <label className="flex min-w-[9rem] flex-1 flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-[10px] leading-tight text-slate-400">{hint}</span>}
    </label>
  )
}

// 차트용 공통 툴팁 박스
export function ChartTooltip({
  active,
  payload,
  label,
  formatter
}: {
  active?: boolean
  payload?: { name?: string; value?: number | string | null; color?: string; dataKey?: string }[]
  label?: string | number
  formatter?: (v: number | string | null | undefined, name?: string) => string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg">
      {label != null && <div className="mb-1 font-semibold text-slate-700">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span className="text-slate-500">{p.name}</span>
          <span className="ml-auto font-semibold text-slate-800">
            {formatter ? formatter(p.value, p.name) : String(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}
