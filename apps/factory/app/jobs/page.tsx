'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { 
  Briefcase, 
  Search, 
  Plus,
  MapPin,
  Clock,
  DollarSign,
  Building2,
  Globe,
  CheckCircle,
  Users,
  Zap,
  ExternalLink
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

type JobType = 'full-time' | 'part-time' | 'contract' | 'bounty';
type JobLocation = 'remote' | 'hybrid' | 'onsite';

interface Job {
  id: string;
  title: string;
  company: string;
  companyLogo?: string;
  description: string;
  type: JobType;
  location: JobLocation;
  compensation: {
    min: number;
    max: number;
    currency: string;
    period: 'yearly' | 'monthly' | 'hourly' | 'fixed';
  };
  skills: string[];
  postedAt: number;
  applicants: number;
  isVerified: boolean;
  isUrgent?: boolean;
}

const mockJobs: Job[] = [
  {
    id: '1',
    title: 'Senior Smart Contract Engineer',
    company: 'Jeju Labs',
    description: 'Build and maintain core protocol contracts for the Jeju Network. Work on identity, bounties, guardians, and model registries.',
    type: 'full-time',
    location: 'remote',
    compensation: { min: 150000, max: 250000, currency: 'USDC', period: 'yearly' },
    skills: ['Solidity', 'Foundry', 'EVM', 'DeFi'],
    postedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    applicants: 24,
    isVerified: true,
    isUrgent: true,
  },
  {
    id: '2',
    title: 'Full Stack Developer',
    company: 'Jeju Labs',
    description: 'Build beautiful, performant UIs for Factory, Bazaar, and Gateway apps. Next.js, React, TypeScript, web3.',
    type: 'full-time',
    location: 'remote',
    compensation: { min: 120000, max: 180000, currency: 'USDC', period: 'yearly' },
    skills: ['React', 'TypeScript', 'Next.js', 'Wagmi'],
    postedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    applicants: 47,
    isVerified: true,
  },
  {
    id: '3',
    title: 'ML/AI Engineer',
    company: 'Psyche Network',
    description: 'Work on distributed training infrastructure and model hub integrations. PyTorch, distributed systems, CUDA.',
    type: 'full-time',
    location: 'remote',
    compensation: { min: 180000, max: 300000, currency: 'USDC', period: 'yearly' },
    skills: ['Python', 'PyTorch', 'CUDA', 'Distributed Systems'],
    postedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
    applicants: 31,
    isVerified: true,
  },
  {
    id: '4',
    title: 'Guardian Agent Developer',
    company: 'Community',
    description: 'Build and operate guardian agents to validate bounties and review code submissions. Earn fees and reputation.',
    type: 'contract',
    location: 'remote',
    compensation: { min: 80, max: 200, currency: 'USDC', period: 'hourly' },
    skills: ['AI/LLM', 'Code Review', 'Security'],
    postedAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
    applicants: 12,
    isVerified: false,
  },
  {
    id: '5',
    title: 'DevRel Engineer',
    company: 'Jeju Labs',
    description: 'Create tutorials, documentation, and example apps. Help developers build on Jeju. Speak at conferences.',
    type: 'part-time',
    location: 'remote',
    compensation: { min: 60000, max: 90000, currency: 'USDC', period: 'yearly' },
    skills: ['Writing', 'Public Speaking', 'Web3', 'Community'],
    postedAt: Date.now() - 14 * 24 * 60 * 60 * 1000,
    applicants: 89,
    isVerified: true,
  },
];

