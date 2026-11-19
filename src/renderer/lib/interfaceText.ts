const numberFormat = new Intl.NumberFormat('ru');
const pluralRules = new Intl.PluralRules('ru');

export function formatCount(count: number, one: string, few: string, many: string): string {
  const form = pluralRules.select(count);
  return `${numberFormat.format(count)} ${form === 'one' ? one : form === 'few' ? few : many}`;
}

export function trackCount(count: number): string {
  return formatCount(count, 'трек', 'трека', 'треков');
}

export const REPEAT_LABELS = {
  none: 'Выключен',
  all: 'Вся очередь',
  one: 'Один трек',
} as const;
