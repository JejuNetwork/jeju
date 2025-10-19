import React, { useEffect, useState } from 'react';
import {
  AutocoderSocket,
  AutocoderWebSocketMessage,
  ProjectHistory,
  ProjectStatusUpdate,
} from '../types';

interface AutocoderProjectPanelProps {
  socket?: AutocoderSocket; // WebSocket connection if available
  onProjectSelect?: (projectId: string) => void;
}

interface ProjectStatus {
  active: ProjectStatusUpdate[];
  history: ProjectHistory[];
  summary: {
    active: number;
    completed: number;
    failed: number;
    totalGenerated: number;
    averageDuration: number;
  };
}

export const AutocoderProjectPanel: React.FC<AutocoderProjectPanelProps> = ({
  socket,
  onProjectSelect,
}) => {
  const [projects, setProjects] = useState<ProjectStatus>({
    active: [],
    history: [],
    summary: {
      active: 0,
      completed: 0,
      failed: 0,
      totalGenerated: 0,
      averageDuration: 0,
    },
  });

  useEffect(() => {
    if (!socket) return;

    // Listen for project updates
    const handleProjectUpdate = (data: AutocoderWebSocketMessage) => {
      if (data.type === 'PROJECT_UPDATE') {
        const update = data.data as ProjectStatusUpdate;
        setProjects((prev) => {
          const activeIndex = prev.active.findIndex((p) => p.projectId === update.projectId);
          const newActive = [...prev.active];

          if (activeIndex >= 0) {
            newActive[activeIndex] = update;
          } else {
            newActive.push(update);
          }

          // If completed or failed, move to history
          if (update.status === 'completed' || update.status === 'failed') {
            const historyEntry: ProjectHistory = {
              id: update.projectId,
              name: update.projectName,
              type: update.type,
              status: update.status,
              startedAt: update.startedAt!,
              completedAt: update.completedAt,
              duration:
                update.completedAt && update.startedAt
                  ? update.completedAt - update.startedAt
                  : undefined,
              filesGenerated: update.files?.filter((f) => f.status === 'complete').length,
              error: update.error,
            };

            return {
              ...prev,
              active: newActive.filter((p) => p.projectId !== update.projectId),
              history: [historyEntry, ...prev.history].slice(0, 50),
            };
          }

          return { ...prev, active: newActive };
        });
      }
    };

    socket.on('autocoder:project:update', handleProjectUpdate);

    return () => {
      socket.off('autocoder:project:update', handleProjectUpdate);
    };
  }, [socket]);

  const formatDuration = (ms?: number) => {
    if (!ms) return '';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'planning':
        return '#3b82f6'; // blue
      case 'generating':
        return '#f59e0b'; // amber
      case 'testing':
        return '#8b5cf6'; // purple
      case 'completed':
        return '#10b981'; // green
      case 'failed':
        return '#ef4444'; // red
      default:
        return '#6b7280'; // gray
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'planning':
        return '📋';
      case 'generating':
        return '⚙️';
      case 'testing':
        return '🧪';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      default:
        return '❓';
    }
  };

  return (
    <div className="autocoder-panel" style={{ padding: '16px', fontFamily: 'system-ui' }}>
      {/* Summary Stats */}
      <div
        className="summary-stats"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '12px',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            background: '#f3f4f6',
            padding: '12px',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#3b82f6' }}>
            {projects.active.length}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Active Projects</div>
        </div>

        <div
          style={{
            background: '#f3f4f6',
            padding: '12px',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981' }}>
            {projects.history.filter((h) => h.status === 'completed').length}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Completed</div>
        </div>

        <div
          style={{
            background: '#f3f4f6',
            padding: '12px',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ef4444' }}>
            {projects.history.filter((h) => h.status === 'failed').length}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Failed</div>
        </div>
      </div>

      {/* Active Projects */}
      {projects.active.length > 0 && (
        <div className="active-projects" style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>
            Active Projects
          </h3>
          {projects.active.map((project) => (
            <div
              key={project.projectId}
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '12px',
                cursor: onProjectSelect ? 'pointer' : 'default',
              }}
              onClick={() => onProjectSelect?.(project.projectId)}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '20px', marginRight: '8px' }}>
                  {getStatusIcon(project.status)}
                </span>
                <h4 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>
                  {project.projectName}
                </h4>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: '12px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: `${getStatusColor(project.status)}20`,
                    color: getStatusColor(project.status),
                    fontWeight: '500',
                  }}
                >
                  {project.status}
                </span>
              </div>

              {project.currentStep && (
                <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>
                  {project.currentStep}: {project.message}
                </div>
              )}

              {/* Progress Bar */}
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  backgroundColor: '#e5e7eb',
                  borderRadius: '3px',
                  overflow: 'hidden',
                  marginTop: '8px',
                }}
              >
                <div
                  style={{
                    width: `${project.progress || 0}%`,
                    height: '100%',
                    backgroundColor: getStatusColor(project.status),
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>

              {/* Validation Results */}
              {project.validationResults && project.status === 'testing' && (
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    marginTop: '8px',
                    fontSize: '12px',
                  }}
                >
                  <span
                    style={{ color: project.validationResults.lint.passed ? '#10b981' : '#ef4444' }}
                  >
                    Lint: {project.validationResults.lint.passed ? '✓' : '✗'}
                  </span>
                  <span
                    style={{
                      color: project.validationResults.typeCheck.passed ? '#10b981' : '#ef4444',
                    }}
                  >
                    Types: {project.validationResults.typeCheck.passed ? '✓' : '✗'}
                  </span>
                  <span
                    style={{
                      color: project.validationResults.tests.passed ? '#10b981' : '#ef4444',
                    }}
                  >
                    Tests: {project.validationResults.tests.passed ? '✓' : '✗'}
                  </span>
                  <span
                    style={{
                      color: project.validationResults.build.passed ? '#10b981' : '#ef4444',
                    }}
                  >
                    Build: {project.validationResults.build.passed ? '✓' : '✗'}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Project History */}
      <div className="project-history">
        <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>
          Recent Projects
        </h3>
        {projects.history.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: '#9ca3af',
              padding: '32px',
              background: '#f9fafb',
              borderRadius: '8px',
            }}
          >
            No completed projects yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {projects.history.map((project) => (
              <div
                key={project.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px',
                  background: '#f9fafb',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              >
                <span style={{ marginRight: '8px' }}>{getStatusIcon(project.status)}</span>
                <span style={{ fontWeight: '500' }}>{project.name}</span>
                <span
                  style={{
                    marginLeft: '8px',
                    color: '#6b7280',
                    fontSize: '12px',
                  }}
                >
                  ({project.type})
                </span>
                {project.duration && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      color: '#6b7280',
                      fontSize: '12px',
                    }}
                  >
                    {formatDuration(project.duration)}
                  </span>
                )}
                {project.filesGenerated && (
                  <span
                    style={{
                      marginLeft: '12px',
                      color: '#6b7280',
                      fontSize: '12px',
                    }}
                  >
                    {project.filesGenerated} files
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
