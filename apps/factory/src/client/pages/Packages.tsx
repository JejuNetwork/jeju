import { Package, Plus, Search } from 'lucide-react'
import { Link } from 'react-router-dom'

export function PackagesPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Package className="w-7 h-7 text-blue-400" />
            Packages
          </h1>
          <p className="text-factory-400 mt-1">
            Decentralized package registry
          </p>
        </div>
        <Link to="/packages/publish" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Publish Package
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
          <input
            type="text"
            placeholder="Search packages..."
            className="input pl-10"
          />
        </div>
      </div>

      <div className="card p-12 text-center">
        <Package className="w-12 h-12 mx-auto mb-4 text-factory-600" />
        <h3 className="text-lg font-medium text-factory-300 mb-2">
          Package registry coming soon
        </h3>
        <p className="text-factory-500">
          Publish and install packages from the decentralized registry
        </p>
      </div>
    </div>
  )
}
