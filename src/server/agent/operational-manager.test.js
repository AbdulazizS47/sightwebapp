import { describe, expect, it } from 'vitest';
import { createOperationalManager } from './operational-manager.js';
import { OPERATIONAL_AGENT_TOOLS } from './tools.js';

describe('operational agent tool registry', () => {
  it('exposes only strict read-only business tools', () => {
    expect(OPERATIONAL_AGENT_TOOLS.length).toBeGreaterThanOrEqual(7);
    for (const tool of OPERATIONAL_AGENT_TOOLS) {
      expect(tool.type).toBe('function');
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.name).not.toMatch(/update|delete|create|send|adjust|restock/);
    }
  });
});

describe('operational manager orchestration', () => {
  it('executes model-requested tools and returns the grounded final response', async () => {
    const requests = [];
    const responses = [
      {
        id: 'resp-1',
        output: [
          {
            type: 'function_call',
            call_id: 'call-1',
            name: 'get_open_orders',
            arguments: '{}',
          },
        ],
        output_text: '',
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
      {
        id: 'resp-2',
        output: [{ type: 'message' }],
        output_text: 'There are 3 open orders worth 75 SAR.',
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      },
    ];
    const client = {
      responses: {
        create: async (request) => {
          requests.push(request);
          return responses.shift();
        },
      },
    };
    const writes = [];
    const db = {
      execute: async (sql, params) => {
        if (sql.includes('FROM agent_conversations')) return [[], []];
        if (sql.includes('FROM orders') && sql.includes('completedAt IS NULL')) {
          return [
            [
              {
                orders: 3,
                revenue: 75,
                oldestCreatedAt: 1,
                newestCreatedAt: 2,
              },
            ],
            [],
          ];
        }
        writes.push({ sql, params });
        return [{ affectedRows: 1 }, []];
      },
    };
    const manager = createOperationalManager({
      client,
      db,
      model: 'test-model',
      reasoningEffort: 'low',
      now: () => new Date('2026-08-04T12:00:00Z'),
    });

    const answer = await manager.answer({
      channel: 'telegram',
      externalId: '123',
      text: 'How many open orders?',
      requestId: 'update-1',
    });

    expect(answer.text).toBe('There are 3 open orders worth 75 SAR.');
    expect(answer.toolCalls).toEqual([
      expect.objectContaining({ name: 'get_open_orders', status: 'completed' }),
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1].previous_response_id).toBe('resp-1');
    expect(requests[1].input[0]).toMatchObject({
      type: 'function_call_output',
      call_id: 'call-1',
    });
    expect(writes.some((write) => write.sql.includes('agent_conversations'))).toBe(true);
    expect(writes.some((write) => write.sql.includes('agent_runs'))).toBe(true);
  });
});
