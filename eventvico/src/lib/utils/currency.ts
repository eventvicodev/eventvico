// Currency formatting helpers — uses Intl.NumberFormat for locale-aware display
// All monetary values are stored as integers (cents) in the database

export function formatCurrency(
  amountInCents: number,
  currency = 'USD',
  locale = 'en-US'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountInCents / 100)
}

export function centsFromDecimal(decimal: number): number {
  return Math.round(decimal * 100)
}
