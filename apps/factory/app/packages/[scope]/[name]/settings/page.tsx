'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  Settings,
  ArrowLeft,
  Package,
  Users,
  Key,
  AlertTriangle,
  Trash2,
  Loader2,
  Save,
  Plus,
  X,
  Shield,
  Clock,
  Tag,
  Archive,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

type SettingsTab = 'general' | 'maintainers' | 'tokens' | 'versions' | 'danger';

const mockMaintainers = [
  { id: '1', name: 'alice.eth', avatar: 'https://avatars.githubusercontent.com/u/1?v=4', role: 'owner', addedAt: Date.now() - 30 * 24 * 60 * 60 * 1000 },
  { id: '2', name: 'bob.eth', avatar: 'https://avatars.githubusercontent.com/u/2?v=4', role: 'maintainer', addedAt: Date.now() - 7 * 24 * 60 * 60 * 1000 },
];

const mockVersions = [
  { version: '1.5.2', publishedAt: Date.now() - 2 * 24 * 60 * 60 * 1000, deprecated: false, downloads: 3240 },
  { version: '1.5.1', publishedAt: Date.now() - 7 * 24 * 60 * 60 * 1000, deprecated: false, downloads: 8450 },
  { version: '1.5.0', publishedAt: Date.now() - 14 * 24 * 60 * 60 * 1000, deprecated: false, downloads: 12300 },
  { version: '1.4.0', publishedAt: Date.now() - 30 * 24 * 60 * 60 * 1000, deprecated: true, downloads: 21500 },
];

const mockTokens = [
  { id: '1', name: 'CI/CD Token', lastUsed: Date.now() - 2 * 60 * 60 * 1000, permissions: ['publish'] },
  { id: '2', name: 'Development', lastUsed: Date.now() - 24 * 60 * 60 * 1000, permissions: ['publish', 'deprecate'] },
];

