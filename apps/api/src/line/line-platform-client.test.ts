import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryLineCredentialStore } from '../security/line-credential-store.js';
import { RealLinePlatformClient } from './line-platform-client.js';

test('real line platform client provisions webhook endpoint and dual rich menus', async () => {
  const credentialStore = new InMemoryLineCredentialStore();
  await credentialStore.upsertTenantCredentials('tenant_a', {
    channelId: '2000000000',
    channelSecret: 'line-channel-secret-1234'
  });

  const calls: Array<{
    method: string;
    url: string;
    body?: string | Uint8Array | ArrayBuffer;
    contentType?: string | null;
  }> = [];
  let richMenuCreateCount = 0;
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ||
      init?.body instanceof Uint8Array ||
      init?.body instanceof ArrayBuffer
        ? init.body
        : undefined;
    const contentType = readHeaderValue(init?.headers, 'content-type');
    calls.push({ method, url, body, contentType });

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
      richMenuCreateCount += 1;
      return new Response(JSON.stringify({ richMenuId: `richmenu-real-00${richMenuCreateCount}` }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }

    if (
      url.endsWith('/v2/bot/richmenu/richmenu-real-001/content') ||
      url.endsWith('/v2/bot/richmenu/richmenu-real-002/content')
    ) {
      return new Response('', { status: 200 });
    }

    throw new Error(`Unexpected LINE API call in test: ${method} ${url}`);
  };

  const client = new RealLinePlatformClient(credentialStore, {
    apiBaseUrl: 'https://api.line.test',
    apiDataBaseUrl: 'https://api-data.line.test',
    fetchFn
  });

  const resources = await client.provisionResources({
    tenantId: 'tenant_a',
    channelId: '2000000000',
    webhookUrl: 'https://api.example.com/v1/line/webhook/tenant_a'
  });

  assert.equal(resources.richMenuId, 'richmenu-real-001');
  assert.equal(resources.approvedRichMenuId, 'richmenu-real-001');
  assert.equal(resources.pendingRichMenuId, 'richmenu-real-002');
  assert.equal(resources.webhookUrl, 'https://api.example.com/v1/line/webhook/tenant_a');
  assert.ok(calls.some((call) => call.url.endsWith('/v2/bot/channel/webhook/endpoint')));
  const createCalls = calls.filter((call) => call.url.endsWith('/v2/bot/richmenu'));
  assert.equal(createCalls.length, 2);
  const uploadCalls = calls.filter((call) => call.url.includes('/v2/bot/richmenu/') && call.url.endsWith('/content'));
  assert.equal(uploadCalls.length, 2);
  assert.ok(
    uploadCalls.some((call) => call.url.endsWith('/v2/bot/richmenu/richmenu-real-001/content'))
  );
  assert.ok(
    uploadCalls.some((call) => call.url.endsWith('/v2/bot/richmenu/richmenu-real-002/content'))
  );
  for (const uploadCall of uploadCalls) {
    assert.equal(uploadCall.method, 'POST');
    assert.equal(uploadCall.contentType, 'image/png');
    assert.ok(uploadCall.body instanceof Uint8Array);
    assert.ok((uploadCall.body as Uint8Array).byteLength > 0);
  }
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

test('real line platform client fails provision when rich menu image upload fails', async () => {
  const credentialStore = new InMemoryLineCredentialStore();
  await credentialStore.upsertTenantCredentials('tenant_a', {
    channelId: '2000000000',
    channelSecret: 'line-channel-secret-1234'
  });

  let richMenuCreateCount = 0;
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);

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
      richMenuCreateCount += 1;
      return new Response(JSON.stringify({ richMenuId: `richmenu-real-00${richMenuCreateCount}` }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }

    if (url.endsWith('/v2/bot/richmenu/richmenu-real-001/content')) {
      return new Response(JSON.stringify({ message: 'upload failed' }), {
        status: 500,
        headers: {
          'content-type': 'application/json'
        }
      });
    }

    throw new Error(`Unexpected LINE API call in test: ${url}`);
  };

  const client = new RealLinePlatformClient(credentialStore, {
    apiBaseUrl: 'https://api.line.test',
    apiDataBaseUrl: 'https://api-data.line.test',
    fetchFn
  });

  await assert.rejects(
    () =>
      client.provisionResources({
        tenantId: 'tenant_a',
        channelId: '2000000000',
        webhookUrl: 'https://api.example.com/v1/line/webhook/tenant_a'
      }),
    /upload rich menu image failed/
  );
});

function readHeaderValue(headers: HeadersInit | undefined, key: string): string | null {
  if (!headers) {
    return null;
  }

  const target = key.toLowerCase();

  if (headers instanceof Headers) {
    return headers.get(target);
  }

  if (Array.isArray(headers)) {
    const match = headers.find(([headerName]) => headerName.toLowerCase() === target);
    return match?.[1] ?? null;
  }

  const recordHeaders = headers as Record<string, string>;
  const directMatch = Object.entries(recordHeaders).find(
    ([headerName]) => headerName.toLowerCase() === target
  );
  return directMatch?.[1] ?? null;
}
