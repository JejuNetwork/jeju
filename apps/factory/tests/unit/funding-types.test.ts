/**
 * Unit tests for funding type parsing and conversion functions
 * Tests the enum-to-index and index-to-enum conversions in types/funding.ts
 */

import { describe, expect, test } from 'bun:test';
import {
  PAYMENT_CATEGORIES,
  PAYMENT_REQUEST_STATUSES,
  CONTRIBUTOR_TYPES,
  VERIFICATION_STATUSES,
  VOTE_TYPES,
  getPaymentCategoryIndex,
  parsePaymentCategory,
  getPaymentStatusIndex,
  parsePaymentStatus,
  getContributorTypeIndex,
  parseContributorType,
  getVerificationStatusIndex,
  parseVerificationStatus,
  getVoteTypeIndex,
  parseVoteType,
  MAX_BPS,
  DEPTH_DECAY_BPS,
  DEFAULT_EPOCH_DURATION,
  DEFAULT_SUPERMAJORITY_BPS,
  type PaymentCategory,
  type PaymentRequestStatus,
  type ContributorType,
  type VerificationStatus,
  type VoteType,
} from '../../types/funding';

describe('Payment Category Conversion', () => {
  test('getPaymentCategoryIndex returns correct index for all categories', () => {
    PAYMENT_CATEGORIES.forEach((category, expectedIndex) => {
      expect(getPaymentCategoryIndex(category)).toBe(expectedIndex);
    });
  });

  test('parsePaymentCategory returns correct category for all indices', () => {
    PAYMENT_CATEGORIES.forEach((expectedCategory, index) => {
      expect(parsePaymentCategory(index)).toBe(expectedCategory);
    });
  });

  test('parsePaymentCategory returns OTHER for out-of-bounds index', () => {
    expect(parsePaymentCategory(-1)).toBe('OTHER');
    expect(parsePaymentCategory(100)).toBe('OTHER');
    expect(parsePaymentCategory(PAYMENT_CATEGORIES.length)).toBe('OTHER');
  });

  test('getPaymentCategoryIndex returns -1 for invalid category', () => {
    expect(getPaymentCategoryIndex('INVALID' as PaymentCategory)).toBe(-1);
  });

  test('round-trip conversion preserves category', () => {
    const category: PaymentCategory = 'MARKETING';
    const index = getPaymentCategoryIndex(category);
    const parsed = parsePaymentCategory(index);
    expect(parsed).toBe(category);
  });

  test('all 11 payment categories are defined', () => {
    expect(PAYMENT_CATEGORIES).toHaveLength(11);
    expect(PAYMENT_CATEGORIES).toContain('MARKETING');
    expect(PAYMENT_CATEGORIES).toContain('COMMUNITY_MANAGEMENT');
    expect(PAYMENT_CATEGORIES).toContain('OPERATIONS');
    expect(PAYMENT_CATEGORIES).toContain('DOCUMENTATION');
    expect(PAYMENT_CATEGORIES).toContain('DESIGN');
    expect(PAYMENT_CATEGORIES).toContain('SUPPORT');
    expect(PAYMENT_CATEGORIES).toContain('RESEARCH');
    expect(PAYMENT_CATEGORIES).toContain('PARTNERSHIP');
    expect(PAYMENT_CATEGORIES).toContain('EVENTS');
    expect(PAYMENT_CATEGORIES).toContain('INFRASTRUCTURE');
    expect(PAYMENT_CATEGORIES).toContain('OTHER');
  });
});

