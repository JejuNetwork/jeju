import { FileCheck, Award, Loader2 } from 'lucide-react';

interface CredentialsCardProps {
  onIssueCredential: () => Promise<void>;
  isLoading: boolean;
}

export function CredentialsCard({ onIssueCredential, isLoading }: CredentialsCardProps) {
  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <FileCheck size={20} className="text-purple-400" />
        <div>
          <h3 className="text-lg font-semibold">Verifiable Credentials</h3>
          <p className="text-sm text-gray-400">W3C compliant identity attestations</p>
        </div>
      </div>

      <p className="text-gray-400 mb-4 text-sm">
        Issue a verifiable credential that proves your identity ownership. 
        This credential can be shared with other services for authentication.
      </p>

      <button
        onClick={onIssueCredential}
        disabled={isLoading}
        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Award size={16} />
        )}
        Issue Credential
      </button>
    </div>
  );
}
