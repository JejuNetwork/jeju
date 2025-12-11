import { useState } from 'react';
import { formatEther } from 'viem';
import { useAccount } from 'wagmi';
import {
  useProviderResources,
  useRentalCost,
  useCreateRental,
  useUserRentals,
  useRental,
  useCancelRental,
  GPU_NAMES,
  RentalStatus,
  STATUS_LABELS,
  formatDuration,
  formatHourlyRate,
} from '../hooks/useComputeRental';

const DEMO_PROVIDERS: Array<{
  address: `0x${string}`;
  name: string;
  location: string;
  rating: number;
}> = [
  {
    address: '0x1234567890123456789012345678901234567890',
    name: 'GPU Farm Alpha',
    location: 'US West',
    rating: 4.8,
  },
  {
    address: '0x2345678901234567890123456789012345678901',
    name: 'TEE Compute EU',
    location: 'Europe',
    rating: 4.9,
  },
  {
    address: '0x3456789012345678901234567890123456789012',
    name: 'H100 Cluster Asia',
    location: 'Asia Pacific',
    rating: 4.7,
  },
];

interface ProviderCardProps {
  provider: (typeof DEMO_PROVIDERS)[0];
  onRent: (address: `0x${string}`) => void;
}

function ProviderCard({ provider, onRent }: ProviderCardProps) {
  const { resources, isLoading } = useProviderResources(provider.address);

  if (isLoading) {
    return (
      <div className="card" style={{ padding: '1.5rem', opacity: 0.6 }}>
        <p>Loading...</p>
      </div>
    );
  }

  const gpuName = resources ? GPU_NAMES[resources.resources.gpuType] : 'Unknown';
  const hourlyRate = resources?.pricing.pricePerHour || 0n;
  const available = resources
    ? resources.maxConcurrent - resources.activeRentals
    : 0;

  return (
    <div
      className="card"
      style={{
        padding: '1.5rem',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        background: 'linear-gradient(135deg, var(--surface-hover) 0%, var(--surface) 100%)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '600' }}>
            {provider.name}
          </h3>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            📍 {provider.location}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--warning)' }}>
            {'⭐'.repeat(Math.floor(provider.rating))} {provider.rating}
          </div>
          <div
            style={{
              marginTop: '0.25rem',
              fontSize: '0.75rem',
              color: available > 0 ? 'var(--success)' : 'var(--error)',
            }}
          >
            {available > 0 ? `${available} slots available` : 'Fully booked'}
          </div>
        </div>
      </div>

      {/* Resources */}
      {resources && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '0.75rem',
            marginBottom: '1rem',
            padding: '1rem',
            background: 'var(--surface-active)',
            borderRadius: '8px',
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>GPU</p>
            <p style={{ margin: 0, fontWeight: '600' }}>
              {resources.resources.gpuCount}x {gpuName}
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>VRAM</p>
            <p style={{ margin: 0, fontWeight: '600' }}>{resources.resources.gpuVram} GB</p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>CPU</p>
            <p style={{ margin: 0, fontWeight: '600' }}>{resources.resources.cpuCores} cores</p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>RAM</p>
            <p style={{ margin: 0, fontWeight: '600' }}>{resources.resources.memory} GB</p>
          </div>
        </div>
      )}

      {/* Features */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {resources?.sshEnabled && (
          <span
            style={{
              padding: '0.25rem 0.5rem',
              background: 'var(--success-soft)',
              color: 'var(--success)',
              borderRadius: '4px',
              fontSize: '0.75rem',
            }}
          >
            🔐 SSH
          </span>
        )}
        {resources?.dockerEnabled && (
          <span
            style={{
              padding: '0.25rem 0.5rem',
              background: 'var(--info-soft)',
              color: 'var(--info)',
              borderRadius: '4px',
              fontSize: '0.75rem',
            }}
          >
            🐳 Docker
          </span>
        )}
        {resources?.resources.teeCapable && (
          <span
            style={{
              padding: '0.25rem 0.5rem',
              background: 'var(--warning-soft)',
              color: 'var(--warning)',
              borderRadius: '4px',
              fontSize: '0.75rem',
            }}
          >
            🔒 TEE
          </span>
        )}
      </div>

      {/* Pricing & Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)' }}>
            {formatHourlyRate(hourlyRate)}
          </p>
          {Boolean(resources?.pricing.pricePerGpuHour && resources.pricing.pricePerGpuHour > 0n) && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              +{formatHourlyRate(resources.pricing.pricePerGpuHour)}/GPU
            </p>
          )}
        </div>
        <button
          className="button"
          onClick={() => onRent(provider.address)}
          disabled={available === 0}
          style={{
            padding: '0.75rem 1.5rem',
            background: available > 0 ? 'var(--info)' : 'var(--text-muted)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: available > 0 ? 'pointer' : 'not-allowed',
            fontWeight: '600',
          }}
        >
          Rent Now
        </button>
      </div>
    </div>
  );
}

interface RentalFormProps {
  provider: `0x${string}`;
  onClose: () => void;
}

function RentalForm({ provider, onClose }: RentalFormProps) {
  const [durationHours, setDurationHours] = useState(1);
  const [sshKey, setSSHKey] = useState('');
  const [containerImage, setContainerImage] = useState('');
  const [startupScript, setStartupScript] = useState('');

  const { resources } = useProviderResources(provider);
  const { cost, costFormatted, isLoading: costLoading } = useRentalCost(provider, durationHours);
  const { createRental, isCreating, isSuccess } = useCreateRental();

  const minHours = resources?.pricing.minimumRentalHours || 1;
  const maxHours = resources?.pricing.maximumRentalHours || 720;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cost || !sshKey) return;

    createRental(provider, durationHours, sshKey, containerImage, startupScript, cost);
  };

  if (isSuccess) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
      >
        <div
          style={{
            background: 'var(--surface)',
            padding: '2rem',
            borderRadius: '12px',
            maxWidth: '400px',
            textAlign: 'center',
          }}
        >
          <h2 style={{ color: 'var(--success)' }}>✅ Rental Created!</h2>
          <p>Your compute rental has been created. Check "My Rentals" for SSH access details.</p>
          <button className="button" onClick={onClose} style={{ marginTop: '1rem' }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--surface)',
          padding: '2rem',
          borderRadius: '12px',
          maxWidth: '500px',
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <h2 style={{ margin: '0 0 1.5rem' }}>Rent Compute Resources</h2>

        <form onSubmit={handleSubmit}>
          {/* Duration */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Duration (hours)
            </label>
            <input
              type="number"
              className="input"
              min={minHours}
              max={maxHours}
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value))}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Min: {minHours}h, Max: {maxHours}h ({Math.floor(maxHours / 24)} days)
            </p>
          </div>

          {/* SSH Key */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              SSH Public Key *
            </label>
            <textarea
              className="input"
              rows={3}
              placeholder="ssh-ed25519 AAAA... your-key"
              value={sshKey}
              onChange={(e) => setSSHKey(e.target.value)}
              required
              style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Paste your public key (e.g., from ~/.ssh/id_ed25519.pub)
            </p>
          </div>

          {/* Container Image (optional) */}
          {resources?.dockerEnabled && (
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                Docker Image (optional)
              </label>
              <input
                type="text"
                className="input"
                placeholder="nvidia/cuda:12.0-runtime-ubuntu22.04"
                value={containerImage}
                onChange={(e) => setContainerImage(e.target.value)}
              />
            </div>
          )}

          {/* Startup Script (optional) */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Startup Script (optional)
            </label>
            <textarea
              className="input"
              rows={3}
              placeholder="#!/bin/bash\napt update\npip install torch"
              value={startupScript}
              onChange={(e) => setStartupScript(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
            />
          </div>

          {/* Cost Summary */}
          <div
            style={{
              padding: '1rem',
              background: 'var(--surface-active)',
              borderRadius: '8px',
              marginBottom: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span>Duration:</span>
              <span>{formatDuration(durationHours * 3600)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '700' }}>
              <span>Total Cost:</span>
              <span>{costLoading ? 'Calculating...' : `${costFormatted} ETH`}</span>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '0.75rem',
                background: 'var(--border)',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button"
              disabled={isCreating || !sshKey || !cost}
              style={{
                flex: 1,
                padding: '0.75rem',
                background: 'var(--info)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: isCreating ? 'wait' : 'pointer',
              }}
            >
              {isCreating ? 'Creating...' : 'Create Rental'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MyRentals() {
  const { rentalIds } = useUserRentals();
  const { cancelRental, isCancelling } = useCancelRental();

  if (rentalIds.length === 0) {
    return (
      <div
        style={{
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--surface-hover)',
          borderRadius: '12px',
        }}
      >
        <p style={{ color: 'var(--text-secondary)' }}>No active rentals. Browse providers to get started!</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {rentalIds.map((id) => (
        <RentalCard
          key={id}
          rentalId={id}
          onCancel={() => cancelRental(id)}
          isCancelling={isCancelling}
        />
      ))}
    </div>
  );
}

interface RentalCardProps {
  rentalId: `0x${string}`;
  onCancel: () => void;
  isCancelling: boolean;
}

function RentalCard({ rentalId, onCancel, isCancelling }: RentalCardProps) {
  const { rental, isLoading } = useRental(rentalId);

  if (isLoading || !rental) {
    return (
      <div className="card" style={{ padding: '1rem', opacity: 0.6 }}>
        Loading...
      </div>
    );
  }

  const isActive = rental.status === RentalStatus.ACTIVE;
  const isPending = rental.status === RentalStatus.PENDING;
  const remainingSeconds = isActive
    ? Math.max(0, Number(rental.endTime) - Math.floor(Date.now() / 1000))
    : 0;

  return (
    <div
      className="card"
      style={{
        padding: '1.5rem',
        border: isActive ? '2px solid var(--success)' : '1px solid var(--border)',
        borderRadius: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <span
            style={{
              padding: '0.25rem 0.5rem',
              background: isActive ? 'var(--success-soft)' : 'var(--surface-active)',
              color: isActive ? 'var(--success)' : 'var(--text-secondary)',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: '600',
            }}
          >
            {STATUS_LABELS[rental.status]}
          </span>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          ID: {rentalId.slice(0, 10)}...
        </div>
      </div>

      {/* SSH Access */}
      {isActive && rental.sshHost && (
        <div
          style={{
            padding: '1rem',
            background: 'var(--success-soft)',
            borderRadius: '8px',
            marginBottom: '1rem',
          }}
        >
          <p style={{ margin: '0 0 0.5rem', fontWeight: '600' }}>🔐 SSH Access</p>
          <code
            style={{
              display: 'block',
              padding: '0.5rem',
              background: 'var(--text-primary)',
              color: 'var(--success)',
              borderRadius: '4px',
              fontSize: '0.75rem',
              wordBreak: 'break-all',
            }}
          >
            ssh -p {rental.sshPort} user@{rental.sshHost}
          </code>
        </div>
      )}

      {/* Time Remaining */}
      {isActive && (
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Time Remaining:</p>
          <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700' }}>
            {formatDuration(remainingSeconds)}
          </p>
        </div>
      )}

      {/* Cost */}
      <div style={{ marginBottom: '1rem' }}>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Total Cost:</p>
        <p style={{ margin: 0, fontSize: '1rem', fontWeight: '600' }}>
          {formatEther(rental.totalCost)} ETH
        </p>
      </div>

      {/* Actions */}
      {isPending && (
        <button
          onClick={onCancel}
          disabled={isCancelling}
          style={{
            width: '100%',
            padding: '0.75rem',
            background: 'var(--error-soft)',
            color: 'var(--error)',
            border: 'none',
            borderRadius: '8px',
            cursor: isCancelling ? 'wait' : 'pointer',
          }}
        >
          {isCancelling ? 'Cancelling...' : 'Cancel Rental'}
        </button>
      )}
    </div>
  );
}

export default function ComputeMarketplace() {
  const { isConnected } = useAccount();
  const [selectedProvider, setSelectedProvider] = useState<`0x${string}` | null>(null);
  const [activeTab, setActiveTab] = useState<'browse' | 'my-rentals'>('browse');

  if (!isConnected) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Compute Marketplace</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Connect your wallet to browse and rent compute resources.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>Compute Marketplace</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Rent GPU compute with SSH access. Similar to vast.ai, but decentralized.
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '1.5rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '1rem',
        }}
      >
        <button
          onClick={() => setActiveTab('browse')}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === 'browse' ? 'var(--info)' : 'transparent',
            color: activeTab === 'browse' ? 'white' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600',
          }}
        >
          Browse Providers
        </button>
        <button
          onClick={() => setActiveTab('my-rentals')}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === 'my-rentals' ? 'var(--info)' : 'transparent',
            color: activeTab === 'my-rentals' ? 'white' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600',
          }}
        >
          My Rentals
        </button>
      </div>

      {/* Content */}
      {activeTab === 'browse' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {DEMO_PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider.address}
              provider={provider}
              onRent={setSelectedProvider}
            />
          ))}
        </div>
      )}

      {activeTab === 'my-rentals' && <MyRentals />}

      {/* Rental Form Modal */}
      {selectedProvider && (
        <RentalForm provider={selectedProvider} onClose={() => setSelectedProvider(null)} />
      )}
    </div>
  );
}

