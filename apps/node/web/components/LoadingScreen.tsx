import { getNetworkName } from '@jejunetwork/config'
import { motion } from 'framer-motion'
import { Zap } from 'lucide-react'

const networkName = getNetworkName()

interface LoadingScreenProps {
  message?: string
}

export function LoadingScreen({
  message = 'Initializing...',
}: LoadingScreenProps) {
  return (
    <div className="fixed inset-0 bg-volcanic-950 flex items-center justify-center">
      <div className="text-center">
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, 5, -5, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className="w-20 h-20 rounded-2xl bg-gradient-to-br from-jeju-500 to-jeju-700 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-jeju-500/30"
        >
          <Zap size={40} className="text-white" />
        </motion.div>

        <h1 className="text-2xl font-bold gradient-text mb-2">
          {networkName} Node
        </h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex items-center justify-center gap-2 text-volcanic-400"
        >
          <motion.span
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            {message}
          </motion.span>
        </motion.div>

        <motion.div
          initial={{ width: 0 }}
          animate={{ width: '100%' }}
          transition={{ duration: 2, ease: 'easeInOut' }}
          className="h-1 bg-gradient-to-r from-jeju-600 to-jeju-400 rounded-full mt-6 max-w-xs mx-auto"
        />
      </div>
    </div>
  )
}
