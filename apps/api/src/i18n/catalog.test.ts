import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JsonMessageCatalog, loadDefaultCatalog } from './catalog.js';

describe('JsonMessageCatalog', () => {
  const catalog = new JsonMessageCatalog({
    'zh-TW': {
      'welcome.message': '歡迎，{{name}}！',
      'only.zh': '僅中文'
    },
    en: {
      'welcome.message': 'Welcome, {{name}}!'
    }
  });

  it('returns zh-TW message by default', () => {
    const result = catalog.t('welcome.message', { name: 'Alice' });
    assert.equal(result, '歡迎，Alice！');
  });

  it('returns en message when locale specified', () => {
    const result = catalog.t('welcome.message', { name: 'Alice' }, 'en');
    assert.equal(result, 'Welcome, Alice!');
  });

  it('falls back to zh-TW when key not in requested locale', () => {
    const result = catalog.t('only.zh', undefined, 'en');
    assert.equal(result, '僅中文');
  });

  it('returns key when no translation found', () => {
    const result = catalog.t('missing.key');
    assert.equal(result, 'missing.key');
  });

  it('preserves unmatched template params', () => {
    const result = catalog.t('welcome.message', {});
    assert.equal(result, '歡迎，{{name}}！');
  });

  it('handles messages without params', () => {
    const result = catalog.t('only.zh');
    assert.equal(result, '僅中文');
  });
});

describe('loadDefaultCatalog', () => {
  it('loads default catalog with zh-TW and en', () => {
    const catalog = loadDefaultCatalog();

    assert.ok(catalog.t('welcome.message').includes('歡迎'));
    assert.ok(catalog.t('welcome.message', undefined, 'en').includes('Welcome'));
  });

  it('interpolates template params', () => {
    const catalog = loadDefaultCatalog();
    const result = catalog.t('email.invitation.subject', { tenantName: 'Acme' });
    assert.ok(result.includes('Acme'));
  });
});
