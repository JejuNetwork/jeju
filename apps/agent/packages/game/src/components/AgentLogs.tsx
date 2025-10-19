import React, { useState, useEffect, useRef } from 'react';
import TauriService from '../services/TauriService';
import './AgentLogs.css';

interface AgentLog {
  timestamp: string;
  type: 'agent' | 'system' | 'error';
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: Record<string, unknown>;
}

export const AgentLogs: React.FC = () => {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [filter, setFilter] = useState<'all' | 'agent' | 'system'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLogs = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const fetchedLogs = await TauriService.fetchLogs(filter === 'all' ? undefined : filter, 100);
      setLogs(fetchedLogs);
    } catch (err) {
      console.error('Failed to fetch agent logs:', err);
      setError('Failed to fetch logs');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchLogs();

    // Set up auto-refresh if enabled
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(fetchLogs, 5000); // Refresh every 5 seconds
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [filter, autoRefresh]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logContainerRef.current && autoRefresh) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogClass = (log: AgentLog): string => {
    if (log.level === 'error') return 'log-error';
    if (log.level === 'warn') return 'log-warn';
    if (log.level === 'debug') return 'log-debug';
    if (log.type === 'system') return 'log-system';
    if (log.type === 'agent') return 'log-agent';
    return 'log-info';
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getLogIcon = (log: AgentLog): string => {
    if (log.type === 'agent') return '🤖';
    if (log.type === 'system') return '⚙️';
    if (log.level === 'error') return '❌';
    if (log.level === 'warn') return '⚠️';
    return '📝';
  };

  return (
    <div className="agent-logs">
      <div className="logs-header">
        <h3>Agent & System Logs</h3>
        <div className="logs-controls">
          <div className="filter-group">
            <label>Type:</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'all' | 'agent' | 'system')}
            >
              <option value="all">All</option>
              <option value="agent">Agent Only</option>
              <option value="system">System Only</option>
            </select>
          </div>
          <div className="filter-group">
            <label>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
          </div>
          <button onClick={fetchLogs} className="refresh-logs-btn" disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="logs-error">{error}</div>}

      <div className="logs-container" ref={logContainerRef}>
        {logs.length === 0 ? (
          <div className="no-logs">{isLoading ? 'Loading logs...' : 'No logs to display'}</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className={`log-entry ${getLogClass(log)}`}>
              <span className="log-timestamp">{formatTimestamp(log.timestamp)}</span>
              <span className="log-icon">{getLogIcon(log)}</span>
              <span className="log-type">[{log.type.toUpperCase()}]</span>
              <span className="log-message">{log.message}</span>
              {log.metadata && Object.keys(log.metadata).length > 0 && (
                <span className="log-metadata" title={JSON.stringify(log.metadata, null, 2)}>
                  📋
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AgentLogs;
