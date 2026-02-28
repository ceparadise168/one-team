#!/usr/bin/env node
/**
 * update-richmenu.mjs
 *
 * Recreates the LINE OA rich menus with postback + URI actions,
 * updates all matching DynamoDB tenant records, and re-assigns
 * the correct rich menu to every active employee via LINE API.
 *
 * Usage:
 *   CHANNEL_ID=... CHANNEL_SECRET=... node scripts/update-richmenu.mjs
 *
 * Required env vars (or set in .env):
 *   CHANNEL_ID       — LINE Messaging API channel ID
 *   CHANNEL_SECRET   — LINE Messaging API channel secret
 *
 * Optional:
 *   LIFF_ID          — LIFF app ID (e.g. 1234567890-AbcDeFgH)
 *                      Defaults to placeholder if not set.
 *   TABLE_NAME       — DynamoDB tenants table (default: one-team-dev-tenants)
 *   AWS_REGION       — AWS region (default: ap-northeast-1)
 *   DRY_RUN          — Set to "true" to print payloads without calling LINE API
 */

import { readFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ────────────────────────────────────────────────────────────────
const envPath = resolve(__dirname, '../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eqIdx = trimmed.indexOf('=');
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const CHANNEL_ID = process.env.CHANNEL_ID;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const LIFF_ID = process.env.LIFF_ID;
const DRY_RUN = process.env.DRY_RUN === 'true';
const TABLE_NAME = process.env.TABLE_NAME ?? 'one-team-dev-tenants';
const AWS_REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

// Derive employees table from tenants table (one-team-dev-tenants → one-team-dev-employees)
const EMPLOYEES_TABLE_NAME = TABLE_NAME.replace(/-tenants$/, '-employees');

if (!CHANNEL_ID || !CHANNEL_SECRET) {
  console.error('❌  CHANNEL_ID and CHANNEL_SECRET must be set in .env or environment');
  process.exit(1);
}

const LINE_API = 'https://api.line.me';
const LINE_DATA_API = 'https://api-data.line.me';

const liffBase = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : 'https://liff.line.me/PLACEHOLDER';
if (!LIFF_ID) {
  console.warn('⚠️   LIFF_ID not set — URI actions will use placeholder URL. Set LIFF_ID in .env before going live.');
}

// ── Access token ─────────────────────────────────────────────────────────────
async function getAccessToken() {
  if (DRY_RUN) return 'DRY_RUN_TOKEN';
  const res = await fetch(`${LINE_API}/v2/oauth/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CHANNEL_ID,
      client_secret: CHANNEL_SECRET
    }).toString()
  });
  if (!res.ok) throw new Error(`Failed to get access token: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

// ── LINE API helpers ──────────────────────────────────────────────────────────
async function lineGet(token, path) {
  if (DRY_RUN) return { richmenus: [] };
  const res = await fetch(`${LINE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') ? res.json() : {};
}

async function linePost(token, path, body) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] POST ${path}`, JSON.stringify(body, null, 2));
    return { richMenuId: `dry_run_${path.replace(/\//g, '_')}` };
  }
  const res = await fetch(`${LINE_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') ? res.json() : {};
}

async function lineDelete(token, path) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] DELETE ${path}`);
    return;
  }
  const res = await fetch(`${LINE_API}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status} ${await res.text()}`);
}

async function uploadImage(token, richMenuId, imageBytes) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] upload image to ${richMenuId}`);
    return;
  }
  const res = await fetch(`${LINE_DATA_API}/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: imageBytes
  });
  if (!res.ok) throw new Error(`Image upload failed: ${res.status} ${await res.text()}`);
}

