import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../errors.js';
import { InMemoryLineCredentialStore } from '../security/line-credential-store.js';
import { RealLineAuthClient } from './line-auth-client.js';

test('real line auth client validates id token and returns line user id', async () => {
  const credentialStore = new InMemoryLineCredentialStore();
  await credentialStore.upsertTenantCredentials('tenant_a', {
    channelId: '2000000000',
    channelSecret: 'line-channel-secret-1234'
  });

  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ method, url, body });

    if (url.endsWith('/oauth2/v2.1/verify')) {
      return new Response(
        JSON.stringify({
          iss: 'https://access.line.me',
          aud: '2000000000',
          sub: 'Uabc123',
          exp: 9999999999
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    }

    throw new Error(`Unexpected LINE API call in test: ${method} ${url}`);
  };

  const client = new RealLineAuthClient(credentialStore, {
    apiBaseUrl: 'https://api.line.test',
    fetchFn
  });

  const validated = await client.validateIdToken({
    tenantId: 'tenant_a',
    idToken: 'real-line-id-token'
  });

  assert.equal(validated.lineUserId, 'Uabc123');
  assert.ok(calls.some((call) => call.url.endsWith('/oauth2/v2.1/verify')));
  assert.ok(calls.some((call) => call.body?.includes('client_id=2000000000')));
});

test('real line auth client rejects when tenant line credentials are missing', async () => {
  const credentialStore = new InMemoryLineCredentialStore();
  const client = new RealLineAuthClient(credentialStore, {
    apiBaseUrl: 'https://api.line.test',
    fetchFn: async () => new Response('{}', { status: 500 })
  });

  await assert.rejects(
    () =>
      client.validateIdToken({
        tenantId: 'tenant_missing',
        idToken: 'real-line-id-token'
      }),
    (error) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.message, 'LINE credentials are not connected for tenant');
      return true;
    }
  );
});

test('real line auth client uses login channel credentials when provided', async () => {
  const credentialStore = new InMemoryLineCredentialStore();
  await credentialStore.upsertTenantCredentials('tenant_b', {
    channelId: '2000000000',
    channelSecret: 'line-channel-secret-1234',
    loginChannelId: '2009999999',
    loginChannelSecret: 'line-login-secret-5678'
  });

  const calls: Array<{ url: string; body?: string }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, body });

    if (url.endsWith('/oauth2/v2.1/verify')) {
      return new Response(JSON.stringify({ sub: 'Ulogin123' }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }

    throw new Error(`Unexpected LINE API call in test: ${url}`);
  };

  const client = new RealLineAuthClient(credentialStore, {
    apiBaseUrl: 'https://api.line.test',
    fetchFn
  });

  const validated = await client.validateIdToken({
    tenantId: 'tenant_b',
    idToken: 'real-line-id-token'
  });

  assert.equal(validated.lineUserId, 'Ulogin123');
  assert.ok(calls.some((call) => call.body?.includes('client_id=2009999999')));
  assert.ok(!calls.some((call) => call.body?.includes('client_id=2000000000')));
});
