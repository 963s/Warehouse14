/**
 * Staff administration (Track A3) — the visual replacement for the provisioning
 * script. The Owner adds / re-roles a staff member (whose Google email then
 * unlocks the app) and can deactivate one.
 *
 *   GET  /api/admin/staff              — list active staff (ADMIN read).
 *   POST /api/admin/staff             — provision / re-role (OWNER + step-up).
 *   POST /api/admin/staff/:id/deactivate — soft-delete a member (OWNER + step-up).
 *
 * Role writes go through the SECURITY DEFINER `provision_staff()` function
 * (migration 0084), never a direct UPDATE — the app role stays REVOKEd from
 * `users.role`. `is_owner` is never touched here. The Owner cannot deactivate
 * themselves or the Owner row.
 */

import { Type } from '@sinclair/typebox';
import { and, eq, isNull, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, users } from '@warehouse14/db/schema';

import { ForbiddenError, requireAuth, requireOwner, requireRole, requireStepUp } from '../lib/auth-policy.js';

const RoleEnum = Type.Union([
  Type.Literal('ADMIN'),
  Type.Literal('CASHIER'),
  Type.Literal('READONLY'),
]);

const CreateBody = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 200, format: 'email' }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  role: RoleEnum,
});

interface CreateShape {
  email: string;
  name: string;
  role: 'ADMIN' | 'CASHIER' | 'READONLY';
}

const adminStaffRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /api/admin/staff ──────────────────────────────────────────────
  app.get(
    '/api/admin/staff',
    { schema: { tags: ['auth'], summary: 'List active staff members.' } },
    async (req) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const rows = await app.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          isOwner: users.isOwner,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(isNull(users.softDeletedAt))
        .orderBy(users.createdAt);
      return {
        items: rows.map((r) => ({
          id: r.id,
          email: r.email,
          name: r.name,
          role: r.role,
          isOwner: r.isOwner,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );

  // ── POST /api/admin/staff ─────────────────────────────────────────────
  app.post(
    '/api/admin/staff',
    { schema: { tags: ['auth'], summary: 'Provision or re-role a staff member.', body: CreateBody } },
    async (req) => {
      requireAuth(req);
      requireOwner(req);
      requireStepUp(req);

      const body = req.body as CreateShape;
      const email = body.email.trim().toLowerCase();

      const id = await app.db.transaction(async (tx) => {
        const rows = await tx.execute<{ id: string }>(drizzleSql`
          SELECT provision_staff(${email}::citext, ${body.name.trim()}, ${body.role}::user_role) AS id`);
        const newId = rows[0]?.id;
        if (!newId) throw new Error('provision_staff returned no id');
        await tx.insert(auditLog).values({
          eventType: 'staff.provisioned',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          payload: { staffUserId: newId, email, role: body.role },
        });
        return newId;
      });

      return { ok: true as const, id, email, name: body.name.trim(), role: body.role };
    },
  );

  // ── POST /api/admin/staff/:id/deactivate ──────────────────────────────
  app.post(
    '/api/admin/staff/:id/deactivate',
    {
      schema: {
        tags: ['auth'],
        summary: 'Deactivate (soft-delete) a staff member.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (req) => {
      requireAuth(req);
      requireOwner(req);
      requireStepUp(req);

      const { id } = req.params as { id: string };
      if (id === req.actor.id) {
        throw new ForbiddenError('Das eigene Konto kann nicht deaktiviert werden.');
      }

      const done = await app.db.transaction(async (tx) => {
        // Never the Owner, never an already-deactivated row.
        const res = await tx
          .update(users)
          .set({ softDeletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(eq(users.id, id), eq(users.isOwner, false), isNull(users.softDeletedAt)),
          )
          .returning({ id: users.id });
        if (res.length > 0) {
          await tx.insert(auditLog).values({
            eventType: 'staff.deactivated',
            actorUserId: req.actor.id,
            deviceId: req.deviceId ?? null,
            ipAddress: req.ip ?? null,
            userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
            payload: { staffUserId: id },
          });
        }
        return res.length > 0;
      });

      return { ok: true as const, deactivated: done };
    },
  );
};

export default adminStaffRoutes;
