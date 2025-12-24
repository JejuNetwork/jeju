import { useQuery } from '@tanstack/react-query'
import {
  Building2,
  ExternalLink,
  GitBranch,
  type LucideProps,
  Package,
  Plus,
  Search,
  Settings,
  Users,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'

// Fix for Lucide React 19 type compatibility
const SearchIcon = Search as ComponentType<LucideProps>
const UsersIcon = Users as ComponentType<LucideProps>
const GitBranchIcon = GitBranch as ComponentType<LucideProps>
const PackageIcon = Package as ComponentType<LucideProps>
const Building2Icon = Building2 as ComponentType<LucideProps>
const PlusIcon = Plus as ComponentType<LucideProps>
const SettingsIcon = Settings as ComponentType<LucideProps>
const ExternalLinkIcon = ExternalLink as ComponentType<LucideProps>

interface Organization {
  id: string
  name: string
  displayName: string
  description?: string
  avatarUrl?: string
  website?: string
  members: number
  repositories: number
  packages: number
  createdAt: string
  verified: boolean
  reputationScore: number
}

interface OrganizationMember {
  username: string
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
}

interface GitOrg {
  name: string
  displayName?: string
  description?: string
  avatarUrl?: string
  website?: string
  memberCount: number
  repoCount: number
  createdAt: string
  verified?: boolean
}

const GIT_SERVER_URL =
  process.env.PUBLIC_GIT_SERVER_URL || 'http://localhost:4600'
const NPM_REGISTRY_URL =
  process.env.PUBLIC_NPM_REGISTRY_URL || 'http://localhost:4700'

async function fetchOrganizations(): Promise<Organization[]> {
  const gitResponse = await fetch(`${GIT_SERVER_URL}/api/organizations`, {
    headers: { Accept: 'application/json' },
  })

  if (!gitResponse.ok) {
    return []
  }

  const rawOrgs = await gitResponse.json()
  const gitOrgs: GitOrg[] = Array.isArray(rawOrgs) ? rawOrgs : []

  return Promise.all(
    gitOrgs.map(async (org) => {
      let packageCount = 0
      const pkgResponse = await fetch(
        `${NPM_REGISTRY_URL}/-/org/${org.name}/package`,
      )

      if (pkgResponse.ok) {
        const packages = await pkgResponse.json()
        packageCount = Array.isArray(packages) ? packages.length : 0
      }

      return {
        id: org.name,
        name: org.name,
        displayName: org.displayName || org.name,
        description: org.description,
        avatarUrl: org.avatarUrl,
        website: org.website,
        members: org.memberCount,
        repositories: org.repoCount,
        packages: packageCount,
        createdAt: org.createdAt,
        verified: org.verified || false,
        reputationScore: org.verified ? 90 : 50,
      }
    }),
  )
}

async function fetchOrgMembers(orgName: string): Promise<OrganizationMember[]> {
  const response = await fetch(
    `${GIT_SERVER_URL}/api/organizations/${orgName}/members`,
    { headers: { Accept: 'application/json' } },
  )

  if (!response.ok) {
    return []
  }

  const rawMembers = await response.json()
  return Array.isArray(rawMembers) ? rawMembers : []
}

export default function OrganizationsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)

  const { data: organizations = [], isLoading: loading } = useQuery({
    queryKey: ['organizations'],
    queryFn: fetchOrganizations,
  })

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', selectedOrg?.name],
    queryFn: () => fetchOrgMembers(selectedOrg?.name ?? ''),
    enabled: !!selectedOrg?.name,
  })

  function selectOrg(org: Organization) {
    setSelectedOrg(org)
  }

  const filteredOrgs = organizations.filter(
    (org) =>
      org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      org.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      org.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Organizations</h1>
            <p className="text-gray-400 mt-1">
              Manage teams and collaborate on repositories and packages
            </p>
          </div>
          <button
            type="button"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <PlusIcon className="w-4 h-4" />
            New Organization
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-8">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search organizations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Organization List */}
          <div className="lg:col-span-2">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
              </div>
            ) : filteredOrgs.length === 0 ? (
              <div className="text-center py-12">
                <Building2Icon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">No organizations found</p>
                <p className="text-gray-500 text-sm mt-2">
                  Create an organization to collaborate with your team
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredOrgs.map((org) => (
                  <button
                    type="button"
                    key={org.id}
                    onClick={() => selectOrg(org)}
                    className={`w-full text-left p-6 bg-gray-800 rounded-lg border transition-colors ${
                      selectedOrg?.id === org.id
                        ? 'border-blue-500'
                        : 'border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-xl font-bold">
                        {org.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-lg">
                            {org.displayName}
                          </span>
                          <span className="text-gray-500">@{org.name}</span>
                          {org.verified && (
                            <span className="px-2 py-0.5 text-xs bg-blue-900/50 text-blue-400 rounded-full">
                              Verified
                            </span>
                          )}
                        </div>
                        {org.description && (
                          <p className="text-gray-400 mt-1">
                            {org.description}
                          </p>
                        )}
                        <div className="flex items-center gap-6 mt-4 text-sm text-gray-400">
                          <span className="flex items-center gap-1">
                            <UsersIcon className="w-4 h-4" />
                            {org.members} members
                          </span>
                          <span className="flex items-center gap-1">
                            <GitBranchIcon className="w-4 h-4" />
                            {org.repositories} repos
                          </span>
                          <span className="flex items-center gap-1">
                            <PackageIcon className="w-4 h-4" />
                            {org.packages} packages
                          </span>
                        </div>
                      </div>
                      <div className="text-right text-sm text-gray-400">
                        Created {formatDate(org.createdAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Organization Details Sidebar */}
          <div className="lg:col-span-1">
            {selectedOrg ? (
              <div className="sticky top-4 space-y-4">
                <div className="p-6 bg-gray-800 rounded-lg border border-gray-700">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold">
                      {selectedOrg.displayName}
                    </h2>
                    <button
                      type="button"
                      className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <SettingsIcon className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Reputation Score</span>
                      <span className="text-green-400 font-semibold">
                        {selectedOrg.reputationScore}/100
                      </span>
                    </div>

                    {selectedOrg.website && (
                      <a
                        href={selectedOrg.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-blue-400 hover:underline"
                      >
                        <ExternalLinkIcon className="w-4 h-4" />
                        {selectedOrg.website}
                      </a>
                    )}
                  </div>
                </div>

                <div className="p-6 bg-gray-800 rounded-lg border border-gray-700">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <UsersIcon className="w-5 h-5" />
                    Members
                  </h3>
                  <div className="space-y-3">
                    {members.map((member) => (
                      <div
                        key={member.username}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-sm">
                            {member.username.charAt(0).toUpperCase()}
                          </div>
                          <span>{member.username}</span>
                        </div>
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            member.role === 'owner'
                              ? 'bg-yellow-900/50 text-yellow-400'
                              : member.role === 'admin'
                                ? 'bg-blue-900/50 text-blue-400'
                                : 'bg-gray-700 text-gray-400'
                          }`}
                        >
                          {member.role}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="w-full mt-4 py-2 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors text-sm"
                  >
                    View All Members
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <a
                    href={`/repositories?org=${selectedOrg.name}`}
                    className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors text-center"
                  >
                    <GitBranchIcon className="w-6 h-6 mx-auto mb-2 text-blue-400" />
                    <div className="text-xl font-bold">
                      {selectedOrg.repositories}
                    </div>
                    <div className="text-sm text-gray-400">Repositories</div>
                  </a>
                  <a
                    href={`/packages?scope=@${selectedOrg.name}`}
                    className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors text-center"
                  >
                    <PackageIcon className="w-6 h-6 mx-auto mb-2 text-red-400" />
                    <div className="text-xl font-bold">
                      {selectedOrg.packages}
                    </div>
                    <div className="text-sm text-gray-400">Packages</div>
                  </a>
                </div>
              </div>
            ) : (
              <div className="p-6 bg-gray-800 rounded-lg border border-gray-700 text-center">
                <Building2Icon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">
                  Select an organization to view details
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
