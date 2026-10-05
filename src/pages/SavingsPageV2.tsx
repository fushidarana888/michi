import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowDownCircle, PiggyBank, ShieldCheck, Sparkles } from 'lucide-react'
import { formatDateRu, localDateKey } from '../lib/date'
import { buildSavingsAdvice } from '../lib/savings'
import { supabase } from '../lib/supabase'
import type { SavingsGoal, SavingsTransaction } from '../types'
import './SavingsPageV2.css'
import './SavingsWeekly.css'

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)
}

function formatRub(value: number) {
  return `${formatNumber(Math.round(value))} ₽`
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100)))
}

function nextWeeklyBump(goal: SavingsGoal) {
  const last = new Date(`${goal.weekly_floor_last_bump_on}T12:00:00`)
  const next = new Date(last)
  next.setDate(next.getDate() + 7)
  const days = Math.max(0, Math.ceil((next.getTime() - Date.now()) / 86_400_000))
  return { date: next, days }
}

export function SavingsPageV2({ userId }: { userId: string }) {
  const [goal, setGoal] = useState<SavingsGoal | null>(null)
  const [transactions, setTransactions] = useState<SavingsTransaction[]>([])
  const [received, setReceived] = useState('1000')
  const [saved, setSaved] = useState('0')
  const [source, setSource] = useState('Еженедельные деньги')
  const [note, setNote] = useState('')
  const [withdrawal, setWithdrawal] = useState('')
  const [withdrawalNote, setWithdrawalNote] = useState('')
  const [allowProtectedSpend, setAllowProtectedSpend] = useState(false)
  const [manualFloor, setManualFloor] = useState('0')
  const [autoRatio, setAutoRatio] = useState('70')
  const [baseRatio, setBaseRatio] = useState('40')
  const [weeklyIncrement, setWeeklyIncrement] = useState('300')
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')

  async function load() {
    setBusy(true)

    const initialGoalResult = await supabase
      .from('savings_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single()
    if (initialGoalResult.error) throw initialGoalResult.error

    const { error: advanceError } = await supabase.rpc('advance_savings_weekly_floor', {
      p_goal_id: initialGoalResult.data.id,
    })
    if (advanceError) throw advanceError

    const [goalResult, txResult] = await Promise.all([
      supabase
        .from('savings_goals')
        .select('*')
        .eq('id', initialGoalResult.data.id)
        .eq('user_id', userId)
        .single(),
      supabase
        .from('savings_transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('savings_goal_id', initialGoalResult.data.id)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false }),
    ])

    if (goalResult.error) throw goalResult.error
    if (txResult.error) throw txResult.error

    const loadedGoal = goalResult.data as SavingsGoal
    setGoal(loadedGoal)
    setTransactions((txResult.data || []) as SavingsTransaction[])
    setManualFloor(String(Number(loadedGoal.protected_floor_rub || 0)))
    setAutoRatio(String(Math.round(Number(loadedGoal.auto_floor_ratio ?? 0.7) * 100)))
    setBaseRatio(String(Math.round(Number(loadedGoal.base_save_ratio ?? 0.4) * 100)))
    setWeeklyIncrement(String(Math.round(Number(loadedGoal.weekly_floor_increment_rub ?? 300))))
    setBusy(false)
  }

  useEffect(() => {
    void load().catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить сбережения')
      setBusy(false)
    })
  }, [userId])

  const enteredIncome = Math.max(0, Number(received || 0))
  const advice = useMemo(
    () => (goal ? buildSavingsAdvice(goal, transactions, enteredIncome) : null),
    [goal, transactions, enteredIncome],
  )
  const receivedTotal = transactions.reduce((sum, item) => sum + Number(item.received_amount_rub || 0), 0)
  const estimatedJpy = goal?.reference_rub_per_jpy && advice
    ? advice.currentBalance / Number(goal.reference_rub_per_jpy)
    : null
  const withdrawalAmount = Math.max(0, Number(withdrawal || 0))
  const touchesProtected = Boolean(advice && withdrawalAmount > advice.freeToSpend)
  const nextBump = goal ? nextWeeklyBump(goal) : null

  async function addTransaction(event: FormEvent) {
    event.preventDefault()
    if (!goal || !advice) return
    setMessage('')
    const got = received.trim() === '' ? null : Number(received)
    const putAway = Number(saved || 0)

    if ((!got || got <= 0) && putAway === 0) {
      setMessage('Нужно указать либо поступление, либо изменение сбережений.')
      return
    }

    const { error } = await supabase.from('savings_transactions').insert({
      user_id: userId,
      savings_goal_id: goal.id,
      received_amount_rub: got,
      saved_amount_rub: putAway,
      source: source || null,
      note: note || null,
      occurred_on: localDateKey(),
    })
    if (error) {
      setMessage(error.message)
      return
    }

    if (Number(goal.weekly_floor_rub || 0) === 0 && advice.currentBalance <= 0 && putAway > 0) {
      await supabase
        .from('savings_goals')
        .update({ weekly_floor_rub: putAway, weekly_floor_last_bump_on: localDateKey() })
        .eq('id', goal.id)
        .eq('user_id', userId)
    }

    setMessage(putAway === 0
      ? 'Записано. Ноль отложенных рублей — допустимый выбор. Недельная линия всё равно продолжает показывать общий темп.'
      : 'Записано. Баланс и свободная сумма пересчитаны.')
    setNote('')
    await load()
  }

  async function withdraw(event: FormEvent) {
    event.preventDefault()
    if (!goal || !advice) return
    setMessage('')

    if (!Number.isFinite(withdrawalAmount) || withdrawalAmount <= 0) {
      setMessage('Укажи сумму, которую хочешь взять из копилки.')
      return
    }
    if (withdrawalAmount > advice.currentBalance) {
      setMessage('Нельзя снять больше, чем сейчас лежит в сбережениях.')
      return
    }
    if (touchesProtected && !allowProtectedSpend) {
      setMessage('Эта трата заденет минимальный запас. Сначала подтверди это ниже.')
      return
    }

    const { error } = await supabase.from('savings_transactions').insert({
      user_id: userId,
      savings_goal_id: goal.id,
      received_amount_rub: null,
      saved_amount_rub: -withdrawalAmount,
      source: 'Трата из сбережений',
      note: withdrawalNote || null,
      occurred_on: localDateKey(),
    })
    if (error) {
      setMessage(error.message)
      return
    }

    setWithdrawal('')
    setWithdrawalNote('')
    setAllowProtectedSpend(false)
    setMessage(touchesProtected
      ? 'Трата записана. Michi будет советовать постепенно вернуться выше текущего минимума.'
      : 'Трата записана. Минимальный запас не задет.')
    await load()
  }

  async function saveGuardrails() {
    if (!goal) return
    const floor = Math.max(0, Number(manualFloor || 0))
    const auto = Math.max(0, Math.min(100, Number(autoRatio || 0))) / 100
    const base = Math.max(0, Math.min(100, Number(baseRatio || 0))) / 100
    const weekly = Math.max(0, Math.round(Number(weeklyIncrement || 0)))
    const { data, error } = await supabase
      .from('savings_goals')
      .update({
        protected_floor_rub: floor,
        auto_floor_ratio: auto,
        base_save_ratio: base,
        weekly_floor_increment_rub: weekly,
      })
      .eq('id', goal.id)
      .eq('user_id', userId)
      .select('*')
      .single()

    if (error) {
      setMessage(error.message)
      return
    }
    setGoal(data as SavingsGoal)
    setMessage('Настройки накоплений обновлены. Новый недельный шаг применяется только к будущим неделям.')
  }

  async function saveRate(value: string) {
    if (!goal) return
    const rate = value.trim() ? Number(value) : null
    const { data, error } = await supabase
      .from('savings_goals')
      .update({ reference_rub_per_jpy: rate })
      .eq('id', goal.id)
      .eq('user_id', userId)
      .select('*')
      .single()
    if (!error) setGoal(data as SavingsGoal)
  }

  if (busy) {
    return <div className="savings-loading"><div className="loader-dot" /><span>Считаем реальные сбережения…</span></div>
  }

  if (!goal || !advice) {
    return <div className="page"><p className="form-message error">{message || 'Цель сбережений не найдена.'}</p></div>
  }

  return (
    <div className="page savings-v2">
      <section className="page-heading">
        <div>
          <p className="eyebrow">ДОЛГАЯ ЦЕЛЬ</p>
          <h1>Сбережения на Японию</h1>
          <p className="muted">Цель — ¥{formatNumber(goal.target_amount_jpy || 2_400_000)}. Минимальный баланс теперь понемногу растёт каждую неделю, чтобы копилка действительно двигалась вперёд.</p>
        </div>
      </section>

      <section className="savings-hero panel">
        <div>
          <span>Сейчас отложено</span>
          <strong>{formatRub(advice.currentBalance)}</strong>
          {estimatedJpy !== null && <small>≈ ¥{formatNumber(Math.round(estimatedJpy))} по справочному курсу</small>}
        </div>
        <div>
          <span>Минимум сейчас</span>
          <strong>{formatRub(advice.effectiveFloor)}</strong>
          <small>Берётся самый высокий порог: недельный, от пика или ручной.</small>
        </div>
        <div className={advice.freeToSpend > 0 ? 'free-money' : 'protected-money'}>
          <span>Свободно внутри копилки</span>
          <strong>{formatRub(advice.freeToSpend)}</strong>
          <small>Эту сумму можно взять, не опускаясь ниже текущего минимума.</small>
        </div>
      </section>

      <section className="panel weekly-floor-card">
        <div className="weekly-floor-main">
          <div className="weekly-floor-icon"><PiggyBank size={24} /></div>
          <div>
            <p className="eyebrow">НЕДЕЛЬНАЯ ЛИНИЯ</p>
            <h2>{formatRub(advice.weeklyFloor)}</h2>
            <p>Каждые 7 дней этот порог автоматически растёт на <strong>+{formatRub(Number(goal.weekly_floor_increment_rub || 0))}</strong>. Если одну неделю ничего не отложил, это не создаёт «просроченную задачу» — просто появляется разница, которую можно восстановить постепенно.</p>
          </div>
        </div>
        <div className="weekly-floor-next">
          <span>Следующая ступень</span>
          <strong>{formatRub(advice.weeklyFloor + Number(goal.weekly_floor_increment_rub || 0))}</strong>
          <small>{nextBump ? (nextBump.days === 0 ? 'сегодня' : `через ${nextBump.days} дн.`) : ''}</small>
        </div>
      </section>

      <section className={`panel savings-advice state-${advice.state}`}>
        <div className="advice-icon">{advice.state === 'recovering' ? <AlertTriangle size={24} /> : <ShieldCheck size={24} />}</div>
        <div>
          <p className="eyebrow">ФИНАНСОВЫЙ НАВИГАТОР</p>
          <h2>{advice.headline}</h2>
          <p>{advice.detail}</p>
          {enteredIncome > 0 && (
            <div className="next-income-advice">
              <Sparkles size={17} />
              <span>Если следующее поступление будет {formatRub(enteredIncome)}, разумный ориентир сейчас — отложить около <strong>{formatRub(advice.recommendedFromNextIncome)}</strong>.</span>
              <button type="button" onClick={() => setSaved(String(advice.recommendedFromNextIncome))}>Подставить</button>
            </div>
          )}
        </div>
      </section>

      <section className="panel floor-explainer">
        <div>
          <span>Лучший баланс за всё время</span>
          <strong>{formatRub(advice.peakBalance)}</strong>
        </div>
        <div className="floor-line-visual">
          <div className="floor-track"><span style={{ width: `${advice.peakBalance > 0 ? Math.min(100, advice.currentBalance / advice.peakBalance * 100) : 0}%` }} /></div>
          <small>От пика защищается {clampPercent(Number(goal.auto_floor_ratio))}% · недельный порог {formatRub(advice.weeklyFloor)} · итоговый минимум {formatRub(advice.effectiveFloor)}</small>
        </div>
        <p>Недельная линия отвечает за движение вперёд. Защита от исторического пика не даёт легко обнулить уже накопленное. Michi использует более строгую из этих двух линий.</p>
      </section>

      <form className="panel savings-form" onSubmit={addTransaction}>
        <div className="section-heading"><div><p className="eyebrow">НОВОЕ ПОСТУПЛЕНИЕ</p><h2>Сколько реально хочешь отложить?</h2></div></div>
        <div className="form-grid three">
          <label><span>Получил, ₽</span><input inputMode="decimal" value={received} onChange={(event) => setReceived(event.target.value)} /></label>
          <label><span>В сбережения, ₽</span><input inputMode="decimal" value={saved} onChange={(event) => setSaved(event.target.value)} /></label>
          <label><span>Откуда</span><input value={source} onChange={(event) => setSource(event.target.value)} /></label>
        </div>
        <div className="quick-money-row">
          {[0, 200, 300, 500, 1000].map((value) => <button type="button" key={value} className={Number(saved) === value ? 'active' : ''} onClick={() => setSaved(String(value))}>{value === 0 ? 'Ничего' : `${value} ₽`}</button>)}
          {advice.recommendedFromNextIncome > 0 && <button type="button" className={Number(saved) === advice.recommendedFromNextIncome ? 'active recommended' : 'recommended'} onClick={() => setSaved(String(advice.recommendedFromNextIncome))}>≈ {formatRub(advice.recommendedFromNextIncome)}</button>}
        </div>
        <label><span>Заметка — необязательно</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Например: подарок на день рождения" /></label>
        <button className="primary-button">Записать</button>
      </form>

      <form className="panel withdrawal-form" onSubmit={withdraw}>
        <div className="section-heading">
          <div><p className="eyebrow">ТРАТА ИЗ КОПИЛКИ</p><h2>Взять деньги из сбережений</h2></div>
          <ArrowDownCircle size={22} />
        </div>
        <div className="form-grid two">
          <label><span>Сумма, ₽</span><input inputMode="decimal" value={withdrawal} onChange={(event) => { setWithdrawal(event.target.value); setAllowProtectedSpend(false) }} placeholder="0" /></label>
          <label><span>На что — необязательно</span><input value={withdrawalNote} onChange={(event) => setWithdrawalNote(event.target.value)} placeholder="Например: одежда" /></label>
        </div>
        {withdrawalAmount > 0 && (
          <div className={`withdrawal-preview ${touchesProtected ? 'danger' : 'safe'}`}>
            {touchesProtected
              ? <><AlertTriangle size={18} /><span>Из свободной части доступно только <strong>{formatRub(advice.freeToSpend)}</strong>. Эта трата заберёт <strong>{formatRub(Math.max(0, withdrawalAmount - advice.freeToSpend))}</strong> ниже текущего минимума.</span></>
              : <><ShieldCheck size={18} /><span>Эта сумма помещается в свободную часть. Минимальный баланс останется целым.</span></>}
          </div>
        )}
        {touchesProtected && withdrawalAmount > 0 && (
          <label className="protected-confirm"><input type="checkbox" checked={allowProtectedSpend} onChange={(event) => setAllowProtectedSpend(event.target.checked)} /><span>Я понимаю, что после траты окажусь ниже текущего минимального уровня.</span></label>
        )}
        <button className="secondary-button" disabled={touchesProtected && !allowProtectedSpend}>Записать трату</button>
      </form>

      <details className="panel savings-settings">
        <summary>Настроить темп и защиту</summary>
        <p className="muted">По умолчанию недельный минимум растёт на 300 ₽. Это примерно 30% от твоего обычного поступления 1000 ₽: достаточно, чтобы копилка двигалась, но не требует откладывать всё. Изменение шага действует только на будущие недели.</p>
        <div className="form-grid four savings-settings-grid">
          <label><span>Рост минимума в неделю, ₽</span><input type="number" min="0" step="50" value={weeklyIncrement} onChange={(event) => setWeeklyIncrement(event.target.value)} /></label>
          <label><span>Ручной минимум, ₽</span><input type="number" min="0" step="100" value={manualFloor} onChange={(event) => setManualFloor(event.target.value)} /></label>
          <label><span>Защищать от пика, %</span><input type="number" min="0" max="100" step="5" value={autoRatio} onChange={(event) => setAutoRatio(event.target.value)} /></label>
          <label><span>Обычный ориентир с дохода, %</span><input type="number" min="0" max="100" step="5" value={baseRatio} onChange={(event) => setBaseRatio(event.target.value)} /></label>
        </div>
        <button type="button" className="secondary-button" onClick={() => void saveGuardrails()}>Сохранить настройки</button>
      </details>

      <section className="panel rate-card">
        <div><strong>Оценка в иенах</strong><span>Автоматический курс добавим позже. Пока можно указать свой справочный курс.</span></div>
        <label><span>1 ¥ ≈ сколько ₽</span><input type="number" min="0" step="0.0001" defaultValue={goal.reference_rub_per_jpy || ''} onBlur={(event) => void saveRate(event.target.value)} placeholder="необязательно" /></label>
      </section>

      {message && <p className="form-message success">{message}</p>}

      <section>
        <div className="section-heading"><div><p className="eyebrow">ИСТОРИЯ</p><h2>Движение денег</h2></div><span className="muted tiny">поступлений записано: {formatRub(receivedTotal)}</span></div>
        <div className="transaction-list">
          {transactions.length === 0 && <div className="panel empty-state">Пока пусто. После первого пополнения Michi зафиксирует стартовую точку, а затем минимальный баланс начнёт расти по неделям.</div>}
          {transactions.map((item) => (
            <article className="panel transaction-row" key={item.id}>
              <div><strong>{item.source || 'Поступление'}</strong><span>{formatDateRu(item.occurred_on)}{item.received_amount_rub !== null ? ` · получил ${formatRub(Number(item.received_amount_rub))}` : ''}</span>{item.note && <small>{item.note}</small>}</div>
              <strong className={Number(item.saved_amount_rub) >= 0 ? 'money-positive' : 'money-negative'}>{Number(item.saved_amount_rub) >= 0 ? '+' : ''}{formatRub(Number(item.saved_amount_rub))}</strong>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
