/**
 * A2A Interface for eHorse
 * Allows agents to discover the game and get race status
 */

import { Router, Request, Response } from 'express';
import { RaceEngine, type Race } from './game.js';

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
          description: 'Get current race information including horses and status',
          tags: ['query', 'game-state'],
          examples: ['What is the current race?', 'Show me race status', 'Which horses are racing?']
        },
        {
          id: 'get-horses',
          name: 'Get Horses',
          description: 'Get list of all horses',
          tags: ['query'],
          examples: ['Show horses', 'List horses', 'Which horses can I bet on?']
        },
        {
          id: 'get-race-history',
          name: 'Get Race History',
          description: 'Get previous race results',
          tags: ['query', 'history'],
          examples: ['Show past races', 'Race history', 'Previous winners']
        }
      ]
    };
  }

  private async handleRequest(req: Request, res: Response): Promise<void> {
    const { method, params, id } = req.body;

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

    // Extract skill from data part
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
    const result = await this.executeSkill(skillId);

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
  }

  private async executeSkill(skillId: string): Promise<{ message: string; data: Record<string, unknown> }> {
    const race = this.raceEngine.getCurrentRace();

    switch (skillId) {
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
        return {
          message: `4 horses: ${HORSES.map(h => h.name).join(', ')}`,
          data: {
            horses: HORSES
          }
        };

      case 'get-race-history':
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

      default:
        return {
          message: 'Unknown skill',
          data: {}
        };
    }
  }
}



