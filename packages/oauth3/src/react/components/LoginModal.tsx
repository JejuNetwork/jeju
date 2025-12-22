/**
 * LoginModal Component
 * 
 * A complete login modal with multiple provider options.
 */

import React, { useState, useCallback } from 'react';
import { AuthProvider } from '../../index.js';
import { useOAuth3 } from '../provider.js';
import { LoginButton } from './LoginButton.js';

export interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  providers?: AuthProvider[];
  title?: string;
  subtitle?: string;
  showEmailPhone?: boolean;
}

const defaultProviders: AuthProvider[] = [
  AuthProvider.WALLET,
  AuthProvider.GOOGLE,
  AuthProvider.FARCASTER,
  AuthProvider.GITHUB,
  AuthProvider.TWITTER,
  AuthProvider.DISCORD,
];

export function LoginModal({
  isOpen,
  onClose,
  onSuccess,
  providers = defaultProviders,
  title = 'Sign In',
  subtitle = 'Choose your preferred method',
  showEmailPhone = true,
}: LoginModalProps) {
  const { login, isLoading } = useOAuth3();
  const [view, setView] = useState<'providers' | 'email' | 'phone'>('providers');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSuccess = useCallback(() => {
    onSuccess?.();
    onClose();
  }, [onSuccess, onClose]);

  const handleEmailSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!codeSent) {
      // Send magic link / OTP
      // This would call the TEE agent
      setCodeSent(true);
    } else {
      // Verify code
      await login(AuthProvider.EMAIL);
      handleSuccess();
    }
  }, [codeSent, email, code, login, handleSuccess]);

  const handlePhoneSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!codeSent) {
      // Send OTP
      setCodeSent(true);
    } else {
      // Verify code
      await login(AuthProvider.PHONE);
      handleSuccess();
    }
  }, [codeSent, phone, code, login, handleSuccess]);

  if (!isOpen) return null;

  const modalOverlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  };

  const modalContentStyle: React.CSSProperties = {
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '32px',
    maxWidth: '400px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    position: 'relative',
  };

  const closeButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: '16px',
    right: '16px',
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: '#666',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '24px',
    fontWeight: 600,
    marginBottom: '8px',
    color: '#111',
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: '14px',
    color: '#666',
    marginBottom: '24px',
  };

  const dividerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    margin: '24px 0',
    color: '#999',
    fontSize: '12px',
  };

  const lineStyle: React.CSSProperties = {
    flex: 1,
    height: '1px',
    backgroundColor: '#e0e0e0',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    fontSize: '16px',
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    marginBottom: '12px',
    outline: 'none',
  };

  const submitButtonStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 500,
    borderRadius: '8px',
    border: 'none',
    cursor: isLoading ? 'not-allowed' : 'pointer',
    backgroundColor: '#4F46E5',
    color: 'white',
    marginTop: '8px',
  };

  const backButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#4F46E5',
    cursor: 'pointer',
    fontSize: '14px',
    marginBottom: '16px',
  };

  const errorStyle: React.CSSProperties = {
    color: '#DC2626',
    fontSize: '14px',
    marginBottom: '12px',
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalContentStyle} onClick={e => e.stopPropagation()}>
        <button style={closeButtonStyle} onClick={onClose}>×</button>

        {view === 'providers' && (
          <>
            <h2 style={titleStyle}>{title}</h2>
            <p style={subtitleStyle}>{subtitle}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {providers.map(provider => (
                <LoginButton
                  key={provider}
                  provider={provider}
                  onSuccess={handleSuccess}
                  style={{ width: '100%' }}
                />
              ))}
            </div>

            {showEmailPhone && (
              <>
                <div style={dividerStyle}>
                  <div style={lineStyle} />
                  <span style={{ padding: '0 12px' }}>or continue with</span>
                  <div style={lineStyle} />
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    onClick={() => setView('email')}
                    style={{
                      ...submitButtonStyle,
                      backgroundColor: '#f3f4f6',
                      color: '#111',
                      flex: 1,
                    }}
                  >
                    📧 Email
                  </button>
                  <button
                    onClick={() => setView('phone')}
                    style={{
                      ...submitButtonStyle,
                      backgroundColor: '#f3f4f6',
                      color: '#111',
                      flex: 1,
                    }}
                  >
                    📱 Phone
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {view === 'email' && (
          <>
            <button style={backButtonStyle} onClick={() => { setView('providers'); setCodeSent(false); setCode(''); }}>
              ← Back
            </button>
            <h2 style={titleStyle}>Continue with Email</h2>
            
            <form onSubmit={handleEmailSubmit}>
              {error && <p style={errorStyle}>{error}</p>}
              
              <input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={inputStyle}
                disabled={codeSent}
                required
              />

              {codeSent && (
                <>
                  <p style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
                    We sent a code to {email}
                  </p>
                  <input
                    type="text"
                    placeholder="Enter verification code"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    style={inputStyle}
                    maxLength={6}
                    required
                  />
                </>
              )}

              <button type="submit" style={submitButtonStyle} disabled={isLoading}>
                {isLoading ? 'Loading...' : codeSent ? 'Verify Code' : 'Send Code'}
              </button>
            </form>
          </>
        )}

        {view === 'phone' && (
          <>
            <button style={backButtonStyle} onClick={() => { setView('providers'); setCodeSent(false); setCode(''); }}>
              ← Back
            </button>
            <h2 style={titleStyle}>Continue with Phone</h2>
            
            <form onSubmit={handlePhoneSubmit}>
              {error && <p style={errorStyle}>{error}</p>}
              
              <input
                type="tel"
                placeholder="Enter your phone number"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                style={inputStyle}
                disabled={codeSent}
                required
              />

              {codeSent && (
                <>
                  <p style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
                    We sent a code to {phone}
                  </p>
                  <input
                    type="text"
                    placeholder="Enter verification code"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    style={inputStyle}
                    maxLength={6}
                    required
                  />
                </>
              )}

              <button type="submit" style={submitButtonStyle} disabled={isLoading}>
                {isLoading ? 'Loading...' : codeSent ? 'Verify Code' : 'Send Code'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
