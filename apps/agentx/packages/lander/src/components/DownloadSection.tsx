import React from 'react';
import { Download, Monitor, HardDrive } from 'lucide-react';
import { useGithubReleases, type DownloadLink } from '../hooks/useGithubReleases';
import { getReleasesUrl, getGitHubUrl } from '../utils/repository';

const PlatformIcon = ({ platform }: { platform: DownloadLink['platform'] }) => {
  switch (platform) {
    case 'macOS':
      return <div className="w-6 h-6 text-center font-mono text-green-400">🍎</div>;
    case 'Windows':
      return <Monitor className="w-6 h-6 text-green-400 mx-auto" />;
    case 'Linux':
      return <HardDrive className="w-6 h-6 text-green-400 mx-auto" />;
    default:
      return <Download className="w-6 h-6 text-green-400 mx-auto" />;
  }
};

const DownloadButton: React.FC<{ link: DownloadLink }> = ({ link }) => {
  const handleDownload = () => {
    // Track download analytics if needed
    window.open(link.downloadUrl, '_blank');
  };

  return (
    <div className="bg-black border-2 border-green-400 p-1 hover:border-green-300 transition-colors group font-mono">
      {/* Header */}
      <div className="bg-green-400 text-black text-xs px-2 py-1 mb-2">
        {link.platform.toUpperCase()}
        {link.architecture && ` [${link.architecture.toUpperCase()}]`}
      </div>

      {/* Content */}
      <div className="p-3 text-center">
        <div className="text-green-400 mb-3">
          <PlatformIcon platform={link.platform} />
        </div>

        <div className="text-xs text-green-400 mb-3">SIZE: {link.size}</div>

        <button
          onClick={handleDownload}
          className="bg-green-400 text-black font-mono font-bold text-xs px-4 py-2 hover:bg-green-300 transition-colors w-full"
        >
          DOWNLOAD
        </button>
      </div>
    </div>
  );
};

export const DownloadSection: React.FC = () => {
  const { latestRelease, downloadLinks, loading, error } = useGithubReleases();

  if (loading) {
    return (
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-black border-2 border-green-400 p-4">
            <div className="bg-green-400 text-black font-mono text-xs px-2 py-1 mb-4">
              ACCESSING REMOTE SERVER...
            </div>
            <div className="text-green-400 font-mono text-sm text-center">
              [████████████████████████] DOWNLOADING MANIFEST...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-black border-2 border-red-400 p-4">
            <div className="bg-red-400 text-black font-mono text-xs px-2 py-1 mb-4">
              CONNECTION FAILED [ERROR CODE: 0x404]
            </div>
            <div className="text-red-400 font-mono text-sm mb-4">{error}</div>
            <div className="text-center">
              <a
                href={getReleasesUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-green-400 text-black font-mono font-bold text-xs px-4 py-2 hover:bg-green-300 transition-colors"
              >
                MANUAL ACCESS
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const groupedDownloads = downloadLinks.reduce(
    (acc, link) => {
      if (!acc[link.platform]) {
        acc[link.platform] = [];
      }
      acc[link.platform].push(link);
      return acc;
    },
    {} as Record<DownloadLink['platform'], DownloadLink[]>
  );

  return (
    <section id="download" className="py-16 bg-black">
      <div className="container mx-auto px-6">
        <div className="max-w-6xl mx-auto">
          {/* Header Block */}
          <div className="bg-black border-2 border-green-400 p-4 mb-8">
            <div className="bg-green-400 text-black font-mono text-xs px-2 py-1 mb-4">
              DOWNLOAD ARCHIVE [CLEARANCE LEVEL: ALPHA]
            </div>

            {latestRelease && (
              <div className="text-green-400 font-mono text-sm text-center">
                BUILD {latestRelease.tag_name} | COMPILED{' '}
                {new Date(latestRelease.published_at).toLocaleDateString().replace(/\//g, '.')}
              </div>
            )}
          </div>

          {/* Download Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {Object.entries(groupedDownloads).map(([platform, links]) =>
              links.map((link, index) => (
                <DownloadButton key={`${platform}-${index}`} link={link} />
              ))
            )}
          </div>

          {/* Alternative Access */}
          <div className="bg-black border border-green-400 p-4">
            <div className="text-green-400 font-mono text-xs mb-2">
              [ALTERNATIVE ACCESS METHODS]
            </div>
            <div className="flex flex-wrap justify-center gap-8 text-xs font-mono">
              <a
                href={getReleasesUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 hover:text-green-300 underline"
              >
                [ALL BUILDS]
              </a>
              <a
                href={getGitHubUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 hover:text-green-300 underline"
              >
                [COMPILE SOURCE]
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
