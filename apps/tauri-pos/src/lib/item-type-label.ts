/**
 * Shared German display labels + option list for a product's item type.
 *
 * Single source for every operator-facing surface (Lager table, product
 * sheet, intake drafts). Branch HERE — not at the call site — so the
 * surfaces stay drift-free.
 */

export type ItemType =
  | 'gold_jewelry'
  | 'gold_coin'
  | 'gold_bar'
  | 'silver_jewelry'
  | 'silver_coin'
  | 'silver_bar'
  | 'platinum_jewelry'
  | 'platinum_coin'
  | 'platinum_bar'
  | 'antique'
  | 'watch'
  | 'other';

export const ITEM_TYPE_LABEL: Readonly<Record<ItemType, string>> = Object.freeze({
  gold_jewelry: 'Goldschmuck',
  gold_coin: 'Goldmünze',
  gold_bar: 'Goldbarren',
  silver_jewelry: 'Silberschmuck',
  silver_coin: 'Silbermünze',
  silver_bar: 'Silberbarren',
  platinum_jewelry: 'Platinschmuck',
  platinum_coin: 'Platinmünze',
  platinum_bar: 'Platinbarren',
  antique: 'Antiquität',
  watch: 'Uhr',
  other: 'Sonstiges',
});

export const ITEM_TYPE_OPTIONS: ReadonlyArray<{ value: ItemType; label: string }> = Object.freeze(
  (Object.keys(ITEM_TYPE_LABEL) as ItemType[]).map((value) => ({
    value,
    label: ITEM_TYPE_LABEL[value],
  })),
);
