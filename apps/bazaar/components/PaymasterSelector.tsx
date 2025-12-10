'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, Check, Loader2 } from 'lucide-react';
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

  useEffect(() => {
    loadPaymasters();
  }, [estimatedGas, gasPrice]);

  async function loadPaymasters() {
    setLoading(true);
    const paymasterOptions = await getPaymasterOptions(estimatedGas, gasPrice);
    setOptions(paymasterOptions);
    
    const recommended = paymasterOptions.find(opt => opt.isRecommended);
    if (recommended) {
      setSelected(recommended);
      onSelect(recommended);
    }
    setLoading(false);
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
                {selected.paymaster.tokenSymbol.slice(0, 2)}
              </div>
              <div className="text-left">
                <div className="font-medium text-gray-900">{selected.paymaster.tokenSymbol}</div>
                <div className="text-xs text-gray-500">{selected.estimatedCostFormatted}</div>
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
            {options.map((option) => {
              const isJeju = option.paymaster.tokenSymbol === 'JEJU';
              return (
                <button
                  key={option.paymaster.address}
                  onClick={() => handleSelect(option)}
                  className={`w-full px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between group ${isJeju ? 'bg-purple-50' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${isJeju ? 'bg-gradient-to-br from-purple-500 to-pink-500' : 'bg-gradient-to-br from-blue-400 to-purple-500'}`}>
                      {option.paymaster.tokenSymbol.slice(0, 2)}
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{option.paymaster.tokenSymbol}</span>
                        {isJeju && (
                          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded font-medium">
                            ⭐ Preferred
                          </span>
                        )}
                        {option.isRecommended && !isJeju && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded font-medium">
                            Recommended
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{option.estimatedCostFormatted}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{option.paymaster.stakedEth.toString()} ETH staked</div>
                    </div>
                  </div>
                  {selected?.paymaster.address === option.paymaster.address && (
                    <Check size={20} className="text-green-500" />
                  )}
                </button>
              );
            })}

          </div>
        </>
      )}
    </div>
  );
}

