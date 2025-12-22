'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { formatEther, parseEther } from 'viem';

// ============ Types ============

type PaymentCategory =
  | 'MARKETING'
  | 'COMMUNITY_MANAGEMENT'
  | 'OPERATIONS'
  | 'DOCUMENTATION'
  | 'DESIGN'
  | 'SUPPORT'
  | 'RESEARCH'
  | 'PARTNERSHIP'
  | 'EVENTS'
  | 'INFRASTRUCTURE'
  | 'OTHER';

type PaymentRequestStatus =
  | 'SUBMITTED'
  | 'COUNCIL_REVIEW'
  | 'CEO_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID'
  | 'DISPUTED'
  | 'CANCELLED';

interface PaymentRequest {
  requestId: string;
  daoId: string;
  daoName: string;
  requester: string;
  category: PaymentCategory;
  title: string;
  description: string;
  evidenceUri: string;
  requestedAmount: bigint;
  approvedAmount: bigint;
  status: PaymentRequestStatus;
  isRetroactive: boolean;
  workStartDate: number;
  workEndDate: number;
  submittedAt: number;
  councilVotes: { approve: number; reject: number; abstain: number };
}

// ============ Mock Data ============

const MOCK_REQUESTS: PaymentRequest[] = [
  {
    requestId: '0xreq1',
    daoId: '0xjeju',
    daoName: 'Jeju Network',
    requester: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    category: 'MARKETING',
    title: 'Q4 2025 Marketing Campaign',
    description: 'Social media management, content creation, and community growth initiatives for Q4.',
    evidenceUri: 'ipfs://QmEvidence1',
    requestedAmount: parseEther('25'),
    approvedAmount: 0n,
    status: 'COUNCIL_REVIEW',
    isRetroactive: false,
    workStartDate: Date.now(),
    workEndDate: Date.now() + 90 * 24 * 60 * 60 * 1000,
    submittedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    councilVotes: { approve: 2, reject: 0, abstain: 1 },
  },
  {
    requestId: '0xreq2',
    daoId: '0xjeju',
    daoName: 'Jeju Network',
    requester: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    category: 'COMMUNITY_MANAGEMENT',
    title: 'Discord Moderation - November',
    description: 'Daily moderation, user support, and community event organization.',
    evidenceUri: 'ipfs://QmEvidence2',
    requestedAmount: parseEther('8'),
    approvedAmount: parseEther('8'),
    status: 'APPROVED',
    isRetroactive: true,
    workStartDate: Date.now() - 30 * 24 * 60 * 60 * 1000,
    workEndDate: Date.now(),
    submittedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    councilVotes: { approve: 4, reject: 0, abstain: 0 },
  },
  {
    requestId: '0xreq3',
    daoId: '0xeliza',
    daoName: 'ElizaOS',
    requester: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    category: 'DOCUMENTATION',
    title: 'API Documentation Overhaul',
    description: 'Complete rewrite of developer documentation with examples and tutorials.',
    evidenceUri: 'ipfs://QmEvidence3',
    requestedAmount: parseEther('15'),
    approvedAmount: 0n,
    status: 'CEO_REVIEW',
    isRetroactive: false,
    workStartDate: Date.now() - 14 * 24 * 60 * 60 * 1000,
    workEndDate: Date.now() + 14 * 24 * 60 * 60 * 1000,
    submittedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    councilVotes: { approve: 2, reject: 1, abstain: 2 },
  },
  {
    requestId: '0xreq4',
    daoId: '0xjeju',
    daoName: 'Jeju Network',
    requester: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    category: 'OPERATIONS',
    title: 'Infrastructure Cost Reimbursement',
    description: 'Server hosting and monitoring costs for the past quarter.',
    evidenceUri: 'ipfs://QmEvidence4',
    requestedAmount: parseEther('12'),
    approvedAmount: parseEther('12'),
    status: 'PAID',
    isRetroactive: true,
    workStartDate: Date.now() - 90 * 24 * 60 * 60 * 1000,
    workEndDate: Date.now() - 1 * 24 * 60 * 60 * 1000,
    submittedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    councilVotes: { approve: 5, reject: 0, abstain: 0 },
  },
];

