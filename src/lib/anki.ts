import { supabase } from './supabase'

const ANKI_ENDPOINT = 'http://127.0.0.1:8765'
const ANKI_KEY_STORAGE = 'michi-anki-api-key'
const ANKI_API_VERSION = 6

type AnkiEnvelope<T> = { result: T; error: string | null }

type PermissionResult = {
  permission: 'granted' | 'denied'
  requireApiKey?: boolean
  requireApikey?: boolean
  version?: number
}

type CardInfo = {
  cardId: number
  note?: number
  deckName?: string
  question?: string
  answer?: string
  interval?: number
  factor?: number
  reps?: number
  lapses?: number
  mod?: number
}

type ReviewTuple = [
  reviewTime: number,
  cardId: number,
  usn: number,
  ease: number,
  intervalValue: number,
  previousInterval: number,
  factor: number,
  durationMs: number,
  reviewType: number,
]

export type AnkiConnectionRow = {
  user_id: string
  deck_name: string | null
  last_review_id: number
  last_sync_at: string | null
  last_card_count: number
}

export type AnkiCardRow = {
  id: string
  user_id: string
  anki_card_id: number
  note_id: number | null
  deck_name: string
  question_text: string | null
  answer_text: string | null
  reps: number
  lapses: number
  interval_days: number
  ease_factor: number
  anki_modified_at: number | null
  first_reviewed_at: string | null
  last_reviewed_at: string | null
  created_at: string
  updated_at: string
}

export type AnkiReviewRow = {
  id: string
  user_id: string
  review_id: number
  anki_card_id: number
  reviewed_at: string
  ease: number
  interval_value: number
  previous_interval: number
  factor: number
  duration_ms: number
  review_type: number
}

export type AnkiSyncProgress = {
  stage: 'cards' | 'reviews' | 'saving' | 'done'
  current: number
  total: number
  text: string
}

export type AnkiSyncResult = {
  deckName: string
  cardCount: number
  newReviewCount: number
  latestReviewId: number
  syncedAt: string
}

