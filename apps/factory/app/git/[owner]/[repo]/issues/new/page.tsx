'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  AlertCircle,
  ArrowLeft,
  Tag,
  Users,
  Milestone,
  Loader2,
  Send,
  Bold,
  Italic,
  Code,
  Link as LinkIcon,
  List,
  ListOrdered,
  Image as ImageIcon,
  Eye,
  Edit3,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';

const labels = [
  { name: 'bug', color: 'bg-red-500' },
  { name: 'enhancement', color: 'bg-blue-500' },
  { name: 'documentation', color: 'bg-purple-500' },
  { name: 'good first issue', color: 'bg-green-500' },
  { name: 'help wanted', color: 'bg-yellow-500' },
  { name: 'question', color: 'bg-pink-500' },
];

const assignees = [
  { id: '1', name: 'alice.eth', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' },
  { id: '2', name: 'bob.eth', avatar: 'https://avatars.githubusercontent.com/u/2?v=4' },
  { id: '3', name: 'charlie.eth', avatar: 'https://avatars.githubusercontent.com/u/3?v=4' },
];

export default function NewIssuePage() {
  const params = useParams();
  const router = useRouter();
  const { isConnected } = useAccount();
  const owner = params.owner as string;
  const repo = params.repo as string;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [isPreview, setIsPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showAssignees, setShowAssignees] = useState(false);

  const toggleLabel = (label: string) => {
    setSelectedLabels(prev =>
      prev.includes(label)
        ? prev.filter(l => l !== label)
        : [...prev, label]
    );
  };

  const toggleAssignee = (id: string) => {
    setSelectedAssignees(prev =>
      prev.includes(id)
        ? prev.filter(a => a !== id)
        : [...prev, id]
    );
  };

  const insertMarkdown = (syntax: string, wrap = false) => {
    const textarea = document.querySelector('textarea');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = body.substring(start, end);

    let newText: string;
    if (wrap && selected) {
      newText = body.substring(0, start) + syntax + selected + syntax + body.substring(end);
    } else {
      newText = body.substring(0, start) + syntax + body.substring(end);
    }

    setBody(newText);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Redirect to issues list
    router.push(`/git/${owner}/${repo}`);
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={`/git/${owner}/${repo}`}
            className="text-factory-400 hover:text-factory-300 text-sm inline-flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {owner}/{repo}
          </Link>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <AlertCircle className="w-7 h-7 text-green-400" />
            New Issue
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-6">
          {/* Main Content */}
          <div className="flex-1">
            <div className="card p-6">
              {/* Title */}
              <div className="mb-4">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Issue title"
                  className="input text-lg font-medium"
                  required
                />
              </div>

              {/* Markdown Toolbar */}
              <div className="flex items-center gap-1 mb-2 p-2 bg-factory-800 rounded-t-lg border-b border-factory-700">
                <button
                  type="button"
                  onClick={() => setIsPreview(false)}
                  className={clsx(
                    'px-3 py-1 text-sm rounded',
                    !isPreview ? 'bg-factory-700 text-factory-100' : 'text-factory-400 hover:text-factory-200'
                  )}
                >
                  <Edit3 className="w-4 h-4 inline mr-1" />
                  Write
                </button>
                <button
                  type="button"
                  onClick={() => setIsPreview(true)}
                  className={clsx(
                    'px-3 py-1 text-sm rounded',
                    isPreview ? 'bg-factory-700 text-factory-100' : 'text-factory-400 hover:text-factory-200'
                  )}
                >
                  <Eye className="w-4 h-4 inline mr-1" />
                  Preview
                </button>
                <div className="flex-1" />
                {!isPreview && (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => insertMarkdown('**', true)} className="p-1.5 hover:bg-factory-700 rounded" title="Bold">
                      <Bold className="w-4 h-4 text-factory-400" />
                    </button>
                    <button type="button" onClick={() => insertMarkdown('_', true)} className="p-1.5 hover:bg-factory-700 rounded" title="Italic">
                      <Italic className="w-4 h-4 text-factory-400" />
                    </button>
                    <button type="button" onClick={() => insertMarkdown('`', true)} className="p-1.5 hover:bg-factory-700 rounded" title="Code">
                      <Code className="w-4 h-4 text-factory-400" />
                    </button>
                    <button type="button" onClick={() => insertMarkdown('[text](url)')} className="p-1.5 hover:bg-factory-700 rounded" title="Link">
                      <LinkIcon className="w-4 h-4 text-factory-400" />
                    </button>
                    <button type="button" onClick={() => insertMarkdown('\n- ')} className="p-1.5 hover:bg-factory-700 rounded" title="List">
                      <List className="w-4 h-4 text-factory-400" />
                    </button>
                    <button type="button" onClick={() => insertMarkdown('\n1. ')} className="p-1.5 hover:bg-factory-700 rounded" title="Numbered list">
                      <ListOrdered className="w-4 h-4 text-factory-400" />
                    </button>
                    <button type="button" onClick={() => insertMarkdown('![alt](url)')} className="p-1.5 hover:bg-factory-700 rounded" title="Image">
                      <ImageIcon className="w-4 h-4 text-factory-400" />
                    </button>
                  </div>
                )}
              </div>

              {/* Body */}
              {isPreview ? (
                <div className="min-h-[300px] p-4 bg-factory-900 rounded-b-lg prose prose-invert max-w-none">
                  {body ? (
                    <ReactMarkdown>{body}</ReactMarkdown>
                  ) : (
                    <p className="text-factory-500 italic">Nothing to preview</p>
                  )}
                </div>
              ) : (
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Describe the issue in detail. You can use Markdown for formatting."
                  rows={12}
                  className="input resize-none rounded-t-none font-mono text-sm"
                />
              )}

              {/* Submit */}
              <div className="flex justify-end mt-4 gap-3">
                <Link href={`/git/${owner}/${repo}`} className="btn btn-secondary">
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={!title.trim() || isSubmitting || !isConnected}
                  className="btn btn-primary"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Submit Issue
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-64 space-y-4">
            {/* Labels */}
            <div className="card p-4">
              <button
                type="button"
                onClick={() => setShowLabels(!showLabels)}
                className="flex items-center justify-between w-full text-sm font-medium text-factory-300 mb-2"
              >
                <span className="flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  Labels
                </span>
                <span className="text-factory-500">{selectedLabels.length || 'None'}</span>
              </button>
              {showLabels && (
                <div className="space-y-2 mt-3">
                  {labels.map((label) => (
                    <label key={label.name} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedLabels.includes(label.name)}
                        onChange={() => toggleLabel(label.name)}
                        className="rounded border-factory-600 bg-factory-800 text-accent-500"
                      />
                      <span className={clsx('w-3 h-3 rounded-full', label.color)} />
                      <span className="text-sm text-factory-300">{label.name}</span>
                    </label>
                  ))}
                </div>
              )}
              {selectedLabels.length > 0 && !showLabels && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {selectedLabels.map((label) => {
                    const labelData = labels.find(l => l.name === label);
                    return (
                      <span key={label} className={clsx('badge text-xs', labelData?.color, 'text-white')}>
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Assignees */}
            <div className="card p-4">
              <button
                type="button"
                onClick={() => setShowAssignees(!showAssignees)}
                className="flex items-center justify-between w-full text-sm font-medium text-factory-300 mb-2"
              >
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Assignees
                </span>
                <span className="text-factory-500">{selectedAssignees.length || 'None'}</span>
              </button>
              {showAssignees && (
                <div className="space-y-2 mt-3">
                  {assignees.map((user) => (
                    <label key={user.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedAssignees.includes(user.id)}
                        onChange={() => toggleAssignee(user.id)}
                        className="rounded border-factory-600 bg-factory-800 text-accent-500"
                      />
                      <img src={user.avatar} alt="" className="w-5 h-5 rounded-full" />
                      <span className="text-sm text-factory-300">{user.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Milestone */}
            <div className="card p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-factory-300 mb-2">
                <Milestone className="w-4 h-4" />
                Milestone
              </div>
              <select className="input text-sm">
                <option value="">No milestone</option>
                <option value="v1.0">v1.0 Release</option>
                <option value="v1.1">v1.1 Release</option>
              </select>
            </div>

            {/* Tips */}
            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-factory-300">
                <strong className="text-blue-400">Pro tip:</strong> Use Markdown to format your issue. 
                Reference other issues with #number and users with @username.
              </p>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}


