import { Play, Plus, Search } from 'lucide-react'
import { Link } from 'react-router-dom'

export function CIPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Play className="w-7 h-7 text-green-400" />
            CI/CD
          </h1>
          <p className="text-factory-400 mt-1">
            Continuous integration and deployment
          </p>
        </div>
        <Link to="/ci/new" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          New Workflow
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
          <input
            type="text"
            placeholder="Search workflows..."
            className="input pl-10"
          />
        </div>
      </div>

      <div className="card p-12 text-center">
        <Play className="w-12 h-12 mx-auto mb-4 text-factory-600" />
        <h3 className="text-lg font-medium text-factory-300 mb-2">
          CI/CD coming soon
        </h3>
        <p className="text-factory-500">Run automated builds and deployments</p>
      </div>
    </div>
  )
}
