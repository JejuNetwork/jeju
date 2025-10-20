import { describe, it, expect, afterEach } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { MarketCard } from '@/components/MarketCard';
import type { Market } from '@/types';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

describe('MarketCard', () => {
  const mockMarket: Market = {
    id: '1',
    sessionId: '0x1234567890abcdef',
    question: 'Will Team A win the championship?',
    yesPrice: 600000000000000000n, // 60%
    noPrice: 400000000000000000n, // 40%
    yesShares: 1000000000000000000n,
    noShares: 1000000000000000000n,
    totalVolume: 10000000000000000000n, // 10 ETH
    createdAt: new Date('2025-01-01T00:00:00Z'),
    resolved: false,
  };

  it('should render market question', () => {
    render(<MarketCard market={mockMarket} />);
    expect(screen.getByText('Will Team A win the championship?')).toBeTruthy();
  });

  it('should display active status for unresolved markets', () => {
    render(<MarketCard market={mockMarket} />);
    const activeElements = screen.getAllByText('Active');
    expect(activeElements.length).toBeGreaterThan(0);
  });

  it('should display resolved status for resolved markets', () => {
    const resolvedMarket = { ...mockMarket, resolved: true, outcome: true };
    render(<MarketCard market={resolvedMarket} />);
    
    expect(screen.getByText('Resolved')).toBeTruthy();
    expect(screen.getByText(/Outcome: YES/)).toBeTruthy();
  });

  it('should calculate and display YES percentage correctly', () => {
    render(<MarketCard market={mockMarket} />);
    
    // 60% (600000000000000000n / 1e16)
    const yesElements = screen.getAllByText(/60.0%/);
    expect(yesElements.length).toBeGreaterThan(0);
  });

  it('should calculate and display NO percentage correctly', () => {
    render(<MarketCard market={mockMarket} />);
    
    // 40%
    const noElements = screen.getAllByText(/40.0%/);
    expect(noElements.length).toBeGreaterThan(0);
  });

  it('should display volume in ETH', () => {
    render(<MarketCard market={mockMarket} />);
    
    const volumeElements = screen.getAllByText(/10.*ETH/);
    expect(volumeElements.length).toBeGreaterThan(0);
  });

  it('should have link to market detail page', () => {
    const { container } = render(<MarketCard market={mockMarket} />);
    const links = container.querySelectorAll(`a[href="/market/${mockMarket.sessionId}"]`);
    
    expect(links.length).toBeGreaterThan(0);
  });

  it('should show time since creation', () => {
    render(<MarketCard market={mockMarket} />);
    
    // Should show "X days ago" or similar
    const agoElements = screen.getAllByText(/ago/);
    expect(agoElements.length).toBeGreaterThan(0);
  });

  it('should render outcome badge for resolved markets', () => {
    const resolvedYes = { ...mockMarket, resolved: true, outcome: true };
    render(<MarketCard market={resolvedYes} />);
    
    const yesElements = screen.getAllByText(/Outcome: YES/);
    expect(yesElements.length).toBeGreaterThan(0);
    
    cleanup();

    const resolvedNo = { ...mockMarket, resolved: true, outcome: false };
    render(<MarketCard market={resolvedNo} />);
    
    const noElements = screen.getAllByText(/Outcome: NO/);
    expect(noElements.length).toBeGreaterThan(0);
  });

  it('should have data-testid attribute', () => {
    const { container } = render(<MarketCard market={mockMarket} />);
    const linkWithTestId = container.querySelector('[data-testid="market-card"]');
    
    expect(linkWithTestId).toBeTruthy();
  });
});

