import { LineCredentialStore } from '../security/line-credential-store.js';
import { LineResources } from '../domain/tenant.js';
import { deflateSync } from 'node:zlib';

export interface ProvisionLineResourcesInput {
  tenantId: string;
  channelId: string;
  existingResources?: LineResources;
  webhookUrl: string;
}

export interface LineMessage {
  type: string;
  text?: string;
  altText?: string;
  contents?: unknown;
}

export interface LinePlatformClient {
  validateChannelCredentials(channelId: string, channelSecret: string): Promise<void>;
  provisionResources(input: ProvisionLineResourcesInput): Promise<LineResources>;
  verifyWebhookToken(token: string): Promise<boolean>;
  linkRichMenu(input: { tenantId: string; lineUserId: string; richMenuId: string }): Promise<void>;
  unlinkRichMenu(input: { tenantId: string; lineUserId: string }): Promise<void>;
  pushMessage(input: { tenantId: string; lineUserId: string; messages: LineMessage[] }): Promise<void>;
  replyMessage(input: { tenantId: string; replyToken: string; messages: LineMessage[] }): Promise<void>;
}

export class StubLinePlatformClient implements LinePlatformClient {
  async validateChannelCredentials(channelId: string, channelSecret: string): Promise<void> {
    if (!/^\d{5,20}$/.test(channelId)) {
      throw new Error('LINE channel ID format is invalid');
    }

    if (channelSecret.length < 16) {
      throw new Error('LINE channel secret format is invalid');
    }
  }

  async provisionResources(input: ProvisionLineResourcesInput): Promise<LineResources> {
    const approvedRichMenuId =
      input.existingResources?.approvedRichMenuId ??
      input.existingResources?.richMenuId ??
      `richmenu_${input.tenantId}`;
    const pendingRichMenuId =
      input.existingResources?.pendingRichMenuId ?? `richmenu_pending_${input.tenantId}`;

    return {
      liffId: input.existingResources?.liffId ?? `liff_${input.tenantId}`,
      richMenuId: approvedRichMenuId,
      approvedRichMenuId,
      pendingRichMenuId,
      webhookId: input.existingResources?.webhookId ?? `webhook_${input.tenantId}`,
      webhookUrl: input.webhookUrl
    };
  }

  async verifyWebhookToken(token: string): Promise<boolean> {
    return token.startsWith('line-verify-') && token.length > 16;
  }

  async linkRichMenu(input: { tenantId: string; lineUserId: string; richMenuId: string }): Promise<void> {
    if (!input.richMenuId.trim()) {
      throw new Error('Rich menu ID is required');
    }

    if (input.lineUserId.startsWith('fail-link-')) {
      throw new Error('LINE API transient failure while linking rich menu');
    }
  }

  async unlinkRichMenu(input: { tenantId: string; lineUserId: string }): Promise<void> {
    if (input.lineUserId.startsWith('fail-')) {
      throw new Error('LINE API transient failure while unlinking rich menu');
    }
  }

  readonly pushedMessages: Array<{ tenantId: string; lineUserId: string; messages: LineMessage[] }> = [];
  readonly repliedMessages: Array<{ tenantId: string; replyToken: string; messages: LineMessage[] }> = [];

  async pushMessage(input: { tenantId: string; lineUserId: string; messages: LineMessage[] }): Promise<void> {
    this.pushedMessages.push(input);
  }

  async replyMessage(input: { tenantId: string; replyToken: string; messages: LineMessage[] }): Promise<void> {
    this.repliedMessages.push(input);
  }
}

interface RealLinePlatformClientOptions {
  apiBaseUrl?: string;
  apiDataBaseUrl?: string;
  fetchFn?: typeof fetch;
  webhookVerifyTokenPrefix?: string;
}

export class RealLinePlatformClient implements LinePlatformClient {
  private readonly apiBaseUrl: string;
  private readonly apiDataBaseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly webhookVerifyTokenPrefix: string;

  constructor(
    private readonly lineCredentialStore: LineCredentialStore,
    options: RealLinePlatformClientOptions = {}
  ) {
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.line.me').replace(/\/$/, '');
    this.apiDataBaseUrl = (options.apiDataBaseUrl ?? 'https://api-data.line.me').replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.webhookVerifyTokenPrefix = options.webhookVerifyTokenPrefix ?? 'line-verify-';
  }

  async validateChannelCredentials(channelId: string, channelSecret: string): Promise<void> {
    const accessToken = await this.issueChannelAccessToken(channelId, channelSecret);
    await this.callLineJson('/v2/bot/info', {
      method: 'GET',
      accessToken,
      operation: 'validate channel credentials'
    });
  }