// ============ Components ============

const CATEGORY_DISPLAY: Record<PaymentCategory, { label: string; icon: string; color: string }> = {
  MARKETING: { label: 'Marketing', icon: '📣', color: 'text-pink-400' },
  COMMUNITY_MANAGEMENT: { label: 'Community', icon: '👥', color: 'text-blue-400' },
  OPERATIONS: { label: 'Operations', icon: '⚙️', color: 'text-slate-400' },
  DOCUMENTATION: { label: 'Documentation', icon: '📚', color: 'text-amber-400' },
  DESIGN: { label: 'Design', icon: '🎨', color: 'text-purple-400' },
  SUPPORT: { label: 'Support', icon: '🎧', color: 'text-teal-400' },
  RESEARCH: { label: 'Research', icon: '🔬', color: 'text-cyan-400' },
  PARTNERSHIP: { label: 'Partnership', icon: '🤝', color: 'text-orange-400' },
  EVENTS: { label: 'Events', icon: '🎉', color: 'text-rose-400' },
  INFRASTRUCTURE: { label: 'Infrastructure', icon: '🏗️', color: 'text-emerald-400' },
  OTHER: { label: 'Other', icon: '📦', color: 'text-slate-400' },
};

const STATUS_STYLES: Record<PaymentRequestStatus, { bg: string; text: string; label: string }> = {
  SUBMITTED: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Submitted' },
  COUNCIL_REVIEW: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Council Review' },
  CEO_REVIEW: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'CEO Review' },
  APPROVED: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Approved' },
  REJECTED: { bg: 'bg-rose-500/20', text: 'text-rose-400', label: 'Rejected' },
  PAID: { bg: 'bg-indigo-500/20', text: 'text-indigo-400', label: 'Paid' },
  DISPUTED: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Disputed' },
  CANCELLED: { bg: 'bg-slate-500/20', text: 'text-slate-500', label: 'Cancelled' },
};

