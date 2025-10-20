/**
 * Paymaster Selector Component
 * Allows users to choose which token to use for gas payments
 */

'use client';

import { useState, useEffect } from 'react';
import { Address, parseEther } from 'viem';
import { ChevronDown, Check, Loader2, AlertCircle } from 'lucide-react';
import { getPaymasterOptions, type PaymasterOption } from '@/lib/paymaster';

interface PaymasterSelectorProps {
  estimatedGas: bigint;
  gasPrice: bigint;
  onSelect: (paymaster: PaymasterOption | null) => void;
  className?: string;
}

export default function PaymasterSelector({
  estimatedGas,
  gasPrice,
  onSelect,
  className = '',
}: PaymasterSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<PaymasterOption | null>(null);
  const [options, setOptions] = useState<PaymasterOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPaymasters();
  }, [estimatedGas, gasPrice]);

  async function loadPaymasters() {
    try {
      setLoading(true);
      setError(null);
      const paymasterOptions = await getPaymasterOptions(estimatedGas, gasPrice);
      setOptions(paymasterOptions);
      
      // Auto-select recommended option
      const recommended = paymasterOptions.find(opt => opt.recommended);
      if (recommended) {
        setSelected(recommended);
        onSelect(recommended);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load paymasters');
      console.error('Error loading paymasters:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(option: PaymasterOption) {
    setSelected(option);
    onSelect(option);
    setIsOpen(false);
  }

  function handleUseETH() {
    setSelected(null);
    onSelect(null);
    setIsOpen(false);
  }

  if (loading) {
    return (
      <div className={`border border-gray-200 rounded-lg p-4 ${className}`}>
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="animate-spin" size={16} />
          <span className="text-sm">Loading payment options...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`border border-red-200 bg-red-50 rounded-lg p-4 ${className}`}>
        <div className="flex items-start gap-2 text-red-600">
          <AlertCircle size={16} className="mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">Failed to load payment options</p>
            <p className="text-red-500 mt-1">{error}</p>
            <button
              onClick={loadPaymasters}
              className="mt-2 text-red-600 hover:text-red-700 underline text-xs"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Pay Gas With
      </label>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white hover:bg-gray-50 transition-colors flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          {selected ? (
            <>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
                {selected.token.symbol.slice(0, 2)}
              </div>
              <div className="text-left">
                <div className="font-medium text-gray-900">{selected.token.symbol}</div>
                <div className="text-xs text-gray-500">{selected.estimatedCost}</div>
              </div>
            </>
          ) : (
            <>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white font-bold text-sm">
                ETH
              </div>
              <div className="text-left">
                <div className="font-medium text-gray-900">Ethereum</div>
                <div className="text-xs text-gray-500">Pay gas with ETH</div>
              </div>
            </>
          )}
        </div>
        <ChevronDown
          size={20}
          className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute z-20 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
            {/* ETH Option */}
            <button
              onClick={handleUseETH}
              className="w-full px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white font-bold text-sm">
                  ETH
                </div>
                <div className="text-left">
                  <div className="font-medium text-gray-900">Ethereum</div>
                  <div className="text-xs text-gray-500">Standard gas payment</div>
                </div>
              </div>
              {!selected && (
                <Check size={20} className="text-green-500" />
              )}
            </button>

            {/* Divider */}
            {options.length > 0 && (
              <div className="border-t border-gray-200 my-1"></div>
            )}

            {/* Paymaster Options */}
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => handleSelect(option)}
                className="w-full px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
                    {option.token.symbol.slice(0, 2)}
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{option.token.symbol}</span>
                      {option.recommended && (
                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded font-medium">
                          Recommended
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{option.estimatedCost}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{option.stakedEth}</div>
                  </div>
                </div>
                {selected?.value === option.value && (
                  <Check size={20} className="text-green-500" />
                )}
              </button>
            ))}

            {options.length === 0 && (
              <div className="px-4 py-3 text-center text-sm text-gray-500">
                No paymasters available
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

