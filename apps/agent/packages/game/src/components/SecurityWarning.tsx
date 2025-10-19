import React, { useState } from 'react';

/**
 * Security Warning Component for ELIZA Game
 *
 * Displays warnings for dangerous capabilities and requires
 * explicit user confirmation before enabling high-risk features
 */

interface SecurityWarningProps {
  capability: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  risks: string[];
  onConfirm: () => void;
  onCancel: () => void;
  isVisible: boolean;
}

export const SecurityWarning: React.FC<SecurityWarningProps> = ({
  capability,
  riskLevel,
  description,
  risks,
  onConfirm,
  onCancel,
  isVisible,
}) => {
  const [acknowledged, setAcknowledged] = useState(false);
  const [warningsRead, setWarningsRead] = useState(false);

  if (!isVisible) {
    return null;
  }

  const riskColors = {
    low: '#4ade80', // green
    medium: '#facc15', // yellow
    high: '#f97316', // orange
    critical: '#ef4444', // red
  };

  const riskIcons = {
    low: '⚠️',
    medium: '⚠️',
    high: '🚨',
    critical: '🔴',
  };

  const handleConfirm = () => {
    if (!acknowledged || !warningsRead) {
      return;
    }
    onConfirm();
  };

  return (
    <div className="security-warning-overlay">
      <div className="security-warning-modal">
        <div className="security-warning-header" style={{ borderColor: riskColors[riskLevel] }}>
          <span className="security-warning-icon">{riskIcons[riskLevel]}</span>
          <h2 className="security-warning-title">Security Warning: {capability}</h2>
          <div
            className="security-warning-risk-level"
            style={{ backgroundColor: riskColors[riskLevel] }}
          >
            {riskLevel.toUpperCase()} RISK
          </div>
        </div>

        <div className="security-warning-content">
          <div className="security-warning-description">
            <h3>Capability Description:</h3>
            <p>{description}</p>
          </div>

          <div className="security-warning-risks">
            <h3>Security Risks:</h3>
            <ul>
              {risks.map((risk, index) => (
                <li key={index} className="security-warning-risk-item">
                  <span className="risk-bullet">⚠️</span>
                  {risk}
                </li>
              ))}
            </ul>
          </div>

          {riskLevel === 'critical' && (
            <div className="security-warning-critical">
              <h3>🔴 CRITICAL WARNING:</h3>
              <p>
                This capability can completely compromise your system security. It provides
                unrestricted access to your computer and should only be enabled in isolated,
                non-production environments.
              </p>
            </div>
          )}

          <div className="security-warning-recommendations">
            <h3>Security Recommendations:</h3>
            <ul>
              <li>Only enable this capability if you fully understand the risks</li>
              <li>Use in an isolated environment (virtual machine, container)</li>
              <li>Monitor all activity when this capability is enabled</li>
              <li>Disable immediately after use</li>
              {riskLevel === 'critical' && (
                <>
                  <li>
                    <strong>Do not use on production systems</strong>
                  </li>
                  <li>
                    <strong>Ensure no sensitive data is accessible</strong>
                  </li>
                </>
              )}
            </ul>
          </div>

          <div className="security-warning-acknowledgments">
            <label className="security-warning-checkbox">
              <input
                type="checkbox"
                checked={warningsRead}
                onChange={(e) => setWarningsRead(e.target.checked)}
              />
              I have read and understood all security warnings above
            </label>

            <label className="security-warning-checkbox">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              I acknowledge the security risks and accept full responsibility
            </label>

            {riskLevel === 'critical' && (
              <label className="security-warning-checkbox critical">
                <input type="checkbox" required />I understand this could completely compromise my
                system
              </label>
            )}
          </div>
        </div>

        <div className="security-warning-actions">
          <button className="security-warning-button cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="security-warning-button confirm"
            onClick={handleConfirm}
            disabled={!acknowledged || !warningsRead}
            style={{
              backgroundColor: acknowledged && warningsRead ? riskColors[riskLevel] : '#666',
            }}
          >
            {riskLevel === 'critical' ? 'Enable Despite Risks' : 'Enable Capability'}
          </button>
        </div>
      </div>

      <style>{`
        .security-warning-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          font-family: 'Courier New', monospace;
        }

        .security-warning-modal {
          background: #1a1a1a;
          border: 2px solid #333;
          border-radius: 8px;
          max-width: 600px;
          max-height: 80vh;
          overflow-y: auto;
          color: #00ff00;
        }

        .security-warning-header {
          padding: 20px;
          border-bottom: 2px solid;
          display: flex;
          align-items: center;
          gap: 15px;
          position: relative;
        }

        .security-warning-icon {
          font-size: 24px;
        }

        .security-warning-title {
          flex: 1;
          margin: 0;
          font-size: 18px;
          font-weight: bold;
        }

        .security-warning-risk-level {
          padding: 5px 10px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
          color: black;
        }

        .security-warning-content {
          padding: 20px;
        }

        .security-warning-description,
        .security-warning-risks,
        .security-warning-recommendations,
        .security-warning-critical {
          margin-bottom: 20px;
        }

        .security-warning-content h3 {
          margin: 0 0 10px 0;
          color: #ffff00;
          font-size: 14px;
        }

        .security-warning-content p {
          margin: 0 0 10px 0;
          line-height: 1.4;
        }

        .security-warning-content ul {
          margin: 0;
          padding-left: 20px;
        }

        .security-warning-risk-item {
          margin-bottom: 8px;
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }

        .risk-bullet {
          flex-shrink: 0;
          margin-top: 1px;
        }

        .security-warning-critical {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid #ef4444;
          padding: 15px;
          border-radius: 4px;
        }

        .security-warning-critical h3 {
          color: #ef4444;
          margin-top: 0;
        }

        .security-warning-acknowledgments {
          border-top: 1px solid #333;
          padding-top: 15px;
        }

        .security-warning-checkbox {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 12px;
          cursor: pointer;
          font-size: 12px;
          line-height: 1.4;
        }

        .security-warning-checkbox.critical {
          color: #ef4444;
          font-weight: bold;
        }

        .security-warning-checkbox input[type="checkbox"] {
          margin: 0;
          accent-color: #00ff00;
        }

        .security-warning-actions {
          padding: 20px;
          border-top: 1px solid #333;
          display: flex;
          gap: 15px;
          justify-content: flex-end;
        }

        .security-warning-button {
          padding: 10px 20px;
          border: 1px solid;
          background: transparent;
          color: inherit;
          font-family: inherit;
          font-size: 12px;
          cursor: pointer;
          border-radius: 4px;
          transition: all 0.2s;
        }

        .security-warning-button.cancel {
          border-color: #666;
          color: #ccc;
        }

        .security-warning-button.cancel:hover {
          background: #333;
        }

        .security-warning-button.confirm {
          border-color: currentColor;
          font-weight: bold;
        }

        .security-warning-button.confirm:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .security-warning-button.confirm:not(:disabled):hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </div>
  );
};

/**
 * Security capability definitions for different plugins
 */
export const SECURITY_CAPABILITIES = {
  shell: {
    capability: 'Shell Command Execution',
    riskLevel: 'critical' as const,
    description:
      'Allows the AI agent to execute arbitrary shell commands on your system with full user privileges.',
    risks: [
      'Complete system compromise through arbitrary command execution',
      'File system access, modification, and deletion',
      'Network access and potential data exfiltration',
      'Installation of malicious software',
      'Privilege escalation attempts',
      'Access to sensitive files and credentials',
    ],
  },
  browser: {
    capability: 'Browser Automation',
    riskLevel: 'high' as const,
    description: 'Enables automated web browsing, form filling, and interaction with websites.',
    risks: [
      'Unauthorized access to logged-in accounts',
      'Automatic form submission with sensitive data',
      'Web-based social engineering attacks',
      'Interaction with malicious websites',
      'Potential for spam or abuse of online services',
    ],
  },
  autocoder: {
    capability: 'Dynamic Code Generation',
    riskLevel: 'high' as const,
    description:
      'Allows the AI to generate and execute code dynamically, modifying its own behavior.',
    risks: [
      'Injection of malicious code into the runtime',
      'Modification of security controls',
      'Creation of new attack vectors',
      'Bypass of existing safety measures',
      'Unpredictable behavior changes',
    ],
  },
  vision: {
    capability: 'Camera and Screen Access',
    riskLevel: 'medium' as const,
    description:
      'Provides access to camera, screen capture, and microphone for environmental awareness.',
    risks: [
      'Privacy violation through unauthorized recording',
      'Exposure of sensitive visual information',
      'Potential surveillance capabilities',
      'Access to confidential documents on screen',
    ],
  },
};
