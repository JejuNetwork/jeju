import React, { useState, useEffect } from 'react';
import { TauriService } from '../services/TauriService';
import './BackupSettings.css';

interface Backup {
  id: string;
  timestamp: string;
  backup_type: 'manual' | 'automatic' | 'shutdown';
  size_bytes: number;
  components: Array<{
    name: string;
    component_type: string;
    size_bytes: number;
  }>;
  metadata: {
    agent_name: string;
    eliza_version: string;
    notes?: string;
  };
}

interface BackupConfig {
  auto_backup_enabled: boolean;
  auto_backup_interval_hours: number;
  max_backups_to_keep: number;
  backup_directory: string;
}

interface RestoreOptions {
  restore_database: boolean;
  restore_agent_state: boolean;
  restore_knowledge: boolean;
  restore_logs: boolean;
  force: boolean;
}

export const BackupSettings: React.FC = () => {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [config, setConfig] = useState<BackupConfig>({
    auto_backup_enabled: true,
    auto_backup_interval_hours: 4,
    max_backups_to_keep: 5,
    backup_directory: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
  const [restoreOptions, setRestoreOptions] = useState<RestoreOptions>({
    restore_database: true,
    restore_agent_state: true,
    restore_knowledge: true,
    restore_logs: false,
    force: false,
  });
  const [backupNotes, setBackupNotes] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    fetchBackups();
    fetchConfig();
  }, []);

  const fetchBackups = async () => {
    try {
      const backupList = await TauriService.listBackups();
      setBackups(backupList);
    } catch (error) {
      console.error('Failed to fetch backups:', error);
    }
  };

  const fetchConfig = async () => {
    try {
      const backupConfig = await TauriService.getBackupConfig();
      setConfig(backupConfig);
    } catch (error) {
      console.error('Failed to fetch backup config:', error);
    }
  };

  const handleCreateBackup = async () => {
    setIsLoading(true);
    try {
      await TauriService.createBackup('manual', backupNotes || undefined);
      await fetchBackups();
      setShowCreateDialog(false);
      setBackupNotes('');
    } catch (error) {
      console.error('Failed to create backup:', error);
      setNotification({ type: 'error', message: `Failed to create backup: ${error}` });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedBackup) return;

    setConfirmDialog({
      open: true,
      title: '⚠️ Restore Backup Warning',
      message: `This will restore your agent to the state from ${new Date(
        selectedBackup.timestamp
      ).toLocaleString()}. This operation is DESTRUCTIVE and will overwrite current data. Are you sure you want to continue?`,
      onConfirm: async () => {
        setConfirmDialog(null);
        setIsLoading(true);
        try {
          await TauriService.restoreBackup(selectedBackup.id, restoreOptions);
          setNotification({
            type: 'success',
            message: 'Backup restored successfully! The application will restart.',
          });
          await TauriService.restartApplication();
        } catch (error) {
          console.error('Failed to restore backup:', error);
          setNotification({ type: 'error', message: `Failed to restore backup: ${error}` });
        } finally {
          setIsLoading(false);
          setShowRestoreDialog(false);
        }
      },
    });
  };

  const handleDeleteBackup = async (backupId: string) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Backup',
      message: 'Are you sure you want to delete this backup?',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await TauriService.deleteBackup(backupId);
          await fetchBackups();
        } catch (error) {
          console.error('Failed to delete backup:', error);
          setNotification({ type: 'error', message: `Failed to delete backup: ${error}` });
        }
      },
    });
  };

  const handleExportBackup = async (backup: Backup) => {
    try {
      const exportPath = await TauriService.exportBackup(backup.id);
      setNotification({
        type: 'success',
        message: `Backup exported successfully to: ${exportPath}`,
      });
    } catch (error) {
      console.error('Failed to export backup:', error);
      setNotification({ type: 'error', message: `Failed to export backup: ${error}` });
    }
  };

  const handleImportBackup = async () => {
    try {
      const importPath = await TauriService.selectFile({
        filters: [{ name: 'Backup Files', extensions: ['zip'] }],
      });

      if (importPath) {
        setIsLoading(true);
        await TauriService.importBackup(importPath);
        await fetchBackups();
        setNotification({ type: 'success', message: 'Backup imported successfully!' });
      }
    } catch (error) {
      console.error('Failed to import backup:', error);
      setNotification({ type: 'error', message: `Failed to import backup: ${error}` });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfigUpdate = async () => {
    try {
      await TauriService.updateBackupConfig(config);
      setNotification({ type: 'success', message: 'Backup configuration updated successfully!' });
    } catch (error) {
      console.error('Failed to update config:', error);
      setNotification({ type: 'error', message: `Failed to update configuration: ${error}` });
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getBackupTypeIcon = (type: string): string => {
    switch (type) {
      case 'manual':
        return '✋';
      case 'automatic':
        return '🔄';
      case 'shutdown':
        return '🔌';
      default:
        return '📦';
    }
  };

  return (
    <div className="backup-settings">
      <div className="backup-header">
        <h3>◎ BACKUP & RESTORE</h3>
        <div className="backup-actions">
          <button className="backup-btn import" onClick={handleImportBackup} disabled={isLoading}>
            📥 Import
          </button>
          <button
            className="backup-btn create"
            onClick={() => setShowCreateDialog(true)}
            disabled={isLoading}
          >
            💾 Create Backup
          </button>
        </div>
      </div>

      {/* Auto-backup Configuration */}
      <div className="backup-config">
        <h4>Automatic Backup Settings</h4>
        <div className="config-item">
          <label>
            <input
              type="checkbox"
              checked={config.auto_backup_enabled}
              onChange={(e) => setConfig({ ...config, auto_backup_enabled: e.target.checked })}
            />
            Enable automatic backups
          </label>
        </div>
        <div className="config-item">
          <label>Backup interval (hours)</label>
          <input
            type="number"
            min="1"
            max="24"
            value={config.auto_backup_interval_hours}
            onChange={(e) =>
              setConfig({
                ...config,
                auto_backup_interval_hours: parseInt(e.target.value, 10) || 4,
              })
            }
          />
        </div>
        <div className="config-item">
          <label>Keep last</label>
          <input
            type="number"
            min="1"
            max="20"
            value={config.max_backups_to_keep}
            onChange={(e) =>
              setConfig({ ...config, max_backups_to_keep: parseInt(e.target.value, 10) || 5 })
            }
          />
          <span> backups</span>
        </div>
        <button className="config-save-btn" onClick={handleConfigUpdate}>
          Save Settings
        </button>
      </div>

      {/* Backup List */}
      <div className="backup-list">
        <h4>Available Backups</h4>
        {backups.length === 0 ? (
          <div className="no-backups">No backups available</div>
        ) : (
          <div className="backup-items">
            {backups.map((backup) => (
              <div key={backup.id} className="backup-item">
                <div className="backup-info">
                  <div className="backup-main">
                    <span className="backup-type-icon">
                      {getBackupTypeIcon(backup.backup_type)}
                    </span>
                    <span className="backup-name">{backup.metadata.agent_name}</span>
                    <span className="backup-type">{backup.backup_type}</span>
                  </div>
                  <div className="backup-details">
                    <span className="backup-time">
                      {new Date(backup.timestamp).toLocaleString()}
                    </span>
                    <span className="backup-size">{formatBytes(backup.size_bytes)}</span>
                    {backup.metadata.notes && (
                      <span className="backup-notes">{backup.metadata.notes}</span>
                    )}
                  </div>
                </div>
                <div className="backup-actions">
                  <button
                    className="action-btn restore"
                    onClick={() => {
                      setSelectedBackup(backup);
                      setShowRestoreDialog(true);
                    }}
                    title="Restore"
                  >
                    🔄
                  </button>
                  <button
                    className="action-btn export"
                    onClick={() => handleExportBackup(backup)}
                    title="Export"
                  >
                    📤
                  </button>
                  <button
                    className="action-btn delete"
                    onClick={() => handleDeleteBackup(backup.id)}
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Backup Dialog */}
      {showCreateDialog && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Create Manual Backup</h3>
            <div className="modal-body">
              <label>Notes (optional)</label>
              <textarea
                value={backupNotes}
                onChange={(e) => setBackupNotes(e.target.value)}
                placeholder="Add notes about this backup..."
                rows={3}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowCreateDialog(false)} disabled={isLoading}>
                Cancel
              </button>
              <button onClick={handleCreateBackup} disabled={isLoading} className="primary">
                {isLoading ? 'Creating...' : 'Create Backup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Dialog */}
      {showRestoreDialog && selectedBackup && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>⚠️ Restore Backup</h3>
            <div className="modal-body">
              <p className="warning-text">
                This will restore your agent to the state from{' '}
                <strong>{new Date(selectedBackup.timestamp).toLocaleString()}</strong>.
              </p>
              <p className="warning-text">
                <strong>This operation is DESTRUCTIVE and cannot be undone!</strong>
              </p>

              <div className="restore-options">
                <h4>Select components to restore:</h4>
                <label>
                  <input
                    type="checkbox"
                    checked={restoreOptions.restore_database}
                    onChange={(e) =>
                      setRestoreOptions({ ...restoreOptions, restore_database: e.target.checked })
                    }
                  />
                  Database (conversations, settings)
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={restoreOptions.restore_agent_state}
                    onChange={(e) =>
                      setRestoreOptions({
                        ...restoreOptions,
                        restore_agent_state: e.target.checked,
                      })
                    }
                  />
                  Agent State (memory, context)
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={restoreOptions.restore_knowledge}
                    onChange={(e) =>
                      setRestoreOptions({ ...restoreOptions, restore_knowledge: e.target.checked })
                    }
                  />
                  Knowledge Base
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={restoreOptions.restore_logs}
                    onChange={(e) =>
                      setRestoreOptions({ ...restoreOptions, restore_logs: e.target.checked })
                    }
                  />
                  Logs (optional)
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowRestoreDialog(false)} disabled={isLoading}>
                Cancel
              </button>
              <button onClick={handleRestore} disabled={isLoading} className="danger">
                {isLoading ? 'Restoring...' : 'Restore Backup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification */}
      {notification && (
        <div className={`notification ${notification.type}`}>
          <span>{notification.message}</span>
          <button onClick={() => setNotification(null)}>×</button>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && confirmDialog.open && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>{confirmDialog.title}</h2>
            <p>{confirmDialog.message}</p>
            <div className="modal-actions">
              <button onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button onClick={confirmDialog.onConfirm} className="danger">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
