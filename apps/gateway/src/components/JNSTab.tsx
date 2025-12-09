/**
 * JNS Tab Component
 * 
 * Portal for Jeju Name Service:
 * - Search and register names
 * - Manage owned names
 * - Set resolver records
 * - Primary name selection
 */

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { formatEther, type Address } from 'viem';
import { Tag, Search, ExternalLink, Settings, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { useJNSLookup, useJNSRegister, useJNSResolver, useJNSReverse, type JNSRegistration, type JNSPriceQuote } from '../hooks/useJNS';

// ============ Sub-components ============

function NameSearchCard() {
  const { address } = useAccount();
  const { checkAvailability, getPrice, getRegistration } = useJNSLookup();
  const { register, loading: registering } = useJNSRegister();
  
  const [searchName, setSearchName] = useState('');
  const [duration, setDuration] = useState(1);
  const [searchResult, setSearchResult] = useState<{
    available: boolean;
    registration?: JNSRegistration;
    price?: JNSPriceQuote;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchName || searchName.length < 3) {
      setError('Name must be at least 3 characters');
      return;
    }

    setSearching(true);
    setError(null);
    setSearchResult(null);

    const normalizedName = searchName.toLowerCase().replace(/[^a-z0-9-]/g, '');
    
    const available = await checkAvailability(normalizedName);
    const price = await getPrice(normalizedName, duration);
    
    let registration: JNSRegistration | undefined;
    if (!available) {
      registration = await getRegistration(normalizedName);
    }

    setSearchResult({ available, registration, price });
    setSearching(false);
  };

  const handleRegister = async () => {
    if (!searchResult?.available || !address) return;

    setError(null);
    setTxHash(null);

    const normalizedName = searchName.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const hash = await register(normalizedName, duration);
    setTxHash(hash);
      
    // Refresh search results
    setTimeout(() => handleSearch(), 3000);
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Search size={20} />
        Search & Register Names
      </h3>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Enter name (e.g., myapp)"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value.toLowerCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          style={{
            flex: 1,
            padding: '0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '1rem',
          }}
        />
        <span style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 0.75rem',
          background: 'var(--surface-active)',
          borderRadius: '8px',
          fontWeight: '500',
        }}>
          .jeju
        </span>
        <button
          className="button"
          onClick={handleSearch}
          disabled={searching || !searchName}
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && (
        <div style={{
          padding: '0.75rem',
          background: 'var(--error-soft)',
          border: '1px solid var(--error)',
          borderRadius: '8px',
          color: 'var(--error)',
          marginBottom: '1rem',
        }}>
          {error}
        </div>
      )}

      {searchResult && (
        <div style={{
          padding: '1rem',
          background: searchResult.available ? 'var(--success-soft)' : 'var(--warning-soft)',
          border: `1px solid ${searchResult.available ? 'var(--success)' : 'var(--warning)'}`,
          borderRadius: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {searchResult.available ? (
              <>
                <CheckCircle size={20} style={{ color: 'var(--success)' }} />
                <span style={{ fontWeight: '600', color: 'var(--success)' }}>
                  {searchName}.jeju is available
                </span>
              </>
            ) : (
              <>
                <AlertCircle size={20} style={{ color: 'var(--warning)' }} />
                <span style={{ fontWeight: '600', color: 'var(--warning)' }}>
                  {searchName}.jeju is taken
                </span>
              </>
            )}
          </div>

          {searchResult.available && searchResult.price && (
            <div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Registration Duration
                </label>
                <select
                  value={duration}
                  onChange={(e) => {
                    setDuration(Number(e.target.value));
                    handleSearch();
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                  }}
                >
                  <option value={1}>1 Year</option>
                  <option value={2}>2 Years</option>
                  <option value={3}>3 Years</option>
                  <option value={5}>5 Years</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Price:</span>
                <span style={{ fontWeight: '600' }}>
                  {formatEther(searchResult.price.priceWithDiscount || searchResult.price.price)} ETH
                  {searchResult.price.hasDiscount && (
                    <span style={{ color: 'var(--success)', fontSize: '0.875rem', marginLeft: '0.5rem' }}>
                      (5% agent discount)
                    </span>
                  )}
                </span>
              </div>

              <button
                className="button"
                onClick={handleRegister}
                disabled={registering || !address}
                style={{ width: '100%' }}
              >
                {registering ? 'Registering...' : `Register ${searchName}.jeju`}
              </button>
            </div>
          )}

          {!searchResult.available && searchResult.registration && (
            <div style={{ fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Owner:</span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {searchResult.registration.owner.slice(0, 6)}...{searchResult.registration.owner.slice(-4)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Expires:</span>
                <span>
                  {new Date(searchResult.registration.expiresAt * 1000).toLocaleDateString()}
                  {searchResult.registration.inGracePeriod && (
                    <span style={{ color: 'var(--warning)', marginLeft: '0.5rem' }}>(Grace Period)</span>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {txHash && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem',
          background: 'var(--info-soft)',
          border: '1px solid var(--info)',
          borderRadius: '8px',
        }}>
          <span style={{ color: 'var(--info)' }}>Transaction submitted: </span>
          <a
            href={`#/tx/${txHash}`}
            style={{ color: 'var(--info)', fontFamily: 'monospace', fontSize: '0.75rem' }}
          >
            {txHash.slice(0, 10)}...{txHash.slice(-8)}
          </a>
        </div>
      )}
    </div>
  );
}

function MyNamesCard() {
  const { address } = useAccount();
  const { renew, loading: renewing } = useJNSRegister();
  const { setPrimaryName } = useJNSReverse();
  
  // Mock data - in production, fetch from indexer or events
  const [myNames] = useState<JNSRegistration[]>([]);
  const [primaryName] = useState<string | null>(null);

  if (!address) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Tag size={20} />
          My Names
        </h3>
        <p style={{ color: 'var(--text-secondary)' }}>Connect wallet to view your names</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Tag size={20} />
        My Names
      </h3>

      {myNames.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>You don't own any names yet. Register one above.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {myNames.map((name) => (
            <div
              key={name.name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem',
                background: 'var(--surface-hover)',
                borderRadius: '8px',
              }}
            >
              <div>
                <div style={{ fontWeight: '600' }}>{name.name}.jeju</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Expires: {new Date(name.expiresAt * 1000).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="button-secondary"
                  onClick={() => renew(name.name, 1)}
                  disabled={renewing}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                >
                  <RefreshCw size={14} /> Renew
                </button>
                <button
                  className="button-secondary"
                  onClick={() => setPrimaryName(name.name)}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                >
                  Set Primary
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {primaryName && (
        <div style={{
          marginTop: '1rem',
          padding: '0.5rem 0.75rem',
          background: 'var(--info-soft)',
          borderRadius: '8px',
          fontSize: '0.875rem',
        }}>
          Primary name: <strong>{primaryName}</strong>
        </div>
      )}
    </div>
  );
}

function NameManagerCard() {
  const { address } = useAccount();
  const { resolve, getText, setAddr, setText, getAppInfo } = useJNSResolver();
  
  const [selectedName, setSelectedName] = useState('');
  const [resolverData, setResolverData] = useState<{
    addr: Address | null;
    url: string;
    description: string;
    endpoint: string;
    a2aEndpoint: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const loadResolverData = async () => {
    if (!selectedName) return;
    
    setLoading(true);
    
    const [addr, url, description, appInfo] = await Promise.all([
      resolve(selectedName),
      getText(selectedName, 'url'),
      getText(selectedName, 'description'),
      getAppInfo(selectedName),
    ]);

    setResolverData({
      addr,
      url,
      description,
      endpoint: appInfo?.endpoint || '',
      a2aEndpoint: appInfo?.a2aEndpoint || '',
    });
    
    setLoading(false);
  };

  useEffect(() => {
    if (selectedName) {
      loadResolverData();
    }
  }, [selectedName]);

  if (!address) return null;

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Settings size={20} />
        Name Manager
      </h3>

      <div style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Enter name to manage (e.g., myapp)"
          value={selectedName}
          onChange={(e) => setSelectedName(e.target.value.toLowerCase())}
          style={{
            width: '100%',
            padding: '0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '8px',
          }}
        />
      </div>

      {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading resolver data...</p>}

      {resolverData && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Address
            </label>
            {editMode ? (
              <input
                type="text"
                value={resolverData.addr || ''}
                onChange={(e) => setResolverData({ ...resolverData, addr: e.target.value as Address })}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                }}
              />
            ) : (
              <p style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                {resolverData.addr || 'Not set'}
              </p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              URL
            </label>
            {editMode ? (
              <input
                type="text"
                value={resolverData.url}
                onChange={(e) => setResolverData({ ...resolverData, url: e.target.value })}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}
              />
            ) : (
              <p>{resolverData.url || 'Not set'}</p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Description
            </label>
            {editMode ? (
              <textarea
                value={resolverData.description}
                onChange={(e) => setResolverData({ ...resolverData, description: e.target.value })}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  minHeight: '80px',
                }}
              />
            ) : (
              <p>{resolverData.description || 'Not set'}</p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              App Endpoint
            </label>
            {editMode ? (
              <input
                type="text"
                value={resolverData.endpoint}
                onChange={(e) => setResolverData({ ...resolverData, endpoint: e.target.value })}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}
              />
            ) : (
              <p>{resolverData.endpoint || 'Not set'}</p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              A2A Endpoint
            </label>
            {editMode ? (
              <input
                type="text"
                value={resolverData.a2aEndpoint}
                onChange={(e) => setResolverData({ ...resolverData, a2aEndpoint: e.target.value })}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}
              />
            ) : (
              <p>{resolverData.a2aEndpoint || 'Not set'}</p>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            {editMode ? (
              <>
                <button
                  className="button"
                  onClick={async () => {
                    if (resolverData.addr) await setAddr(selectedName, resolverData.addr);
                    if (resolverData.url) await setText(selectedName, 'url', resolverData.url);
                    if (resolverData.description) await setText(selectedName, 'description', resolverData.description);
                    setEditMode(false);
                  }}
                >
                  Save Changes
                </button>
                <button
                  className="button-secondary"
                  onClick={() => {
                    setEditMode(false);
                    loadResolverData();
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="button"
                onClick={() => setEditMode(true)}
              >
                Edit Records
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RegisteredAppsCard() {
  // Pre-registered Jeju app names
  const apps = [
    { name: 'gateway', description: 'Protocol Infrastructure Hub', url: 'http://localhost:4001' },
    { name: 'bazaar', description: 'DeFi + NFT Marketplace', url: 'http://localhost:4006' },
    { name: 'compute', description: 'Decentralized Compute', url: 'http://localhost:4004' },
    { name: 'storage', description: 'Decentralized Storage', url: 'http://localhost:4005' },
    { name: 'indexer', description: 'Blockchain Indexer', url: 'http://localhost:4350' },
    { name: 'cloud', description: 'Cloud Platform', url: 'http://localhost:3000' },
    { name: 'docs', description: 'Documentation', url: 'http://localhost:4007' },
  ];

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <ExternalLink size={20} />
        Registered Apps
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
        {apps.map((app) => (
          <a
            key={app.name}
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block',
              padding: '0.75rem',
              background: 'var(--surface-hover)',
              borderRadius: '8px',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'background 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--surface-active)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
          >
            <div style={{ fontWeight: '600', color: 'var(--accent-primary)' }}>{app.name}.jeju</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{app.description}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ============ Main Component ============

export default function JNSTab() {
  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🏷️ Jeju Name Service</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Register decentralized names for your apps and services. Names point to hosted apps,
          ERC-8004 agents, and resolver records.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <NameSearchCard />
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          <MyNamesCard />
          <NameManagerCard />
        </div>

        <RegisteredAppsCard />
      </div>
    </div>
  );
}

