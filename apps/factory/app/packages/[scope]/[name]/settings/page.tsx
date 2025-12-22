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
import { 
  usePackageSettings, 
  useUpdatePackageSettings, 
  useAddMaintainer, 
  useRemoveMaintainer,
  useCreateAccessToken,
  useRevokeAccessToken,
  useDeprecatePackage,
  useUndeprecatePackage,
  useUnpublishPackage,
} from '../../../../../hooks';

type SettingsTab = 'general' | 'maintainers' | 'tokens' | 'danger';

export default function PackageSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const { isConnected } = useAccount();
  const rawScope = params.scope as string;
  const name = params.name as string;
  const scope = decodeURIComponent(rawScope);
  const fullName = scope.startsWith('@') ? `${scope}/${name}` : name;

  const { settings, isLoading } = usePackageSettings(scope, name);
  const updateSettings = useUpdatePackageSettings(scope, name);
  const addMaintainer = useAddMaintainer(scope, name);
  const removeMaintainer = useRemoveMaintainer(scope, name);
  const createToken = useCreateAccessToken(scope, name);
  const revokeToken = useRevokeAccessToken(scope, name);
  const deprecatePackage = useDeprecatePackage(scope, name);
  const undeprecatePackage = useUndeprecatePackage(scope, name);
  const unpublishPackage = useUnpublishPackage(scope, name);

  const [tab, setTab] = useState<SettingsTab>('general');
  const [description, setDescription] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [newMaintainer, setNewMaintainer] = useState('');
  const [newMaintainerRole, setNewMaintainerRole] = useState<'owner' | 'maintainer'>('maintainer');
  const [newTokenName, setNewTokenName] = useState('');
  const [deprecationMessage, setDeprecationMessage] = useState('');

  // Initialize form values when settings load
  useState(() => {
    if (settings) {
      setDescription(settings.description);
    }
  });

  const handleSave = async () => {
    await updateSettings.mutateAsync({ description });
  };

  const handleAddMaintainer = async () => {
    if (!newMaintainer) return;
    await addMaintainer.mutateAsync({ login: newMaintainer, role: newMaintainerRole });
    setNewMaintainer('');
  };

  const handleCreateToken = async () => {
    if (!newTokenName) return;
    await createToken.mutateAsync({ name: newTokenName, permissions: ['read', 'write'] });
    setNewTokenName('');
  };

  const handleDeprecate = async () => {
    if (!deprecationMessage) return;
    await deprecatePackage.mutateAsync(deprecationMessage);
    setDeprecationMessage('');
  };

  const handleUndeprecate = async () => {
    await undeprecatePackage.mutateAsync();
  };

  const handleUnpublish = async () => {
    if (deleteConfirm !== fullName) return;
    await unpublishPackage.mutateAsync();
    router.push('/packages');
  };

  const tabs = [
    { id: 'general' as const, label: 'General', icon: Settings },
    { id: 'maintainers' as const, label: 'Maintainers', icon: Users },
    { id: 'tokens' as const, label: 'Access Tokens', icon: Key },
    { id: 'danger' as const, label: 'Danger Zone', icon: AlertTriangle },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
      </div>
    );
  }

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
                  <label className="block text-sm font-medium text-factory-300 mb-2">Package Name</label>
                  <input
                    type="text"
                    value={settings?.name || fullName}
                    disabled
                    className="input opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">Description</label>
                  <textarea
                    value={description || settings?.description || ''}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="input resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">Visibility</label>
                  <div className="text-factory-400">
                    {settings?.visibility === 'private' ? 'Private' : 'Public'}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">Downloads</label>
                  <div className="text-factory-400">
                    {(settings?.downloadCount || 0).toLocaleString()} total downloads
                  </div>
                </div>

                <div className="pt-4 border-t border-factory-800">
                  <button 
                    onClick={handleSave} 
                    disabled={updateSettings.isPending || !isConnected} 
                    className="btn btn-primary"
                  >
                    {updateSettings.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
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
                  <select
                    value={newMaintainerRole}
                    onChange={(e) => setNewMaintainerRole(e.target.value as 'owner' | 'maintainer')}
                    className="input w-32"
                  >
                    <option value="maintainer">Maintainer</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button 
                    onClick={handleAddMaintainer}
                    disabled={addMaintainer.isPending || !isConnected}
                    className="btn btn-primary"
                  >
                    {addMaintainer.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add
                  </button>
                </div>

                <div className="space-y-3">
                  {settings?.maintainers.map(m => (
                    <div key={m.login} className="flex items-center justify-between p-4 bg-factory-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <img src={m.avatar} alt="" className="w-8 h-8 rounded-full" />
                        <div>
                          <span className="text-factory-200">{m.login}</span>
                          {m.role === 'owner' && (
                            <span className="ml-2 badge bg-purple-500/20 text-purple-400 text-xs">Owner</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="badge bg-factory-700 text-factory-300 capitalize">{m.role}</span>
                        {m.role !== 'owner' && (
                          <button 
                            onClick={() => removeMaintainer.mutate(m.login)}
                            disabled={removeMaintainer.isPending}
                            className="text-red-400 hover:text-red-300 p-1"
                          >
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
                </div>

                <p className="text-factory-400 text-sm">
                  Tokens allow CI/CD systems and tools to publish on your behalf.
                </p>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTokenName}
                    onChange={(e) => setNewTokenName(e.target.value)}
                    placeholder="Token name (e.g. CI/CD Token)"
                    className="input flex-1"
                  />
                  <button 
                    onClick={handleCreateToken}
                    disabled={createToken.isPending || !isConnected}
                    className="btn btn-primary text-sm"
                  >
                    {createToken.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create token
                  </button>
                </div>

                <div className="space-y-3">
                  {settings?.webhooks.map(webhook => (
                    <div key={webhook.id} className="p-4 bg-factory-800/50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Key className="w-4 h-4 text-factory-400" />
                          <span className="text-factory-200 font-medium">Token #{webhook.id}</span>
                        </div>
                        <button 
                          onClick={() => revokeToken.mutate(webhook.id)}
                          disabled={revokeToken.isPending}
                          className="text-red-400 hover:text-red-300 text-sm"
                        >
                          Revoke
                        </button>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-factory-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Created: {new Date(webhook.createdAt).toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Shield className="w-3 h-3" />
                          {webhook.events.join(', ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'danger' && (
              <div className="space-y-6">
                <div className="card p-6 border-yellow-500/30">
                  <h3 className="text-lg font-semibold text-yellow-400 mb-4 flex items-center gap-2">
                    <Archive className="w-5 h-5" />
                    Deprecate Package
                  </h3>
                  <p className="text-factory-400 text-sm mb-4">
                    Mark this package as deprecated. Users will see a warning when installing.
                  </p>
                  {settings?.deprecated ? (
                    <button 
                      onClick={handleUndeprecate}
                      disabled={undeprecatePackage.isPending}
                      className="btn bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30"
                    >
                      {undeprecatePackage.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Remove deprecation
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={deprecationMessage}
                        onChange={(e) => setDeprecationMessage(e.target.value)}
                        placeholder="Deprecation message (e.g. Use @new/package instead)"
                        className="input"
                      />
                      <button 
                        onClick={handleDeprecate}
                        disabled={deprecatePackage.isPending || !deprecationMessage}
                        className="btn bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/30"
                      >
                        {deprecatePackage.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Deprecate all versions
                      </button>
                    </div>
                  )}
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
                      onClick={handleUnpublish}
                      disabled={deleteConfirm !== fullName || unpublishPackage.isPending}
                      className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {unpublishPackage.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
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
