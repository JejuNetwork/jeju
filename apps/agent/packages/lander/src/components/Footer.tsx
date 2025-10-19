import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-black">
      <div className="container mx-auto px-6 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-black border border-green-400 p-4">
            <div className="bg-green-400 text-black font-mono text-xs px-2 py-1 mb-4">
              SYSTEM LINKS [AUTHORIZED PERSONNEL ONLY]
            </div>

            {/* Links */}
            <div className="flex flex-wrap justify-center gap-8 text-xs font-mono mb-4">
              <a
                href="https://github.com/elizaos/eliza"
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 hover:text-green-300 transition-colors"
              >
                [REPOSITORY]
              </a>
              <a
                href="https://discord.gg/elizaos"
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 hover:text-green-300 transition-colors"
              >
                [COMMUNICATION]
              </a>
              <a
                href="https://github.com/elizaos/eliza/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 hover:text-green-300 transition-colors"
              >
                [ARCHIVE]
              </a>
            </div>

            {/* Bottom */}
            <div className="text-center text-xs text-green-400 font-mono">
              ELIZAGOTCHI PROJECT • YOUR AI COMPANION • 2025
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
