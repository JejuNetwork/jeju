import { useState } from 'react';
import { useAccount } from 'wagmi';
import { GitBranch, Plus, RefreshCw, Play, Clock, CheckCircle, XCircle, Circle, ChevronRight } from 'lucide-react';
import { usePipelines } from '../../hooks';

export default function PipelinesPage() {
  const { isConnected } = useAccount();
  const { data: pipelinesData, isLoading, refetch } = usePipelines();
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);

  const pipelines = pipelinesData?.pipelines ?? [];
  const running = pipelines.filter(p => p.status === 'running').length;
  const success = pipelines.filter(p => p.status === 'success').length;
  const failed = pipelines.filter(p => p.status === 'failed').length;

  const selectedPipelineData = pipelines.find(p => p.id === selectedPipeline);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle size={16} style={{ color: 'var(--success)' }} />;
      case 'failed': return <XCircle size={16} style={{ color: 'var(--error)' }} />;
      case 'running': return <div className="spinner" style={{ width: 16, height: 16 }} />;
      case 'pending': return <Clock size={16} style={{ color: 'var(--warning)' }} />;
      case 'skipped': return <Circle size={16} style={{ color: 'var(--text-muted)' }} />;
      default: return <Circle size={16} style={{ color: 'var(--text-muted)' }} />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success': return 'badge-success';
      case 'failed': return 'badge-error';
      case 'running': return 'badge-info';
      case 'pending': return 'badge-warning';
      default: return 'badge-neutral';
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">CI/CD Pipelines</h1>
          <p className="page-subtitle">Continuous integration and deployment on decentralized compute</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => refetch()}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn btn-primary" disabled={!isConnected}>
            <Plus size={16} /> New Pipeline
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute"><GitBranch size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Pipelines</div>
            <div className="stat-value">{pipelines.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Play size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Running</div>
            <div className="stat-value">{running}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage"><CheckCircle size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Succeeded</div>
            <div className="stat-value">{success}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--error-soft)', color: 'var(--error)' }}><XCircle size={24} /></div>
          <div className="stat-content">
            <div className="stat-label">Failed</div>
            <div className="stat-value">{failed}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedPipeline ? '1fr 1fr' : '1fr', gap: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><GitBranch size={18} /> Pipeline Runs</h3>
          </div>
          
          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
              <div className="spinner" />
            </div>
          ) : pipelines.length === 0 ? (
            <div className="empty-state">
              <GitBranch size={48} />
              <h3>No pipelines</h3>
              <p>Create your first CI/CD pipeline</p>
              <button className="btn btn-primary" disabled={!isConnected}>
                <Plus size={16} /> New Pipeline
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {pipelines.map((pipeline) => (
                <div
                  key={pipeline.id}
                  onClick={() => setSelectedPipeline(pipeline.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '1rem',
                    background: selectedPipeline === pipeline.id ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${selectedPipeline === pipeline.id ? 'var(--accent)' : 'var(--border)'}`,
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  {getStatusIcon(pipeline.status)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{pipeline.name}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Triggered {new Date(pipeline.triggeredAt).toLocaleString()}
                    </div>
                  </div>
                  <span className={`badge ${getStatusBadge(pipeline.status)}`}>{pipeline.status}</span>
                  <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedPipeline && selectedPipelineData && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Pipeline Details</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedPipeline(null)}>×</button>
            </div>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Name</div>
                <div style={{ fontWeight: 500 }}>{selectedPipelineData.name}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Status</div>
                <span className={`badge ${getStatusBadge(selectedPipelineData.status)}`}>{selectedPipelineData.status}</span>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Duration</div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>
                  {selectedPipelineData.completedAt 
                    ? `${((selectedPipelineData.completedAt - selectedPipelineData.triggeredAt) / 1000).toFixed(1)}s`
                    : 'Running...'
                  }
                </div>
              </div>
              
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Steps</div>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {selectedPipelineData.steps.map((step, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      {getStatusIcon(step.status)}
                      <span style={{ flex: 1 }}>{step.name}</span>
                      {step.durationMs !== null && (
                        <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {(step.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {selectedPipelineData.steps.some(s => s.output) && (
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Output</div>
                  <pre style={{ 
                    background: 'var(--bg-tertiary)', 
                    padding: '1rem', 
                    borderRadius: 'var(--radius-md)', 
                    overflow: 'auto', 
                    maxHeight: '200px',
                    fontSize: '0.8rem',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {selectedPipelineData.steps.map(s => s.output).filter(Boolean).join('\n')}
                  </pre>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-secondary" style={{ flex: 1 }}>
                  <RefreshCw size={16} /> Re-run
                </button>
                {selectedPipelineData.status === 'running' && (
                  <button className="btn btn-secondary" style={{ flex: 1 }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