const typeConfig: Record<JobType, { label: string; color: string }> = {
  'full-time': { label: 'Full-time', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  'part-time': { label: 'Part-time', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  'contract': { label: 'Contract', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  'bounty': { label: 'Bounty', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
};

export default function JobsPage() {
  const { isConnected } = useAccount();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<JobType | 'all'>('all');

  const filteredJobs = mockJobs.filter(job => {
    if (filterType !== 'all' && job.type !== filterType) return false;
    if (search && !job.title.toLowerCase().includes(search.toLowerCase()) &&
        !job.company.toLowerCase().includes(search.toLowerCase()) &&
        !job.skills.some(s => s.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  const formatCompensation = (comp: Job['compensation']) => {
    const formatter = new Intl.NumberFormat('en-US', { notation: 'compact' });
    if (comp.period === 'fixed') {
      return `${formatter.format(comp.min)}-${formatter.format(comp.max)} ${comp.currency}`;
    }
    return `${formatter.format(comp.min)}-${formatter.format(comp.max)} ${comp.currency}/${comp.period === 'yearly' ? 'yr' : comp.period === 'monthly' ? 'mo' : 'hr'}`;
  };

  const formatDate = (timestamp: number) => {
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  };

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-emerald-400" />
            Jobs
          </h1>
          <p className="text-factory-400 mt-1">Find work in the Jeju ecosystem</p>
        </div>
        <Link href="/jobs/post" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Post Job
        </Link>
      </div>

      {/* Search & Filters */}
      <div className="card p-6 mb-8">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-factory-500" />
            <input
              type="text"
              placeholder="Search jobs, companies, skills..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-12 text-lg"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'full-time', 'part-time', 'contract', 'bounty'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                  filterType === type
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100'
                )}
              >
                {type === 'all' ? 'All' : type.replace('-', ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Open Positions', value: '127', icon: Briefcase, color: 'text-emerald-400' },
          { label: 'Companies', value: '34', icon: Building2, color: 'text-blue-400' },
          { label: 'Applications', value: '2.4k', icon: Users, color: 'text-purple-400' },
          { label: 'Avg. Salary', value: '$145k', icon: DollarSign, color: 'text-green-400' },
        ].map((stat) => (
          <div key={stat.label} className="card p-4">
            <div className="flex items-center gap-3">
              <stat.icon className={clsx('w-8 h-8', stat.color)} />
              <div>
                <p className="text-2xl font-bold text-factory-100">{stat.value}</p>
                <p className="text-factory-500 text-sm">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Job List */}
      <div className="space-y-4">
        {filteredJobs.map((job) => (
          <Link 
            key={job.id}
            href={`/jobs/${job.id}`}
            className="card p-6 card-hover block"
          >
            <div className="flex items-start gap-4">
              {/* Company Logo */}
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-xl font-bold flex-shrink-0">
                {job.company[0]}
              </div>

              <div className="flex-1 min-w-0">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-lg text-factory-100">{job.title}</h3>
                      {job.isUrgent && (
                        <span className="badge bg-red-500/20 text-red-400 border border-red-500/30">
                          <Zap className="w-3 h-3 mr-1" />
                          Urgent
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="flex items-center gap-1 text-factory-300">
                        <Building2 className="w-4 h-4" />
                        {job.company}
                      </span>
                      {job.isVerified && (
                        <span className="flex items-center gap-1 text-green-400">
                          <CheckCircle className="w-4 h-4" />
                          Verified
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={clsx('badge border', typeConfig[job.type].color)}>
                    {typeConfig[job.type].label}
                  </span>
                </div>

                {/* Description */}
                <p className="text-factory-400 text-sm mb-3 line-clamp-2">{job.description}</p>

                {/* Skills */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {job.skills.map((skill) => (
                    <span key={skill} className="badge badge-info">
                      {skill}
                    </span>
                  ))}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-sm text-factory-500">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-4 h-4" />
                      {formatCompensation(job.compensation)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Globe className="w-4 h-4" />
                      {job.location.charAt(0).toUpperCase() + job.location.slice(1)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      {job.applicants} applicants
                    </span>
                  </div>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {formatDate(job.postedAt)}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Empty State */}
      {filteredJobs.length === 0 && (
        <div className="card p-12 text-center">
          <Briefcase className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">No jobs found</h3>
          <p className="text-factory-500 mb-4">Try adjusting your filters or post a new job</p>
          <Link href="/jobs/post" className="btn btn-primary">
            Post Job
          </Link>
        </div>
      )}
    </div>
  );
}

