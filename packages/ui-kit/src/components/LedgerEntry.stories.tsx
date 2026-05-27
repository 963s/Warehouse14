import type { Meta, StoryObj } from '@storybook/react';

import { LedgerEntry } from './LedgerEntry.js';
import { MoneyAmount } from './MoneyAmount.js';

const meta: Meta<typeof LedgerEntry> = {
  title: 'Werkstatt/LedgerEntry',
  component: LedgerEntry,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof LedgerEntry>;

export const Sale: Story = {
  args: {
    timestamp: '2026-05-26T14:32:18.000Z',
    eventType: 'transaction.finalized',
    rightHint: <MoneyAmount valueEur="1420.00" />,
    subtitle: 'Shift #47 · Krugerrand 1oz',
  },
};

export const Reservation: Story = {
  args: {
    timestamp: '2026-05-26T14:21:00.000Z',
    eventType: 'product.reserved',
    rightHint: 'STOREFRONT',
    subtitle: 'Bestellnummer #12389 · TTL 15 min',
  },
};

export const Alert: Story = {
  args: {
    timestamp: '2026-05-26T13:58:42.000Z',
    eventType: 'alert.ebay_sale_conflict',
    subtitle: 'Lokale Reservierung POS · eBay verkauft',
    alert: true,
  },
};

export const Fresh: Story = {
  args: {
    timestamp: '2026-05-26T14:32:18.000Z',
    eventType: 'transaction.finalized',
    rightHint: <MoneyAmount valueEur="1420.00" />,
    fresh: true,
  },
};

export const Feed: Story = {
  render: () => (
    <div
      role="list"
      style={{
        display: 'grid',
        gap: 2,
        width: 460,
        backgroundColor: 'var(--w14-parchment)',
        padding: 12,
        borderRadius: 6,
        border: '1px solid var(--w14-rule)',
      }}
    >
      <LedgerEntry
        timestamp="2026-05-26T14:32:18.000Z"
        eventType="transaction.finalized"
        rightHint={<MoneyAmount valueEur="1420.00" />}
        subtitle="Krugerrand 1oz"
        fresh
      />
      <LedgerEntry
        timestamp="2026-05-26T14:21:00.000Z"
        eventType="product.reserved"
        rightHint="STOREFRONT"
      />
      <LedgerEntry
        timestamp="2026-05-26T13:58:42.000Z"
        eventType="alert.ebay_sale_conflict"
        subtitle="Lokale Reservierung POS · eBay verkauft"
        alert
      />
      <LedgerEntry
        timestamp="2026-05-26T13:40:11.000Z"
        eventType="shift.opened"
        subtitle="Float €200,00 · Owner"
      />
    </div>
  ),
};
