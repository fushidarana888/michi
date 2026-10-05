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
  const weeklyFloor = Math.max(0, Number(goal.weekly_floor_rub ?? 0))
  const baseRatio = Number(goal.base_save_ratio ?? 0.4)
  const automaticFloor = roundDown(peak * autoRatio, 500)
  const effectiveFloor = Math.max(manualFloor, automaticFloor, weeklyFloor)

  let floorSource: SavingsAdvice['floorSource'] = 'none'
  if (effectiveFloor > 0) {
    if (manualFloor >= automaticFloor && manualFloor >= weeklyFloor) floorSource = 'manual'
    else if (weeklyFloor >= automaticFloor) floorSource = 'weekly'
    else floorSource = 'peak'
  }

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
    recommendedSaveRatio = Math.max(baseRatio, 0.6)
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
    const baseAmount = income * baseRatio
    let recoveryTarget = baseAmount

    if (reserveGap <= income * 0.25) {
      recoveryTarget = Math.max(baseAmount, reserveGap)
    } else if (reserveGap <= income) {
      recoveryTarget = Math.max(income * 0.55, Math.min(reserveGap, income * 0.65))
    } else {
      recoveryTarget = income * 0.7
    }

    recommendedFromNextIncome = roundRecommendation(Math.min(income * 0.75, recoveryTarget))
    recommendedSaveRatio = income > 0 ? recommendedFromNextIncome / income : baseRatio
  }

  let state: SavingsAdvice['state'] = 'building'
  let headline = 'Запас только формируется'
  let detail = 'Недельная линия будет понемногу поднимать минимальный баланс. Это темп накоплений, а не долг перед приложением.'

  if (reserveGap > 0) {
    state = 'recovering'
    headline = `До текущего минимума не хватает ${Math.round(reserveGap).toLocaleString('ru-RU')} ₽`
    detail = floorSource === 'weekly'
      ? 'Недельная линия уже поднялась выше текущего баланса. Со следующего поступления лучше отложить побольше, но закрывать разницу одним разом не обязательно.'
      : 'Защитный запас просел. Следующее поступление лучше заметно сильнее направить в запас, но закрывать всю разницу одним разом не нужно.'
  } else if (effectiveFloor > 0) {
    state = 'protected'
    if (freeToSpend > 0) {
      headline = `Свободно до ${Math.round(freeToSpend).toLocaleString('ru-RU')} ₽`
      detail = `Остальные ${Math.round(effectiveFloor).toLocaleString('ru-RU')} ₽ лучше считать минимальным уровнем долгой цели.`
    } else {
      headline = 'Ты прямо у текущего минимума'
      detail = 'Внутри копилки сейчас нет свободной части. Следующая недельная ступень поднимет планку ещё немного.'
    }
  }

  return {
    currentBalance,
    peakBalance: peak,
    automaticFloor,
    weeklyFloor,
    effectiveFloor,
    floorSource,
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
