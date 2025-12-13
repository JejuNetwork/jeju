import { describe, it, expect } from 'bun:test';

interface SearchParams {
  query?: string;
  endpointType?: string;
  tags?: string | string[];
  category?: string;
  minStakeTier?: string | number;
  verified?: string | boolean;
  active?: string | boolean;
  limit?: string | number;
  offset?: string | number;
}

interface ValidatedSearchParams {
  query?: string;
  endpointType: 'a2a' | 'mcp' | 'rest' | 'graphql' | 'all';
  tags: string[];
  category?: string;
  minStakeTier: number;
  verified: boolean;
  active: boolean;
  limit: number;
  offset: number;
}

function validateSearchParams(raw: SearchParams): ValidatedSearchParams {
  const validEndpointTypes = ['a2a', 'mcp', 'rest', 'graphql', 'all'];
  
  // Parse endpoint type
  const endpointType = validEndpointTypes.includes(raw.endpointType || '')
    ? raw.endpointType as ValidatedSearchParams['endpointType']
    : 'all';

  // Parse tags (can be string or array)
  let tags: string[] = [];
  if (Array.isArray(raw.tags)) {
    tags = raw.tags.filter(t => typeof t === 'string' && t.trim());
  } else if (typeof raw.tags === 'string' && raw.tags.trim()) {
    tags = raw.tags.split(',').map(t => t.trim()).filter(Boolean);
  }

  // Parse numeric values
  const minStakeTier = Math.max(0, Math.min(4, parseInt(String(raw.minStakeTier || '0'), 10) || 0));
  const limit = Math.max(1, Math.min(1000, parseInt(String(raw.limit || '50'), 10) || 50));
  const offset = Math.max(0, parseInt(String(raw.offset || '0'), 10) || 0);

  // Parse boolean values
  const parseBoolean = (val: string | boolean | undefined, defaultVal: boolean): boolean => {
    if (typeof val === 'boolean') return val;
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    return defaultVal;
  };

  return {
    query: raw.query?.trim() || undefined,
    endpointType,
    tags,
    category: raw.category?.trim() || undefined,
    minStakeTier,
    verified: parseBoolean(raw.verified, false),
    active: parseBoolean(raw.active, true),
    limit,
    offset,
  };
}

