import type { Meta, StoryObj } from '@storybook/react';

import { DiamondRule } from './DiamondRule.js';

const meta: Meta<typeof DiamondRule> = {
  title: 'Brand/DiamondRule',
  component: DiamondRule,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof DiamondRule>;

export const Bare: Story = { args: {} };
export const WithLabel: Story = { args: { label: 'Zahlung' } };
export const Sequence: Story = {
  render: () => (
    <div style={{ width: 480 }}>
      <DiamondRule label="Belegtext" />
      <p style={{ margin: 0 }}>Differenzbesteuerung gemäß § 25a UStG.</p>
      <DiamondRule label="Zahlung" />
      <p style={{ margin: 0 }}>Bar · €1.420,00</p>
    </div>
  ),
};
