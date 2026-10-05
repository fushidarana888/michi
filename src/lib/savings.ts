import type { SavingsAdvice, SavingsGoal, SavingsTransaction } from '../types'

function roundDown(value: number, step = 500) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value / step) * step
}

function roundRecommendation(value: number, step = 50) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(value, Math.round(value / step) * step)
}

function transactionTime(item: SavingsTransaction) {
  return new Date(`${item.occurred_on}T12:00:00`).getTime() + new Date(item.created_at).getTime() / 1e9
}

export function buildSavingsAdvice(
  goal: SavingsGoal,
  transactions: SavingsTransaction[],
  nextIncomeRub = 0,
): SavingsAdvice {
  const chronological = [...transactions].sort((a, b) => transactionTime(a) - transactionTime(b))
  let running = 0
  let peak = 0

  for (const item of chronological) {
    running += Number(item.saved_amount_rub || 0)
    peak = Math.max(peak, running)
  }

  const currentBalance = running
  const autoRatio = Number(goal.auto_floor_ratio ?? 0.7)
  const manualFloor = Number(goal.protected_floor_rub ?? 0)
  const baseRatio = Number(goal.base_save_ratio ?? 0.4)
  const automaticFloor = roundDown(peak * autoRatio, 500)
  const effectiveFloor = Math.max(manualFloor, automaticFloor)
  const freeToSpend = Math.max(0, currentBalance - effectiveFloor)
  const reserveGap = Math.max(0, effectiveFloor - currentBalance)

  const cutoff = Date.now() - 90 * 86_400_000
  const recent = chronological.filter((item) => new Date(`${item.occurred_on}T12:00:00`).getTime() >= cutoff)
  const recentReceived = recent.reduce((sum, item) => sum + Number(item.received_amount_rub || 0), 0)
  const recentSaved = recent.reduce((sum, item) => sum + Math.max(0, Number(item.saved_amount_rub || 0)), 0)
  const recentWithdrawals = recent.reduce((sum, item) => sum + Math.max(0, -Number(item.saved_amount_rub || 0)), 0)
  const recentSaveRatio = recentReceived > 0 ? Math.min(1, recentSaved / recentReceived) : null
  const drawdown = Math.max(0, peak - currentBalance)

  let recommendedSaveRatio = baseRatio
  if (reserveGap > 0) {
    recommendedSaveRatio = Math.max(baseRatio, 0.7)
  } else if (peak >= 2000 && drawdown >= Math.max(1000, peak * 0.15)) {
    recommendedSaveRatio = Math.max(baseRatio, 0.6)
  } else if (recentReceived >= 1000 && recentSaveRatio !== null && recentSaveRatio < baseRatio * 0.6) {
    recommendedSaveRatio = Math.min(0.65, Math.max(baseRatio + 0.15, 0.5))
  } else if (recentWithdrawals > 0 && recentWithdrawals >= Math.max(1000, peak * 0.1)) {
    recommendedSaveRatio = Math.max(baseRatio, 0.55)
  }

  const income = Math.max(0, Number(nextIncomeRub || 0))
  let recommendedFromNextIncome = roundRecommendation(income * recommendedSaveRatio)
  if (reserveGap > 0 && income > 0) {
    recommendedFromNextIncome = Math.min(income, Math.max(recommendedFromNextIncome, roundRecommendation(Math.min(reserveGap, income))))
  }

  let state: SavingsAdvice['state'] = 'building'
  let headline = 'Запас только формируется'
  let detail = 'Пока защитная линия небольшая. По мере роста копилки Michi будет автоматически оставлять большую часть прошлых достижений неприкосновенной.'

  if (reserveGap > 0) {
    state = 'recovering'
    headline = `Защитный запас просел на ${Math.round(reserveGap).toLocaleString('ru-RU')} ₽`
    detail = 'Следующее поступление лучше частично направить на восстановление запаса. Это рекомендация, а не обязательный платёж.'
  } else if (effectiveFloor > 0) {
    state = 'protected'
    if (freeToSpend > 0) {
      headline = `Свободно до ${Math.round(freeToSpend).toLocaleString('ru-RU')} ₽`
      detail = `Остальные ${Math.round(effectiveFloor).toLocaleString('ru-RU')} ₽ лучше считать неприкосновенной частью долгой цели.`
    } else {
      headline = 'Свободной части внутри копилки сейчас нет'
      detail = `Баланс находится у защитной линии ${Math.round(effectiveFloor).toLocaleString('ru-RU')} ₽. Трата уже будет забирать деньги из долгосрочного запаса.`
    }
  }

  return {
    currentBalance,
    peakBalance: peak,
    automaticFloor,
    effectiveFloor,
    freeToSpend,
    reserveGap,
    recentSaveRatio,
    recommendedSaveRatio,
    recommendedFromNextIncome,
    state,
    headline,
    detail,
  }
}
