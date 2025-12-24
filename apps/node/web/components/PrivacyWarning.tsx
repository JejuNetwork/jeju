import clsx from 'clsx'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, Shield, X } from 'lucide-react'
import { useState } from 'react'

interface PrivacyWarningProps {
  computeType: 'cpu' | 'gpu' | 'both'
  teeAvailable: boolean
  onAccept: () => void
  onCancel: () => void
}

export function PrivacyWarning({
  computeType,
  teeAvailable,
  onAccept,
  onCancel,
}: PrivacyWarningProps) {
  const [acknowledged, setAcknowledged] = useState(false)

  if (teeAvailable) {
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-zinc-900 border border-amber-500/30 rounded-xl max-w-lg w-full shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-zinc-800 bg-amber-500/10">
          <div className="p-2 bg-amber-500/20 rounded-lg">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-amber-400">
              Non-Confidential Compute Warning
            </h2>
            <p className="text-sm text-zinc-400">
              {computeType === 'cpu'
                ? 'CPU'
                : computeType === 'gpu'
                  ? 'GPU'
                  : 'CPU & GPU'}{' '}
              compute will run without hardware encryption
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-zinc-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 text-sm text-zinc-300 space-y-3">
            <p>
              Your hardware does not support{' '}
              <strong>Trusted Execution Environment (TEE)</strong> for this
              compute type. This means:
            </p>

            <ul className="space-y-2 ml-4">
              <li className="flex items-start gap-2">
                <span className="text-amber-400 mt-1">•</span>
                <span>
                  Compute jobs will run in <strong>unencrypted memory</strong>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-400 mt-1">•</span>
                <span>
                  A sophisticated attacker with physical access could
                  potentially view job data
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-400 mt-1">•</span>
                <span>
                  Cloud providers could theoretically inspect workloads
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-400 mt-1">•</span>
                <span>
                  This is suitable for{' '}
                  <strong>non-sensitive workloads only</strong>
                </span>
              </li>
            </ul>
          </div>

          {/* TEE Requirements */}
          <div className="bg-zinc-800/50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-zinc-200 mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-400" />
              For Confidential Compute, you need:
            </h3>
            <ul className="text-sm text-zinc-400 space-y-1 ml-6">
              <li>• Intel TDX or SGX (CPU)</li>
              <li>• AMD SEV (CPU)</li>
              <li>• NVIDIA Confidential Computing (GPU)</li>
            </ul>
          </div>

          {/* Acknowledgment */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative mt-0.5">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="peer sr-only"
              />
              <div
                className={clsx(
                  'w-5 h-5 rounded border-2 transition-colors',
                  acknowledged
                    ? 'bg-amber-500 border-amber-500'
                    : 'border-zinc-600 group-hover:border-zinc-500',
                )}
              >
                {acknowledged && (
                  <Check className="w-4 h-4 text-black absolute inset-0 m-auto" />
                )}
              </div>
            </div>
            <span className="text-sm text-zinc-300">
              I understand that my compute will run in non-confidential mode and
              accept the associated privacy risks for non-sensitive workloads.
            </span>
          </label>
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={!acknowledged}
            className={clsx(
              'flex-1 px-4 py-2.5 rounded-lg transition-colors font-medium',
              acknowledged
                ? 'bg-amber-500 hover:bg-amber-400 text-black'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed',
            )}
          >
            Continue Anyway
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/**
 * Inline warning badge for non-TEE compute
 */
export function NonTeeWarningBadge({
  computeType,
}: {
  computeType: 'cpu' | 'gpu' | 'both'
}) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-md text-amber-400 text-xs font-medium">
      <AlertTriangle className="w-3 h-3" />
      <span>Non-confidential {computeType.toUpperCase()}</span>
    </div>
  )
}

/**
 * TEE status indicator
 */
export function TeeStatusIndicator({
  available,
  type,
}: {
  available: boolean
  type: string | null
}) {
  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium',
        available
          ? 'bg-green-500/10 border border-green-500/20 text-green-400'
          : 'bg-amber-500/10 border border-amber-500/20 text-amber-400',
      )}
    >
      <Shield className="w-3 h-3" />
      <span>{available ? type || 'TEE Available' : 'Non-confidential'}</span>
    </div>
  )
}