describe('Search Parameter Validation', () => {
  describe('Query String', () => {
    it('should trim whitespace', () => {
      const result = validateSearchParams({ query: '  hello world  ' });
      expect(result.query).toBe('hello world');
    });

    it('should return undefined for empty query', () => {
      expect(validateSearchParams({ query: '' }).query).toBeUndefined();
      expect(validateSearchParams({ query: '   ' }).query).toBeUndefined();
      expect(validateSearchParams({}).query).toBeUndefined();
    });

    it('should preserve special characters in query', () => {
      const result = validateSearchParams({ query: 'DeFi $ETH @user' });
      expect(result.query).toBe('DeFi $ETH @user');
    });
  });

  describe('Endpoint Type', () => {
    it('should accept valid endpoint types', () => {
      expect(validateSearchParams({ endpointType: 'a2a' }).endpointType).toBe('a2a');
      expect(validateSearchParams({ endpointType: 'mcp' }).endpointType).toBe('mcp');
      expect(validateSearchParams({ endpointType: 'rest' }).endpointType).toBe('rest');
      expect(validateSearchParams({ endpointType: 'graphql' }).endpointType).toBe('graphql');
      expect(validateSearchParams({ endpointType: 'all' }).endpointType).toBe('all');
    });

    it('should default to all for invalid types', () => {
      expect(validateSearchParams({ endpointType: 'invalid' }).endpointType).toBe('all');
      expect(validateSearchParams({ endpointType: '' }).endpointType).toBe('all');
      expect(validateSearchParams({}).endpointType).toBe('all');
    });

    it('should handle case sensitivity', () => {
      // Our implementation is case-sensitive, should default to 'all' for wrong case
      expect(validateSearchParams({ endpointType: 'A2A' }).endpointType).toBe('all');
    });
  });

  describe('Tags', () => {
    it('should parse comma-separated string', () => {
      const result = validateSearchParams({ tags: 'agent,defi,nft' });
      expect(result.tags).toEqual(['agent', 'defi', 'nft']);
    });

    it('should accept array of tags', () => {
      const result = validateSearchParams({ tags: ['agent', 'defi', 'nft'] });
      expect(result.tags).toEqual(['agent', 'defi', 'nft']);
    });

    it('should trim tag values', () => {
      const result = validateSearchParams({ tags: ' agent , defi , nft ' });
      expect(result.tags).toEqual(['agent', 'defi', 'nft']);
    });

    it('should filter empty tags', () => {
      const result = validateSearchParams({ tags: 'agent,,defi,,,nft' });
      expect(result.tags).toEqual(['agent', 'defi', 'nft']);
    });

    it('should return empty array for empty tags', () => {
      expect(validateSearchParams({ tags: '' }).tags).toEqual([]);
      expect(validateSearchParams({ tags: [] }).tags).toEqual([]);
      expect(validateSearchParams({}).tags).toEqual([]);
    });
  });

  describe('Stake Tier', () => {
    it('should parse valid tier values', () => {
      expect(validateSearchParams({ minStakeTier: '0' }).minStakeTier).toBe(0);
      expect(validateSearchParams({ minStakeTier: '2' }).minStakeTier).toBe(2);
      expect(validateSearchParams({ minStakeTier: '4' }).minStakeTier).toBe(4);
      expect(validateSearchParams({ minStakeTier: 3 }).minStakeTier).toBe(3);
    });

    it('should clamp to valid range', () => {
      expect(validateSearchParams({ minStakeTier: '-1' }).minStakeTier).toBe(0);
      expect(validateSearchParams({ minStakeTier: '5' }).minStakeTier).toBe(4);
      expect(validateSearchParams({ minStakeTier: '100' }).minStakeTier).toBe(4);
    });

    it('should default to 0 for invalid values', () => {
      expect(validateSearchParams({ minStakeTier: 'invalid' }).minStakeTier).toBe(0);
      expect(validateSearchParams({ minStakeTier: '' }).minStakeTier).toBe(0);
      expect(validateSearchParams({}).minStakeTier).toBe(0);
    });
  });

  describe('Limit and Offset', () => {
    it('should parse valid limit values', () => {
      expect(validateSearchParams({ limit: '10' }).limit).toBe(10);
      expect(validateSearchParams({ limit: 100 }).limit).toBe(100);
    });

    it('should clamp limit to valid range', () => {
      // Note: '0' is falsy so falls back to default 50, then clamped to min 1
      expect(validateSearchParams({ limit: '0' }).limit).toBe(50);
      expect(validateSearchParams({ limit: '-10' }).limit).toBe(1);
      expect(validateSearchParams({ limit: '5000' }).limit).toBe(1000);
    });

    it('should default limit to 50', () => {
      expect(validateSearchParams({}).limit).toBe(50);
      expect(validateSearchParams({ limit: 'invalid' }).limit).toBe(50);
    });

    it('should parse valid offset values', () => {
      expect(validateSearchParams({ offset: '0' }).offset).toBe(0);
      expect(validateSearchParams({ offset: '100' }).offset).toBe(100);
      expect(validateSearchParams({ offset: 50 }).offset).toBe(50);
    });

    it('should clamp negative offset to 0', () => {
      expect(validateSearchParams({ offset: '-10' }).offset).toBe(0);
    });

    it('should default offset to 0', () => {
      expect(validateSearchParams({}).offset).toBe(0);
      expect(validateSearchParams({ offset: 'invalid' }).offset).toBe(0);
    });
  });

  describe('Boolean Flags', () => {
    it('should parse true values', () => {
      expect(validateSearchParams({ verified: 'true' }).verified).toBe(true);
      expect(validateSearchParams({ verified: '1' }).verified).toBe(true);
      expect(validateSearchParams({ verified: true }).verified).toBe(true);
    });

    it('should parse false values', () => {
      expect(validateSearchParams({ verified: 'false' }).verified).toBe(false);
      expect(validateSearchParams({ verified: '0' }).verified).toBe(false);
      expect(validateSearchParams({ verified: false }).verified).toBe(false);
    });

    it('should use defaults for invalid values', () => {
      expect(validateSearchParams({ verified: 'invalid' }).verified).toBe(false); // default false
      expect(validateSearchParams({ active: 'invalid' }).active).toBe(true); // default true
    });

    it('should handle missing values with defaults', () => {
      const result = validateSearchParams({});
      expect(result.verified).toBe(false);
      expect(result.active).toBe(true);
    });
  });
});

