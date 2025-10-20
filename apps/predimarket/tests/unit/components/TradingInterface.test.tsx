import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TradingInterface } from '@/components/TradingInterface';
import type { Market } from '@/types';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock wagmi hooks
const mockWriteContract = mock(() => {});
const mockUseAccount = mock(() => ({ address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', isConnected: true }));
const mockUseWriteContract = mock(() => ({ 
  writeContract: mockWriteContract, 
  data: null, 
  isPending: false 
}));
const mockUseWaitForTransactionReceipt = mock(() => ({ isLoading: false }));

mock.module('wagmi', () => ({
  useAccount: mockUseAccount,
  useWriteContract: mockUseWriteContract,
  useWaitForTransactionReceipt: mockUseWaitForTransactionReceipt,
}));

mock.module('viem', () => ({
  parseEther: (val: string) => BigInt(parseFloat(val) * 1e18),
}));

describe('TradingInterface', () => {
  const mockMarket: Market = {
    id: '1',
    sessionId: '0x1234567890abcdef',
    question: 'Will Team A win?',
    yesPrice: 600000000000000000n,
    noPrice: 400000000000000000n,
    yesShares: 1000000000000000000n,
    noShares: 1000000000000000000n,
    totalVolume: 10000000000000000000n,
    createdAt: new Date(),
    resolved: false,
  };

  it('should render trading interface', () => {
    render(<TradingInterface market={mockMarket} />);
    
    expect(screen.getByText('Place Bet')).toBeTruthy();
    expect(screen.getByTestId('outcome-yes-button')).toBeTruthy();
    expect(screen.getByTestId('outcome-no-button')).toBeTruthy();
    expect(screen.getByTestId('amount-input')).toBeTruthy();
    expect(screen.getByTestId('buy-button')).toBeTruthy();
  });

  it('should show YES as default selection', () => {
    render(<TradingInterface market={mockMarket} />);
    
    const yesButtons = screen.getAllByTestId('outcome-yes-button');
    expect(yesButtons[0].classList.contains('bg-green-600')).toBe(true);
  });

  it('should toggle outcome selection', () => {
    render(<TradingInterface market={mockMarket} />);
    
    const noButtons = screen.getAllByTestId('outcome-no-button');
    fireEvent.click(noButtons[0]);
    
    expect(noButtons[0].classList.contains('bg-red-600')).toBe(true);
    const buyButtons = screen.getAllByTestId('buy-button');
    expect(buyButtons[0].textContent).toContain('NO');
  });

  it('should update amount input', () => {
    render(<TradingInterface market={mockMarket} />);
    
    const amountInputs = screen.getAllByTestId('amount-input');
    const amountInput = amountInputs[0] as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '250' } });
    
    expect(amountInput.value).toBe('250');
  });

  it('should show error when not connected', () => {
    mockUseAccount.mockImplementationOnce(() => ({ address: undefined, isConnected: false }));
    
    render(<TradingInterface market={mockMarket} />);
    
    const buyButtons = screen.getAllByTestId('buy-button');
    fireEvent.click(buyButtons[0]);
    
    // Wait for error to appear
    setTimeout(() => {
      const errorMessages = screen.queryAllByTestId('error-message');
      expect(errorMessages.length).toBeGreaterThan(0);
    }, 100);
  });

  it('should display current prices with percentages', () => {
    render(<TradingInterface market={mockMarket} />);
    
    const yesElements = screen.getAllByText(/YES 60.0%/);
    const noElements = screen.getAllByText(/NO 40.0%/);
    expect(yesElements.length).toBeGreaterThan(0);
    expect(noElements.length).toBeGreaterThan(0);
  });

  it('should disable buy button when pending', () => {
    mockUseWriteContract.mockImplementationOnce(() => ({ 
      writeContract: mockWriteContract, 
      data: null, 
      isPending: true 
    }));
    
    render(<TradingInterface market={mockMarket} />);
    
    const buyButtons = screen.getAllByTestId('buy-button');
    const buyButton = buyButtons[buyButtons.length - 1] as HTMLButtonElement;
    expect(buyButton.disabled).toBe(true);
  });

  it('should show confirming status during transaction', () => {
    mockUseWriteContract.mockImplementationOnce(() => ({ 
      writeContract: mockWriteContract, 
      data: '0xhash', 
      isPending: true 
    }));
    
    render(<TradingInterface market={mockMarket} />);
    
    const confirmingElements = screen.getAllByText('Confirming...');
    expect(confirmingElements.length).toBeGreaterThan(0);
  });
});

