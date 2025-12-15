import { AlertTriangle, X } from 'lucide-react';
import { useAppStore } from '../store';
import { motion } from 'framer-motion';

export function ErrorBanner() {
  const { error, clearError } = useAppStore();

  if (!error) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6 flex items-start gap-3"
    >
      <AlertTriangle size={20} className="text-red-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <p className="font-medium text-red-300">Error</p>
        <p className="text-sm text-red-200/70 mt-1">{error}</p>
      </div>
      <button
        onClick={clearError}
        className="p-1 rounded-lg hover:bg-red-500/20 transition-colors"
      >
        <X size={18} className="text-red-400" />
      </button>
    </motion.div>
  );
}

