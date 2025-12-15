import { Shield, Clock, Key, CheckCircle, AlertTriangle } from 'lucide-react';
import type { OAuth3Session } from '../hooks/useOAuth3';

interface SessionInfoProps {
  session: OAuth3Session;
}

export function SessionInfo({ session }: SessionInfoProps) {
  const expiresIn = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000 / 60));
  const isVerified = session.attestation.verified;
  const teeProvider = session.attestation.provider;

  return (
    <div className="card session-card">
      <div className="session-header">
        <div>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <Shield size={20} />
            <h3 className="card-title">Active Session</h3>
          </div>
          <p className="card-subtitle">TEE-attested authentication session</p>
        </div>
        <div className="session-status">
          <CheckCircle size={12} />
          Authenticated
        </div>
      </div>

      <div className="session-info-grid">
        <div className="session-info-item">
          <div className="session-info-label">Session ID</div>
          <div className="session-info-value">
            {session.sessionId.slice(0, 10)}...{session.sessionId.slice(-8)}
          </div>
        </div>

        <div className="session-info-item">
          <div className="session-info-label">Identity ID</div>
          <div className="session-info-value">
            {session.identityId.slice(0, 10)}...{session.identityId.slice(-8)}
          </div>
        </div>

        <div className="session-info-item">
          <div className="session-info-label">
            <Clock size={12} style={{ marginRight: '0.25rem', display: 'inline' }} />
            Expires In
          </div>
          <div className="session-info-value">
            {expiresIn} minutes
          </div>
        </div>

        <div className="session-info-item">
          <div className="session-info-label">
            <Key size={12} style={{ marginRight: '0.25rem', display: 'inline' }} />
            Capabilities
          </div>
          <div className="session-info-value">
            {session.capabilities.join(', ')}
          </div>
        </div>
      </div>

      {/* TEE Attestation */}
      <div style={{ 
        padding: '1rem', 
        background: 'var(--bg-tertiary)', 
        borderRadius: 'var(--radius-sm)',
        marginTop: '0.5rem'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '0.75rem'
        }}>
          <span style={{ 
            color: 'var(--text-muted)', 
            fontSize: '0.75rem', 
            textTransform: 'uppercase' 
          }}>
            TEE Attestation
          </span>
          <span className={`attestation-badge ${isVerified ? 'verified' : 'simulated'}`}>
            {isVerified ? (
              <>
                <CheckCircle size={12} />
                Verified
              </>
            ) : (
              <>
                <AlertTriangle size={12} />
                Simulated
              </>
            )}
          </span>
        </div>
        
        <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Provider:</span>
            <span style={{ fontFamily: 'monospace' }}>{teeProvider}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Measurement:</span>
            <span style={{ fontFamily: 'monospace' }}>
              {session.attestation.measurement.slice(0, 12)}...
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Quote:</span>
            <span style={{ fontFamily: 'monospace' }}>
              {session.attestation.quote.slice(0, 12)}...
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
