import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMetricEmitter, CloudWatchEmfMetricEmitter } from './metrics.js';

describe('InMemoryMetricEmitter', () => {
  it('accumulates emitted metrics', () => {
    const emitter = new InMemoryMetricEmitter();

    emitter.emit('OneTeam', 'RequestCount', 1, 'Count', [
      { Name: 'TenantId', Value: 'tenant-1' }
    ]);

    emitter.emit('OneTeam', 'RequestLatency', 42, 'Milliseconds');

    assert.equal(emitter.metrics.length, 2);
    assert.equal(emitter.metrics[0].metricName, 'RequestCount');
    assert.equal(emitter.metrics[0].value, 1);
    assert.equal(emitter.metrics[0].dimensions?.[0].Value, 'tenant-1');
    assert.equal(emitter.metrics[1].metricName, 'RequestLatency');
    assert.equal(emitter.metrics[1].value, 42);
  });
});

describe('CloudWatchEmfMetricEmitter', () => {
  it('can be constructed without throwing', () => {
    const emitter = new CloudWatchEmfMetricEmitter();
    assert.ok(emitter);
  });
});
