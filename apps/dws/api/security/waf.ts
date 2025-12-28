import { createHash } from 'node:crypto'

export type ThreatType =
  | 'sqli'
  | 'xss'
  | 'path_traversal'
  | 'command_injection'
  | 'bot'
  | 'ddos'
  | 'rate_limit'
  | 'geo_block'
  | 'ip_reputation'
  | 'malformed_request'
  | 'protocol_violation'

export type WAFAction = 'allow' | 'block' | 'challenge' | 'log' | 'rate_limit'

export type RuleMode = 'detect' | 'block'

export interface WAFRule {
  ruleId: string
  name: string
  description: string
  enabled: boolean
  mode: RuleMode
  priority: number

  // Conditions
  conditions: RuleCondition[]

  // Action
  action: WAFAction
  blockDuration?: number // seconds

  // Stats
  matchCount: number
  lastMatchAt?: number
}

export interface RuleCondition {
  field:
    | 'ip'
    | 'path'
    | 'query'
    | 'body'
    | 'headers'
    | 'method'
    | 'user-agent'
    | 'country'
  operator:
    | 'equals'
    | 'contains'
    | 'matches'
    | 'in'
    | 'not_in'
    | 'starts_with'
    | 'ends_with'
  value: string | string[]
  negated?: boolean
}

export interface WAFDecision {
  action: WAFAction
  ruleId?: string
  ruleName?: string
  threatType?: ThreatType
  reason: string
  timestamp: number
}

export interface RateLimitConfig {
  requestsPerSecond: number
  burstSize: number
  windowSeconds: number
  blockDurationSeconds: number
}

export interface DDoSConfig {
  // Detection thresholds
  requestsPerSecondThreshold: number
  connectionThreshold: number
  bandwidthThreshold: number // bytes per second

  // Mitigation
  challengeOnSuspicious: boolean
  blockOnConfirmed: boolean
  mitigation: 'drop' | 'challenge' | 'rate_limit'
}

export interface IPReputationEntry {
  ip: string
  score: number // 0-100, lower is worse
  threats: ThreatType[]
  lastSeen: number
  blocked: boolean
  blockedUntil?: number
}

export interface SecurityEvent {
  eventId: string
  timestamp: number
  ip: string
  path: string
  method: string
  threatType: ThreatType
  action: WAFAction
  ruleId?: string
  details: string
  blocked: boolean
}