export default function PackageSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const { isConnected } = useAccount();
  const rawScope = params.scope as string;
  const name = params.name as string;
  const scope = decodeURIComponent(rawScope);
  const fullName = scope.startsWith('@') ? `${scope}/${name}` : name;

  const [tab, setTab] = useState<SettingsTab>('general');
  const [description, setDescription] = useState('Official Jeju Network SDK for building dApps with bounties, guardians, and AI models.');
  const [keywords, setKeywords] = useState(['jeju', 'web3', 'sdk', 'ethereum', 'bounties']);
  const [newKeyword, setNewKeyword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [newMaintainer, setNewMaintainer] = useState('');

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSaving(false);
  };

  const addKeyword = () => {
    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
      setKeywords([...keywords, newKeyword.trim()]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter(k => k !== kw));
  };

  const tabs = [
    { id: 'general' as const, label: 'General', icon: Settings },
    { id: 'maintainers' as const, label: 'Maintainers', icon: Users },
    { id: 'tokens' as const, label: 'Access Tokens', icon: Key },
    { id: 'versions' as const, label: 'Versions', icon: Tag },
    { id: 'danger' as const, label: 'Danger Zone', icon: AlertTriangle },
  ];

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={`/packages/${rawScope}/${name}`}
            className="text-factory-400 hover:text-factory-300 text-sm inline-flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {fullName}
          </Link>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Package className="w-7 h-7 text-orange-400" />
            Package Settings
          </h1>
          <p className="text-factory-400 mt-1">{fullName}</p>
        </div>

        <div className="flex gap-6">
          {/* Sidebar */}
          <div className="w-48 space-y-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors text-left',
                  tab === id
                    ? 'bg-accent-600 text-white'
                    : id === 'danger'
                      ? 'text-red-400 hover:bg-red-500/10'
                      : 'text-factory-400 hover:bg-factory-800 hover:text-factory-100'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1">
            {tab === 'general' && (
              <div className="card p-6 space-y-6">
                <h2 className="text-lg font-semibold text-factory-100">Package Information</h2>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="input resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">Keywords</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {keywords.map(kw => (
                      <span key={kw} className="badge badge-info flex items-center gap-1">
                        {kw}
                        <button onClick={() => removeKeyword(kw)} className="hover:text-white">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                      placeholder="Add keyword..."
                      className="input flex-1"
                    />
                    <button type="button" onClick={addKeyword} className="btn btn-secondary">
                      Add
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">Homepage URL</label>
                  <input
                    type="url"
                    defaultValue="https://jeju.network"
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">Repository URL</label>
                  <input
                    type="url"
                    defaultValue="https://git.jeju.network/jeju/sdk"
                    className="input"
                  />
                </div>

                <div className="pt-4 border-t border-factory-800">
                  <button onClick={handleSave} disabled={isSaving} className="btn btn-primary">
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save changes
                  </button>
                </div>
              </div>
            )}

            {tab === 'maintainers' && (
              <div className="card p-6 space-y-6">
                <h2 className="text-lg font-semibold text-factory-100">Package Maintainers</h2>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMaintainer}
                    onChange={(e) => setNewMaintainer(e.target.value)}
                    placeholder="Add maintainer by address or ENS..."
                    className="input flex-1"
                  />
                  <button className="btn btn-primary">
                    <Plus className="w-4 h-4" />
                    Add
                  </button>
                </div>

                <div className="space-y-3">
                  {mockMaintainers.map(m => (
                    <div key={m.id} className="flex items-center justify-between p-4 bg-factory-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <img src={m.avatar} alt="" className="w-8 h-8 rounded-full" />
                        <div>
                          <span className="text-factory-200">{m.name}</span>
                          {m.role === 'owner' && (
                            <span className="ml-2 badge bg-purple-500/20 text-purple-400 text-xs">Owner</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <select defaultValue={m.role} className="input text-sm py-1" disabled={m.role === 'owner'}>
                          <option value="maintainer">Maintainer</option>
                          <option value="owner">Owner</option>
                        </select>
                        {m.role !== 'owner' && (
                          <button className="text-red-400 hover:text-red-300 p-1">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'tokens' && (
              <div className="card p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-factory-100">Access Tokens</h2>
                  <button className="btn btn-primary text-sm">
                    <Plus className="w-4 h-4" />
                    Create token
                  </button>
                </div>

                <p className="text-factory-400 text-sm">
                  Tokens allow CI/CD systems and tools to publish on your behalf.
                </p>

                <div className="space-y-3">
                  {mockTokens.map(token => (
                    <div key={token.id} className="p-4 bg-factory-800/50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Key className="w-4 h-4 text-factory-400" />
                          <span className="text-factory-200 font-medium">{token.name}</span>
                        </div>
                        <button className="text-red-400 hover:text-red-300 text-sm">Revoke</button>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-factory-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Last used: {new Date(token.lastUsed).toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Shield className="w-3 h-3" />
                          {token.permissions.join(', ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'versions' && (
              <div className="card p-6 space-y-6">
                <h2 className="text-lg font-semibold text-factory-100">Version Management</h2>

                <div className="space-y-3">
                  {mockVersions.map(v => (
                    <div key={v.version} className="flex items-center justify-between p-4 bg-factory-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Tag className="w-4 h-4 text-factory-400" />
                        <span className="font-mono text-factory-200">{v.version}</span>
                        {v.deprecated && (
                          <span className="badge bg-yellow-500/20 text-yellow-400 text-xs">Deprecated</span>
                        )}
                        {v === mockVersions[0] && (
                          <span className="badge bg-green-500/20 text-green-400 text-xs">Latest</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-factory-500 text-sm">{v.downloads.toLocaleString()} downloads</span>
                        <button className={clsx(
                          'text-sm px-2 py-1 rounded',
                          v.deprecated
                            ? 'text-green-400 hover:bg-green-500/10'
                            : 'text-yellow-400 hover:bg-yellow-500/10'
                        )}>
                          {v.deprecated ? 'Undeprecate' : 'Deprecate'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'danger' && (
              <div className="space-y-6">
                <div className="card p-6 border-red-500/30">
                  <h3 className="text-lg font-semibold text-red-400 mb-4 flex items-center gap-2">
                    <Archive className="w-5 h-5" />
                    Deprecate Package
                  </h3>
                  <p className="text-factory-400 text-sm mb-4">
                    Mark this package as deprecated. Users will see a warning when installing.
                  </p>
                  <button className="btn bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/30">
                    Deprecate all versions
                  </button>
                </div>

                <div className="card p-6 border-red-500/30">
                  <h3 className="text-lg font-semibold text-red-400 mb-4 flex items-center gap-2">
                    <Trash2 className="w-5 h-5" />
                    Unpublish Package
                  </h3>
                  <p className="text-factory-400 text-sm mb-4">
                    Remove this package from the registry. This action cannot be undone.
                  </p>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder={`Type "${fullName}" to confirm`}
                      className="input"
                    />
                    <button
                      disabled={deleteConfirm !== fullName}
                      className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Unpublish package
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


