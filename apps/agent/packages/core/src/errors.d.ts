/**
 * Shared error types and utilities for ElizaOS
 */
export declare enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_API_KEY = 'INVALID_API_KEY',
  INVALID_REQUEST = 'INVALID_REQUEST',
  MISSING_FIELD = 'MISSING_FIELD',
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  RATE_LIMITED = 'RATE_LIMITED',
}
export declare class ElizaError extends Error {
  code: ErrorCode;
  statusCode: number;
  details?: any;
  constructor(code: ErrorCode, message: string, statusCode?: number, details?: any);
}
export declare function createErrorResponse(error: unknown):
  | {
      error: {
        code: ErrorCode;
        message: string;
        details: any;
      };
      statusCode: number;
    }
  | {
      error: {
        code: ErrorCode;
        message: string;
        details?: undefined;
      };
      statusCode: number;
    };
