'use client'

import type {
  PaymentRequestStatus,
  VerificationStatus,
} from '../../types/funding'
import { PAYMENT_STATUS_DISPLAY } from '../../types/funding'

// ============ Verification Status Badge ============

const VERIFICATION_STATUS_STYLES: Record<VerificationStatus, string> = {
  VERIFIED: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  PENDING: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  UNVERIFIED: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
  REVOKED: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
}

export function VerificationStatusBadge({
  status,
}: {
  status: VerificationStatus
}) {
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full ${VERIFICATION_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}

// ============ Payment Request Status Badge ============

export function PaymentStatusBadge({
  status,
}: {
  status: PaymentRequestStatus
}) {
  const style = PAYMENT_STATUS_DISPLAY[status]
  return (
    <span
      className={`px-2.5 py-1 text-xs font-medium rounded-full ${style.bgClass} ${style.textClass}`}
    >
      {style.label}
    </span>
  )
}

// ============ Generic Status Badge ============

export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

const VARIANT_STYLES: Record<StatusVariant, string> = {
  success: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  error: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
  info: 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30',
  neutral: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
}

export function StatusBadge({
  label,
  variant = 'neutral',
}: {
  label: string
  variant?: StatusVariant
}) {
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full ${VARIANT_STYLES[variant]}`}
    >
      {label}
    </span>
  )
}

// ============ Contributor Type Badge ============

import type { ContributorType } from '../../types/funding'

const CONTRIBUTOR_TYPE_STYLES: Record<ContributorType, string> = {
  INDIVIDUAL: 'bg-blue-500/20 text-blue-400',
  ORGANIZATION: 'bg-purple-500/20 text-purple-400',
  PROJECT: 'bg-cyan-500/20 text-cyan-400',
}

export function ContributorTypeBadge({ type }: { type: ContributorType }) {
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded ${CONTRIBUTOR_TYPE_STYLES[type]}`}
    >
      {type}
    </span>
  )
}

// ============ Registry Type Badge ============

import type { RegistryType } from '../../types/funding'

const REGISTRY_TYPE_STYLES: Record<RegistryType, string> = {
  npm: 'bg-red-500/20 text-red-400',
  pypi: 'bg-blue-500/20 text-blue-400',
  cargo: 'bg-orange-500/20 text-orange-400',
  go: 'bg-cyan-500/20 text-cyan-400',
  unknown: 'bg-slate-500/20 text-slate-400',
}

export function RegistryTypeBadge({ type }: { type: RegistryType }) {
  return (
    <span
      className={`px-1.5 py-0.5 text-xs font-medium rounded ${REGISTRY_TYPE_STYLES[type]}`}
    >
      {type}
    </span>
  )
}

// ============ Registered/Unregistered Badge ============

export function RegisteredBadge({ isRegistered }: { isRegistered: boolean }) {
  if (isRegistered) {
    return (
      <span className="text-xs text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded">
        Registered
      </span>
    )
  }
  return (
    <span className="text-xs text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded">
      Unregistered
    </span>
  )
}

// ============ Active/Inactive Badge ============

export function ActiveBadge({ active }: { active: boolean }) {
  if (active) {
    return <span className="text-xs text-emerald-400">● Active</span>
  }
  return <span className="text-xs text-slate-500">○ Inactive</span>
}

// ============ Retroactive Badge ============

export function RetroactiveBadge() {
  return <span className="text-xs text-amber-400">Retroactive</span>
}
