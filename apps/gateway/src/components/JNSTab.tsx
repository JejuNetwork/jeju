import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatEther, type Address, zeroAddress } from 'viem';
import { Tag, Search, ExternalLink, Settings, RefreshCw, CheckCircle, AlertCircle, Link, Shield, AlertTriangle } from 'lucide-react';
import { useJNSLookup, useJNSRegister, useJNSResolver, useJNSReverse, type JNSRegistration, type JNSPriceQuote, type JNSAppInfo } from '../hooks/useJNS';
import { MODERATION_CONTRACTS } from '../config/moderation';
import { NETWORK } from '../config';
import { ZERO_BYTES32 } from '../lib/contracts';

function NameSearchCard() {
  const { address } = useAccount();
  const { checkAvailability, getPrice, getRegistration } = useJNSLookup();
  const { register, loading: registering } = useJNSRegister();
  const { getAppInfo } = useJNSResolver();
  
  const [searchName, setSearchName] = useState('');
  const [duration, setDuration] = useState(1);
  const [searchResult, setSearchResult] = useState<{
    available: boolean;
    registration?: JNSRegistration;
    price?: JNSPriceQuote;
    appInfo?: JNSAppInfo | null;
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
    let appInfo: JNSAppInfo | null = null;
    if (!available) {
      [registration, appInfo] = await Promise.all([
        getRegistration(normalizedName),
        getAppInfo(normalizedName),
      ]);
    }

    setSearchResult({ available, registration, price, appInfo });
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

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', display: 'flex', gap: '0.5rem', minWidth: 0 }}>
          <input
            className="input"
            type="text"
            placeholder="Enter name (e.g., myapp)"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value.toLowerCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{ flex: 1, minWidth: 0 }}
          />
          <span style={{ display: 'flex', alignItems: 'center', padding: '0 0.75rem', background: 'var(--surface-active)', borderRadius: 'var(--radius-md)', fontWeight: 600, flexShrink: 0 }}>.jeju</span>
        </div>
        <button className="button" onClick={handleSearch} disabled={searching || !searchName} style={{ flexShrink: 0 }}>
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
                  className="input"
                  value={duration}
                  onChange={(e) => {
                    setDuration(Number(e.target.value));
                    handleSearch();
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
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Expires:</span>
                <span>
                  {new Date(searchResult.registration.expiresAt * 1000).toLocaleDateString()}
                  {searchResult.registration.inGracePeriod && (
                    <span style={{ color: 'var(--warning)', marginLeft: '0.5rem' }}>(Grace Period)</span>
                  )}
                </span>
              </div>
              {searchResult.appInfo && Boolean(searchResult.appInfo.agentId > 0n) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Linked Agent:</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Link size={12} />
                    Agent #{searchResult.appInfo.agentId.toString()}
                  </span>
                </div>
              )}
              {searchResult.appInfo?.a2aEndpoint && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>A2A:</span>
                  <a href={searchResult.appInfo.a2aEndpoint} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', fontSize: '0.75rem' }}>
                    {searchResult.appInfo.a2aEndpoint.slice(0, 30)}...
                  </a>
                </div>
              )}
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
  const { setPrimaryName, getPrimaryName } = useJNSReverse();
  const { getOwnerNames } = useJNSLookup();
  const [myNames, setMyNames] = useState<JNSRegistration[]>([]);
  const [primaryName, setPrimaryNameState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    
    setLoading(true);
    Promise.all([
      getOwnerNames(address),
      getPrimaryName(address),
    ]).then(([names, primary]) => {
      setMyNames(names);
      setPrimaryNameState(primary);
    }).finally(() => setLoading(false));
  }, [address, getOwnerNames, getPrimaryName]);

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

      {loading ? (
        <p style={{ color: 'var(--text-secondary)' }}>Loading your names...</p>
      ) : myNames.length === 0 ? (
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
  const { resolve, getText, setAddr, setText, getAppInfo, setAppConfig } = useJNSResolver();
  
  const [selectedName, setSelectedName] = useState('');
  const [resolverData, setResolverData] = useState<{
    addr: Address | null;
    url: string;
    description: string;
    endpoint: string;
    a2aEndpoint: string;
    agentId: bigint;
    appContract: Address;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch ban status for linked agent
  const { data: banStatus } = useReadContract({
    address: MODERATION_CONTRACTS.BanManager as Address,
    abi: [{ name: 'getBanStatus', type: 'function', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: 'banType', type: 'uint8' }, { name: 'timestamp', type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'getBanStatus',
    args: resolverData?.agentId && resolverData.agentId > 0n ? [resolverData.agentId] : undefined,
    query: { enabled: !!resolverData?.agentId && resolverData.agentId > 0n && MODERATION_CONTRACTS.BanManager !== zeroAddress }
  });

  const loadResolverData = useCallback(async () => {
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
      agentId: appInfo?.agentId || 0n,
      appContract: appInfo?.appContract || zeroAddress,
    });
    
    setLoading(false);
  }, [selectedName, resolve, getText, getAppInfo]);

  useEffect(() => {
    if (selectedName) {
      loadResolverData();
    }
  }, [selectedName, loadResolverData]);

  const handleSave = async () => {
    if (!resolverData) return;
    setSaving(true);
    
    // Save text records
    if (resolverData.addr) await setAddr(selectedName, resolverData.addr);
    if (resolverData.url) await setText(selectedName, 'url', resolverData.url);
    if (resolverData.description) await setText(selectedName, 'description', resolverData.description);
    
    // Save app config if any app fields are set
    if (resolverData.endpoint || resolverData.a2aEndpoint || resolverData.agentId > 0n) {
      await setAppConfig(
        selectedName,
        resolverData.appContract,
        ZERO_BYTES32,
        resolverData.agentId,
        resolverData.endpoint,
        resolverData.a2aEndpoint
      );
    }
    
    setSaving(false);
    setEditMode(false);
  };

  if (!address) return null;

  const banType = banStatus ? Number((banStatus as [number, bigint])[0]) : 0;

  return (
    <div className="card">
      <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Settings size={20} />
        Name Manager
      </h3>

      <div style={{ marginBottom: '1rem' }}>
        <input
          className="input"
          type="text"
          placeholder="Enter name to manage (e.g., myapp)"
          value={selectedName}
          onChange={(e) => setSelectedName(e.target.value.toLowerCase())}
        />
      </div>

      {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading resolver data...</p>}

      {resolverData && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Address</label>
            {editMode ? (
              <input className="input" type="text" value={resolverData.addr || ''} onChange={(e) => setResolverData({ ...resolverData, addr: e.target.value as Address })} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }} />
            ) : (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', wordBreak: 'break-all' }}>{resolverData.addr || 'Not set'}</p>
            )}
          </div>
          
          {/* ERC-8004 Agent Link */}
          <div>
            <label style={{ marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Link size={12} /> Linked ERC-8004 Agent
            </label>
            {editMode ? (
              <input
                className="input"
                type="number"
                min="0"
                placeholder="Enter agent ID (0 for none)"
                value={resolverData.agentId.toString()}
                onChange={(e) => setResolverData({ ...resolverData, agentId: BigInt(e.target.value || '0') })}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {resolverData.agentId > 0n ? (
                  <>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>Agent #{resolverData.agentId.toString()}</span>
                    {banType === 0 ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--success)', fontSize: '0.75rem' }}>
                        <Shield size={12} /> Good Standing
                      </span>
                    ) : banType === 3 ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--error)', fontSize: '0.75rem' }}>
                        <AlertTriangle size={12} /> Banned
                      </span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--warning)', fontSize: '0.75rem' }}>
                        <AlertCircle size={12} /> Under Review
                      </span>
                    )}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-secondary)' }}>Not linked</span>
                )}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>URL</label>
            {editMode ? (
              <input className="input" type="text" value={resolverData.url} onChange={(e) => setResolverData({ ...resolverData, url: e.target.value })} />
            ) : (
              <p style={{ wordBreak: 'break-all' }}>{resolverData.url || 'Not set'}</p>
            )}
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Description</label>
            {editMode ? (
              <textarea className="input" value={resolverData.description} onChange={(e) => setResolverData({ ...resolverData, description: e.target.value })} style={{ minHeight: '80px', resize: 'vertical' }} />
            ) : (
              <p>{resolverData.description || 'Not set'}</p>
            )}
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>App Endpoint</label>
            {editMode ? (
              <input className="input" type="text" value={resolverData.endpoint} onChange={(e) => setResolverData({ ...resolverData, endpoint: e.target.value })} placeholder="https://api.myapp.com" />
            ) : (
              <p style={{ wordBreak: 'break-all' }}>{resolverData.endpoint || 'Not set'}</p>
            )}
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>A2A Endpoint</label>
            {editMode ? (
              <input className="input" type="text" value={resolverData.a2aEndpoint} onChange={(e) => setResolverData({ ...resolverData, a2aEndpoint: e.target.value })} placeholder="https://api.myapp.com/a2a" />
            ) : (
              <p style={{ wordBreak: 'break-all' }}>{resolverData.a2aEndpoint || 'Not set'}</p>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            {editMode ? (
              <>
                <button
                  className="button"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
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
  // Pre-registered Jeju app names - URLs resolve via .jeju TLD in production
  const apps = [
    { name: 'gateway', description: 'Protocol Infrastructure Hub' },
    { name: 'bazaar', description: 'DeFi + NFT Marketplace' },
    { name: 'compute', description: 'Decentralized Compute' },
    { name: 'storage', description: 'Decentralized Storage' },
    { name: 'indexer', description: 'Blockchain Indexer' },
    { name: 'cloud', description: 'Cloud Platform' },
    { name: 'docs', description: 'Documentation' },
  ];
  
  const getAppUrl = (name: string) => {
    if (NETWORK === 'localnet') return `http://localhost:4001/${name}`;
    if (NETWORK === 'testnet') return `https://testnet-${name}.jeju.network`;
    return `https://${name}.jeju.network`;
  };

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
            href={getAppUrl(app.name)}
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

export default function JNSTab() {
  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: 'clamp(1.25rem, 4vw, 1.5rem)', marginBottom: '0.5rem' }}>🏷️ Jeju Name Service</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>
          Register decentralized names for your apps and services.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <NameSearchCard />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1rem' }}>
          <MyNamesCard />
          <NameManagerCard />
        </div>
        <RegisteredAppsCard />
      </div>
    </div>
  );
}