async function linkRichMenu(token, lineUserId, richMenuId) {
  if (DRY_RUN) return;
  const res = await fetch(
    `${LINE_API}/v2/bot/user/${encodeURIComponent(lineUserId)}/richmenu/${encodeURIComponent(richMenuId)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    // 404 = user not found / not a follower — skip silently
    if (res.status === 404) return;
    throw new Error(`Link rich menu failed for ${lineUserId}: ${res.status} ${body}`);
  }
}

// ── Rich menu definitions ─────────────────────────────────────────────────────
function buildPendingMenu() {
  return {
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'one-team-pending',
    chatBarText: '申請開通',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: 'postback', data: 'action=request_access', displayText: '申請開通' }
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'postback', data: 'action=digital_id', displayText: '員工證' }
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'postback', data: 'action=contact_admin', displayText: '聯絡管理員' }
      }
    ]
  };
}

function buildApprovedMenu() {
  return {
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'one-team-approved',
    chatBarText: '員工服務',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: 'postback', data: 'action=digital_id', displayText: '員工證' }
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'postback', data: 'action=profile', displayText: '我的資料' }
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'postback', data: 'action=services_menu', displayText: '員工服務' }
      }
    ]
  };
}

// ── Rich menu image via SVG → PNG (sharp) ───────────────────────────────────
const FONT_FAMILY = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";

async function createRichMenuImage(menuType) {
  const isPending = menuType === 'pending';
  const bgColor = isPending ? '#2C3E50' : '#1a73e8';
  const labels = isPending
    ? ['申請開通', '我的員工證', '聯絡管理員']
    : ['員工證', '我的資料', '員工服務'];

  const svg = `<svg width="2500" height="843" xmlns="http://www.w3.org/2000/svg">
  <rect width="2500" height="843" fill="${bgColor}"/>
  <line x1="833" y1="120" x2="833" y2="723" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
  <line x1="1667" y1="120" x2="1667" y2="723" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
  <text x="416" y="440" text-anchor="middle" fill="white" font-size="56" font-weight="bold"
        font-family="${FONT_FAMILY}">${labels[0]}</text>
  <text x="1250" y="440" text-anchor="middle" fill="white" font-size="56" font-weight="bold"
        font-family="${FONT_FAMILY}">${labels[1]}</text>
  <text x="2083" y="440" text-anchor="middle" fill="white" font-size="56" font-weight="bold"
        font-family="${FONT_FAMILY}">${labels[2]}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── DynamoDB helpers ─────────────────────────────────────────────────────────
let _dynamoClient = null;
async function getDynamoClient() {
  if (_dynamoClient) return _dynamoClient;
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  _dynamoClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: AWS_REGION }),
    { marshallOptions: { removeUndefinedValues: true } }
  );
  return _dynamoClient;
}

async function findTenantsByChannelId(channelId) {
  const client = await getDynamoClient();
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
  const response = await client.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'sk = :sk AND #line.channelId = :cid',
    ExpressionAttributeNames: { '#line': 'line' },
    ExpressionAttributeValues: { ':sk': 'PROFILE', ':cid': channelId }
  }));
  return response.Items ?? [];
}

async function updateTenantRichMenuIds(tenantId, pendingMenuId, approvedMenuId) {
  const client = await getDynamoClient();
  const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
  await client.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `TENANT#${tenantId}`, sk: 'PROFILE' },
    UpdateExpression: 'SET #line.#res.#pending = :p, #line.#res.#approved = :a, #line.#res.#rich = :a',
    ExpressionAttributeNames: {
      '#line': 'line',
      '#res': 'resources',
      '#pending': 'pendingRichMenuId',
      '#approved': 'approvedRichMenuId',
      '#rich': 'richMenuId'
    },
    ExpressionAttributeValues: {
      ':p': pendingMenuId,
      ':a': approvedMenuId
    }
  }));
}