// SQL Injection patterns
const SQLI_PATTERNS = [
  /(%27)|(')|(--)|(%23)|(#)/i,
  /((%3D)|(=))[^\n]*((%27)|(')|(--)|(%3B)|(;))/i,
  /\w*((%27)|('))((%6F)|o|(%4F))((%72)|r|(%52))/i,
  /(((%27)|('))union)/i,
  /exec(\s|\+)+(s|x)p\w+/i,
  /UNION(\s+ALL)?\s+SELECT/i,
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i,
  /\bOR\b.+\b(1|true)\s*=\s*(1|true)/i,
  /\bAND\b.+\b(1|0)\s*=\s*(1|0)/i,
  /\bSLEEP\s*\(/i,
  /\bBENCHMARK\s*\(/i,
  /\bWAITFOR\b/i,
]

// XSS patterns
const XSS_PATTERNS = [
  /<script\b[^>]*>([\s\S]*?)<\/script>/i,
  /((%3C)|<)((%2F)|\/)*[a-z0-9%]+((%3E)|>)/i,
  /((%3C)|<)((%69)|i|(%49))((%6D)|m|(%4D))((%67)|g|(%47))/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /on\w+\s*=/i,
  /data\s*:/i,
  /expression\s*\(/i,
]

// Path traversal patterns
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e%2f/i,
  /%2e%2e\//i,
  /\.\.%2f/i,
  /%2e%2e%5c/i,
  /\.\.%5c/i,
  /%c0%ae%c0%ae\//i,
  /%c0%ae%c0%ae%5c/i,
]

// Command injection patterns
const COMMAND_INJECTION_PATTERNS = [
  /;\s*(ls|cat|rm|wget|curl|bash|sh|nc|python|perl|ruby|php)/i,
  /\|\s*(ls|cat|rm|wget|curl|bash|sh|nc|python|perl|ruby|php)/i,
  /\$\(/,
  /`[^`]+`/,
  /&&/,
  /\|\|/,
  />\s*\/dev\/null/,
  /2>&1/,
]

// Bot detection patterns
const BOT_PATTERNS = [
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /python-urllib/i,
  /go-http-client/i,
  /java\//i,
  /libwww-perl/i,
  /scrapy/i,
  /httpclient/i,
]

interface RateLimitBucket {
  tokens: number
  lastRefill: number
  requests: number[]
}

class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>()
  private config: RateLimitConfig
  private blocked = new Map<string, number>() // key -> blocked until timestamp

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now()

    // Check if blocked
    const blockedUntil = this.blocked.get(key)
    if (blockedUntil && blockedUntil > now) {
      return { allowed: false, remaining: 0, resetAt: blockedUntil }
    }

    // Get or create bucket
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = {
        tokens: this.config.burstSize,
        lastRefill: now,
        requests: [],
      }
      this.buckets.set(key, bucket)
    }

    // Refill tokens
    const elapsed = now - bucket.lastRefill
    const tokensToAdd = (elapsed / 1000) * this.config.requestsPerSecond
    bucket.tokens = Math.min(this.config.burstSize, bucket.tokens + tokensToAdd)
    bucket.lastRefill = now

    // Clean old requests
    const windowStart = now - this.config.windowSeconds * 1000
    bucket.requests = bucket.requests.filter((t) => t > windowStart)

    // Check limit
    if (bucket.tokens < 1) {
      this.blocked.set(key, now + this.config.blockDurationSeconds * 1000)
      return {
        allowed: false,
        remaining: 0,
        resetAt: now + this.config.blockDurationSeconds * 1000,
      }
    }

    // Consume token
    bucket.tokens--
    bucket.requests.push(now)

    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetAt: now + (1 / this.config.requestsPerSecond) * 1000,
    }
  }

  reset(key: string): void {
    this.buckets.delete(key)
    this.blocked.delete(key)
  }

  getStats(key: string): {
    requests: number
    blocked: boolean
    blockedUntil?: number
  } {
    const bucket = this.buckets.get(key)
    const blockedUntil = this.blocked.get(key)

    return {
      requests: bucket?.requests.length ?? 0,
      blocked: blockedUntil ? blockedUntil > Date.now() : false,
      blockedUntil,
    }
  }
}

interface DDoSStats {
  requestsPerSecond: number
  uniqueIPs: number
  connections: number
  bandwidth: number
}

class DDoSDetector {
  private config: DDoSConfig
  private requestTimes: number[] = []
  private uniqueIPs = new Set<string>()
  private connectionCount = 0
  private bandwidthBytes = 0
  private lastCheck = Date.now()
  private underAttack = false

  constructor(config: DDoSConfig) {
    this.config = config
  }

  recordRequest(ip: string, bytes: number): void {
    const now = Date.now()
    this.requestTimes.push(now)
    this.uniqueIPs.add(ip)
    this.bandwidthBytes += bytes

    // Clean old data (last second)
    const cutoff = now - 1000
    this.requestTimes = this.requestTimes.filter((t) => t > cutoff)
  }

  recordConnection(delta: number): void {
    this.connectionCount += delta
  }

  check(): { underAttack: boolean; stats: DDoSStats } {
    const now = Date.now()
    const elapsed = (now - this.lastCheck) / 1000
    this.lastCheck = now

    const stats: DDoSStats = {
      requestsPerSecond: this.requestTimes.length,
      uniqueIPs: this.uniqueIPs.size,
      connections: this.connectionCount,
      bandwidth: this.bandwidthBytes / elapsed,
    }

    // Reset counters
    this.uniqueIPs.clear()
    this.bandwidthBytes = 0

    // Check thresholds
    this.underAttack =
      stats.requestsPerSecond > this.config.requestsPerSecondThreshold ||
      stats.connections > this.config.connectionThreshold ||
      stats.bandwidth > this.config.bandwidthThreshold

    return { underAttack: this.underAttack, stats }
  }

  isUnderAttack(): boolean {
    return this.underAttack
  }
}

export class WebApplicationFirewall {
  private rules = new Map<string, WAFRule>()
  private ipReputation = new Map<string, IPReputationEntry>()
  private events: SecurityEvent[] = []
  private rateLimiter: RateLimiter
  private ddosDetector: DDoSDetector
  private blockedIPs = new Set<string>()
  private blockedCountries = new Set<string>()
  private whitelistedIPs = new Set<string>()

  constructor(config?: {
    rateLimit?: Partial<RateLimitConfig>
    ddos?: Partial<DDoSConfig>
  }) {
    this.rateLimiter = new RateLimiter({
      requestsPerSecond: config?.rateLimit?.requestsPerSecond ?? 100,
      burstSize: config?.rateLimit?.burstSize ?? 200,
      windowSeconds: config?.rateLimit?.windowSeconds ?? 60,
      blockDurationSeconds: config?.rateLimit?.blockDurationSeconds ?? 300,
    })

    this.ddosDetector = new DDoSDetector({
      requestsPerSecondThreshold:
        config?.ddos?.requestsPerSecondThreshold ?? 10000,
      connectionThreshold: config?.ddos?.connectionThreshold ?? 5000,
      bandwidthThreshold: config?.ddos?.bandwidthThreshold ?? 100 * 1024 * 1024,
      challengeOnSuspicious: config?.ddos?.challengeOnSuspicious ?? true,
      blockOnConfirmed: config?.ddos?.blockOnConfirmed ?? true,
      mitigation: config?.ddos?.mitigation ?? 'challenge',
    })

    // Load default rules
    this.loadDefaultRules()
  }

  private loadDefaultRules(): void {
    // SQL Injection protection
    this.addRule({
      name: 'SQL Injection Protection',
      description: 'Blocks common SQL injection patterns',
      enabled: true,
      mode: 'block',
      priority: 1,
      conditions: [],
      action: 'block',
    })

    // XSS protection
    this.addRule({
      name: 'XSS Protection',
      description: 'Blocks cross-site scripting attempts',
      enabled: true,
      mode: 'block',
      priority: 2,
      conditions: [],
      action: 'block',
    })

    // Path traversal protection
    this.addRule({
      name: 'Path Traversal Protection',
      description: 'Blocks directory traversal attempts',
      enabled: true,
      mode: 'block',
      priority: 3,
      conditions: [],
      action: 'block',
    })
  }

  async analyze(request: Request): Promise<WAFDecision> {
    const ip = this.getClientIP(request)
    const path = new URL(request.url).pathname
    const method = request.method
    const userAgent = request.headers.get('user-agent') ?? ''

    // Record for DDoS detection
    const contentLength = parseInt(
      request.headers.get('content-length') ?? '0',
      10,
    )
    this.ddosDetector.recordRequest(ip, contentLength)

    // Check whitelist
    if (this.whitelistedIPs.has(ip)) {
      return {
        action: 'allow',
        reason: 'Whitelisted IP',
        timestamp: Date.now(),
      }
    }

    // Check blocklist
    if (this.blockedIPs.has(ip)) {
      return this.createDecision('block', 'ip_reputation', 'Blocked IP')
    }

    // Check IP reputation
    const reputation = this.ipReputation.get(ip)
    if (reputation?.blocked) {
      if (reputation.blockedUntil && reputation.blockedUntil > Date.now()) {
        return this.createDecision(
          'block',
          'ip_reputation',
          'IP temporarily blocked',
        )
      }
    }

    // Rate limiting
    const rateCheck = this.rateLimiter.check(ip)
    if (!rateCheck.allowed) {
      this.recordEvent(
        ip,
        path,
        method,
        'rate_limit',
        'block',
        'Rate limit exceeded',
        true,
      )
      return this.createDecision('block', 'rate_limit', 'Rate limit exceeded')
    }

    // DDoS check
    if (this.ddosDetector.isUnderAttack()) {
      // More aggressive checking during attack
      return this.createDecision('challenge', 'ddos', 'DDoS mitigation active')
    }

    // Bot detection
    if (this.isBot(userAgent)) {
      this.recordEvent(
        ip,
        path,
        method,
        'bot',
        'log',
        `Bot detected: ${userAgent}`,
        false,
      )
      // Could block or challenge depending on policy
    }

    // SQL Injection check
    const sqliCheck = await this.checkSQLi(request)
    if (sqliCheck.detected) {
      this.recordEvent(
        ip,
        path,
        method,
        'sqli',
        'block',
        sqliCheck.pattern,
        true,
      )
      this.updateReputation(ip, 'sqli')
      return this.createDecision('block', 'sqli', 'SQL injection detected')
    }

    // XSS check
    const xssCheck = await this.checkXSS(request)
    if (xssCheck.detected) {
      this.recordEvent(ip, path, method, 'xss', 'block', xssCheck.pattern, true)
      this.updateReputation(ip, 'xss')
      return this.createDecision('block', 'xss', 'XSS attempt detected')
    }

    // Path traversal check
    if (this.checkPathTraversal(path)) {
      this.recordEvent(
        ip,
        path,
        method,
        'path_traversal',
        'block',
        'Path traversal attempt',
        true,
      )
      this.updateReputation(ip, 'path_traversal')
      return this.createDecision(
        'block',
        'path_traversal',
        'Path traversal detected',
      )
    }

    // Command injection check
    const cmdCheck = await this.checkCommandInjection(request)
    if (cmdCheck.detected) {
      this.recordEvent(
        ip,
        path,
        method,
        'command_injection',
        'block',
        cmdCheck.pattern,
        true,
      )
      this.updateReputation(ip, 'command_injection')
      return this.createDecision(
        'block',
        'command_injection',
        'Command injection detected',
      )
    }

    // Custom rules
    for (const rule of Array.from(this.rules.values()).sort(
      (a, b) => a.priority - b.priority,
    )) {
      if (!rule.enabled) continue

      if (this.matchesRule(request, rule)) {
        rule.matchCount++
        rule.lastMatchAt = Date.now()

        if (rule.mode === 'block') {
          this.recordEvent(
            ip,
            path,
            method,
            'malformed_request',
            rule.action,
            rule.name,
            rule.action === 'block',
          )
          return this.createDecision(
            rule.action,
            undefined,
            rule.name,
            rule.ruleId,
            rule.name,
          )
        }
      }
    }

    return {
      action: 'allow',
      reason: 'Passed all checks',
      timestamp: Date.now(),
    }
  }

  private createDecision(
    action: WAFAction,
    threatType?: ThreatType,
    reason?: string,
    ruleId?: string,
    ruleName?: string,
  ): WAFDecision {
    return {
      action,
      threatType,
      reason: reason ?? '',
      ruleId,
      ruleName,
      timestamp: Date.now(),
    }
  }

  private async checkSQLi(
    request: Request,
  ): Promise<{ detected: boolean; pattern: string }> {
    const url = new URL(request.url)
    const query = url.search

    // Check query string
    for (const pattern of SQLI_PATTERNS) {
      if (pattern.test(query)) {
        return { detected: true, pattern: pattern.source }
      }
    }

    // Check body for POST requests
    if (request.method === 'POST' || request.method === 'PUT') {
      try {
        const body = await request.clone().text()
        for (const pattern of SQLI_PATTERNS) {
          if (pattern.test(body)) {
            return { detected: true, pattern: pattern.source }
          }
        }
      } catch {
        // Ignore body parsing errors
      }
    }

    return { detected: false, pattern: '' }
  }

  private async checkXSS(
    request: Request,
  ): Promise<{ detected: boolean; pattern: string }> {
    const url = new URL(request.url)
    const query = url.search

    for (const pattern of XSS_PATTERNS) {
      if (pattern.test(query)) {
        return { detected: true, pattern: pattern.source }
      }
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      try {
        const body = await request.clone().text()
        for (const pattern of XSS_PATTERNS) {
          if (pattern.test(body)) {
            return { detected: true, pattern: pattern.source }
          }
        }
      } catch {
        // Ignore
      }
    }

    return { detected: false, pattern: '' }
  }

  private checkPathTraversal(path: string): boolean {
    for (const pattern of PATH_TRAVERSAL_PATTERNS) {
      if (pattern.test(path)) return true
    }
    return false
  }

  private async checkCommandInjection(
    request: Request,
  ): Promise<{ detected: boolean; pattern: string }> {
    const url = new URL(request.url)
    const query = url.search

    for (const pattern of COMMAND_INJECTION_PATTERNS) {
      if (pattern.test(query)) {
        return { detected: true, pattern: pattern.source }
      }
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      try {
        const body = await request.clone().text()
        for (const pattern of COMMAND_INJECTION_PATTERNS) {
          if (pattern.test(body)) {
            return { detected: true, pattern: pattern.source }
          }
        }
      } catch {
        // Ignore
      }
    }

    return { detected: false, pattern: '' }
  }

  private isBot(userAgent: string): boolean {
    for (const pattern of BOT_PATTERNS) {
      if (pattern.test(userAgent)) return true
    }
    return false
  }

  private matchesRule(request: Request, rule: WAFRule): boolean {
    const url = new URL(request.url)

    for (const condition of rule.conditions) {
      let value: string

      switch (condition.field) {
        case 'ip':
          value = this.getClientIP(request)
          break
        case 'path':
          value = url.pathname
          break
        case 'query':
          value = url.search
          break
        case 'method':
          value = request.method
          break
        case 'user-agent':
          value = request.headers.get('user-agent') ?? ''
          break
        case 'headers':
          value = JSON.stringify(Object.fromEntries(request.headers.entries()))
          break
        default:
          continue
      }

      let matches = false

      switch (condition.operator) {
        case 'equals':
          matches = value === condition.value
          break
        case 'contains':
          matches = value.includes(condition.value as string)
          break
        case 'matches':
          matches = new RegExp(condition.value as string).test(value)
          break
        case 'in':
          matches = (condition.value as string[]).includes(value)
          break
        case 'not_in':
          matches = !(condition.value as string[]).includes(value)
          break
        case 'starts_with':
          matches = value.startsWith(condition.value as string)
          break
        case 'ends_with':
          matches = value.endsWith(condition.value as string)
          break
      }

      if (condition.negated) matches = !matches
      if (!matches) return false
    }

    return true
  }

  private getClientIP(request: Request): string {
    return (
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      request.headers.get('x-real-ip') ??
      'unknown'
    )
  }

  blockIP(ip: string, duration?: number): void {
    if (duration) {
      const entry = this.ipReputation.get(ip) ?? {
        ip,
        score: 0,
        threats: [],
        lastSeen: Date.now(),
        blocked: false,
      }
      entry.blocked = true
      entry.blockedUntil = Date.now() + duration * 1000
      this.ipReputation.set(ip, entry)
    } else {
      this.blockedIPs.add(ip)
    }
  }

  unblockIP(ip: string): void {
    this.blockedIPs.delete(ip)
    const entry = this.ipReputation.get(ip)
    if (entry) {
      entry.blocked = false
      entry.blockedUntil = undefined
    }
  }

  whitelistIP(ip: string): void {
    this.whitelistedIPs.add(ip)
    this.blockedIPs.delete(ip)
  }

  removeWhitelist(ip: string): void {
    this.whitelistedIPs.delete(ip)
  }

  blockCountry(countryCode: string): void {
    this.blockedCountries.add(countryCode.toUpperCase())
  }

  unblockCountry(countryCode: string): void {
    this.blockedCountries.delete(countryCode.toUpperCase())
  }

  private updateReputation(ip: string, threat: ThreatType): void {
    const entry = this.ipReputation.get(ip) ?? {
      ip,
      score: 100,
      threats: [],
      lastSeen: Date.now(),
      blocked: false,
    }

    entry.score = Math.max(0, entry.score - 20)
    if (!entry.threats.includes(threat)) {
      entry.threats.push(threat)
    }
    entry.lastSeen = Date.now()

    // Auto-block if score too low
    if (entry.score <= 20) {
      entry.blocked = true
      entry.blockedUntil = Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    }

    this.ipReputation.set(ip, entry)
  }

  addRule(
    rule: Omit<WAFRule, 'ruleId' | 'matchCount' | 'lastMatchAt'>,
  ): WAFRule {
    const ruleId = createHash('sha256')
      .update(`${rule.name}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const fullRule: WAFRule = { ...rule, ruleId, matchCount: 0 }
    this.rules.set(ruleId, fullRule)

    return fullRule
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId)
  }

  enableRule(ruleId: string): void {
    const rule = this.rules.get(ruleId)
    if (rule) rule.enabled = true
  }

  disableRule(ruleId: string): void {
    const rule = this.rules.get(ruleId)
    if (rule) rule.enabled = false
  }

  private recordEvent(
    ip: string,
    path: string,
    method: string,
    threatType: ThreatType,
    action: WAFAction,
    details: string,
    blocked: boolean,
    ruleId?: string,
  ): void {
    const event: SecurityEvent = {
      eventId: createHash('sha256')
        .update(`${ip}-${Date.now()}-${Math.random()}`)
        .digest('hex')
        .slice(0, 16),
      timestamp: Date.now(),
      ip,
      path,
      method,
      threatType,
      action,
      ruleId,
      details,
      blocked,
    }

    this.events.push(event)

    // Keep only last 10000 events
    while (this.events.length > 10000) {
      this.events.shift()
    }
  }

  getEvents(options?: {
    ip?: string
    threatType?: ThreatType
    startTime?: number
    endTime?: number
    limit?: number
  }): SecurityEvent[] {
    let events = this.events

    if (options?.ip) {
      events = events.filter((e) => e.ip === options.ip)
    }

    if (options?.threatType) {
      events = events.filter((e) => e.threatType === options.threatType)
    }

    if (options?.startTime) {
      events = events.filter((e) => e.timestamp >= (options.startTime ?? 0))
    }

    if (options?.endTime) {
      events = events.filter(
        (e) => e.timestamp <= (options.endTime ?? Infinity),
      )
    }

    return events.slice(-(options?.limit ?? 100))
  }

  getStats(): {
    blockedRequests: number
    threatsByType: Record<ThreatType, number>
    topBlockedIPs: Array<{ ip: string; count: number }>
    ddosStatus: { underAttack: boolean }
  } {
    const blockedEvents = this.events.filter((e) => e.blocked)

    const threatsByType: Record<ThreatType, number> = {
      sqli: 0,
      xss: 0,
      path_traversal: 0,
      command_injection: 0,
      bot: 0,
      ddos: 0,
      rate_limit: 0,
      geo_block: 0,
      ip_reputation: 0,
      malformed_request: 0,
      protocol_violation: 0,
    }

    for (const event of blockedEvents) {
      threatsByType[event.threatType]++
    }

    const ipCounts = new Map<string, number>()
    for (const event of blockedEvents) {
      ipCounts.set(event.ip, (ipCounts.get(event.ip) ?? 0) + 1)
    }

    const topBlockedIPs = Array.from(ipCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }))

    return {
      blockedRequests: blockedEvents.length,
      threatsByType,
      topBlockedIPs,
      ddosStatus: { underAttack: this.ddosDetector.isUnderAttack() },
    }
  }

  listRules(): WAFRule[] {
    return Array.from(this.rules.values())
  }

  getIPReputation(ip: string): IPReputationEntry | undefined {
    return this.ipReputation.get(ip)
  }
}

let waf: WebApplicationFirewall | null = null

export function getWAF(): WebApplicationFirewall {
  if (!waf) {
    waf = new WebApplicationFirewall()
  }
  return waf
}
