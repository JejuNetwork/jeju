'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Settings,
  ArrowLeft,
  GitBranch,
  Users,
  Webhook,
  Trash2,
  AlertTriangle,
  Globe,
  Lock,
  Loader2,
  Save,
  Plus,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { 
  useRepoSettings, 
  useUpdateRepoSettings, 
  useAddCollaborator, 
  useRemoveCollaborator,
  useAddWebhook,
  useDeleteWebhook,
  useTransferRepo,
  useDeleteRepo,
} from '../../../../../hooks';

type SettingsTab = 'general' | 'branches' | 'collaborators' | 'webhooks' | 'danger';

export default function RepoSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const owner = params.owner as string;
  const repo = params.repo as string;

  const { settings, isLoading } = useRepoSettings(owner, repo);
  const updateSettings = useUpdateRepoSettings(owner, repo);
  const addCollaborator = useAddCollaborator(owner, repo);
  const removeCollaborator = useRemoveCollaborator(owner, repo);
  const addWebhook = useAddWebhook(owner, repo);
  const deleteWebhook = useDeleteWebhook(owner, repo);
  const transferRepo = useTransferRepo(owner, repo);
  const deleteRepo = useDeleteRepo(owner, repo);

  const [tab, setTab] = useState<SettingsTab>('general');
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [newCollaborator, setNewCollaborator] = useState('');
  const [newCollaboratorRole, setNewCollaboratorRole] = useState<'read' | 'write' | 'admin'>('write');
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newTransferOwner, setNewTransferOwner] = useState('');

  // Initialize form values when settings load
  useState(() => {
    if (settings) {
      setRepoName(settings.name);
      setDescription(settings.description);
      setIsPrivate(settings.visibility === 'private');
      setDefaultBranch(settings.defaultBranch);
    }
  });

  const handleSave = async () => {
    await updateSettings.mutateAsync({
      name: repoName,
      description,
      visibility: isPrivate ? 'private' : 'public',
      defaultBranch,
    });
  };

  const handleAddCollaborator = async () => {
    if (!newCollaborator) return;
    await addCollaborator.mutateAsync({ login: newCollaborator, permission: newCollaboratorRole });
    setNewCollaborator('');
  };

  const handleAddWebhook = async () => {
    if (!newWebhookUrl) return;
    await addWebhook.mutateAsync({ url: newWebhookUrl, events: ['push', 'pull_request'] });
    setNewWebhookUrl('');
  };

  const handleTransfer = async () => {
    if (!newTransferOwner) return;
    await transferRepo.mutateAsync(newTransferOwner);
    router.push(`/git/${newTransferOwner}/${repo}`);
  };

  const handleDelete = async () => {
    if (deleteConfirm !== `${owner}/${repo}`) return;
    await deleteRepo.mutateAsync();
    router.push('/git');
  };

  const tabs = [
    { id: 'general' as const, label: 'General', icon: Settings },
    { id: 'branches' as const, label: 'Branches', icon: GitBranch },
    { id: 'collaborators' as const, label: 'Collaborators', icon: Users },
    { id: 'webhooks' as const, label: 'Webhooks', icon: Webhook },
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
            href={`/git/${owner}/${repo}`}
            className="text-factory-400 hover:text-factory-300 text-sm inline-flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {owner}/{repo}
          </Link>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Settings className="w-7 h-7 text-factory-400" />
            Repository Settings
          </h1>
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
                <h2 className="text-lg font-semibold text-factory-100">General Settings</h2>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">Repository name</label>
                  <input
                    type="text"
                    value={repoName || settings?.name || ''}
                    onChange={(e) => setRepoName(e.target.value)}
                    className="input"
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
                  <label className="block text-sm font-medium text-factory-300 mb-3">Visibility</label>
                  <div className="space-y-2">
                    <label className={clsx(
                      'flex items-start gap-3 p-3 rounded-lg border cursor-pointer',
                      !isPrivate ? 'border-accent-500 bg-accent-500/10' : 'border-factory-700 hover:border-factory-600'
                    )}>
                      <input
                        type="radio"
                        checked={!isPrivate}
                        onChange={() => setIsPrivate(false)}
                        className="mt-1"
                      />
                      <Globe className="w-5 h-5 text-factory-400" />
                      <div>
                        <p className="font-medium text-factory-200">Public</p>
                        <p className="text-factory-500 text-sm">Anyone can see this repository</p>
                      </div>
                    </label>
                    <label className={clsx(
                      'flex items-start gap-3 p-3 rounded-lg border cursor-pointer',
                      isPrivate ? 'border-accent-500 bg-accent-500/10' : 'border-factory-700 hover:border-factory-600'
                    )}>
                      <input
                        type="radio"
                        checked={isPrivate}
                        onChange={() => setIsPrivate(true)}
                        className="mt-1"
                      />
                      <Lock className="w-5 h-5 text-factory-400" />
                      <div>
                        <p className="font-medium text-factory-200">Private</p>
                        <p className="text-factory-500 text-sm">Only collaborators can see this repository</p>
                      </div>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">Default branch</label>
                  <select
                    value={defaultBranch}
                    onChange={(e) => setDefaultBranch(e.target.value)}
                    className="input"
                  >
                    {settings?.branches.map(b => (
                      <option key={b.name} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div className="pt-4 border-t border-factory-800">
                  <button
                    onClick={handleSave}
                    disabled={updateSettings.isPending}
                    className="btn btn-primary"
                  >
                    {updateSettings.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save changes
                  </button>
                </div>
              </div>
            )}

            {tab === 'branches' && (
              <div className="card p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-factory-100">Branch Protection</h2>
                  <button className="btn btn-secondary text-sm">
                    <Plus className="w-4 h-4" />
                    Add rule
                  </button>
                </div>

                <div className="space-y-3">
                  {settings?.branches.map(branch => (
                    <div key={branch.name} className="flex items-center justify-between p-4 bg-factory-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <GitBranch className="w-4 h-4 text-factory-400" />
                        <span className="font-mono text-factory-200">{branch.name}</span>
                        {branch.protected && (
                          <span className="badge bg-yellow-500/20 text-yellow-400 text-xs">Protected</span>
                        )}
                        {branch.default && (
                          <span className="badge bg-blue-500/20 text-blue-400 text-xs">Default</span>
                        )}
                      </div>
                      <button className="text-factory-400 hover:text-factory-200">
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'collaborators' && (
              <div className="card p-6 space-y-6">
                <h2 className="text-lg font-semibold text-factory-100">Manage Collaborators</h2>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCollaborator}
                    onChange={(e) => setNewCollaborator(e.target.value)}
                    placeholder="Add collaborator by address or ENS..."
                    className="input flex-1"
                  />
                  <select
                    value={newCollaboratorRole}
                    onChange={(e) => setNewCollaboratorRole(e.target.value as 'read' | 'write' | 'admin')}
                    className="input w-32"
                  >
                    <option value="read">Read</option>
                    <option value="write">Write</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button 
                    onClick={handleAddCollaborator}
                    disabled={addCollaborator.isPending}
                    className="btn btn-primary"
                  >
                    {addCollaborator.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add
                  </button>
                </div>

                <div className="space-y-3">
                  {settings?.collaborators.map(collab => (
                    <div key={collab.login} className="flex items-center justify-between p-4 bg-factory-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <img src={collab.avatar} alt="" className="w-8 h-8 rounded-full" />
                        <span className="text-factory-200">{collab.login}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="badge bg-factory-700 text-factory-300 capitalize">{collab.permission}</span>
                        <button 
                          onClick={() => removeCollaborator.mutate(collab.login)}
                          disabled={removeCollaborator.isPending}
                          className="text-red-400 hover:text-red-300 p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'webhooks' && (
              <div className="card p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-factory-100">Webhooks</h2>
                </div>

                <div className="flex gap-2">
                  <input
                    type="url"
                    value={newWebhookUrl}
                    onChange={(e) => setNewWebhookUrl(e.target.value)}
                    placeholder="https://example.com/webhook"
                    className="input flex-1"
                  />
                  <button 
                    onClick={handleAddWebhook}
                    disabled={addWebhook.isPending}
                    className="btn btn-primary text-sm"
                  >
                    {addWebhook.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add webhook
                  </button>
                </div>

                <div className="space-y-3">
                  {settings?.webhooks.map(webhook => (
                    <div key={webhook.id} className="p-4 bg-factory-800/50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <code className="text-factory-200 text-sm">{webhook.url}</code>
                        <div className="flex items-center gap-2">
                          <span className={clsx(
                            'w-2 h-2 rounded-full',
                            webhook.active ? 'bg-green-400' : 'bg-gray-400'
                          )} />
                          <button 
                            onClick={() => deleteWebhook.mutate(webhook.id)}
                            disabled={deleteWebhook.isPending}
                            className="text-red-400 hover:text-red-300"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {webhook.events.map(event => (
                          <span key={event} className="badge badge-info text-xs">{event}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'danger' && (
              <div className="space-y-6">
                <div className="card p-6 border-red-500/30">
                  <h3 className="text-lg font-semibold text-red-400 mb-4">Transfer Repository</h3>
                  <p className="text-factory-400 text-sm mb-4">
                    Transfer this repository to another user or organization.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTransferOwner}
                      onChange={(e) => setNewTransferOwner(e.target.value)}
                      placeholder="New owner address or ENS"
                      className="input flex-1"
                    />
                    <button 
                      onClick={handleTransfer}
                      disabled={transferRepo.isPending || !newTransferOwner}
                      className="btn bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
                    >
                      {transferRepo.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Transfer ownership
                    </button>
                  </div>
                </div>

                <div className="card p-6 border-red-500/30">
                  <h3 className="text-lg font-semibold text-red-400 mb-4 flex items-center gap-2">
                    <Trash2 className="w-5 h-5" />
                    Delete Repository
                  </h3>
                  <p className="text-factory-400 text-sm mb-4">
                    Once you delete a repository, there is no going back. Please be certain.
                  </p>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder={`Type "${owner}/${repo}" to confirm`}
                      className="input"
                    />
                    <button
                      onClick={handleDelete}
                      disabled={deleteConfirm !== `${owner}/${repo}` || deleteRepo.isPending}
                      className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleteRepo.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      Delete this repository
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
