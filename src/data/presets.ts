export const STUDY_PRESETS = [
  {
    slug: 'japanese',
    name: 'Японский',
    icon: 'あ',
    goalTitle: 'Японский — JLPT N4',
    goalDescription: 'Спокойно пройти базу N5, перейти к N4 и закрепить язык практикой.',
    stages: ['Фундамент', 'Уровень N5', 'Переход к N4', 'Закрепление N4'],
    topics: [
      ['Слова и повторение', 5],
      ['Базовая грамматика', 5],
      ['Чтение', 3],
      ['Аудирование', 4],
    ],
  },
  {
    slug: 'math',
    name: 'Профильная математика',
    icon: '∑',
    goalTitle: 'Профильная математика ЕГЭ',
    goalDescription: 'Закрыть базу, пройти темы ЕГЭ и постепенно перейти к полным вариантам.',
    stages: ['Закрыть пробелы', 'Первая часть', 'Сложные темы', 'Пробники'],
    topics: [
      ['Алгебраическая база', 5],
      ['Уравнения и неравенства', 5],
      ['Геометрия', 5],
      ['Задачи ЕГЭ', 4],
    ],
  },
  {
    slug: 'russian',
    name: 'Русский язык',
    icon: 'Я',
    goalTitle: 'Русский ЕГЭ — 65+',
    goalDescription: 'Пройти теорию, закрепить задания и научиться стабильно писать сочинение.',
    stages: ['База и правила', 'Задания по темам', 'Смешанная практика', 'Пробники и сочинение'],
    topics: [
      ['Задание 3 и работа с текстом', 5],
      ['Ударения', 4],
      ['Орфография и пунктуация', 5],
      ['Сочинение', 4],
    ],
  },
] as const

export const MOODS = [
  { value: 1, emoji: '😢', label: 'Очень грустно' },
  { value: 2, emoji: '🙁', label: 'Плохо' },
  { value: 3, emoji: '😐', label: 'Обычно' },
  { value: 4, emoji: '🙂', label: 'Хорошо' },
  { value: 5, emoji: '😄', label: 'Очень хорошо' },
] as const

export const NEGATIVE_REASONS = [
  ['tired', 'Устал'],
  ['school', 'Школа'],
  ['sleep', 'Мало спал'],
  ['study', 'Учёба не получается'],
  ['social', 'Ссора / общение'],
  ['stress', 'Стресс'],
  ['health', 'Плохое самочувствие'],
  ['future', 'Переживания о будущем'],
  ['other_bad', 'Просто плохое настроение'],
] as const

export const NEUTRAL_REASONS = [
  ['usual', 'Обычный день'],
  ['mixed', 'Всё понемногу'],
  ['tired_ok', 'Немного устал'],
  ['calm', 'Спокойно'],
] as const

export const POSITIVE_REASONS = [
  ['school_good', 'Хороший день в школе'],
  ['study_good', 'Получилось в учёбе'],
  ['social_good', 'Общение'],
  ['rest', 'Отдых'],
  ['hobby', 'Хобби'],
  ['sport', 'Прогулка / спорт'],
  ['event', 'Что-то хорошее произошло'],
  ['other_good', 'Просто хорошее настроение'],
] as const

export function reasonsForMood(value: number) {
  if (value <= 2) return NEGATIVE_REASONS
  if (value >= 4) return POSITIVE_REASONS
  return NEUTRAL_REASONS
}
