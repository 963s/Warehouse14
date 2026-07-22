import { describe, expect, it } from 'vitest';

import {
  RECEIPT_VAT_LOCK_REASON,
  SHOP_INFO,
  type ShopInfoApi,
  isReceiptShopValid,
  resolveShopInfo,
} from './shop-info.js';

const api = (over: Partial<ShopInfoApi> = {}): ShopInfoApi => ({
  name: 'W14',
  tagline: 'Antiquitäten',
  addressLine1: 'Rosenstraße 40',
  addressLine2: '73614 Schorndorf',
  vatId: 'DE811234567',
  phone: '+49 7181 123',
  ...over,
});

describe('resolveShopInfo — no placeholder VAT id ever prints (Phase 7.2 / GoBD)', () => {
  it('the bundled fallback carries NO VAT id', () => {
    expect(SHOP_INFO.vatId).toBe('');
    expect(resolveShopInfo(undefined).vatId).toBe('');
  });

  it('an empty/blank server VAT resolves to empty, never DE123456789', () => {
    expect(resolveShopInfo(api({ vatId: '' })).vatId).toBe('');
    expect(resolveShopInfo(api({ vatId: '   ' })).vatId).toBe('');
  });

  it('takes the real server VAT id when configured', () => {
    expect(resolveShopInfo(api({ vatId: ' DE811234567 ' })).vatId).toBe('DE811234567');
  });

  it('drops an empty phone to null, keeps a real one (trimmed)', () => {
    expect(resolveShopInfo(api({ phone: '' })).phone).toBeNull();
    expect(resolveShopInfo(api({ phone: '   ' })).phone).toBeNull();
    expect(resolveShopInfo(api({ phone: ' +49 7181 123 ' })).phone).toBe('+49 7181 123');
  });

  it('address is a safe-to-default field: server lines win, else the bundled address', () => {
    // Server carries both lines → server wins.
    expect(resolveShopInfo(api()).address).toEqual([
      'Rosenstraße 40',
      '73614 Schorndorf',
    ]);
    // Server carries neither line → fall back to the bundled address (never blank).
    expect(resolveShopInfo(api({ addressLine1: '', addressLine2: '' })).address).toEqual(
      SHOP_INFO.address,
    );
    // A single blank line is filtered but the present line still wins.
    expect(resolveShopInfo(api({ addressLine1: 'Nur eine Zeile', addressLine2: '' })).address).toEqual(
      ['Nur eine Zeile'],
    );
  });
});

describe('isReceiptShopValid — the receipt-lock predicate', () => {
  it('locks (false) when the VAT id is missing or blank', () => {
    expect(isReceiptShopValid(resolveShopInfo(undefined))).toBe(false);
    expect(isReceiptShopValid(resolveShopInfo(api({ vatId: '' })))).toBe(false);
    expect(isReceiptShopValid(resolveShopInfo(api({ vatId: '  ' })))).toBe(false);
  });

  it('is valid (true) with a configured VAT id', () => {
    expect(isReceiptShopValid(resolveShopInfo(api({ vatId: 'DE811234567' })))).toBe(true);
  });
});

describe('RECEIPT_VAT_LOCK_REASON — one honest, dash-free lock message', () => {
  it('names the missing USt-IdNr. and points to the settings', () => {
    expect(RECEIPT_VAT_LOCK_REASON).toContain('USt-IdNr.');
    expect(RECEIPT_VAT_LOCK_REASON).toContain('Einstellungen');
  });

  it('carries no em/en dash (house style)', () => {
    expect(RECEIPT_VAT_LOCK_REASON).not.toMatch(/[—–]/);
  });
});