function getStoredKey() {
  try {
    return localStorage.getItem(ANKI_KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

export function setStoredAnkiKey(value: string) {
  try {
    if (value.trim()) localStorage.setItem(ANKI_KEY_STORAGE, value.trim())
    else localStorage.removeItem(ANKI_KEY_STORAGE)
  } catch {
    // Local-only secret. Michi still works if storage is unavailable.
  }
}

export function getStoredAnkiKeyValue() {
  return getStoredKey()
}

async function invoke<T>(action: string, params: Record<string, unknown> = {}, includeKey = true): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12_000)
  const key = includeKey ? getStoredKey() : ''
  const body: Record<string, unknown> = { action, version: ANKI_API_VERSION, params }
  if (key) body.key = key

  try {
    const response = await fetch(ANKI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`AnkiConnect ответил ${response.status}`)
    const payload = await response.json() as AnkiEnvelope<T>
    if (payload.error) throw new Error(payload.error)
    return payload.result
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('AnkiConnect не ответил. Проверь, что Anki открыт на этом компьютере.')
    }
    if (error instanceof TypeError) {
      throw new Error('Не удалось связаться с AnkiConnect. Открой Anki на ПК и разреши Michi доступ к локальной сети / AnkiConnect.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function requestAnkiPermission() {
  const result = await invoke<PermissionResult>('requestPermission', {}, false)
  return {
    ...result,
    requireApiKey: Boolean(result.requireApiKey ?? result.requireApikey),
  }
}

export async function getAnkiDeckNames() {
  return invoke<string[]>('deckNames')
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function plainText(html?: string) {
  if (!html) return ''
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return (doc.body.textContent || '')
      .replace(/\[sound:[^\]]+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
}

function deckQuery(deckName: string) {
  const escaped = deckName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `deck:"${escaped}"`
}

export async function loadAnkiConnection(userId: string) {
  const { data, error } = await supabase
    .from('anki_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return (data || null) as AnkiConnectionRow | null
}

export async function saveAnkiDeck(userId: string, deckName: string) {
  const existing = await loadAnkiConnection(userId)
  const deckChanged = Boolean(existing?.deck_name && existing.deck_name !== deckName)
  const { data, error } = await supabase
    .from('anki_connections')
    .upsert({
      user_id: userId,
      deck_name: deckName,
      last_review_id: deckChanged ? 0 : Number(existing?.last_review_id || 0),
      last_sync_at: deckChanged ? null : existing?.last_sync_at || null,
      last_card_count: deckChanged ? 0 : Number(existing?.last_card_count || 0),
    }, { onConflict: 'user_id' })
    .select('*')
    .single()
  if (error) throw error
  return data as AnkiConnectionRow
}

export async function syncAnkiToMichi(
  userId: string,
  deckName: string,
  onProgress?: (progress: AnkiSyncProgress) => void,
): Promise<AnkiSyncResult> {
  const connection = await loadAnkiConnection(userId)
  const sameDeck = connection?.deck_name === deckName
  const startId = sameDeck ? Number(connection?.last_review_id || 0) : 0

  onProgress?.({ stage: 'cards', current: 0, total: 1, text: 'Читаем карточки из Anki…' })
  const cardIds = await invoke<number[]>('findCards', { query: deckQuery(deckName) })
  const infoBatches = chunk(cardIds, 250)
  const cardInfos: CardInfo[] = []

  for (let index = 0; index < infoBatches.length; index += 1) {
    const batchInfo = await invoke<CardInfo[]>('cardsInfo', { cards: infoBatches[index] })
    cardInfos.push(...batchInfo)
    onProgress?.({ stage: 'cards', current: index + 1, total: Math.max(1, infoBatches.length), text: `Карточки: ${Math.min(cardIds.length, (index + 1) * 250)} из ${cardIds.length}` })
  }

  const cardRows = cardInfos.map((card) => ({
    user_id: userId,
    anki_card_id: Number(card.cardId),
    note_id: card.note == null ? null : Number(card.note),
    deck_name: card.deckName || deckName,
    question_text: plainText(card.question).slice(0, 1000) || null,
    answer_text: plainText(card.answer).slice(0, 1000) || null,
    reps: Math.max(0, Number(card.reps || 0)),
    lapses: Math.max(0, Number(card.lapses || 0)),
    interval_days: Number(card.interval || 0),
    ease_factor: Number(card.factor || 0),
    anki_modified_at: card.mod == null ? null : Number(card.mod),
  }))

  onProgress?.({ stage: 'reviews', current: 0, total: 1, text: startId > 0 ? 'Читаем новые повторения…' : 'Импортируем историю повторений…' })
  const rawReviews = await invoke<ReviewTuple[]>('cardReviews', { deck: deckName, startID: startId })
  const currentCardIds = new Set(cardRows.map((row) => row.anki_card_id))
  const uniqueReviews = new Map<number, ReviewTuple>()
  for (const review of rawReviews) {
    if (currentCardIds.has(Number(review[1]))) uniqueReviews.set(Number(review[0]), review)
  }
  const reviews = [...uniqueReviews.values()].sort((a, b) => a[0] - b[0])

  onProgress?.({ stage: 'saving', current: 0, total: 2, text: 'Сохраняем карточки в Michi…' })
  for (const batch of chunk(cardRows, 300)) {
    if (!batch.length) continue
    const { error } = await supabase
      .from('anki_cards')
      .upsert(batch, { onConflict: 'user_id,anki_card_id' })
    if (error) throw error
  }

  onProgress?.({ stage: 'saving', current: 1, total: 2, text: 'Сохраняем историю повторений…' })
  const reviewRows = reviews.map((review) => ({
    user_id: userId,
    review_id: Number(review[0]),
    anki_card_id: Number(review[1]),
    reviewed_at: new Date(Number(review[0])).toISOString(),
    ease: Math.max(0, Math.min(4, Number(review[3] || 0))),
    interval_value: Number(review[4] || 0),
    previous_interval: Number(review[5] || 0),
    factor: Number(review[6] || 0),
    duration_ms: Math.max(0, Number(review[7] || 0)),
    review_type: Number(review[8] || 0),
  }))

  for (const batch of chunk(reviewRows, 800)) {
    if (!batch.length) continue
    const { error } = await supabase
      .from('anki_reviews')
      .upsert(batch, { onConflict: 'user_id,review_id', ignoreDuplicates: true })
    if (error) throw error
  }

  let latestReviewId = startId
  if (reviews.length) latestReviewId = Math.max(latestReviewId, ...reviews.map((review) => Number(review[0])))
  try {
    const latestFromAnki = await invoke<number>('getLatestReviewID', { deck: deckName })
    latestReviewId = Math.max(latestReviewId, Number(latestFromAnki || 0))
  } catch {
    // cardReviews already gave us a safe cursor; this extra action is only an optimization.
  }

  const syncedAt = new Date().toISOString()
  const { error: connectionError } = await supabase
    .from('anki_connections')
    .upsert({
      user_id: userId,
      deck_name: deckName,
      last_review_id: latestReviewId,
      last_sync_at: syncedAt,
      last_card_count: cardIds.length,
    }, { onConflict: 'user_id' })
  if (connectionError) throw connectionError

  onProgress?.({ stage: 'done', current: 1, total: 1, text: 'Anki синхронизирован.' })
  return {
    deckName,
    cardCount: cardIds.length,
    newReviewCount: reviewRows.length,
    latestReviewId,
    syncedAt,
  }
}

async function fetchPaged<T>(build: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>, pageSize = 1000) {
  const all: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw error
    const rows = data || []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  return all
}

export async function loadAnkiDashboardData(userId: string) {
  const cutoff = new Date(Date.now() - 31 * 86_400_000).toISOString()
  const [connection, cards, reviews] = await Promise.all([
    loadAnkiConnection(userId),
    fetchPaged<AnkiCardRow>(async (from, to) => {
      const result = await supabase
        .from('anki_cards')
        .select('*')
        .eq('user_id', userId)
        .order('lapses', { ascending: false })
        .order('reps', { ascending: false })
        .range(from, to)
      return { data: result.data as AnkiCardRow[] | null, error: result.error }
    }),
    fetchPaged<AnkiReviewRow>(async (from, to) => {
      const result = await supabase
        .from('anki_reviews')
        .select('*')
        .eq('user_id', userId)
        .gte('reviewed_at', cutoff)
        .order('reviewed_at', { ascending: false })
        .range(from, to)
      return { data: result.data as AnkiReviewRow[] | null, error: result.error }
    }),
  ])

  return { connection, cards, reviews }
}
