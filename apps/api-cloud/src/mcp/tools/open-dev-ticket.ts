/**
 * MCP tool: `open_dev_ticket` — the safe escape hatch for the voice assistant.
 *
 * Jarvis (Vierzehn) is forbidden from running code / touching the system. When
 * the owner asks for a code change, a new feature, or any programmatic work,
 * the assistant refuses that action but offers to forward the wish to the
 * developer (Basel). This tool records that wish as an internal task assigned
 * to the owner, so it surfaces in the app's task list / notifications and the
 * developer can act on it. It is the ONLY write the assistant may perform.
 *
 * Safe by construction: it only inserts an OPEN internal_tasks row (title +
 * description). It touches no fiscal, customer, or system data.
 */

import { Type } from '@sinclair/typebox';

import { internalTasks } from '@warehouse14/db/schema';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

export const OpenDevTicketArgs = Type.Object({
  title: Type.String({
    minLength: 1,
    maxLength: 160,
    description: 'Kurzer Titel der Anfrage, zum Beispiel „Neue Auswertung für Wochenumsatz".',
  }),
  request: Type.String({
    minLength: 1,
    maxLength: 4000,
    description: 'Die vollständige Anfrage des Inhabers an den Entwickler, klar zusammengefasst.',
  }),
});

interface ArgsShape {
  title: string;
  request: string;
}

const handler: ToolHandler<ArgsShape> = async (
  ctx: ToolInvocationContext,
  args: ArgsShape,
): Promise<ToolResult> => {
  const title = `Jarvis-Anfrage: ${args.title}`.slice(0, 200);

  // OPEN task: no lifecycle timestamps (satisfies the open_no_timestamps CHECK);
  // status OPEN comes from the column default. Assigned to + created by the
  // current owner so it lands in the owner's day-list, and priority HIGH so a
  // Jarvis request rises to the top of the Aufgaben list (sorted priority desc)
  // and is easy to find + close.
  const inserted = await ctx.db
    .insert(internalTasks)
    .values({
      title,
      description: args.request,
      priority: 'HIGH',
      assignedToUserId: ctx.actor.id,
      createdByUserId: ctx.actor.id,
    })
    .returning({ id: internalTasks.id });

  const ticketId = inserted[0]?.id;
  ctx.logger.info({ ticketId, title }, 'mcp.open_dev_ticket: forwarded a request to the developer');

  return {
    content: [
      {
        type: 'text',
        text: `Support-Ticket für den Entwickler Basel geöffnet: „${args.title}". Es liegt jetzt in der Aufgabenliste.`,
      },
    ],
    data: { ticketId: ticketId ?? null, title: args.title },
    ...(ticketId ? { affectedEntity: { table: 'internal_tasks', id: ticketId } } : {}),
  };
};

export const openDevTicketTool: ToolRegistration = {
  manifest: {
    name: 'open_dev_ticket',
    description:
      'Opens a support/development ticket for the developer (Basel) as an internal task assigned to ' +
      'the owner. Use this whenever the owner asks for a code change, a new feature, a system or ' +
      'configuration modification, or anything programmatic that the assistant must NOT do itself. ' +
      'It records the request so the developer can act on it; it never touches fiscal or system state.',
    inputSchema: OpenDevTicketArgs,
    requiredRoles: ['ADMIN'],
    isMutation: true,
    // The one deliberate write the assistant may make: forward a request to
    // the developer. Records an internal task; touches no fiscal/system state.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
