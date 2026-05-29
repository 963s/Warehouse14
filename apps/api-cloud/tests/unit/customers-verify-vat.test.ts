import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { customersVerifyVatRoute } from '../../src/routes/customers-verify-vat.js';
import errorHandlerPlugin from '../../src/plugins/error-handler.js';

describe('customers-verify-vat route', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(customersVerifyVatRoute);

    // Decorate request with mock auth to satisfy requireAuth and requireRole
    app.addHook('onRequest', async (req) => {
      req.actor = {
        id: 'actor-123',
        role: 'CASHIER',
        isOwner: false,
        email: 'cashier@warehouse14.de',
      };
      req.session = {
        userId: 'actor-123',
        actorId: 'actor-123',
        role: 'CASHIER',
      } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid format VAT IDs early without fetching VIES', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // Too short after cleanup
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE%201', // length 4, cleans up to DE1 (length 3)
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json()).toEqual({ valid: false, error: 'INVALID_FORMAT' });

    // Invalid country code characters
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=1234567', // cleans up to 1234567, country code starts with 12
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toEqual({ valid: false, error: 'INVALID_FORMAT' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns valid: true and VIES details when EU VIES returns isValid: true', async () => {
    const mockResponse = {
      isValid: true,
      name: 'Google Ireland Limited',
      address: 'Gordon House, Barrow Street, Dublin 4',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=IE6388047V',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      valid: true,
      name: 'Google Ireland Limited',
      address: 'Gordon House, Barrow Street, Dublin 4',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IE/vat/6388047V',
      expect.any(Object)
    );
  });

  it('replaces masked or empty details with --- (DE/ES privacy rules)', async () => {
    const mockResponse = {
      isValid: true,
      name: ' ', // empty name
      address: '---', // masked address
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE123456789',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      valid: true,
      name: '---',
      address: '---',
    });
  });

  it('returns valid: false when EU VIES returns isValid: false', async () => {
    const mockResponse = {
      isValid: false,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE999999999',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      valid: false,
    });
  });

  it('handles VIES service non-200 outage gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE123456789',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      valid: false,
      error: 'VIES_UNAVAILABLE',
    });
  });

  it('handles VIES lookup timeout gracefully', async () => {
    const abortError = new Error('The user aborted a request.');
    abortError.name = 'AbortError';

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE123456789',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      valid: false,
      error: 'VIES_TIMEOUT',
    });
  });

  it('handles generic network/lookup errors gracefully as VIES_UNAVAILABLE', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DNS lookup failed'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE123456789',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      valid: false,
      error: 'VIES_UNAVAILABLE',
    });
  });
});