function StatusBadge({ status }: { status: PaymentRequestStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

function RequestCard({ request, onSelect }: { request: PaymentRequest; onSelect: () => void }) {
  const category = CATEGORY_DISPLAY[request.category];

  return (
    <div
      onClick={onSelect}
      className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-5 cursor-pointer hover:border-indigo-500/50 hover:bg-slate-800/60 transition-all duration-200"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{category.icon}</span>
          <div>
            <h3 className="text-white font-medium line-clamp-1">{request.title}</h3>
            <p className={`text-sm ${category.color}`}>{category.label}</p>
          </div>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <p className="text-slate-400 text-sm line-clamp-2 mb-4">{request.description}</p>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-500 text-xs">Requested</p>
          <p className="text-white font-semibold">{parseFloat(formatEther(request.requestedAmount)).toFixed(2)} ETH</p>
        </div>
        <div className="text-right">
          <p className="text-slate-500 text-xs">{request.daoName}</p>
          {request.isRetroactive && (
            <span className="text-xs text-amber-400">Retroactive</span>
          )}
        </div>
      </div>

      {request.status === 'COUNCIL_REVIEW' && (
        <div className="mt-4 pt-3 border-t border-slate-700/50">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-emerald-400">✓ {request.councilVotes.approve}</span>
            <span className="text-rose-400">✗ {request.councilVotes.reject}</span>
            <span className="text-slate-400">○ {request.councilVotes.abstain}</span>
            <span className="text-slate-500 ml-auto">
              Needs {5 - (request.councilVotes.approve + request.councilVotes.reject + request.councilVotes.abstain)} more votes
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function SubmitRequestForm({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<PaymentCategory>('OTHER');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [isRetroactive, setIsRetroactive] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-semibold text-white mb-4">Submit Payment Request</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as PaymentCategory)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500 focus:outline-none"
            >
              {Object.entries(CATEGORY_DISPLAY).map(([key, { label, icon }]) => (
                <option key={key} value={key}>{icon} {label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Brief description of work"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Detailed description of work performed or to be performed..."
              rows={4}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Requested Amount (ETH)</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="retroactive"
              checked={isRetroactive}
              onChange={e => setIsRetroactive(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="retroactive" className="text-sm text-slate-300">
              This is a retroactive funding request (work already completed)
            </label>
          </div>

          {isRetroactive && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-sm">
              <p className="text-amber-400 font-medium">Retroactive Funding Note</p>
              <p className="text-amber-300/80 mt-1">
                Retroactive requests require supermajority council approval and strong evidence.
                Upload detailed proof of work completion.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title || !amount}
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              {loading ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RequestDetails({ request, onClose }: { request: PaymentRequest; onClose: () => void }) {
  const category = CATEGORY_DISPLAY[request.category];
  const [voting, setVoting] = useState(false);

  const handleVote = async (vote: 'approve' | 'reject' | 'abstain') => {
    setVoting(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setVoting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full mx-4 shadow-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <span className="text-4xl">{category.icon}</span>
              <div>
                <h3 className="text-xl font-semibold text-white">{request.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-sm ${category.color}`}>{category.label}</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-400 text-sm">{request.daoName}</span>
                  {request.isRetroactive && (
                    <>
                      <span className="text-slate-500">•</span>
                      <span className="text-amber-400 text-sm">Retroactive</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">×</button>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-slate-400 text-sm">Requested</p>
              <p className="text-white text-xl font-bold">{parseFloat(formatEther(request.requestedAmount)).toFixed(2)} ETH</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-slate-400 text-sm">Status</p>
              <div className="mt-1">
                <StatusBadge status={request.status} />
              </div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-slate-400 text-sm">Submitted</p>
              <p className="text-white font-medium">{new Date(request.submittedAt).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <div>
            <h4 className="text-sm font-medium text-slate-400 mb-2">Description</h4>
            <p className="text-white">{request.description}</p>
          </div>

          <div>
            <h4 className="text-sm font-medium text-slate-400 mb-2">Work Period</h4>
            <p className="text-white">
              {new Date(request.workStartDate).toLocaleDateString()} – {new Date(request.workEndDate).toLocaleDateString()}
            </p>
          </div>

          <div>
            <h4 className="text-sm font-medium text-slate-400 mb-2">Evidence</h4>
            <a
              href={request.evidenceUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 text-sm"
            >
              {request.evidenceUri}
            </a>
          </div>

          <div>
            <h4 className="text-sm font-medium text-slate-400 mb-2">Requester</h4>
            <p className="text-white font-mono text-sm">{request.requester}</p>
          </div>

          {/* Council Votes */}
          <div>
            <h4 className="text-sm font-medium text-slate-400 mb-3">Council Votes</h4>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">
                  {request.councilVotes.approve}
                </div>
                <span className="text-slate-400">Approve</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-400 font-bold">
                  {request.councilVotes.reject}
                </div>
                <span className="text-slate-400">Reject</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-slate-500/20 flex items-center justify-center text-slate-400 font-bold">
                  {request.councilVotes.abstain}
                </div>
                <span className="text-slate-400">Abstain</span>
              </div>
            </div>
            <div className="mt-3 bg-slate-800/50 rounded-full h-2 overflow-hidden">
              <div className="flex h-full">
                <div
                  className="bg-emerald-500"
                  style={{ width: `${(request.councilVotes.approve / 5) * 100}%` }}
                />
                <div
                  className="bg-rose-500"
                  style={{ width: `${(request.councilVotes.reject / 5) * 100}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              67% supermajority required for approval • {5 - (request.councilVotes.approve + request.councilVotes.reject + request.councilVotes.abstain)} votes remaining
            </p>
          </div>
        </div>

        {/* Vote Actions */}
        {request.status === 'COUNCIL_REVIEW' && (
          <div className="p-6 border-t border-slate-700 bg-slate-800/30">
            <p className="text-sm text-slate-400 mb-3">Cast your vote as a council member:</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleVote('approve')}
                disabled={voting}
                className="flex-1 px-4 py-2.5 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-600/30 transition-colors disabled:opacity-50"
              >
                ✓ Approve
              </button>
              <button
                onClick={() => handleVote('reject')}
                disabled={voting}
                className="flex-1 px-4 py-2.5 bg-rose-600/20 border border-rose-500/30 text-rose-400 rounded-lg hover:bg-rose-600/30 transition-colors disabled:opacity-50"
              >
                ✗ Reject
              </button>
              <button
                onClick={() => handleVote('abstain')}
                disabled={voting}
                className="flex-1 px-4 py-2.5 bg-slate-600/20 border border-slate-500/30 text-slate-400 rounded-lg hover:bg-slate-600/30 transition-colors disabled:opacity-50"
              >
                ○ Abstain
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Main Page ============

export default function PaymentRequestsPage() {
  const { isConnected } = useAccount();
  const [showSubmit, setShowSubmit] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<PaymentRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<PaymentRequestStatus | 'ALL'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<PaymentCategory | 'ALL'>('ALL');

  const filteredRequests = MOCK_REQUESTS.filter(r => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (categoryFilter !== 'ALL' && r.category !== categoryFilter) return false;
    return true;
  });

  const pendingReview = MOCK_REQUESTS.filter(r => r.status === 'COUNCIL_REVIEW' || r.status === 'CEO_REVIEW').length;
  const totalPaid = MOCK_REQUESTS.filter(r => r.status === 'PAID').reduce((sum, r) => sum + r.approvedAmount, 0n);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Payment Requests</h1>
            <p className="text-slate-400">Request funding for non-bounty work like marketing, ops, and community</p>
          </div>
          {isConnected && (
            <button
              onClick={() => setShowSubmit(true)}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors flex items-center gap-2"
            >
              <span>+</span> Submit Request
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
            <p className="text-slate-400 text-sm">Total Requests</p>
            <p className="text-2xl font-bold text-white">{MOCK_REQUESTS.length}</p>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
            <p className="text-amber-400 text-sm">Pending Review</p>
            <p className="text-2xl font-bold text-amber-400">{pendingReview}</p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
            <p className="text-emerald-400 text-sm">Total Paid</p>
            <p className="text-2xl font-bold text-emerald-400">{parseFloat(formatEther(totalPaid)).toFixed(2)} ETH</p>
          </div>
          <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-5">
            <p className="text-indigo-400 text-sm">Your Requests</p>
            <p className="text-2xl font-bold text-indigo-400">0</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as PaymentRequestStatus | 'ALL')}
            className="bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            {Object.entries(STATUS_STYLES).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as PaymentCategory | 'ALL')}
            className="bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none"
          >
            <option value="ALL">All Categories</option>
            {Object.entries(CATEGORY_DISPLAY).map(([key, { label, icon }]) => (
              <option key={key} value={key}>{icon} {label}</option>
            ))}
          </select>
        </div>

        {/* Requests Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRequests.map(request => (
            <RequestCard
              key={request.requestId}
              request={request}
              onSelect={() => setSelectedRequest(request)}
            />
          ))}
        </div>

        {filteredRequests.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-400">No payment requests match your filters.</p>
          </div>
        )}
      </div>

      {/* Modals */}
      {showSubmit && <SubmitRequestForm onClose={() => setShowSubmit(false)} />}
      {selectedRequest && (
        <RequestDetails
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
        />
      )}
    </div>
  );
}

