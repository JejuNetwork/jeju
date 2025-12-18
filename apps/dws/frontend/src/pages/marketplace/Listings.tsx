import { useState } from 'react';
import { useAccount } from 'wagmi';
import { LayoutList, Plus, RefreshCw, Activity, DollarSign, Star, Pause, Play, Trash2, Settings } from 'lucide-react';
import { useAPIProviders, useAPIListings, useCreateListing } from '../../hooks';
import type { ViewMode } from '../../types';

interface ListingsPageProps {
  viewMode: ViewMode;
}

export default function ListingsPage({ viewMode }: ListingsPageProps) {
  const { isConnected, address } = useAccount();
  const { data: providersData } = useAPIProviders();
  const { data: listingsData, isLoading, refetch } = useAPIListings();
  const createListing = useCreateListing();
  
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    providerId: '',
    apiKey: '',
    pricePerRequest: '',
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createListing.mutateAsync({
      providerId: formData.providerId,
      apiKey: formData.apiKey,
      pricePerRequest: formData.pricePerRequest || undefined,
    });
    setShowModal(false);
    setFormData({ providerId: '', apiKey: '', pricePerRequest: '' });
  };

  const providers = providersData?.providers ?? [];
  const listings = listingsData?.listings ?? [];
  const myListings = listings.filter(l => l.seller.toLowerCase() === address?.toLowerCase());
  
  const totalRevenue = myListings.reduce((sum, l) => sum + parseFloat(l.totalRevenue), 0);
  const totalRequests = myListings.reduce((sum, l) => sum + parseInt(l.totalRequests), 0);
  const activeListings = myListings.filter(l => l.active).length;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">
            {viewMode === 'provider' ? 'My API Listings' : 'My Subscriptions'}
          </h1>
          <p className="page-subtitle">
            {viewMode === 'provider' 
              ? 'Manage your API listings and earnings'
              : 'View your subscribed API services'
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => refetch()}>
            <RefreshCw size={16} /> Refresh
          </button>
          {viewMode === 'provider' && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)} disabled={!isConnected}>
              <Plus size={16} /> New Listing
            </button>
          )}
        </div>
      </div>

      {viewMode === 'provider' && (
        <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
          <div className="stat-card">
            <div className="stat-icon compute"><LayoutList size={24} /></div>
            <div className="stat-content">
              <div className="stat-label">Active Listings</div>
              <div className="stat-value">{activeListings}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon storage"><DollarSign size={24} /></div>
            <div className="stat-content">
              <div className="stat-label">Total Revenue</div>
              <div className="stat-value">{(totalRevenue / 1e18).toFixed(4)} ETH</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon network"><Activity size={24} /></div>
            <div className="stat-content">
              <div className="stat-label">Total Requests</div>
              <div className="stat-value">{totalRequests.toLocaleString()}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon ai"><Star size={24} /></div>
            <div className="stat-content">
              <div className="stat-label">Avg Rating</div>
              <div className="stat-value">
                {myListings.length > 0 
                  ? (myListings.reduce((sum, l) => sum + l.rating, 0) / myListings.length).toFixed(1)
                  : '—'
                }
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <LayoutList size={18} /> 
            {viewMode === 'provider' ? 'Your Listings' : 'Subscriptions'}
          </h3>
        </div>
        
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" />
          </div>
        ) : myListings.length === 0 ? (
          <div className="empty-state">
            <LayoutList size={48} />
            <h3>
              {viewMode === 'provider' ? 'No listings yet' : 'No subscriptions'}
            </h3>
            <p>
              {viewMode === 'provider' 
                ? 'Create your first API listing to start earning'
                : 'Browse the marketplace to find APIs'
              }
            </p>
            {viewMode === 'provider' && (
              <button className="btn btn-primary" onClick={() => setShowModal(true)} disabled={!isConnected}>
                <Plus size={16} /> New Listing
              </button>
            )}
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Price</th>
                  <th>Requests</th>
                  <th>Revenue</th>
                  <th>Rating</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {myListings.map((listing) => {
                  const provider = providers.find(p => p.id === listing.providerId);
                  return (
                    <tr key={listing.id}>
                      <td style={{ fontWeight: 500 }}>{provider?.name ?? listing.providerId}</td>
                      <td>
                        <span className={`badge ${listing.active ? 'badge-success' : 'badge-neutral'}`}>
                          {listing.active ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                        {listing.pricePerRequest} wei
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {parseInt(listing.totalRequests).toLocaleString()}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {(parseFloat(listing.totalRevenue) / 1e18).toFixed(6)} ETH
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Star size={14} style={{ color: 'var(--warning)', fill: 'var(--warning)' }} />
                          <span>{listing.rating.toFixed(1)}</span>
                        </div>
                      </td>
                      <td style={{ display: 'flex', gap: '0.25rem' }}>
                        <button 
                          className="btn btn-ghost btn-sm" 
                          title={listing.active ? 'Pause' : 'Resume'}
                        >
                          {listing.active ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <button className="btn btn-ghost btn-sm" title="Settings">
                          <Settings size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">New API Listing</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">API Provider *</label>
                  <select
                    className="input"
                    value={formData.providerId}
                    onChange={e => setFormData({ ...formData, providerId: e.target.value })}
                    required
                  >
                    <option value="">Select a provider</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Your API Key *</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Enter your provider API key"
                    value={formData.apiKey}
                    onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                    required
                  />
                  <div className="form-hint">Your key is encrypted and stored securely in TEE</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Price per Request (wei)</label>
                  <input
                    className="input"
                    type="number"
                    placeholder="Leave empty for default pricing"
                    value={formData.pricePerRequest}
                    onChange={e => setFormData({ ...formData, pricePerRequest: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={createListing.isPending}>
                  {createListing.isPending ? 'Creating...' : <><Plus size={16} /> Create Listing</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