describe('Payment Status Conversion', () => {
  test('getPaymentStatusIndex returns correct index for all statuses', () => {
    PAYMENT_REQUEST_STATUSES.forEach((status, expectedIndex) => {
      expect(getPaymentStatusIndex(status)).toBe(expectedIndex);
    });
  });

  test('parsePaymentStatus returns correct status for all indices', () => {
    PAYMENT_REQUEST_STATUSES.forEach((expectedStatus, index) => {
      expect(parsePaymentStatus(index)).toBe(expectedStatus);
    });
  });

  test('parsePaymentStatus returns SUBMITTED for out-of-bounds index', () => {
    expect(parsePaymentStatus(-1)).toBe('SUBMITTED');
    expect(parsePaymentStatus(100)).toBe('SUBMITTED');
    expect(parsePaymentStatus(PAYMENT_REQUEST_STATUSES.length)).toBe('SUBMITTED');
  });

  test('getPaymentStatusIndex returns -1 for invalid status', () => {
    expect(getPaymentStatusIndex('INVALID' as PaymentRequestStatus)).toBe(-1);
  });

  test('round-trip conversion preserves status', () => {
    const statuses: PaymentRequestStatus[] = ['SUBMITTED', 'COUNCIL_REVIEW', 'CEO_REVIEW', 'APPROVED', 'REJECTED', 'PAID', 'DISPUTED', 'CANCELLED'];
    statuses.forEach(status => {
      const index = getPaymentStatusIndex(status);
      const parsed = parsePaymentStatus(index);
      expect(parsed).toBe(status);
    });
  });

  test('all 8 payment statuses are defined', () => {
    expect(PAYMENT_REQUEST_STATUSES).toHaveLength(8);
  });
});

describe('Contributor Type Conversion', () => {
  test('getContributorTypeIndex returns correct index for all types', () => {
    CONTRIBUTOR_TYPES.forEach((type, expectedIndex) => {
      expect(getContributorTypeIndex(type)).toBe(expectedIndex);
    });
  });

  test('parseContributorType returns correct type for all indices', () => {
    CONTRIBUTOR_TYPES.forEach((expectedType, index) => {
      expect(parseContributorType(index)).toBe(expectedType);
    });
  });

  test('parseContributorType returns INDIVIDUAL for out-of-bounds index', () => {
    expect(parseContributorType(-1)).toBe('INDIVIDUAL');
    expect(parseContributorType(100)).toBe('INDIVIDUAL');
    expect(parseContributorType(CONTRIBUTOR_TYPES.length)).toBe('INDIVIDUAL');
  });

  test('getContributorTypeIndex returns -1 for invalid type', () => {
    expect(getContributorTypeIndex('INVALID' as ContributorType)).toBe(-1);
  });

  test('round-trip conversion preserves type', () => {
    const types: ContributorType[] = ['INDIVIDUAL', 'ORGANIZATION', 'PROJECT'];
    types.forEach(type => {
      const index = getContributorTypeIndex(type);
      const parsed = parseContributorType(index);
      expect(parsed).toBe(type);
    });
  });

  test('all 3 contributor types are defined', () => {
    expect(CONTRIBUTOR_TYPES).toHaveLength(3);
    expect(CONTRIBUTOR_TYPES).toContain('INDIVIDUAL');
    expect(CONTRIBUTOR_TYPES).toContain('ORGANIZATION');
    expect(CONTRIBUTOR_TYPES).toContain('PROJECT');
  });
});

describe('Verification Status Conversion', () => {
  test('getVerificationStatusIndex returns correct index for all statuses', () => {
    VERIFICATION_STATUSES.forEach((status, expectedIndex) => {
      expect(getVerificationStatusIndex(status)).toBe(expectedIndex);
    });
  });

  test('parseVerificationStatus returns correct status for all indices', () => {
    VERIFICATION_STATUSES.forEach((expectedStatus, index) => {
      expect(parseVerificationStatus(index)).toBe(expectedStatus);
    });
  });

  test('parseVerificationStatus returns UNVERIFIED for out-of-bounds index', () => {
    expect(parseVerificationStatus(-1)).toBe('UNVERIFIED');
    expect(parseVerificationStatus(100)).toBe('UNVERIFIED');
    expect(parseVerificationStatus(VERIFICATION_STATUSES.length)).toBe('UNVERIFIED');
  });

  test('getVerificationStatusIndex returns -1 for invalid status', () => {
    expect(getVerificationStatusIndex('INVALID' as VerificationStatus)).toBe(-1);
  });

  test('round-trip conversion preserves status', () => {
    const statuses: VerificationStatus[] = ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REVOKED'];
    statuses.forEach(status => {
      const index = getVerificationStatusIndex(status);
      const parsed = parseVerificationStatus(index);
      expect(parsed).toBe(status);
    });
  });

  test('all 4 verification statuses are defined', () => {
    expect(VERIFICATION_STATUSES).toHaveLength(4);
  });
});

