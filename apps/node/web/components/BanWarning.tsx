import { motion } from 'framer-motion'
import { AlertTriangle, Clock, ExternalLink, Shield } from 'lucide-react'
import { useAppStore } from '../context/AppContext'

export function BanWarning() {
  const { banStatus } = useAppStore()

  if (!banStatus?.is_banned && !banStatus?.is_on_notice) return null

  const isPermanent = banStatus.is_permanently_banned
  const isOnNotice = banStatus.is_on_notice && !banStatus.is_banned
  const canAppeal =
    banStatus.appeal_deadline && banStatus.appeal_deadline > Date.now() / 1000

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg p-4 mb-6 ${
        isPermanent
          ? 'bg-red-500/20 border border-red-500/50'
          : isOnNotice
            ? 'bg-yellow-500/20 border border-yellow-500/50'
            : 'bg-orange-500/20 border border-orange-500/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          size={24}
          className={
            isPermanent
              ? 'text-red-400'
              : isOnNotice
                ? 'text-yellow-400'
                : 'text-orange-400'
          }
        />

        <div className="flex-1">
          <h3
            className={`font-semibold ${
              isPermanent
                ? 'text-red-300'
                : isOnNotice
                  ? 'text-yellow-300'
                  : 'text-orange-300'
            }`}
          >
            {isPermanent
              ? 'Agent Permanently Banned'
              : isOnNotice
                ? 'Agent Under Review'
                : 'Agent Temporarily Banned'}
          </h3>

          {banStatus.reason && (
            <p className="text-sm text-volcanic-300 mt-1">
              Reason: {banStatus.reason}
            </p>
          )}

          {banStatus.appeal_status && (
            <div className="flex items-center gap-2 mt-2 text-sm">
              <Shield size={14} />
              <span>Appeal Status: {banStatus.appeal_status}</span>
            </div>
          )}

          {canAppeal && banStatus.appeal_deadline && (
            <div className="flex items-center gap-2 mt-2 text-sm text-volcanic-400">
              <Clock size={14} />
              <span>
                Appeal deadline:{' '}
                {new Date(
                  banStatus.appeal_deadline * 1000,
                ).toLocaleDateString()}
              </span>
            </div>
          )}

          <div className="flex gap-3 mt-4">
            {canAppeal && !banStatus.appeal_status && (
              <button type="button" className="btn-primary text-sm">
                Submit Appeal
              </button>
            )}

            <a
              href="https://gateway.jejunetwork.org/moderation"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm flex items-center gap-2"
            >
              View on Gateway
              <ExternalLink size={14} />
            </a>
          </div>

          {isPermanent && (
            <p className="text-xs text-red-300/70 mt-3">
              This agent has been permanently banned due to severe violations.
              You may need to register a new agent with a fresh stake.
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}