  async provisionResources(input: ProvisionLineResourcesInput): Promise<LineResources> {
    const credentials = await this.getTenantCredentialsOrThrow(input.tenantId);
    const accessToken = await this.issueChannelAccessToken(credentials.channelId, credentials.channelSecret);

    await this.callLineJson('/v2/bot/channel/webhook/endpoint', {
      method: 'PUT',
      accessToken,
      body: {
        endpoint: input.webhookUrl
      },
      operation: 'set webhook endpoint'
    });

    const approvedRichMenuId =
      input.existingResources?.approvedRichMenuId ??
      input.existingResources?.richMenuId ??
      (await this.createRichMenu(accessToken, this.createRichMenuRequest(input.tenantId, 'approved')));

    const pendingRichMenuId =
      input.existingResources?.pendingRichMenuId ??
      (await this.createRichMenu(accessToken, this.createRichMenuRequest(input.tenantId, 'pending')));

    await this.uploadRichMenuImage({ accessToken, richMenuId: approvedRichMenuId, variant: 'approved' });
    await this.uploadRichMenuImage({ accessToken, richMenuId: pendingRichMenuId, variant: 'pending' });

    return {
      ...input.existingResources,
      richMenuId: approvedRichMenuId,
      approvedRichMenuId,
      pendingRichMenuId,
      webhookId: input.existingResources?.webhookId ?? `webhook_${input.tenantId}`,
      webhookUrl: input.webhookUrl
    };
  }

  async verifyWebhookToken(token: string): Promise<boolean> {
    return token.startsWith(this.webhookVerifyTokenPrefix) && token.length > this.webhookVerifyTokenPrefix.length;
  }

  async linkRichMenu(input: { tenantId: string; lineUserId: string; richMenuId: string }): Promise<void> {
    const credentials = await this.getTenantCredentialsOrThrow(input.tenantId);
    const accessToken = await this.issueChannelAccessToken(credentials.channelId, credentials.channelSecret);

    await this.callLineJson(
      `/v2/bot/user/${encodeURIComponent(input.lineUserId)}/richmenu/${encodeURIComponent(input.richMenuId)}`,
      {
        method: 'POST',
        accessToken,
        operation: 'link rich menu'
      }
    );
  }

  async unlinkRichMenu(input: { tenantId: string; lineUserId: string }): Promise<void> {
    const credentials = await this.getTenantCredentialsOrThrow(input.tenantId);
    const accessToken = await this.issueChannelAccessToken(credentials.channelId, credentials.channelSecret);

    await this.callLineJson(`/v2/bot/user/${encodeURIComponent(input.lineUserId)}/richmenu`, {
      method: 'DELETE',
      accessToken,
      operation: 'unlink rich menu'
    });
  }

  async pushMessage(input: { tenantId: string; lineUserId: string; messages: LineMessage[] }): Promise<void> {
    const credentials = await this.getTenantCredentialsOrThrow(input.tenantId);
    const accessToken = await this.issueChannelAccessToken(credentials.channelId, credentials.channelSecret);

    await this.callLineJson('/v2/bot/message/push', {
      method: 'POST',
      accessToken,
      body: {
        to: input.lineUserId,
        messages: input.messages
      },
      operation: 'push message'
    });
  }

  async replyMessage(input: { tenantId: string; replyToken: string; messages: LineMessage[] }): Promise<void> {
    const credentials = await this.getTenantCredentialsOrThrow(input.tenantId);
    const accessToken = await this.issueChannelAccessToken(credentials.channelId, credentials.channelSecret);

    await this.callLineJson('/v2/bot/message/reply', {
      method: 'POST',
      accessToken,
      body: {
        replyToken: input.replyToken,
        messages: input.messages
      },
      operation: 'reply message'
    });
  }

  private async getTenantCredentialsOrThrow(tenantId: string): Promise<{ channelId: string; channelSecret: string }> {
    const credentials = await this.lineCredentialStore.getTenantCredentials(tenantId);

    if (!credentials) {
      throw new Error(`LINE credentials not found for tenant: ${tenantId}`);
    }

    return credentials;
  }

