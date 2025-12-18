import { useState } from 'react';
import { useAccount } from 'wagmi';
import { FolderGit2, Plus, RefreshCw, Star, GitFork, Lock, Globe, Copy, Check, Settings, Archive } from 'lucide-react';
import { useRepositories, useCreateRepository } from '../../hooks';

export default function RepositoriesPage() {
  const { isConnected } = useAccount();
  const { data: reposData, isLoading, refetch } = useRepositories(50);
  const createRepo = useCreateRepository();
  
  const [showModal, setShowModal] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'public' | 'private'>('all');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    visibility: 'private',
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createRepo.mutateAsync({
      name: formData.name,
      description: formData.description,
      visibility: formData.visibility,
    });
    setShowModal(false);
    setFormData({ name: '', description: '', visibility: 'private' });
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const repositories = reposData?.repositories ?? [];
  const filteredRepos = repositories.filter(repo => {
    if (filter === 'all') return true;
    return repo.visibility === filter;
  });

  const totalStars = repositories.reduce((sum, r) => sum + r.starCount, 0);
  const totalForks = repositories.reduce((sum, r) => sum + r.forkCount, 0);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Git Repositories</h1>
          <p className="page-subtitle">Decentralized Git hosting with IPFS-backed storage</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => refetch()}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)} disabled={!isConnected}>
            <Plus size={16} /> New Repository
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute"><FolderGit2 size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Repositories</div>
            <div className="stat-value">{repositories.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage"><Star size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Total Stars</div>
            <div className="stat-value">{totalStars.toLocaleString()}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network"><GitFork size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Total Forks</div>
            <div className="stat-value">{totalForks.toLocaleString()}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai"><Globe size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Public</div>
            <div className="stat-value">{repositories.filter(r => r.visibility === 'public').length}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title"><FolderGit2 size={18} /> Repositories</h3>
          <div className="tabs" style={{ marginBottom: 0, border: 'none' }}>
            {(['all', 'public', 'private'] as const).map((f) => (
              <button
                key={f}
                className={`tab ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
                style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" />
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="empty-state">
            <FolderGit2 size={48} />
            <h3>No repositories</h3>
            <p>Create your first Git repository</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)} disabled={!isConnected}>
              <Plus size={16} /> New Repository
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {filteredRepos.map((repo) => (
              <div
                key={repo.repoId}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}
              >
                <FolderGit2 size={24} style={{ color: 'var(--accent)', marginTop: '0.125rem' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <a href={`/developer/repositories/${repo.repoId}`} style={{ fontWeight: 600, fontSize: '1.05rem' }}>
                      {repo.name}
                    </a>
                    <span className={`badge ${repo.visibility === 'public' ? 'badge-success' : 'badge-neutral'}`}>
                      {repo.visibility === 'public' ? <Globe size={12} style={{ marginRight: '0.25rem' }} /> : <Lock size={12} style={{ marginRight: '0.25rem' }} />}
                      {repo.visibility}
                    </span>
                    {repo.archived && <span className="badge badge-warning"><Archive size={12} style={{ marginRight: '0.25rem' }} /> Archived</span>}
                  </div>
                  {repo.description && (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0.5rem 0' }}>
                      {repo.description}
                    </p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Star size={14} /> {repo.starCount}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <GitFork size={14} /> {repo.forkCount}
                    </span>
                    <span>Updated {new Date(repo.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleCopy(repo.cloneUrl, repo.repoId)}
                    title="Copy clone URL"
                  >
                    {copied === repo.repoId ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button className="btn btn-ghost btn-sm" title="Settings">
                    <Settings size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">New Repository</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Repository Name *</label>
                  <input
                    className="input"
                    placeholder="my-project"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    required
                    pattern="[a-zA-Z0-9_-]+"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    className="input"
                    placeholder="A short description of your repository"
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Visibility</label>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.75rem', background: formData.visibility === 'public' ? 'var(--accent-soft)' : 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: `1px solid ${formData.visibility === 'public' ? 'var(--accent)' : 'var(--border)'}` }}>
                      <input
                        type="radio"
                        name="visibility"
                        value="public"
                        checked={formData.visibility === 'public'}
                        onChange={e => setFormData({ ...formData, visibility: e.target.value })}
                        style={{ marginTop: '0.25rem' }}
                      />
                      <div>
                        <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Globe size={16} /> Public
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Anyone can see this repository</div>
                      </div>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.75rem', background: formData.visibility === 'private' ? 'var(--accent-soft)' : 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: `1px solid ${formData.visibility === 'private' ? 'var(--accent)' : 'var(--border)'}` }}>
                      <input
                        type="radio"
                        name="visibility"
                        value="private"
                        checked={formData.visibility === 'private'}
                        onChange={e => setFormData({ ...formData, visibility: e.target.value })}
                        style={{ marginTop: '0.25rem' }}
                      />
                      <div>
                        <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Lock size={16} /> Private
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Only you can see this repository</div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={createRepo.isPending}>
                  {createRepo.isPending ? 'Creating...' : <><Plus size={16} /> Create</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


