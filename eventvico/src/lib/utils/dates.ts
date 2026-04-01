// Date formatting helpers — always use Intl.DateTimeFormat, never toLocaleDateString()
// Dates are stored as ISO 8601 strings in the database and API layer

export function formatDate(
  dateString: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
  locale = 'en-US'
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(dateString))
}

export function formatDateTime(dateString: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(dateString))
}

export function formatTime(dateString: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
    new Date(dateString)
  )
}
