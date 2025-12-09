'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { 
  useJNSListings, 
  useJNSList, 
  useJNSBuy, 
  useOwnedJNSNames,
  formatNamePrice,
  getTimeRemaining,
  type JNSNameListing,
} from '@/hooks/names/useJNS';

function NameCard({ listing, onBuy }: { listing: JNSNameListing; onBuy: (listing: JNSNameListing) => void }) {
  const { address } = useAccount();
  const isOwner = address?.toLowerCase() === listing.seller.toLowerCase();

  return (
    <div className="card p-4 md:p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-gradient truncate">{listing.name}.jeju</h3>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {getTimeRemaining(listing.nameExpiresAt)}
          </p>
        </div>
        <span className={`ml-2 shrink-0 ${listing.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
          {listing.status}
        </span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {formatNamePrice(listing.price)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {listing.seller.slice(0, 6)}...{listing.seller.slice(-4)}
          </p>
        </div>
      </div>

      {!isOwner && listing.status === 'active' && (
        <button onClick={() => onBuy(listing)} className="btn-accent w-full">
          Buy
        </button>
      )}

      {isOwner && (
        <button className="btn-secondary w-full" disabled>
          Your Listing
        </button>
      )}
    </div>
  );
}

function ListNameModal({ 
  isOpen, 
  onClose, 
  onList 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onList: (name: string, price: string, duration: number) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState(30);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setLoading(true);
    await onList(name, price, duration);
    setLoading(false);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0, 0, 0, 0.7)' }}
      onClick={onClose}
    >
      <div 
        className="w-full max-w-md p-5 md:p-6 rounded-2xl border"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          List Name
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="myname"
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Price (ETH)</label>
            <input
              type="text"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.1"
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Duration</label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="input">
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={loading || !name || !price}
              className="btn-accent flex-1 disabled:opacity-50"
            >
              {loading ? 'Listing...' : 'List'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BuyModal({ 
  listing, 
  onClose, 
  onBuy 
}: { 
  listing: JNSNameListing | null; 
  onClose: () => void; 
  onBuy: (listing: JNSNameListing) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  if (!listing) return null;

  const handleBuy = async () => {
    setLoading(true);
    await onBuy(listing);
    setLoading(false);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0, 0, 0, 0.7)' }}
      onClick={onClose}
    >
      <div 
        className="w-full max-w-md p-5 md:p-6 rounded-2xl border"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          Buy {listing.name}.jeju
        </h2>

        <div className="mb-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>Price</span>
            <span className="font-semibold">{formatNamePrice(listing.price)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-secondary)' }}>Expires</span>
            <span>{getTimeRemaining(listing.nameExpiresAt)}</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleBuy} disabled={loading} className="btn-accent flex-1 disabled:opacity-50">
            {loading ? 'Buying...' : 'Buy'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NamesPage() {
  const { isConnected } = useAccount();
  const { listings, loading: listingsLoading, refetch } = useJNSListings();
  const { listName } = useJNSList();
  const { buyName } = useJNSBuy();
  const { names: ownedNames } = useOwnedJNSNames();

  const [showListModal, setShowListModal] = useState(false);
  const [selectedListing, setSelectedListing] = useState<JNSNameListing | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleList = async (name: string, price: string, duration: number) => {
    await listName(name, price, duration);
    refetch();
  };

  const handleBuy = async (listing: JNSNameListing) => {
    await buyName(listing.listingId, listing.price);
    refetch();
    setSelectedListing(null);
  };

  const filteredListings = listings.filter(l => 
    l.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
    l.status === 'active'
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <h1 className="text-3xl md:text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
          🏷️ Names
        </h1>
        {isConnected && (
          <button onClick={() => setShowListModal(true)} className="btn-accent whitespace-nowrap">
            + List
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input flex-1"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <div className="stat-card text-center">
          <p className="stat-value text-xl">{listings.length}</p>
          <p className="stat-label">Listed</p>
        </div>
        <div className="stat-card text-center">
          <p className="stat-value text-xl">{ownedNames.length}</p>
          <p className="stat-label">Owned</p>
        </div>
        <div className="stat-card text-center">
          <p className="stat-value text-xl">
            {listings.length > 0 
              ? formatEther(listings.reduce((min, l) => l.price < min ? l.price : min, listings[0].price))
              : '0'}
          </p>
          <p className="stat-label">Floor</p>
        </div>
        <div className="stat-card text-center">
          <p className="stat-value text-xl">2.5%</p>
          <p className="stat-label">Fee</p>
        </div>
      </div>

      {listingsLoading ? (
        <div className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>Loading...</div>
      ) : filteredListings.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🏷️</div>
          <p style={{ color: 'var(--text-secondary)' }}>No names listed</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredListings.map((listing) => (
            <NameCard key={listing.listingId.toString()} listing={listing} onBuy={setSelectedListing} />
          ))}
        </div>
      )}

      <ListNameModal isOpen={showListModal} onClose={() => setShowListModal(false)} onList={handleList} />
      <BuyModal listing={selectedListing} onClose={() => setSelectedListing(null)} onBuy={handleBuy} />
    </div>
  );
}
