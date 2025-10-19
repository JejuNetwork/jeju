import React, { useState, useEffect, useRef } from 'react';
import TauriService, { ContainerLog } from '../services/TauriService';
import './ContainerLogs.css';

export const ContainerLogs: React.FC = () => {
  const [logs, setLogs] = useState<ContainerLog[]>([]);
  const [filter, setFilter] = useState<'all' | 'agentserver' | 'postgres'>('all');
  const [showOnlyErrors, setShowOnlyErrors] = useState<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const maxLogsRef = useRef<number>(1000); // Keep last 1000 logs

  useEffect(() => {
    // Subscribe to container logs
    const unsubscribe = TauriService.onContainerLog((log: ContainerLog) => {
      setLogs((prevLogs) => {
        const newLogs = [...prevLogs, log];
        // Keep only the last maxLogsRef logs
        if (newLogs.length > maxLogsRef.current) {
          return newLogs.slice(-maxLogsRef.current);
        }
        return newLogs;
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const isErrorLog = (message: string): boolean => {
    const errorPatterns = [
      /ERROR/i,
      /FATAL/i,
      /CRITICAL/i,
      /Exception/i,
      /Failed/i,
      /Error:/i,
      /panic:/i,
    ];
    return errorPatterns.some((pattern) => pattern.test(message));
  };

  const isPostgresError = (log: ContainerLog): boolean => {
    return log.service.toLowerCase().includes('postgres') && isErrorLog(log.message);
  };

  const filteredLogs = logs.filter((log) => {
    // Filter by container
    if (filter === 'agentserver' && !log.service.toLowerCase().includes('agentserver')) {
      return false;
    }
    if (filter === 'postgres' && !log.service.toLowerCase().includes('postgres')) {
      return false;
    }

    // For postgres, only show errors
    if (log.service.toLowerCase().includes('postgres') && !isPostgresError(log)) {
      return false;
    }

    // For other containers, show all logs unless showOnlyErrors is true
    if (
      showOnlyErrors &&
      !log.service.toLowerCase().includes('postgres') &&
      !isErrorLog(log.message)
    ) {
      return false;
    }

    return true;
  });

  const clearLogs = () => {
    setLogs([]);
  };

  const getLogClass = (log: ContainerLog): string => {
    if (isErrorLog(log.message)) return 'log-error';
    if (log.level === 'error') return 'log-stderr';
    if (log.message.includes('WARN')) return 'log-warn';
    if (log.message.includes('INFO')) return 'log-info';
    if (log.message.includes('DEBUG')) return 'log-debug';
    return 'log-default';
  };

  const formatTimestamp = (timestamp: Date): string => {
    return timestamp.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="container-logs">
      <div className="logs-header">
        <h3>Container Logs</h3>
        <div className="logs-controls">
          <div className="filter-group">
            <label>Container:</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
              <option value="all">All</option>
              <option value="agentserver">AgentServer</option>
              <option value="postgres">PostgreSQL (Errors Only)</option>
            </select>
          </div>
          <div className="filter-group">
            <label>
              <input
                type="checkbox"
                checked={showOnlyErrors}
                onChange={(e) => setShowOnlyErrors(e.target.checked)}
                disabled={filter === 'postgres'} // Postgres always shows only errors
              />
              Errors Only
            </label>
          </div>
          <button onClick={clearLogs} className="clear-logs-btn">
            Clear
          </button>
        </div>
      </div>
      <div className="logs-container" ref={logContainerRef}>
        {filteredLogs.length === 0 ? (
          <div className="no-logs">No logs to display</div>
        ) : (
          filteredLogs.map((log, index) => (
            <div key={index} className={`log-entry ${getLogClass(log)}`}>
              <span className="log-timestamp">{formatTimestamp(log.timestamp)}</span>
              <span className="log-container">[{log.service}]</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ContainerLogs;
