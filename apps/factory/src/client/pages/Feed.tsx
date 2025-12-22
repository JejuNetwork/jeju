import { MessageSquare } from 'lucide-react'

export function FeedPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <MessageSquare className="w-7 h-7 text-accent-400" />
            Feed
          </h1>
          <p className="text-factory-400 mt-1">
            Developer community on Farcaster
          </p>
        </div>
      </div>

      <div className="card p-12 text-center">
        <MessageSquare className="w-12 h-12 mx-auto mb-4 text-factory-600" />
        <h3 className="text-lg font-medium text-factory-300 mb-2">
          Connect to Farcaster
        </h3>
        <p className="text-factory-500 mb-4">Join the Factory community feed</p>
        <button type="button" className="btn btn-primary">
          Connect Farcaster
        </button>
      </div>
    </div>
  )
}
