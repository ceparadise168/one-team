import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryLineCredentialStore } from '../security/line-credential-store.js';
import { RealLinePlatformClient } from './line-platform-client.js';

test('real line platform client provisions webhook endpoint and rich menu', async () => {
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

    if (url.endsWith('/v2/oauth/accessToken')) {
      return new Response(
        JSON.stringify({
          access_token: 'line-access-token',
          token_type: 'Bearer',
          expires_in: 2592000
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    }

    if (url.endsWith('/v2/bot/channel/webhook/endpoint')) {
      return new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }

    if (url.endsWith('/v2/bot/richmenu')) {
      return new Response(JSON.stringify({ richMenuId: 'richmenu-real-001' }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }

    throw new Error(`Unexpected LINE API call in test: ${method} ${url}`);
  };

  const client = new RealLinePlatformClient(credentialStore, {
    apiBaseUrl: 'https://api.line.test',
    fetchFn
  });

  const resources = await client.provisionResources({
    tenantId: 'tenant_a',
    channelId: '2000000000',
    webhookUrl: 'https://api.example.com/v1/line/webhook/tenant_a'
  });

  assert.equal(resources.richMenuId, 'richmenu-real-001');
  assert.equal(resources.webhookUrl, 'https://api.example.com/v1/line/webhook/tenant_a');
  assert.ok(calls.some((call) => call.url.endsWith('/v2/bot/channel/webhook/endpoint')));
  assert.ok(calls.some((call) => call.url.endsWith('/v2/bot/richmenu')));
});

test('real line platform client links and unlinks rich menu for a tenant user', async () => {
  const credentialStore = new InMemoryLineCredentialStore();
  await credentialStore.upsertTenantCredentials('tenant_a', {
    channelId: '2000000000',
    channelSecret: 'line-channel-secret-1234'
  });

  const calls: Array<{ method: string; url: string }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });

    if (url.endsWith('/v2/oauth/accessToken')) {
      return new Response(
        JSON.stringify({
          access_token: 'line-access-token',
          token_type: 'Bearer',
          expires_in: 2592000
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    }

    if (url.includes('/v2/bot/user/U1001/richmenu/')) {
      return new Response('', { status: 200 });
    }

    if (url.endsWith('/v2/bot/user/U1001/richmenu')) {
      return new Response('', { status: 200 });
    }

    throw new Error(`Unexpected LINE API call in test: ${method} ${url}`);
  };

  const client = new RealLinePlatformClient(credentialStore, {
    apiBaseUrl: 'https://api.line.test',
    fetchFn
  });

  await client.linkRichMenu({
    tenantId: 'tenant_a',
    lineUserId: 'U1001',
    richMenuId: 'richmenu-real-001'
  });

  await client.unlinkRichMenu({
    tenantId: 'tenant_a',
    lineUserId: 'U1001'
  });

  assert.ok(calls.some((call) => call.url.includes('/v2/bot/user/U1001/richmenu/richmenu-real-001')));
  assert.ok(calls.some((call) => call.url.endsWith('/v2/bot/user/U1001/richmenu') && call.method === 'DELETE'));
});
