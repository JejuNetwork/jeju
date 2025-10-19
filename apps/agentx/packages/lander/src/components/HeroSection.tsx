import React from 'react';
import { getGitHubUrl } from '../utils/repository';

export const HeroSection: React.FC = () => {
  const scrollToDownload = () => {
    document.getElementById('download')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-black">
      {/* Static noise background */}
      <div className="absolute inset-0 opacity-5">
        <div
          className="w-full h-full bg-repeat"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.4'/%3E%3C/svg%3E")`,
            backgroundSize: '128px 128px',
          }}
        ></div>
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-6">
        <div className="max-w-6xl mx-auto">
          {/* Title Block */}
          <div className="bg-black border border-green-400 p-6 mb-8">
            <div className="text-center">
              <h1 className="text-6xl md:text-8xl font-mono font-bold text-green-400 mb-4 tracking-wider">
                ELIZA
              </h1>
              <div className="text-green-400 text-lg font-mono">
                AUTONOMOUS INTELLIGENCE PROJECT
              </div>
            </div>
          </div>

          {/* Download Block */}
          <div className="bg-black border border-green-400 p-6 mb-8">
            <div className="text-center">
              <div className="text-red-400 font-mono text-sm mb-4">USE AT YOUR OWN RISK</div>
              <button
                onClick={scrollToDownload}
                className="bg-green-400 text-black font-mono font-bold px-8 py-3 hover:bg-green-300 transition-colors text-lg tracking-wider"
              >
                DOWNLOAD
              </button>
            </div>
          </div>

          {/* Bottom Links */}
          <div className="flex justify-center gap-8 text-xs font-mono">
            <a
              href={getGitHubUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-400 hover:text-green-300 underline"
            >
              [SOURCE]
            </a>
            <span className="text-green-400">|</span>
            <a
              href="https://discord.gg/elizaos"
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-400 hover:text-green-300 underline"
            >
              [COMMUNITY]
            </a>
          </div>
        </div>
      </div>

      {/* Scanline effect */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute w-full h-px bg-green-400/30"
          style={{
            top: '40%',
            animation: 'scanline 4s linear infinite',
          }}
        ></div>
      </div>
    </section>
  );
};
