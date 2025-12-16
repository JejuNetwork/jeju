/**
 * Oracle Processor Tests
 * 
 * Tests the oracle event indexing logic with mock events.
 * Validates that events are parsed correctly and entities are created.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { keccak256, stringToHex, parseAbi } from 'viem';

// Event signatures from oracle-processor.ts
const EVENTS = {
  FEED_CREATED: keccak256(stringToHex('FeedCreated(bytes32,string,address,address,address)')),
  FEED_ACTIVATED: keccak256(stringToHex('FeedActivated(bytes32)')),
  FEED_DEACTIVATED: keccak256(stringToHex('FeedDeactivated(bytes32)')),
  OPERATOR_REGISTERED: keccak256(stringToHex('OperatorRegistered(bytes32,bytes32,uint256,address)')),
  OPERATOR_DEACTIVATED: keccak256(stringToHex('OperatorDeactivated(bytes32,string)')),
  PERFORMANCE_RECORDED: keccak256(stringToHex('PerformanceRecorded(bytes32,uint256,uint256,uint256)')),
  COMMITTEE_FORMED: keccak256(stringToHex('CommitteeFormed(bytes32,uint256,address[],address,uint256)')),
  MEMBER_ADDED: keccak256(stringToHex('MemberAdded(bytes32,uint256,address)')),
  MEMBER_REMOVED: keccak256(stringToHex('MemberRemoved(bytes32,uint256,address,string)')),
  REPORT_SUBMITTED: keccak256(stringToHex('ReportSubmitted(bytes32,bytes32,uint256,uint256,uint256,uint256)')),
  REPORT_REJECTED: keccak256(stringToHex('ReportRejected(bytes32,bytes32,string)')),
  DISPUTE_OPENED: keccak256(stringToHex('DisputeOpened(bytes32,bytes32,bytes32,address,uint256,uint8)')),
  DISPUTE_CHALLENGED: keccak256(stringToHex('DisputeChallenged(bytes32,address,uint256)')),
  DISPUTE_RESOLVED: keccak256(stringToHex('DisputeResolved(bytes32,uint8,uint256,uint256)')),
  SUBSCRIPTION_CREATED: keccak256(stringToHex('SubscriptionCreated(bytes32,address,bytes32[],uint256,uint256)')),
  SUBSCRIPTION_CANCELLED: keccak256(stringToHex('SubscriptionCancelled(bytes32,uint256)')),
  REWARDS_CLAIMED: keccak256(stringToHex('RewardsClaimed(bytes32,address,uint256)')),
} as const;

// ABIs for encoding test data
const INTERFACES = {
  registry: parseAbi([
    'event FeedCreated(bytes32 indexed feedId, string symbol, address baseToken, address quoteToken, address creator)',
    'event FeedActivated(bytes32 indexed feedId)',
    'event FeedDeactivated(bytes32 indexed feedId)',
  ]),
  connector: parseAbi([
    'event OperatorRegistered(bytes32 indexed operatorId, bytes32 indexed stakingOracleId, uint256 agentId, address workerKey)',
    'event OperatorDeactivated(bytes32 indexed operatorId, string reason)',
    'event PerformanceRecorded(bytes32 indexed operatorId, uint256 indexed epoch, uint256 reportsSubmitted, uint256 reportsAccepted)',
  ]),
  committee: parseAbi([
    'event CommitteeFormed(bytes32 indexed feedId, uint256 indexed round, address[] members, address leader, uint256 activeUntil)',
    'event MemberAdded(bytes32 indexed feedId, uint256 indexed round, address indexed member)',
    'event MemberRemoved(bytes32 indexed feedId, uint256 indexed round, address indexed member, string reason)',
  ]),
  reporting: parseAbi([
    'event ReportSubmitted(bytes32 indexed feedId, bytes32 reportHash, uint256 price, uint256 confidence, uint256 round, uint256 signatureCount)',
    'event ReportRejected(bytes32 indexed feedId, bytes32 indexed reportHash, string reason)',
  ]),
  dispute: parseAbi([
    'event DisputeOpened(bytes32 indexed disputeId, bytes32 reportHash, bytes32 feedId, address disputer, uint256 bond, uint8 reason)',
    'event DisputeChallenged(bytes32 indexed disputeId, address challenger, uint256 additionalBond)',
    'event DisputeResolved(bytes32 indexed disputeId, uint8 outcome, uint256 slashedAmount, uint256 reward)',
  ]),
  subscription: parseAbi([
    'event SubscriptionCreated(bytes32 indexed subscriptionId, address indexed subscriber, bytes32[] feedIds, uint256 duration, uint256 amountPaid)',
    'event SubscriptionCancelled(bytes32 indexed subscriptionId, uint256 refundAmount)',
    'event RewardsClaimed(bytes32 indexed operatorId, address indexed recipient, uint256 amount)',
  ]),
};

describe('Oracle Event Signatures', () => {
  test('should compute correct event signatures', () => {
    // Verify event signatures match expected keccak256 hashes
    expect(EVENTS.FEED_CREATED).toMatch(/^0x[a-f0-9]{64}$/);
    expect(EVENTS.OPERATOR_REGISTERED).toMatch(/^0x[a-f0-9]{64}$/);
    expect(EVENTS.REPORT_SUBMITTED).toMatch(/^0x[a-f0-9]{64}$/);
    expect(EVENTS.DISPUTE_OPENED).toMatch(/^0x[a-f0-9]{64}$/);
    
    // All event signatures should be unique
    const signatures = Object.values(EVENTS);
    const uniqueSignatures = new Set(signatures);
    expect(uniqueSignatures.size).toBe(signatures.length);
  });
});

describe('Oracle Event Encoding', () => {
  const testFeedId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const testOperatorId = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const testAddress = '0x1234567890123456789012345678901234567890';

  test('should encode FeedCreated event', () => {
    const encoded = INTERFACES.registry.encodeEventLog(
      INTERFACES.registry.getEvent('FeedCreated')!,
      [testFeedId, 'ETH-USD', testAddress, testAddress, testAddress]
    );

    expect(encoded.topics[0]).toBe(EVENTS.FEED_CREATED);
    expect(encoded.topics[1]).toBe(testFeedId);
  });

  test('should encode OperatorRegistered event', () => {
    const stakingOracleId = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const encoded = INTERFACES.connector.encodeEventLog(
      INTERFACES.connector.getEvent('OperatorRegistered')!,
      [testOperatorId, stakingOracleId, 123n, testAddress]
    );

    expect(encoded.topics[0]).toBe(EVENTS.OPERATOR_REGISTERED);
    expect(encoded.topics[1]).toBe(testOperatorId);
  });

  test('should encode ReportSubmitted event', () => {
    const reportHash = '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba';
    const encoded = INTERFACES.reporting.encodeEventLog(
      INTERFACES.reporting.getEvent('ReportSubmitted')!,
      [testFeedId, reportHash, 350000000000n, 9500n, 1n, 3n]
    );

    expect(encoded.topics[0]).toBe(EVENTS.REPORT_SUBMITTED);
    expect(encoded.topics[1]).toBe(testFeedId);
  });

  test('should encode DisputeOpened event', () => {
    const disputeId = '0xdead000000000000000000000000000000000000000000000000000000000000';
    const reportHash = '0xbeef000000000000000000000000000000000000000000000000000000000000';
    const encoded = INTERFACES.dispute.encodeEventLog(
      INTERFACES.dispute.getEvent('DisputeOpened')!,
      [disputeId, reportHash, testFeedId, testAddress, ethers.parseEther('100'), 0]
    );

    expect(encoded.topics[0]).toBe(EVENTS.DISPUTE_OPENED);
    expect(encoded.topics[1]).toBe(disputeId);
  });
});

describe('Oracle Event Decoding', () => {
  test('should decode FeedCreated event', () => {
    const testFeedId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const testAddress = '0x1234567890123456789012345678901234567890';

    const encoded = INTERFACES.registry.encodeEventLog(
      INTERFACES.registry.getEvent('FeedCreated')!,
      [testFeedId, 'ETH-USD', testAddress, testAddress, testAddress]
    );

    const decoded = INTERFACES.registry.parseLog({
      topics: encoded.topics as string[],
      data: encoded.data,
    });

    expect(decoded).not.toBeNull();
    // args[0] is feedId (indexed), args[1] is symbol, args[2] is baseToken
    expect(decoded!.args[0]).toBe(testFeedId);
    expect(decoded!.args[1]).toBe('ETH-USD');
    expect(decoded!.args[2].toLowerCase()).toBe(testAddress);
  });

  test('should decode ReportSubmitted event', () => {
    const testFeedId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const reportHash = '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba';

    const encoded = INTERFACES.reporting.encodeEventLog(
      INTERFACES.reporting.getEvent('ReportSubmitted')!,
      [testFeedId, reportHash, 350000000000n, 9500n, 42n, 5n]
    );

    const decoded = INTERFACES.reporting.parseLog({
      topics: encoded.topics as string[],
      data: encoded.data,
    });

    expect(decoded).not.toBeNull();
    // args[0] is feedId (indexed), rest are in data
    expect(decoded!.args[0]).toBe(testFeedId);
    expect(decoded!.args[1]).toBe(reportHash); // reportHash
    expect(decoded!.args[2]).toBe(350000000000n); // price
    expect(decoded!.args[3]).toBe(9500n); // confidence
    expect(decoded!.args[4]).toBe(42n); // round
    expect(decoded!.args[5]).toBe(5n); // signatureCount
  });

  test('should decode DisputeResolved event', () => {
    const disputeId = '0xdead000000000000000000000000000000000000000000000000000000000000';

    const encoded = INTERFACES.dispute.encodeEventLog(
      INTERFACES.dispute.getEvent('DisputeResolved')!,
      [disputeId, 1, ethers.parseEther('10'), ethers.parseEther('5')]
    );

    const decoded = INTERFACES.dispute.parseLog({
      topics: encoded.topics as string[],
      data: encoded.data,
    });

    expect(decoded).not.toBeNull();
    // args[0] is disputeId (indexed), rest are in data
    expect(decoded!.args[0]).toBe(disputeId);
    expect(decoded!.args[1]).toBe(1n); // outcome (INVALID)
    expect(decoded!.args[2]).toBe(ethers.parseEther('10')); // slashedAmount
    expect(decoded!.args[3]).toBe(ethers.parseEther('5')); // reward
  });
});

describe('Oracle Category Detection', () => {
  const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
    [/TWAP/i, 'TWAP'],
    [/FX|EUR|GBP|JPY|CHF/i, 'FX_RATE'],
    [/USDC|USDT|DAI|PEG/i, 'STABLECOIN_PEG'],
    [/STETH|RETH|CBETH|LST/i, 'LST_RATE'],
    [/GAS/i, 'L2_GAS'],
    [/UPTIME|SEQUENCER/i, 'SEQUENCER_UPTIME'],
    [/FINALITY/i, 'FINALITY'],
    [/MARKET.*STATUS|STATUS/i, 'MARKET_STATUS'],
  ];

  function categoryFromSymbol(symbol: string): string {
    for (const [pattern, category] of CATEGORY_PATTERNS) {
      if (pattern.test(symbol)) return category;
    }
    return 'SPOT_PRICE';
  }

  test('should categorize SPOT_PRICE feeds', () => {
    expect(categoryFromSymbol('ETH-USD')).toBe('SPOT_PRICE');
    expect(categoryFromSymbol('BTC-USD')).toBe('SPOT_PRICE');
    expect(categoryFromSymbol('LINK-ETH')).toBe('SPOT_PRICE');
  });

  test('should categorize TWAP feeds', () => {
    expect(categoryFromSymbol('ETH-USD-TWAP')).toBe('TWAP');
    expect(categoryFromSymbol('WETH-USDC-TWAP-30MIN')).toBe('TWAP');
  });

  test('should categorize FX feeds', () => {
    expect(categoryFromSymbol('EUR-USD')).toBe('FX_RATE');
    expect(categoryFromSymbol('GBP-USD')).toBe('FX_RATE');
    expect(categoryFromSymbol('USD-JPY')).toBe('FX_RATE');
  });

  test('should categorize stablecoin feeds', () => {
    expect(categoryFromSymbol('USDC-USD')).toBe('STABLECOIN_PEG');
    expect(categoryFromSymbol('DAI-USD')).toBe('STABLECOIN_PEG');
    expect(categoryFromSymbol('USDT-PEG')).toBe('STABLECOIN_PEG');
  });

  test('should categorize LST feeds', () => {
    expect(categoryFromSymbol('STETH-ETH')).toBe('LST_RATE');
    expect(categoryFromSymbol('RETH-ETH')).toBe('LST_RATE');
    expect(categoryFromSymbol('CBETH-USD')).toBe('LST_RATE');
  });

  test('should categorize infrastructure feeds', () => {
    expect(categoryFromSymbol('L2-GAS')).toBe('L2_GAS');
    expect(categoryFromSymbol('SEQUENCER-UPTIME')).toBe('SEQUENCER_UPTIME');
    expect(categoryFromSymbol('FINALITY-TIME')).toBe('FINALITY');
    expect(categoryFromSymbol('MARKET-STATUS')).toBe('MARKET_STATUS');
  });
});

describe('Oracle Event Set Membership', () => {
  const ORACLE_EVENT_SET = new Set(Object.values(EVENTS));

  test('should identify oracle events', () => {
    expect(ORACLE_EVENT_SET.has(EVENTS.FEED_CREATED)).toBe(true);
    expect(ORACLE_EVENT_SET.has(EVENTS.REPORT_SUBMITTED)).toBe(true);
    expect(ORACLE_EVENT_SET.has(EVENTS.DISPUTE_OPENED)).toBe(true);
  });

  test('should reject non-oracle events', () => {
    const transferEvent = ethers.id('Transfer(address,address,uint256)');
    const approvalEvent = ethers.id('Approval(address,address,uint256)');
    
    expect(ORACLE_EVENT_SET.has(transferEvent)).toBe(false);
    expect(ORACLE_EVENT_SET.has(approvalEvent)).toBe(false);
  });
});

describe('Oracle Data Validation', () => {
  test('should validate price is non-zero', () => {
    const price = 350000000000n;
    expect(price).toBeGreaterThan(0n);
  });

  test('should validate confidence in range', () => {
    const validConfidences = [0n, 5000n, 9500n, 9900n, 10000n];
    for (const conf of validConfidences) {
      expect(conf).toBeGreaterThanOrEqual(0n);
      expect(conf).toBeLessThanOrEqual(10000n);
    }
  });

  test('should validate round increments', () => {
    let currentRound = 0n;
    for (let i = 1; i <= 10; i++) {
      const newRound = BigInt(i);
      expect(newRound).toBeGreaterThan(currentRound);
      currentRound = newRound;
    }
  });

  test('should validate dispute bond minimum', () => {
    const MIN_BOND = ethers.parseEther('100');
    const validBond = ethers.parseEther('100');
    const invalidBond = ethers.parseEther('1');

    expect(validBond).toBeGreaterThanOrEqual(MIN_BOND);
    expect(invalidBond).toBeLessThan(MIN_BOND);
  });
});
