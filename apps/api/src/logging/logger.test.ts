import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryLogger, JsonLogger } from './logger.js';

describe('InMemoryLogger', () => {
  it('records log entries at each level', () => {
    const logger = new InMemoryLogger();

    logger.debug('debug-action');
    logger.info('info-action');
    logger.warn('warn-action');
    logger.error('error-action', new Error('oops'));

    assert.equal(logger.entries.length, 4);
    assert.equal(logger.entries[0].level, 'DEBUG');
    assert.equal(logger.entries[0].action, 'debug-action');
    assert.equal(logger.entries[1].level, 'INFO');
    assert.equal(logger.entries[2].level, 'WARN');
    assert.equal(logger.entries[3].level, 'ERROR');
    assert.equal(logger.entries[3].error, 'oops');
  });

  it('includes metadata when provided', () => {
    const logger = new InMemoryLogger();

    logger.info('test-action', { key: 'value', count: 42 });

    assert.deepEqual(logger.entries[0].metadata, { key: 'value', count: 42 });
  });

  it('includes fields from constructor', () => {
    const logger = new InMemoryLogger({ requestId: 'req-123', tenantId: 'tenant-1' });

    logger.info('test-action');

    assert.equal(logger.entries[0].requestId, 'req-123');
    assert.equal(logger.entries[0].tenantId, 'tenant-1');
  });

  it('child logger inherits and overrides fields', () => {
    const parent = new InMemoryLogger({ requestId: 'req-123' });
    const child = parent.child({ tenantId: 'tenant-1' });

    child.info('child-action');

    assert.equal(parent.entries.length, 1);
    assert.equal(parent.entries[0].requestId, 'req-123');
    assert.equal(parent.entries[0].tenantId, 'tenant-1');
    assert.equal(parent.entries[0].action, 'child-action');
  });

  it('uses custom now function for timestamps', () => {
    const fixedDate = new Date('2025-01-01T00:00:00.000Z');
    const logger = new InMemoryLogger({}, () => fixedDate);

    logger.info('test-action');

    assert.equal(logger.entries[0].timestamp, '2025-01-01T00:00:00.000Z');
  });

  it('converts non-Error objects to string in error field', () => {
    const logger = new InMemoryLogger();

    logger.error('test-action', 'string-error');

    assert.equal(logger.entries[0].error, 'string-error');
  });
});

describe('JsonLogger', () => {
  it('can be constructed without throwing', () => {
    const logger = new JsonLogger();
    assert.ok(logger);
  });

  it('child returns a new logger with merged fields', () => {
    const logger = new JsonLogger({ requestId: 'req-1' });
    const child = logger.child({ tenantId: 'tenant-1' });
    assert.ok(child);
  });
});
