/**
 * Ban Banner Component
 * Displays a prominent banner when user is banned or on notice
 * Used across all network apps
 */

'use client'

import { type BanStatus, BanType, getBanTypeLabel } from '../hooks/useBanStatus'

interface BanBannerProps {
  banStatus: BanStatus
  appName: string
  appealUrl?: string
  showDetails?: boolean
}

export function BanBanner({
  banStatus,
  appName,
  appealUrl = '/moderation',
  showDetails = true,
}: BanBannerProps) {
  if (!banStatus.isBanned && !banStatus.isOnNotice) {
    return null
  }

  const isOnNotice =
    banStatus.isOnNotice || banStatus.banType === BanType.ON_NOTICE
  const isChallenged = banStatus.banType === BanType.CHALLENGED
  const isPermanent = banStatus.banType === BanType.PERMANENT

  // Color schemes based on ban severity
  const colorScheme = isOnNotice
    ? 'bg-yellow-50 border-yellow-300 text-yellow-900'
    : isChallenged
      ? 'bg-orange-50 border-orange-300 text-orange-900'
      : 'bg-red-50 border-red-300 text-red-900'

  const iconColor = isOnNotice
    ? 'text-yellow-500'
    : isChallenged
      ? 'text-orange-500'
      : 'text-red-500'

  return (
    <div className={`border-l-4 p-4 mb-4 rounded-r-lg ${colorScheme}`}>
      <div className="flex items-start gap-3">
        {/* Warning Icon */}
        <div className={`flex-shrink-0 ${iconColor}`}>
          <svg
            className="h-6 w-6"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        {/* Content */}
        <div className="flex-1">
          <h3 className="font-semibold text-lg">
            {isOnNotice
              ? 'Account Under Review'
              : isChallenged
                ? 'Ban Challenged - Vote in Progress'
                : 'Account Banned'}
          </h3>

          <p className="mt-1 text-sm opacity-90">
            {isOnNotice
              ? `Your access to ${appName} is restricted while your account is under review.`
              : isChallenged
                ? `A moderation case is active. The community is voting on your account status.`
                : `You have been banned from ${appName} and cannot perform most actions.`}
          </p>

          {showDetails && (
            <>
              {/* Status Badge */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    isOnNotice
                      ? 'bg-yellow-200 text-yellow-800'
                      : isChallenged
                        ? 'bg-orange-200 text-orange-800'
                        : 'bg-red-200 text-red-800'
                  }`}
                >
                  {getBanTypeLabel(banStatus.banType)}
                </span>

                {banStatus.caseId && (
                  <span className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-mono">
                    Case: {banStatus.caseId.slice(0, 10)}...
                  </span>
                )}
              </div>

              {/* Reason */}
              {banStatus.reason && (
                <div className="mt-3 p-2 bg-black/5 rounded text-sm">
                  <strong>Reason:</strong> {banStatus.reason}
                </div>
              )}

              {/* Actions */}
              <div className="mt-4 flex gap-3">
                {banStatus.canAppeal && (
                  <a
                    href={appealUrl}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isPermanent
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-orange-600 hover:bg-orange-700 text-white'
                    }`}
                  >
                    Appeal Ban
                  </a>
                )}

                {(isOnNotice || isChallenged) && (
                  <a
                    href={appealUrl}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg text-sm font-medium transition-colors"
                  >
                    View Case Details
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Compact ban indicator for headers/navbars
 */
export function BanIndicator({ banStatus }: { banStatus: BanStatus }) {
  if (!banStatus.isBanned && !banStatus.isOnNotice) {
    return null
  }

  const isOnNotice =
    banStatus.isOnNotice || banStatus.banType === BanType.ON_NOTICE

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
        isOnNotice
          ? 'bg-yellow-100 text-yellow-800 animate-pulse'
          : 'bg-red-100 text-red-800'
      }`}
    >
      <svg
        className="h-3 w-3"
        fill="currentColor"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
      {isOnNotice ? 'On Notice' : 'Banned'}
    </div>
  )
}

/**
 * Full-screen ban overlay for completely blocking access
 */
export function BanOverlay({
  banStatus,
  appName,
  appealUrl = '/moderation',
}: BanBannerProps) {
  if (!banStatus.isBanned) {
    return null
  }

  // Don't show overlay for ON_NOTICE - just show banner
  if (banStatus.banType === BanType.ON_NOTICE) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-gray-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        {/* Red shield icon */}
        <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
          <svg
            className="h-8 w-8 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20.618 5.984A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016zM12 9v2m0 4h.01"
            />
          </svg>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Account Banned
        </h2>

        <p className="text-gray-600 mb-4">
          Your access to {appName} has been revoked. You cannot use this
          application until your ban is lifted.
        </p>

        {banStatus.reason && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-3 mb-6 text-sm text-red-800 text-left">
            <strong>Reason:</strong> {banStatus.reason}
          </div>
        )}

        <div className="space-y-3">
          {banStatus.canAppeal && (
            <a
              href={appealUrl}
              className="block w-full px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
            >
              Appeal This Ban
            </a>
          )}

          <a
            href="/"
            className="block w-full px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
          >
            Return Home
          </a>
        </div>

        {banStatus.caseId && (
          <p className="mt-4 text-xs text-gray-500">
            Case ID: {banStatus.caseId}
          </p>
        )}
      </div>
    </div>
  )
}
