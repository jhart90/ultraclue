import { describe, it, expect } from 'vitest';
import { SOCKET_EVENTS } from '../src/index';

describe('shared smoke test', () => {
  it('exposes the hello protocol constants', () => {
    expect(SOCKET_EVENTS.HELLO).toBe('hello');
    expect(SOCKET_EVENTS.HELLO_ACK).toBe('helloAck');
  });
});