  private async issueChannelAccessToken(channelId: string, channelSecret: string): Promise<string> {
    const formBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: channelId,
      client_secret: channelSecret
    });

    const response = await this.fetchFn(`${this.apiBaseUrl}/v2/oauth/accessToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody.toString()
    });

    if (!response.ok) {
      const detail = await readResponseText(response);
      throw new Error(`LINE API issue access token failed (HTTP ${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token?.trim()) {
      throw new Error('LINE API issue access token response missing access_token');
    }

    return payload.access_token.trim();
  }

  private async callLineJson(
    path: string,
    input: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      accessToken: string;
      operation: string;
      body?: unknown;
    }
  ): Promise<unknown> {
    const endpoint = `${this.apiBaseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${input.accessToken}`
    };

    let serializedBody: string | undefined;
    if (input.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      serializedBody = JSON.stringify(input.body);
    }

    const response = await this.fetchFn(endpoint, {
      method: input.method,
      headers,
      body: serializedBody
    });

    if (!response.ok) {
      const detail = await readResponseText(response);
      throw new Error(`LINE API ${input.operation} failed (HTTP ${response.status}): ${detail}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return {};
    }

    return response.json();
  }

  private async uploadRichMenuImage(input: { accessToken: string; richMenuId: string; variant: 'pending' | 'approved' }): Promise<void> {
    const endpoint = `${this.apiDataBaseUrl}/v2/bot/richmenu/${encodeURIComponent(input.richMenuId)}/content`;
    const imageBytes = createRichMenuImagePng(input.variant);
    const imagePayload = new Uint8Array(imageBytes.byteLength);
    imagePayload.set(imageBytes);

    const response = await this.fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'image/png'
      },
      body: imagePayload
    });

    if (!response.ok) {
      const detail = await readResponseText(response);
      throw new Error(`LINE API upload rich menu image failed (HTTP ${response.status}): ${detail}`);
    }
  }

  private async createRichMenu(
    accessToken: string,
    payload: ReturnType<RealLinePlatformClient['createRichMenuRequest']>
  ): Promise<string> {
    const richMenuCreated = await this.callLineJson('/v2/bot/richmenu', {
      method: 'POST',
      accessToken,
      body: payload,
      operation: 'create rich menu'
    });

    const parsed = richMenuCreated as { richMenuId?: string };
    if (!parsed.richMenuId?.trim()) {
      throw new Error('LINE API create rich menu response missing richMenuId');
    }

    return parsed.richMenuId.trim();
  }

  private createRichMenuRequest(tenantId: string, variant: 'pending' | 'approved'): {
    size: {
      width: number;
      height: number;
    };
    selected: boolean;
    name: string;
    chatBarText: string;
    areas: Array<{
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      action: {
        type: 'message';
        text: string;
      };
    }>;
  } {
    if (variant === 'pending') {
      return {
        size: {
          width: 2500,
          height: 843
        },
        selected: true,
        name: `one-team-${tenantId}-pending`,
        chatBarText: '申請開通',
        areas: [
          {
            bounds: { x: 0, y: 0, width: 833, height: 843 },
            action: { type: 'message', text: '申請開通' }
          },
          {
            bounds: { x: 833, y: 0, width: 834, height: 843 },
            action: { type: 'message', text: '等待審核' }
          },
          {
            bounds: { x: 1667, y: 0, width: 833, height: 843 },
            action: { type: 'message', text: '聯絡管理員' }
          }
        ]
      };
    }

    return {
      size: {
        width: 2500,
        height: 843
      },
      selected: true,
      name: `one-team-${tenantId}-approved`,
      chatBarText: '員工服務',
      areas: [
        {
          bounds: { x: 0, y: 0, width: 833, height: 843 },
          action: { type: 'message', text: '按摩預約' }
        },
        {
          bounds: { x: 833, y: 0, width: 834, height: 843 },
          action: { type: 'message', text: '諮商預約' }
        },
        {
          bounds: { x: 1667, y: 0, width: 833, height: 843 },
          action: { type: 'message', text: '員工服務' }
        }
      ]
    };
  }
}

async function readResponseText(response: Response): Promise<string> {
  const text = await response.text();
  return text.trim() || 'No response body';
}

const richMenuImageCache = new Map<string, Uint8Array>();

function createRichMenuImagePng(variant: 'pending' | 'approved'): Uint8Array {
  const cached = richMenuImageCache.get(variant);
  if (cached) return cached;

  const config = RICH_MENU_VARIANTS[variant];
  const image = createRichMenuSvgPng({
    width: 2500,
    height: 843,
    bgColor: config.bgColor,
    labels: config.labels
  });

  richMenuImageCache.set(variant, image);
  return image;
}

const RICH_MENU_VARIANTS = {
  pending: {
    bgColor: { red: 44, green: 62, blue: 80 },       // #2C3E50
    labels: ['申請開通', '我的員工證', '聯絡管理員']
  },
  approved: {
    bgColor: { red: 26, green: 115, blue: 232 },      // #1a73e8
    labels: ['員工證', '我的資料', '員工服務']
  }
} as const;

function createRichMenuSvgPng(input: {
  width: number;
  height: number;
  bgColor: { red: number; green: number; blue: number };
  labels: readonly string[];
}): Uint8Array {
  // Build the image from a solid-color background.
  // We render text glyphs manually as filled rectangles so that this works
  // without any CJK font installed (e.g. on Amazon Linux / Lambda).
  const { width, height, bgColor, labels } = input;

  const bytesPerPixel = 4;
  const rowByteLength = 1 + width * bytesPerPixel;
  const rawImage = Buffer.alloc(rowByteLength * height);

  // Fill background
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * rowByteLength;
    rawImage[rowOffset] = 0; // PNG filter type 0 (None)
    for (let col = 0; col < width; col += 1) {
      const pixelOffset = rowOffset + 1 + col * bytesPerPixel;
      rawImage[pixelOffset] = bgColor.red;
      rawImage[pixelOffset + 1] = bgColor.green;
      rawImage[pixelOffset + 2] = bgColor.blue;
      rawImage[pixelOffset + 3] = 255;
    }
  }

  // Draw two vertical divider lines at x=833 and x=1667
  const dividerColor = {
    red: Math.min(255, bgColor.red + 30),
    green: Math.min(255, bgColor.green + 30),
    blue: Math.min(255, bgColor.blue + 30)
  };
  for (const dx of [833, 1667]) {
    for (let row = 120; row < 723; row += 1) {
      const rowOffset = row * rowByteLength;
      for (const col of [dx, dx + 1]) {
        if (col >= width) continue;
        const pixelOffset = rowOffset + 1 + col * bytesPerPixel;
        rawImage[pixelOffset] = dividerColor.red;
        rawImage[pixelOffset + 1] = dividerColor.green;
        rawImage[pixelOffset + 2] = dividerColor.blue;
        rawImage[pixelOffset + 3] = 255;
      }
    }
  }

  // Draw simplified block labels (each CJK char rendered as a 28x28 white block)
  const blockSize = 28;
  const gap = 12;
  const centerY = Math.floor(height / 2);
  const centers = [416, 1250, 2083]; // x centers for 3 columns

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const charCount = label.length;
    const totalWidth = charCount * blockSize + (charCount - 1) * gap;
    const startX = centers[i] - Math.floor(totalWidth / 2);
    const startY = centerY - Math.floor(blockSize / 2);

    for (let c = 0; c < charCount; c++) {
      const bx = startX + c * (blockSize + gap);
      const by = startY;
      for (let row = by; row < by + blockSize && row < height; row++) {
        const rowOffset = row * rowByteLength;
        for (let col = bx; col < bx + blockSize && col < width; col++) {
          if (col < 0) continue;
          const pixelOffset = rowOffset + 1 + col * bytesPerPixel;
          rawImage[pixelOffset] = 255;
          rawImage[pixelOffset + 1] = 255;
          rawImage[pixelOffset + 2] = 255;
          rawImage[pixelOffset + 3] = 255;
        }
      }
    }
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method

  const compressedData = deflateSync(rawImage, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = createPngChunk('IHDR', ihdrData);
  const idatChunk = createPngChunk('IDAT', compressedData);
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createSolidColorPng(input: {
  width: number;
  height: number;
  red: number;
  green: number;
  blue: number;
  alpha: number;
}): Uint8Array {
  const bytesPerPixel = 4;
  const rowByteLength = 1 + input.width * bytesPerPixel;
  const rawImage = Buffer.alloc(rowByteLength * input.height);

  for (let row = 0; row < input.height; row += 1) {
    const rowOffset = row * rowByteLength;
    rawImage[rowOffset] = 0; // PNG filter type 0 (None)

    for (let col = 0; col < input.width; col += 1) {
      const pixelOffset = rowOffset + 1 + col * bytesPerPixel;
      rawImage[pixelOffset] = input.red;
      rawImage[pixelOffset + 1] = input.green;
      rawImage[pixelOffset + 2] = input.blue;
      rawImage[pixelOffset + 3] = input.alpha;
    }
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(input.width, 0);
  ihdrData.writeUInt32BE(input.height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method

  const compressedData = deflateSync(rawImage, {
    level: 9
  });

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = createPngChunk('IHDR', ihdrData);
  const idatChunk = createPngChunk('IDAT', compressedData);
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createPngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const dataBytes = Buffer.from(data);

  const length = Buffer.alloc(4);
  length.writeUInt32BE(dataBytes.length, 0);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(calculateCrc32(Buffer.concat([typeBytes, dataBytes])), 0);

  return Buffer.concat([length, typeBytes, dataBytes, crc]);
}

const crc32LookupTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crc32LookupTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