describe('Vote Type Conversion', () => {
  test('getVoteTypeIndex returns correct index for all vote types', () => {
    VOTE_TYPES.forEach((voteType, expectedIndex) => {
      expect(getVoteTypeIndex(voteType)).toBe(expectedIndex);
    });
  });

  test('parseVoteType returns correct type for all indices', () => {
    VOTE_TYPES.forEach((expectedType, index) => {
      expect(parseVoteType(index)).toBe(expectedType);
    });
  });

  test('parseVoteType returns ABSTAIN for out-of-bounds index', () => {
    expect(parseVoteType(-1)).toBe('ABSTAIN');
    expect(parseVoteType(100)).toBe('ABSTAIN');
    expect(parseVoteType(VOTE_TYPES.length)).toBe('ABSTAIN');
  });

  test('getVoteTypeIndex returns -1 for invalid vote type', () => {
    expect(getVoteTypeIndex('INVALID' as VoteType)).toBe(-1);
  });

  test('round-trip conversion preserves vote type', () => {
    const voteTypes: VoteType[] = ['APPROVE', 'REJECT', 'ABSTAIN'];
    voteTypes.forEach(voteType => {
      const index = getVoteTypeIndex(voteType);
      const parsed = parseVoteType(index);
      expect(parsed).toBe(voteType);
    });
  });

  test('all 3 vote types are defined', () => {
    expect(VOTE_TYPES).toHaveLength(3);
    expect(VOTE_TYPES).toContain('APPROVE');
    expect(VOTE_TYPES).toContain('REJECT');
    expect(VOTE_TYPES).toContain('ABSTAIN');
  });
});

describe('Funding Constants', () => {
  test('MAX_BPS is 10000 (100%)', () => {
    expect(MAX_BPS).toBe(10000);
  });

  test('DEPTH_DECAY_BPS is 2000 (20%)', () => {
    expect(DEPTH_DECAY_BPS).toBe(2000);
  });

  test('DEFAULT_EPOCH_DURATION is 30 days in seconds', () => {
    const expectedSeconds = 30 * 24 * 60 * 60;
    expect(DEFAULT_EPOCH_DURATION).toBe(expectedSeconds);
  });

  test('DEFAULT_SUPERMAJORITY_BPS is 6700 (67%)', () => {
    expect(DEFAULT_SUPERMAJORITY_BPS).toBe(6700);
  });

  test('BPS calculations are correct for fee splits', () => {
    // Test that percentages can be calculated correctly from BPS
    const bps = 3000; // 30%
    const amount = BigInt(1000);
    const fee = (amount * BigInt(bps)) / BigInt(MAX_BPS);
    expect(fee).toBe(BigInt(300));
  });

  test('depth decay compounds correctly', () => {
    // Test depth decay: each level reduces by 20%
    const baseWeight = 10000;
    const depth1Weight = baseWeight - (baseWeight * DEPTH_DECAY_BPS / MAX_BPS);
    expect(depth1Weight).toBe(8000); // 80% of original

    const depth2Weight = depth1Weight - (depth1Weight * DEPTH_DECAY_BPS / MAX_BPS);
    expect(depth2Weight).toBe(6400); // 80% of 8000
  });
});
