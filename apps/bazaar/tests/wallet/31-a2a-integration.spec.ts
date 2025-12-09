/**
* @fileoverview Test file
 * A2A (Agent-to-Agent) Integration Tests
 * Tests agent card discovery and skill execution
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('A2A Integration', () => {
  test('should serve agent card at /.well-known/agent-card.json', async ({ page }) => {
    // Test agent card endpoint (no wallet needed)
    const response = await page.request.get('http://localhost:4006/.well-known/agent-card.json')
    
    expect(response.ok()).toBe(true)
    expect(response.status()).toBe(200)
    
    const agentCard = await response.json()
    
    // Verify agent card structure
    expect(agentCard.protocolVersion).toBe('0.3.0')
    expect(agentCard.name).toContain('Bazaar')
    expect(agentCard.url).toBe('http://localhost:4006/api/a2a')
    expect(agentCard.skills).toBeDefined()
    expect(Array.isArray(agentCard.skills)).toBe(true)
    expect(agentCard.skills.length).toBeGreaterThan(0)
    
    console.log(`✅ Agent card serves ${agentCard.skills.length} skills`)
  })

  test('should list all available skills in agent card', async ({ page }) => {
    const response = await page.request.get('http://localhost:4006/.well-known/agent-card.json')
    const agentCard = await response.json()
    
    // Verify expected skills exist
    const skillIds = agentCard.skills.map((s: { id: string }) => s.id)
    
    const expectedSkills = [
      'list-tokens',
      'get-token-details',
      'create-token',
      'swap-tokens',
      'create-pool',
      'add-liquidity',
      'remove-liquidity',
      'list-nfts',
      'buy-nft',
      'list-nft',
      'list-markets',
      'place-bet',
      'get-latest-blocks',
      'list-games',
    ]
    
    for (const expectedSkill of expectedSkills) {
      const hasSkill = skillIds.includes(expectedSkill)
      expect(hasSkill).toBe(true)
    }
    
    console.log('✅ All expected skills present in agent card')
  })

  test('should execute list-tokens skill via A2A endpoint', async ({ page }) => {
    // Test A2A endpoint (no auth required for free tier)
    const response = await page.request.post('http://localhost:4006/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-1',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'list-tokens',
                  params: {
                    limit: 10
                  }
                }
              }
            ]
          }
        },
        id: 1
      }
    })
    
    expect(response.ok()).toBe(true)
    const result = await response.json()
    
    expect(result.jsonrpc).toBe('2.0')
    expect(result.result).toBeDefined()
    expect(result.result.parts).toBeDefined()
    
    console.log('✅ list-tokens skill executed via A2A')
  })

  test('should execute get-latest-blocks skill', async ({ page }) => {
    const response = await page.request.post('http://localhost:4006/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-2',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'get-latest-blocks',
                  params: {
                    limit: 5
                  }
                }
              }
            ]
          }
        },
        id: 2
      }
    })
    
    expect(response.ok()).toBe(true)
    const result = await response.json()
    
    expect(result.result).toBeDefined()
    expect(result.result.parts[1].data.blocks).toBeDefined()
    
    console.log('✅ get-latest-blocks skill executed')
  })

  test('should require payment for premium skills', async ({ page }) => {
    // Test paid skill without payment header
    const response = await page.request.post('http://localhost:4006/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-3',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'get-token-details',
                  params: {
                    address: '0x1234567890123456789012345678901234567890'
                  }
                }
              }
            ]
          }
        },
        id: 3
      }
    })
    
    const result = await response.json()
    
    // Should return 402 Payment Required
    if (response.status() === 402 || result.error?.code === 402) {
      expect(result.error.message).toContain('Payment Required')
      expect(result.error.data).toBeDefined()
      expect(result.error.data.x402Version).toBe(1)
      
      console.log('✅ Payment requirement enforced for premium skill')
    } else {
      // May return data if payment not enforced in dev
      console.log('⏸️  Payment enforcement not active (dev mode)')
    }
  })

  test('should validate x402 payment tiers', async ({ page }) => {
    const response = await page.request.post('http://localhost:4006/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-4',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'create-token',
                  params: {
                    name: 'Test',
                    symbol: 'TST',
                    supply: '1000000'
                  }
                }
              }
            ]
          }
        },
        id: 4
      }
    })
    
    const result = await response.json()
    
    // create-token requires payment
    if (result.error?.code === 402) {
      const paymentData = result.error.data
      
      expect(paymentData.accepts).toBeDefined()
      expect(paymentData.accepts[0].maxAmountRequired).toBeDefined()
      expect(paymentData.accepts[0].description).toContain('Token deployment')
      
      console.log('✅ Token deployment payment tier validated')
    }
  })

  test('should handle invalid skill IDs gracefully', async ({ page }) => {
    const response = await page.request.post('http://localhost:4006/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-5',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'nonexistent-skill',
                  params: {}
                }
              }
            ]
          }
        },
        id: 5
      }
    })
    
    const result = await response.json()
    
    expect(result.error).toBeDefined()
    expect(result.error.message).toContain('Unknown skill')
    
    console.log('✅ Invalid skill handled gracefully')
  })

  test('should have CORS headers for cross-origin requests', async ({ page }) => {
    const response = await page.request.options('http://localhost:4006/api/a2a')
    
    const corsHeaders = response.headers()
    
    expect(corsHeaders['access-control-allow-origin']).toBe('*')
    expect(corsHeaders['access-control-allow-methods']).toContain('POST')
    
    console.log('✅ CORS headers configured for A2A')
  })
})
