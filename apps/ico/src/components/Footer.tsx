'use client';

import { FileText, Github, ExternalLink, Shield } from 'lucide-react';
import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-zinc-800 mt-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-jeju-400 to-jeju-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">J</span>
              </div>
              <span className="font-semibold text-lg">Jeju</span>
            </div>
            <p className="text-sm text-zinc-400">
              OP-Stack L2 with 200ms Flashblocks.
            </p>
          </div>
          
          <div>
            <h3 className="font-semibold mb-4">Resources</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/whitepaper" className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
                  <FileText className="w-4 h-4" />
                  Whitepaper
                </Link>
              </li>
              <li>
                <a href="https://docs.jeju.network" target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
                  <ExternalLink className="w-4 h-4" />
                  Documentation
                </a>
              </li>
              <li>
                <a href="https://github.com/elizaos/jeju" target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
                  <Github className="w-4 h-4" />
                  Source Code
                </a>
              </li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-semibold mb-4">Network</h3>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li>Chain ID: 420691</li>
              <li>Testnet: 420690</li>
              <li>Native Token: ETH</li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-semibold mb-4">Legal</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/whitepaper#compliance" className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
                  <Shield className="w-4 h-4" />
                  MiCA Compliance
                </Link>
              </li>
              <li>
                <a href="#" className="text-sm text-zinc-400 hover:text-white transition-colors">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-zinc-400 hover:text-white transition-colors">
                  Privacy Policy
                </a>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-zinc-800 mt-8 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-zinc-500">
            © {new Date().getFullYear()} Jeju Network. Open source under MIT License.
          </p>
          <p className="text-xs text-zinc-600">
            This is a testnet demonstration. Not financial advice.
          </p>
        </div>
      </div>
    </footer>
  );
}
