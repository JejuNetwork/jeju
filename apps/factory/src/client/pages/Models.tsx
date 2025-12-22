import { Brain, Plus, Search } from 'lucide-react'
import { Link } from 'react-router-dom'

export function ModelsPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Brain className="w-7 h-7 text-amber-400" />
            Models
          </h1>
          <p className="text-factory-400 mt-1">
            AI model hub for the Jeju ecosystem
          </p>
        </div>
        <Link to="/models/upload" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Upload Model
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
          <input
            type="text"
            placeholder="Search models..."
            className="input pl-10"
          />
        </div>
      </div>

      <div className="card p-12 text-center">
        <Brain className="w-12 h-12 mx-auto mb-4 text-factory-600" />
        <h3 className="text-lg font-medium text-factory-300 mb-2">
          Model hub coming soon
        </h3>
        <p className="text-factory-500">
          Upload and share AI models with the community
        </p>
      </div>
    </div>
  )
}
