/**
 * Oracle utilities
 * Shared business logic for oracle-related operations
 */

import { DataSource } from 'typeorm';
import { OracleFeed, OracleReport } from '../model';
import { mapOracleFeedResponse, mapOracleReportResponse } from './response-utils';
import { NotFoundError } from './types';

import type { OracleFeedResponse, OracleReportResponse } from './response-utils';

export interface OracleFeedDetail {
  feed: OracleFeedResponse;
  recentReports: OracleReportResponse[];
}

export async function getOracleFeedDetail(
  dataSource: DataSource,
  feedId: string
): Promise<OracleFeedDetail> {
  if (!dataSource) {
    throw new Error('DataSource is required');
  }
  if (!feedId || typeof feedId !== 'string' || feedId.trim().length === 0) {
    throw new Error('feedId is required and must be a non-empty string');
  }

  const feed = await dataSource.getRepository(OracleFeed).findOne({ where: { feedId } });
  
  if (!feed) {
    throw new NotFoundError('Oracle Feed', feedId);
  }

  const recentReports = await dataSource.getRepository(OracleReport).find({
    where: { feed: { id: feed.id } },
    order: { submittedAt: 'DESC' },
    take: 10,
    relations: ['submittedBy', 'feed'],
  });

  return {
    feed: mapOracleFeedResponse(feed),
    recentReports: recentReports.map(mapOracleReportResponse),
  };
}