async function queryBindingsForTenant(tenantId) {
  const client = await getDynamoClient();
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const response = await client.send(new QueryCommand({
    TableName: EMPLOYEES_TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `TENANT#${tenantId}`,
      ':prefix': 'BINDING#'
    }
  }));
  return response.Items ?? [];
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔑  Getting channel access token...');
  const token = await getAccessToken();
  console.log(DRY_RUN ? '   (dry run — no real API calls)' : '   ✓ Token obtained');

  // List existing rich menus
  console.log('\n📋  Listing existing rich menus...');
  const existing = await lineGet(token, '/v2/bot/richmenu/list');
  const oldMenus = existing.richmenus ?? [];
  if (oldMenus.length === 0) {
    console.log('   (none found)');
  } else {
    for (const m of oldMenus) {
      console.log(`   • ${m.richMenuId}  name="${m.name}"  chatBarText="${m.chatBarText}"`);
    }
  }

  // ── Step 1: Create new menus + upload images ──
  console.log('\n🔧  Creating PENDING rich menu...');
  const pendingResult = await linePost(token, '/v2/bot/richmenu', buildPendingMenu());
  const pendingMenuId = pendingResult.richMenuId;
  console.log(`   ✓ Pending menu ID: ${pendingMenuId}`);

  console.log('\n🔧  Creating APPROVED rich menu...');
  const approvedResult = await linePost(token, '/v2/bot/richmenu', buildApprovedMenu());
  const approvedMenuId = approvedResult.richMenuId;
  console.log(`   ✓ Approved menu ID: ${approvedMenuId}`);

  console.log('\n🖼   Generating and uploading images...');
  const [pendingImage, approvedImage] = await Promise.all([
    createRichMenuImage('pending'),
    createRichMenuImage('approved')
  ]);
  await uploadImage(token, pendingMenuId, pendingImage);
  await uploadImage(token, approvedMenuId, approvedImage);
  console.log('   ✓ Images uploaded');

  // ── Step 2: Find all tenants using this channel + update DynamoDB ──
  console.log(`\n📦  Finding tenants with channelId=${CHANNEL_ID}...`);
  const tenants = DRY_RUN ? [] : await findTenantsByChannelId(CHANNEL_ID);
  console.log(`   Found ${tenants.length} tenant(s)`);

  for (const t of tenants) {
    await updateTenantRichMenuIds(t.tenantId, pendingMenuId, approvedMenuId);
    console.log(`   ✓ Updated ${t.tenantId}`);
  }

  // ── Step 3: Re-assign rich menus to all active employees ──
  console.log('\n🔗  Re-assigning rich menus to active employees...');
  const seenUsers = new Set();
  let assigned = 0;
  let skipped = 0;

  for (const t of tenants) {
    const bindings = await queryBindingsForTenant(t.tenantId);
    for (const b of bindings) {
      if (b.employmentStatus !== 'ACTIVE' || !b.lineUserId) {
        skipped++;
        continue;
      }
      // Same LINE user may appear across multiple tenants — only assign once
      if (seenUsers.has(b.lineUserId)) {
        skipped++;
        continue;
      }
      seenUsers.add(b.lineUserId);

      const menuId = b.accessStatus === 'APPROVED' ? approvedMenuId : pendingMenuId;
      try {
        await linkRichMenu(token, b.lineUserId, menuId);
        assigned++;
        const label = b.accessStatus === 'APPROVED' ? 'approved' : 'pending';
        console.log(`   ✓ ${b.lineUserId} (${b.employeeId}) → ${label}`);
      } catch (err) {
        console.log(`   ⚠ ${b.lineUserId} (${b.employeeId}) — ${err.message}`);
        skipped++;
      }
    }
  }
  console.log(`   Assigned: ${assigned}, Skipped: ${skipped}`);

  // ── Step 4: Delete old menus ──
  if (oldMenus.length > 0) {
    console.log('\n🗑   Deleting old rich menus...');
    for (const m of oldMenus) {
      await lineDelete(token, `/v2/bot/richmenu/${m.richMenuId}`);
      console.log(`   ✓ Deleted ${m.richMenuId}`);
    }
  }

  // ── Summary ──
  console.log('\n' + '═'.repeat(60));
  console.log('✅  Done!\n');
  console.log('  PENDING  menu:', pendingMenuId);
  console.log('  APPROVED menu:', approvedMenuId);
  console.log(`  Tenants updated: ${tenants.length}`);
  console.log(`  Users re-assigned: ${assigned}`);
}

main().catch((err) => {
  console.error('\n❌  Error:', err.message);
  process.exit(1);
});