describe('Agent ID Validation', () => {
  const isValidAgentId = (id: string): boolean => {
    if (!id || id.trim() === '') return false;
    const num = parseInt(id, 10);
    return !isNaN(num) && num >= 0 && String(num) === id.trim();
  };

  it('should accept valid agent IDs', () => {
    expect(isValidAgentId('0')).toBe(true);
    expect(isValidAgentId('1')).toBe(true);
    expect(isValidAgentId('123')).toBe(true);
    expect(isValidAgentId('9999999')).toBe(true);
  });

  it('should reject invalid agent IDs', () => {
    expect(isValidAgentId('')).toBe(false);
    expect(isValidAgentId('  ')).toBe(false);
    expect(isValidAgentId('abc')).toBe(false);
    expect(isValidAgentId('-1')).toBe(false);
    expect(isValidAgentId('1.5')).toBe(false);
    expect(isValidAgentId('1e5')).toBe(false);
  });
});

describe('Service ID Validation', () => {
  interface ParsedServiceId {
    type: 'compute' | 'storage' | null;
    address: string | null;
  }

  const parseServiceId = (serviceId: string): ParsedServiceId => {
    const parts = serviceId.split('-');
    if (parts.length !== 2) return { type: null, address: null };
    
    const [type, address] = parts;
    if (type !== 'compute' && type !== 'storage') return { type: null, address: null };
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return { type: null, address: null };
    
    return { type, address: address.toLowerCase() };
  };

  it('should parse valid compute service IDs', () => {
    const result = parseServiceId('compute-0x1234567890abcdef1234567890abcdef12345678');
    expect(result.type).toBe('compute');
    expect(result.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('should parse valid storage service IDs', () => {
    const result = parseServiceId('storage-0xabcdef1234567890abcdef1234567890abcdef12');
    expect(result.type).toBe('storage');
    expect(result.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('should reject invalid service IDs', () => {
    expect(parseServiceId('').type).toBeNull();
    expect(parseServiceId('invalid').type).toBeNull();
    expect(parseServiceId('compute').type).toBeNull();
    expect(parseServiceId('compute-').type).toBeNull();
    expect(parseServiceId('compute-invalid').type).toBeNull();
    expect(parseServiceId('unknown-0x1234567890abcdef1234567890abcdef12345678').type).toBeNull();
    expect(parseServiceId('-0x1234567890abcdef1234567890abcdef12345678').type).toBeNull();
  });

  it('should lowercase addresses', () => {
    const result = parseServiceId('compute-0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    expect(result.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });
});

describe('A2A Request Validation', () => {
  interface A2ATaskRequest {
    id: string;
    method: 'tasks/send' | 'tasks/get' | 'tasks/cancel';
    params?: {
      task_id?: string;
      content?: string;
      skills?: string[];
    };
  }

  const validateA2ARequest = (body: Record<string, unknown>): { valid: boolean; error?: string } => {
    if (!body.id || typeof body.id !== 'string') {
      return { valid: false, error: 'Missing or invalid request id' };
    }

    const validMethods = ['tasks/send', 'tasks/get', 'tasks/cancel'];
    if (!validMethods.includes(body.method as string)) {
      return { valid: false, error: `Invalid method. Must be one of: ${validMethods.join(', ')}` };
    }

    if (body.method === 'tasks/send') {
      const params = body.params as Record<string, unknown> | undefined;
      if (!params?.content || typeof params.content !== 'string') {
        return { valid: false, error: 'tasks/send requires params.content string' };
      }
    }

    if (body.method === 'tasks/get' || body.method === 'tasks/cancel') {
      const params = body.params as Record<string, unknown> | undefined;
      if (!params?.task_id || typeof params.task_id !== 'string') {
        return { valid: false, error: `${body.method} requires params.task_id string` };
      }
    }

    return { valid: true };
  };

  it('should validate tasks/send request', () => {
    const valid = validateA2ARequest({
      id: '1',
      method: 'tasks/send',
      params: { content: 'Hello agent' },
    });
    expect(valid.valid).toBe(true);
  });

  it('should validate tasks/get request', () => {
    const valid = validateA2ARequest({
      id: '1',
      method: 'tasks/get',
      params: { task_id: 'task-123' },
    });
    expect(valid.valid).toBe(true);
  });

  it('should reject missing id', () => {
    const result = validateA2ARequest({ method: 'tasks/send', params: { content: 'test' } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('id');
  });

  it('should reject invalid method', () => {
    const result = validateA2ARequest({ id: '1', method: 'invalid' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid method');
  });

  it('should reject tasks/send without content', () => {
    const result = validateA2ARequest({ id: '1', method: 'tasks/send', params: {} });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('content');
  });

  it('should reject tasks/get without task_id', () => {
    const result = validateA2ARequest({ id: '1', method: 'tasks/get', params: {} });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('task_id');
  });
});

describe('MCP Request Validation', () => {
  interface MCPRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
  }

  const validateMCPRequest = (body: Record<string, unknown>): { valid: boolean; error?: string } => {
    if (body.jsonrpc !== '2.0') {
      return { valid: false, error: 'jsonrpc must be "2.0"' };
    }

    if (!body.id || (typeof body.id !== 'string' && typeof body.id !== 'number')) {
      return { valid: false, error: 'id must be a string or number' };
    }

    if (!body.method || typeof body.method !== 'string') {
      return { valid: false, error: 'method must be a string' };
    }

    return { valid: true };
  };

  it('should validate correct MCP request', () => {
    const result = validateMCPRequest({
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/list',
    });
    expect(result.valid).toBe(true);
  });

  it('should accept numeric id', () => {
    const result = validateMCPRequest({
      jsonrpc: '2.0',
      id: 123,
      method: 'tools/call',
      params: { name: 'search', arguments: {} },
    });
    expect(result.valid).toBe(true);
  });

  it('should reject wrong jsonrpc version', () => {
    const result = validateMCPRequest({
      jsonrpc: '1.0',
      id: '1',
      method: 'tools/list',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('jsonrpc');
  });

  it('should reject missing method', () => {
    const result = validateMCPRequest({
      jsonrpc: '2.0',
      id: '1',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('method');
  });
});

describe('HTTP Error Response Formats', () => {
  interface ErrorResponse {
    error: string;
    message?: string;
    code?: number;
    details?: Record<string, unknown>;
  }

  const createErrorResponse = (status: number, message: string, details?: Record<string, unknown>): ErrorResponse => {
    return {
      error: status >= 500 ? 'Internal Server Error' : 'Bad Request',
      message,
      code: status,
      ...(details && { details }),
    };
  };

  it('should format 400 errors', () => {
    const error = createErrorResponse(400, 'Invalid query parameter');
    expect(error.error).toBe('Bad Request');
    expect(error.code).toBe(400);
    expect(error.message).toBe('Invalid query parameter');
  });

  it('should format 404 errors', () => {
    const error = createErrorResponse(404, 'Agent not found');
    expect(error.error).toBe('Bad Request');
    expect(error.code).toBe(404);
  });

  it('should format 500 errors', () => {
    const error = createErrorResponse(500, 'Database connection failed');
    expect(error.error).toBe('Internal Server Error');
    expect(error.code).toBe(500);
  });

  it('should include details when provided', () => {
    const error = createErrorResponse(400, 'Validation failed', {
      field: 'limit',
      expected: 'number between 1-1000',
      received: '-5',
    });
    expect(error.details).toBeDefined();
    expect(error.details?.field).toBe('limit');
  });
});

describe('Pagination Validation', () => {
  interface PaginationParams {
    page?: number;
    perPage?: number;
  }

  interface ValidatedPagination {
    limit: number;
    offset: number;
  }

  const validatePagination = (params: PaginationParams): ValidatedPagination => {
    const page = Math.max(1, params.page || 1);
    const perPage = Math.max(1, Math.min(100, params.perPage || 20));
    
    return {
      limit: perPage,
      offset: (page - 1) * perPage,
    };
  };

  it('should calculate correct offset for page 1', () => {
    const result = validatePagination({ page: 1, perPage: 20 });
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(20);
  });

  it('should calculate correct offset for page 2', () => {
    const result = validatePagination({ page: 2, perPage: 20 });
    expect(result.offset).toBe(20);
  });

  it('should calculate correct offset for page 5 with 50 per page', () => {
    const result = validatePagination({ page: 5, perPage: 50 });
    expect(result.offset).toBe(200);
    expect(result.limit).toBe(50);
  });

  it('should handle page 0 as page 1', () => {
    const result = validatePagination({ page: 0, perPage: 20 });
    expect(result.offset).toBe(0);
  });

  it('should handle negative page as page 1', () => {
    const result = validatePagination({ page: -5, perPage: 20 });
    expect(result.offset).toBe(0);
  });

  it('should cap perPage at 100', () => {
    const result = validatePagination({ page: 1, perPage: 500 });
    expect(result.limit).toBe(100);
  });

  it('should default to page 1 and 20 per page', () => {
    const result = validatePagination({});
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(20);
  });
});
