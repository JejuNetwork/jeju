export function formatDistanceToNow(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp * 1000 // Convert seconds to milliseconds if needed

  // If timestamp is already in milliseconds
  const adjustedDiffMs = timestamp > 1e12 ? now - timestamp : diffMs

  const seconds = Math.floor(adjustedDiffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'Just now'
}
