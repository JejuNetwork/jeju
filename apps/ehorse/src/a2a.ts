/**
 * A2A Interface for eHorse
 * Allows agents to discover the game and get race status
 */

import { Router, Request, Response } from 'express';
import { RaceEngine, type Race } from './game.js';
import { createPaymentRequirement, checkPayment, PAYMENT_TIERS } from './lib/x402.js';
import { Address } from 'ethers';

export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport: string;
  provider: {
    organization: string;
    url: string;
  };
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ASkill[];
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
}

const PAYMENT_RECIPIENT = (process.env.EHORSE_PAYMENT_RECIPIENT || 
  '0x0000000000000000000000000000000000000000') as Address;

export class A2AServer {
  private raceEngine: RaceEngine;
  private serverUrl: string;

  constructor(raceEngine: RaceEngine, serverUrl: string) {
    this.raceEngine = raceEngine;
    this.serverUrl = serverUrl;
  }

  createRouter(): Router {
    const router = Router();

    // Serve Agent Card
    router.get('/.well-known/agent-card.json', (_req, res) => {
      res.json(this.generateAgentCard());
    });

    // A2A JSON-RPC endpoint
    router.post('/a2a', async (req, res) => {
      await this.handleRequest(req, res);
    });

    return router;
  }

  private generateAgentCard(): A2AAgentCard {
    return {
      protocolVersion: '0.3.0',
      name: 'eHorse Racing Game',
      description: 'Minimal horse racing game for prediction markets',
      url: `${this.serverUrl}/a2a`,
      preferredTransport: 'http',
      provider: {
        organization: 'Jeju Network',
        url: 'https://jeju.network'
      },
      version: '1.0.0',
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false
      },
      defaultInputModes: ['text', 'data'],
      defaultOutputModes: ['text', 'data'],
      skills: [
        {
          id: 'get-race-status',
          name: 'Get Race Status',
          description: 'Get current race information including horses and status (FREE)',
          tags: ['query', 'game-state'],
          examples: ['What is the current race?', 'Show me race status', 'Which horses are racing?']
        },
        {
          id: 'get-horses',
          name: 'Get Horses',
          description: 'Get list of all horses (FREE)',
          tags: ['query'],
          examples: ['Show horses', 'List horses', 'Which horses can I bet on?']
        },
        {
          id: 'get-race-history',
          name: 'Get Race History',
          description: 'Get previous race results (PAID: historical data fee)',
          tags: ['query', 'history', 'premium'],
          examples: ['Show past races', 'Race history', 'Previous winners']
        },
        {
          id: 'place-bet',
          name: 'Place Bet',
          description: 'Place a bet on a horse (PAID: 1% fee)',
          tags: ['action', 'betting', 'premium'],
          examples: ['Bet on horse 1', 'Place bet', 'Wager on winner']
        },
        {
          id: 'get-my-bets',
          name: 'Get My Bets',
          description: 'Get betting history for an address (FREE: last 10, PAID: unlimited)',
          tags: ['query', 'betting'],
          examples: ['Show my bets', 'Betting history', 'My wagers']
        },
        {
          id: 'get-odds',
          name: 'Get Current Odds',
          description: 'Get real-time odds for current race (PAID: premium feed)',
          tags: ['query', 'betting', 'premium'],
          examples: ['Current odds', 'Show odds', 'Betting probabilities']
        },
        {
          id: 'withdraw-winnings',
          name: 'Withdraw Winnings',
          description: 'Withdraw betting winnings (FREE)',
          tags: ['action', 'betting'],
          examples: ['Withdraw winnings', 'Claim prize', 'Get my winnings']
        }
      ]
    };
  }

  private async handleRequest(req: Request, res: Response): Promise<void> {
    const { method, params, id } = req.body;
    const paymentHeader = req.headers['x-payment'] as string | undefined;

    if (method !== 'message/send') {
      res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not found' }
      });
      return;
    }

    const message = params?.message;
    if (!message || !message.parts) {
      res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Invalid params' }
      });
      return;
    }

    const dataPart = message.parts.find((p: { kind: string }) => p.kind === 'data');
    if (!dataPart || !dataPart.data) {
      res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'No data part found' }
      });
      return;
    }

    const skillId = dataPart.data.skillId;
    const skillParams = (dataPart.data.params as Record<string, unknown>) || {};
    
    try {
      const result = await this.executeSkill(skillId, skillParams, paymentHeader || null);

      if (result.requiresPayment) {
        res.status(402).json({
          jsonrpc: '2.0',
          id,
          error: {
            code: 402,
            message: 'Payment Required',
            data: result.requiresPayment,
          },
        });
        return;
      }

      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          role: 'agent',
          parts: [
            { kind: 'text', text: result.message },
            { kind: 'data', data: result.data }
          ],
          messageId: message.messageId,
          kind: 'message'
        }
      });
    } catch (error) {
      res.json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error'
        }
      });
    }
  }

  private async executeSkill(
    skillId: string, 
    params: Record<string, unknown>,
    paymentHeader: string | null
  ): Promise<{ 
    message: string; 
    data: Record<string, unknown>;
    requiresPayment?: any;
  }> {
    const race = this.raceEngine.getCurrentRace();

    switch (skillId) {
      // ============ FREE TIER ============
      
      case 'get-race-status':
        return {
          message: `Race ${race?.id}: ${race?.status}${race?.winner ? `, winner: ${race.horses.find(h => h.id === race.winner)?.name}` : ''}`,
          data: {
            race: {
              id: race?.id,
              status: race?.status,
              horses: race?.horses,
              winner: race?.winner,
              winnerName: race?.winner ? race.horses.find(h => h.id === race.winner)?.name : null,
              startTime: race?.startTime,
              endTime: race?.endTime
            }
          }
        };

      case 'get-horses':
        const HORSES = [
          { id: 0, name: 'Lightning', emoji: '⚡' },
          { id: 1, name: 'Thunder', emoji: '⛈️' },
          { id: 2, name: 'Storm', emoji: '🌪️' },
          { id: 3, name: 'Tempest', emoji: '💨' }
        ];
        return {
          message: `4 horses available`,
          data: { horses: HORSES }
        };

      case 'get-my-bets': {
        const limit = (params.limit as number) || 10;
        
        if (limit > 10) {
          const paymentCheck = await checkPayment(
            paymentHeader,
            PAYMENT_TIERS.HISTORICAL_DATA,
            PAYMENT_RECIPIENT
          );

          if (!paymentCheck.paid) {
            return {
              message: 'Payment required',
              data: {},
              requiresPayment: createPaymentRequirement(
                '/a2a',
                PAYMENT_TIERS.HISTORICAL_DATA,
                'Unlimited bet history access',
                PAYMENT_RECIPIENT
              ),
            };
          }
        }

        return {
          message: `Betting history (${limit} bets)`,
          data: {
            bets: [],
            address: params.address,
            limit,
          },
        };
      }

      case 'withdraw-winnings':
        return {
          message: 'Winnings withdrawal prepared',
          data: {
            address: params.address,
            instructions: 'Execute withdrawal transaction on-chain',
          },
        };

      // ============ PAID TIER ============

      case 'get-race-history': {
        const paymentCheck = await checkPayment(
          paymentHeader,
          PAYMENT_TIERS.HISTORICAL_DATA,
          PAYMENT_RECIPIENT
        );

        if (!paymentCheck.paid) {
          return {
            message: 'Payment required',
            data: {},
            requiresPayment: createPaymentRequirement(
              '/a2a',
              PAYMENT_TIERS.HISTORICAL_DATA,
              'Historical race data access',
              PAYMENT_RECIPIENT
            ),
          };
        }

        const history = this.raceEngine.getRaceHistory();
        return {
          message: `${history.length} past races`,
          data: {
            history: history.map(r => ({
              id: r.id,
              winner: r.winner,
              winnerName: r.horses.find(h => h.id === r.winner)?.name,
              endTime: r.endTime
            }))
          }
        };
      }

      case 'place-bet': {
        const betAmount = BigInt((params.amount as string) || '0');
        const betFee = (betAmount * BigInt(PAYMENT_TIERS.BET_FEE)) / BigInt(10000);
        
        const paymentCheck = await checkPayment(
          paymentHeader,
          betFee,
          PAYMENT_RECIPIENT
        );

        if (!paymentCheck.paid) {
          return {
            message: 'Payment required',
            data: {},
            requiresPayment: createPaymentRequirement(
              '/a2a',
              betFee,
              'Betting fee (1%)',
              PAYMENT_RECIPIENT
            ),
          };
        }

        return {
          message: 'Bet placed successfully',
          data: {
            horseId: params.horseId,
            amount: params.amount,
            fee: betFee.toString(),
            raceId: race?.id,
          },
        };
      }

      case 'get-odds': {
        const paymentCheck = await checkPayment(
          paymentHeader,
          PAYMENT_TIERS.PREMIUM_ODDS,
          PAYMENT_RECIPIENT
        );

        if (!paymentCheck.paid) {
          return {
            message: 'Payment required',
            data: {},
            requiresPayment: createPaymentRequirement(
              '/a2a',
              PAYMENT_TIERS.PREMIUM_ODDS,
              'Real-time odds feed access',
              PAYMENT_RECIPIENT
            ),
          };
        }

        return {
          message: 'Current betting odds',
          data: {
            raceId: race?.id,
            odds: [
              { horseId: 0, odds: '2.5:1' },
              { horseId: 1, odds: '3.0:1' },
              { horseId: 2, odds: '4.0:1' },
              { horseId: 3, odds: '5.0:1' },
            ],
          },
        };
      }

      default:
        return {
          message: 'Unknown skill',
          data: {}
        };
    }
  }
}



