export function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

export function monthStartKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return year + '-' + month + '-01'
}

export function formatDateRu(value: string) {
  const date = new Date(value + 'T12:00:00')
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function daysSince(value?: string | null) {
  if (!value) return 999
  const then = new Date(value).getTime()
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}
