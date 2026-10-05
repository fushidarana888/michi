import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  LogOut,
  Map,
  PiggyBank,
  Plus,
  Settings,
  Smile,
  Sparkles,
} from 'lucide-react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { LEARNING_STATUS_OPTIONS, MOODS, reasonsForMood } from './data/presets'
import { formatDateRu, localDateKey } from './lib/date'
import { buildAttentionCards, ensureWorkspace, loadNavigationData } from './lib/navigation'
import { SavingsPageV2 } from './pages/SavingsPageV2'
import { supabase } from './lib/supabase'
import type {
  LearningNode,
  LearningStatus,
  MoodEntry,
  Profile,
  SavingsGoal,
  SavingsTransaction,
  StudyLog,
  Subject,
} from './types'

const activityLabels = {
  theory: 'Теория',
  practice: 'Практика',
  review: 'Повторение',
  test: 'Тест / вариант',
  lesson: 'Урок',
  other: 'Другое',
} as const

const statusLabels = Object.fromEntries(LEARNING_STATUS_OPTIONS) as Record<LearningStatus, string>

function LoadingScreen({ text = 'Загружаем Michi…' }: { text?: string }) {
  return (
    <div className="center-screen">
      <div className="brand-mark">M</div>
      <div className="loader-dot" />
      <p className="muted">{text}</p>
    </div>
  )
}

function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name || 'Ученик' } },
        })
        if (error) throw error
        if (!data.session) {
          setMessage('Аккаунт создан. Если Supabase попросил подтверждение почты, открой письмо и затем войди.')
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-copy">
        <div className="brand-mark large">M</div>
        <p className="eyebrow">MICHI</p>
        <h1>Не трекер привычек.<br />Навигатор на годы.</h1>
        <p className="muted lead">
          Michi не ругает за пропуски и не требует ежедневных галочек. Он нужен, чтобы ты не мог год заниматься только тем, что и так нравится и получается.
        </p>
      </section>

      <section className="panel auth-card">
        <div className="segmented">
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Войти</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Создать аккаунт</button>
        </div>

        <form className="form-stack" onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              <span>Как тебя называть</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя или ник" />
            </label>
          )}
          <label>
            <span>Email</span>
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            <span>Пароль</span>
            <input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="primary-button" disabled={busy}>{busy ? 'Подождите…' : mode === 'signin' ? 'Войти' : 'Начать путь'}</button>
        </form>
        {message && <p className="form-message">{message}</p>}
      </section>
    </main>
  )
}

function OnboardingPage({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [displayName, setDisplayName] = useState(profile.display_name || '')
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState('')

  async function finish() {
    setBusy(true)
    setErrorText('')
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName || 'Ученик', timezone, onboarding_completed: true })
      .eq('id', profile.id)

    setBusy(false)
    if (error) {
      setErrorText(error.message)
      return
    }
    onDone()
  }

  return (
    <main className="onboarding-page">
      <section className="panel onboarding-card">
        <p className="eyebrow">КАК РАБОТАЕТ MICHI</p>
        <h1>У тебя уже есть дисциплина. Нужна карта.</h1>
        <p className="muted lead">
          Здесь не будет серии дней, штрафов за пропуск и «37 просроченных задач». Michi смотрит на несколько недель подготовки и подсказывает, какое направление ты давно обходишь и какой инструмент там логично брать следующим.
        </p>

        <div className="principle-grid">
          <div><Compass size={22} /><strong>Карта внимания</strong><span>Показывает, куда реально ушло время за последние недели.</span></div>
          <div><Map size={22} /><strong>Карта знаний</strong><span>Отличает «не умею инструмент» от «надо больше решать».</span></div>
          <div><PiggyBank size={22} /><strong>Сбережения</strong><span>Фиксирует реальные пополнения без обязательной недельной нормы.</span></div>
        </div>

        <label className="onboarding-name">
          <span>Имя или ник</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>

        <button className="primary-button wide" onClick={finish} disabled={busy}>{busy ? 'Настраиваем…' : 'Открыть мой маршрут'}</button>
        {errorText && <p className="form-message error">{errorText}</p>}
      </section>
    </main>
  )
}

function AppShell({ userId, profile, reloadProfile }: { userId: string; profile: Profile; reloadProfile: () => Promise<void> }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand-inline" to="/navigate">
          <div className="brand-mark small">M</div>
          <div><strong>Michi</strong><span>Большая цель. Следующий шаг.</span></div>
        </NavLink>
        <NavLink to="/settings" className="icon-button" aria-label="Настройки"><Settings size={19} /></NavLink>
      </header>

      <main className="app-content">
        <Routes>
          <Route path="/navigate" element={<NavigatorPage userId={userId} />} />
          <Route path="/route" element={<RouteMapPage userId={userId} />} />
          <Route path="/savings" element={<SavingsPageV2 userId={userId} />} />
          <Route path="/progress" element={<ProgressPage userId={userId} />} />
          <Route path="/mood" element={<MoodPage userId={userId} />} />
          <Route path="/tutor" element={<TutorPage profile={profile} />} />
          <Route path="/settings" element={<SettingsPage userId={userId} profile={profile} reloadProfile={reloadProfile} />} />
          <Route path="*" element={<Navigate to="/navigate" replace />} />
        </Routes>
      </main>

      <nav className="bottom-nav">
        <BottomLink to="/navigate" icon={<Compass size={20} />} label="Куда дальше" />
        <BottomLink to="/route" icon={<Map size={20} />} label="Маршрут" />
        <BottomLink to="/savings" icon={<PiggyBank size={20} />} label="Деньги" />
        <BottomLink to="/progress" icon={<BarChart3 size={20} />} label="Картина" />
        <BottomLink to="/mood" icon={<Smile size={20} />} label="Настроение" />
      </nav>
    </div>
  )
}

function BottomLink({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => 'bottom-link' + (isActive ? ' active' : '')}>
      {icon}<span>{label}</span>
    </NavLink>
  )
}

function NavigatorPage({ userId }: { userId: string }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [nodes, setNodes] = useState<LearningNode[]>([])
  const [logs, setLogs] = useState<StudyLog[]>([])
  const [duration, setDuration] = useState(30)
  const [logging, setLogging] = useState(false)
  const [busy, setBusy] = useState(true)
  const [errorText, setErrorText] = useState('')

  async function load() {
    setBusy(true)
    setErrorText('')
    try {
      const data = await loadNavigationData(userId)
      setSubjects(data.subjects)
      setNodes(data.nodes)
      setLogs(data.logs)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось собрать карту')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void load() }, [userId])

  const cards = useMemo(() => buildAttentionCards(subjects, nodes, logs), [subjects, nodes, logs])
  const top = cards[0]

  if (busy) return <LoadingScreen text="Собираем карту внимания…" />

  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">НАВИГАТОР</p>
          <h1>Куда двигаться дальше</h1>
          <p className="muted">Не «что ты обязан сделать сегодня», а какой следующий шаг сейчас разумнее.</p>
        </div>
        <button className="secondary-button" onClick={() => setLogging((value) => !value)}><Plus size={17} /> Записать занятие</button>
      </section>

      {logging && <StudyLogComposer userId={userId} subjects={subjects} nodes={nodes} onSaved={() => { setLogging(false); void load() }} />}

      <section className="panel recommendation-card">
        <div className="recommendation-top">
          <div>
            <p className="eyebrow">СЕЙЧАС РАЗУМНЕЕ</p>
            <h2>{top ? `${top.subject.icon || '•'} ${top.subject.name}` : 'Собираем историю'}</h2>
          </div>
          <div className="duration-picker">
            {[15, 30, 60].map((value) => <button key={value} className={duration === value ? 'active' : ''} onClick={() => setDuration(value)}>{value} мин</button>)}
          </div>
        </div>

        {top ? (
          <>
            <p className="recommendation-action">{top.action}</p>
            <p className="muted">{top.reason} На {duration} минут достаточно взять один понятный кусок, а не пытаться закрыть весь предмет.</p>
            <div className="recommendation-meta">
              <span><Clock3 size={15} /> {top.minutes} мин за 28 дней</span>
              <span><BookOpen size={15} /> {top.currentNode ? statusLabels[top.currentNode.status] : 'маршрут закрыт'}</span>
            </div>
          </>
        ) : <p className="muted">После первого записанного занятия Michi начнёт различать направления.</p>}
      </section>

      <section>
        <div className="section-heading">
          <div><p className="eyebrow">ПОСЛЕДНИЕ 28 ДНЕЙ</p><h2>Карта внимания</h2></div>
          <span className="muted tiny">ориентир, не квота</span>
        </div>
        <div className="attention-grid">
          {cards.map((card) => (
            <article className={`panel attention-card state-${card.state}`} key={card.subject.id}>
              <div className="attention-title"><span className="subject-icon">{card.subject.icon || '•'}</span><div><strong>{card.subject.name}</strong><small>{card.reason}</small></div></div>
              <div className="share-row"><strong>{Math.round(card.share * 100)}%</strong><span>{card.minutes} мин</span></div>
              <div className="bar-track"><span style={{ width: `${Math.min(100, card.share * 100)}%` }} /></div>
              <div className="reference-mark">справочный ориентир ≈ {Math.round(card.targetShare * 100)}%</div>
              <div className="next-node"><span>Следующий узел</span><strong>{card.currentNode?.title || 'Смешанная практика'}</strong></div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel anti-pressure-card">
        <CheckCircle2 size={22} />
        <div><strong>Ничего не потеряно, если ты не открыл Michi.</strong><p>Здесь нет серии дней. Через неделю приложение просто пересчитает картину по фактическим занятиям.</p></div>
      </section>

      <NavLink className="panel ai-strip" to="/tutor"><Brain size={22} /><div><strong>ИИ-наставник</strong><span>Позже сможет разбирать ошибки и менять следующий шаг по контексту.</span></div><ChevronRight size={19} /></NavLink>
      {errorText && <p className="form-message error">{errorText}</p>}
    </div>
  )
}

function StudyLogComposer({ userId, subjects, nodes, onSaved }: { userId: string; subjects: Subject[]; nodes: LearningNode[]; onSaved: () => void }) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || '')
  const [nodeId, setNodeId] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [kind, setKind] = useState<keyof typeof activityLabels>('practice')
  const [difficulty, setDifficulty] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState('')

  const subjectNodes = nodes.filter((node) => node.subject_id === subjectId)

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setErrorText('')
    const parsedMinutes = Number(minutes)
    if (!subjectId || !Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
      setErrorText('Выбери предмет и нормальное время занятия.')
      setBusy(false)
      return
    }

    const { error } = await supabase.from('study_logs').insert({
      user_id: userId,
      subject_id: subjectId,
      learning_node_id: nodeId || null,
      minutes: parsedMinutes,
      activity_kind: kind,
      perceived_difficulty: difficulty ? Number(difficulty) : null,
      note: note || null,
      source: 'manual',
    })

    setBusy(false)
    if (error) {
      setErrorText(error.message)
      return
    }
    onSaved()
  }

  return (
    <form className="panel log-composer" onSubmit={save}>
      <div className="section-heading"><div><p className="eyebrow">ФАКТ, НЕ ПЛАН</p><h2>Чем ты реально занимался?</h2></div></div>
      <div className="form-grid four">
        <label><span>Направление</span><select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setNodeId('') }}>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.icon} {subject.name}</option>)}</select></label>
        <label><span>Что именно</span><select value={nodeId} onChange={(event) => setNodeId(event.target.value)}><option value="">Без конкретного узла</option>{subjectNodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
        <label><span>Минуты</span><input inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
        <label><span>Тип</span><select value={kind} onChange={(event) => setKind(event.target.value as keyof typeof activityLabels)}>{Object.entries(activityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      <div className="form-grid two">
        <label><span>Как шло — необязательно</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="">Не отмечать</option><option value="1">Легко</option><option value="2">Нормально</option><option value="3">Тяжело</option><option value="4">Не понял</option></select></label>
        <label><span>Заметка — необязательно</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Например: разобрал №21, но код пока медленно" /></label>
      </div>
      <button className="primary-button" disabled={busy}>{busy ? 'Сохраняем…' : 'Записать занятие'}</button>
      {errorText && <p className="form-message error">{errorText}</p>}
    </form>
  )
}

function RouteMapPage({ userId }: { userId: string }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [nodes, setNodes] = useState<LearningNode[]>([])
  const [busy, setBusy] = useState(true)
  const [errorText, setErrorText] = useState('')

  async function load() {
    setBusy(true)
    const data = await loadNavigationData(userId)
    setSubjects(data.subjects)
    setNodes(data.nodes)
    setBusy(false)
  }

  useEffect(() => { void load().catch((error) => { setErrorText(error instanceof Error ? error.message : 'Ошибка'); setBusy(false) }) }, [userId])

  async function changeStatus(node: LearningNode, status: LearningStatus) {
    setNodes((current) => current.map((item) => item.id === node.id ? { ...item, status } : item))
    const { error } = await supabase.from('learning_nodes').update({ status }).eq('id', node.id).eq('user_id', userId)
    if (error) {
      setErrorText(error.message)
      void load()
    }
  }

  if (busy) return <LoadingScreen text="Открываем карту знаний…" />

  return (
    <div className="page">
      <section className="page-heading"><div><p className="eyebrow">КАРТА ЗНАНИЙ</p><h1>Что ты уже умеешь</h1><p className="muted">Если Michi ошибся в твоём уровне, просто поправь статус. Карта нужна для навигации, а не для оценки.</p></div></section>
      <div className="route-stack">
        {subjects.map((subject) => {
          const subjectNodes = nodes.filter((node) => node.subject_id === subject.id)
          const solid = subjectNodes.filter((node) => node.status === 'solid').length
          return (
            <section className="panel route-card" key={subject.id}>
              <div className="route-header"><div className="attention-title"><span className="subject-icon big">{subject.icon || '•'}</span><div><h2>{subject.name}</h2><span className="muted tiny">Закреплено узлов: {solid} из {subjectNodes.length}</span></div></div><span className="phase-badge">{phaseLabel(subject.learning_phase)}</span></div>
              <div className="node-list">
                {subjectNodes.map((node, index) => (
                  <div className={`learning-node status-${node.status}`} key={node.id}>
                    <span className="node-number">{index + 1}</span>
                    <div className="node-copy"><strong>{node.title}</strong><span>{node.description}</span></div>
                    <select value={node.status} onChange={(event) => void changeStatus(node, event.target.value as LearningStatus)}>{LEARNING_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      {errorText && <p className="form-message error">{errorText}</p>}
    </div>
  )
}

function phaseLabel(phase: Subject['learning_phase']) {
  return ({ foundation: 'Фундамент', tools: 'Инструменты', exam_tasks: 'Задания', mixed: 'Смешанная практика', mock: 'Пробники' } as const)[phase]
}

function SavingsPage({ userId }: { userId: string }) {
  const [goal, setGoal] = useState<SavingsGoal | null>(null)
  const [transactions, setTransactions] = useState<SavingsTransaction[]>([])
  const [received, setReceived] = useState('1000')
  const [saved, setSaved] = useState('0')
  const [source, setSource] = useState('Еженедельные деньги')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')

  async function load() {
    setBusy(true)
    const goalResult = await supabase.from('savings_goals').select('*').eq('user_id', userId).eq('is_active', true).single()
    if (goalResult.error) throw goalResult.error
    const txResult = await supabase.from('savings_transactions').select('*').eq('user_id', userId).eq('savings_goal_id', goalResult.data.id).order('occurred_on', { ascending: false }).order('created_at', { ascending: false })
    if (txResult.error) throw txResult.error
    setGoal(goalResult.data as SavingsGoal)
    setTransactions((txResult.data || []) as SavingsTransaction[])
    setBusy(false)
  }

  useEffect(() => { void load().catch((error) => { setMessage(error instanceof Error ? error.message : 'Ошибка'); setBusy(false) }) }, [userId])

  const balance = transactions.reduce((sum, item) => sum + Number(item.saved_amount_rub || 0), 0)
  const receivedTotal = transactions.reduce((sum, item) => sum + Number(item.received_amount_rub || 0), 0)
  const estimatedJpy = goal?.reference_rub_per_jpy ? balance / Number(goal.reference_rub_per_jpy) : null

  async function addTransaction(event: FormEvent) {
    event.preventDefault()
    if (!goal) return
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
    setMessage(putAway === 0 ? 'Записано. Ноль отложенных рублей — тоже нормальный выбор.' : 'Записано.')
    setNote('')
    await load()
  }

  async function saveRate(value: string) {
    if (!goal) return
    const rate = value.trim() ? Number(value) : null
    const { error } = await supabase.from('savings_goals').update({ reference_rub_per_jpy: rate }).eq('id', goal.id).eq('user_id', userId)
    if (!error) setGoal({ ...goal, reference_rub_per_jpy: rate })
  }

  if (busy) return <LoadingScreen text="Считаем реальные сбережения…" />

  return (
    <div className="page">
      <section className="page-heading"><div><p className="eyebrow">ДОЛГАЯ ЦЕЛЬ</p><h1>Сбережения на Японию</h1><p className="muted">Цель — ¥{formatNumber(goal?.target_amount_jpy || 2400000)}. Никакой обязательной суммы раз в неделю.</p></div></section>

      <section className="savings-hero panel">
        <div><span>Сейчас отложено</span><strong>{formatRub(balance)}</strong>{estimatedJpy !== null && <small>≈ ¥{formatNumber(Math.round(estimatedJpy))} по справочному курсу</small>}</div>
        <div><span>Всего записано поступлений</span><strong>{formatRub(receivedTotal)}</strong><small>Это не «должно было уйти в копилку».</small></div>
      </section>

      <form className="panel savings-form" onSubmit={addTransaction}>
        <div className="section-heading"><div><p className="eyebrow">НОВОЕ ПОСТУПЛЕНИЕ</p><h2>Сколько реально хочешь отложить?</h2></div></div>
        <div className="form-grid three">
          <label><span>Получил, ₽</span><input inputMode="decimal" value={received} onChange={(event) => setReceived(event.target.value)} /></label>
          <label><span>В сбережения, ₽</span><input inputMode="decimal" value={saved} onChange={(event) => setSaved(event.target.value)} /></label>
          <label><span>Откуда</span><input value={source} onChange={(event) => setSource(event.target.value)} /></label>
        </div>
        <div className="quick-money-row">{[0, 200, 500, 1000].map((value) => <button type="button" key={value} className={Number(saved) === value ? 'active' : ''} onClick={() => setSaved(String(value))}>{value === 0 ? 'Ничего' : `${value} ₽`}</button>)}</div>
        <label><span>Заметка — необязательно</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Например: подарок на день рождения" /></label>
        <button className="primary-button">Записать</button>
        {message && <p className="form-message success">{message}</p>}
      </form>

      <section className="panel rate-card">
        <div><strong>Оценка в иенах</strong><span>Автоматический курс добавим позже. Пока можно указать свой справочный курс, если хочешь видеть примерную сумму.</span></div>
        <label><span>1 ¥ ≈ сколько ₽</span><input type="number" min="0" step="0.0001" defaultValue={goal?.reference_rub_per_jpy || ''} onBlur={(event) => void saveRate(event.target.value)} placeholder="необязательно" /></label>
      </section>

      <section>
        <div className="section-heading"><div><p className="eyebrow">ИСТОРИЯ</p><h2>Движение денег</h2></div></div>
        <div className="transaction-list">
          {transactions.length === 0 && <div className="panel empty-state">Пока пусто. Первую запись можно сделать хоть с 0 ₽ в сбережения.</div>}
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

function ProgressPage({ userId }: { userId: string }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [nodes, setNodes] = useState<LearningNode[]>([])
  const [logs, setLogs] = useState<StudyLog[]>([])
  const [savings, setSavings] = useState(0)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    async function load() {
      const data = await loadNavigationData(userId)
      const tx = await supabase.from('savings_transactions').select('saved_amount_rub').eq('user_id', userId)
      setSubjects(data.subjects)
      setNodes(data.nodes)
      setLogs(data.logs)
      setSavings((tx.data || []).reduce((sum, row) => sum + Number(row.saved_amount_rub || 0), 0))
      setBusy(false)
    }
    void load()
  }, [userId])

  if (busy) return <LoadingScreen text="Собираем общую картину…" />

  const cards = buildAttentionCards(subjects, nodes, logs)
  const totalMinutes = logs.reduce((sum, log) => sum + Number(log.minutes), 0)
  const studyDays = new Set(logs.map((log) => localDateKey(new Date(log.occurred_at)))).size
  const touched = cards.filter((card) => card.minutes > 0).length
  const dominant = [...cards].sort((a, b) => b.share - a.share)[0]

  return (
    <div className="page">
      <section className="page-heading"><div><p className="eyebrow">ПОСЛЕДНИЕ 28 ДНЕЙ</p><h1>Общая картина</h1><p className="muted">Не серия и не оценка дисциплины. Просто факты, чтобы заметить перекос раньше, чем пройдёт год.</p></div></section>
      <div className="stats-grid"><Stat value={`${Math.round(totalMinutes / 60 * 10) / 10} ч`} label="занятий" /><Stat value={String(studyDays)} label="дней с учёбой" /><Stat value={`${touched}/${subjects.length}`} label="направлений трогал" /><Stat value={formatRub(savings)} label="в сбережениях" /></div>

      {dominant && totalMinutes > 0 && (
        <section className="panel insight-card"><Sparkles size={22} /><div><strong>{dominant.subject.name}: {Math.round(dominant.share * 100)}% учебного времени</strong><p>{dominant.share > 0.55 ? 'Это уже заметный перекос. Не ошибка — просто сигнал проверить, не обходишь ли ты другие важные направления.' : 'Пока один предмет не съедает почти всю подготовку.'}</p></div></section>
      )}

      <section className="panel distribution-card">
        <div className="section-heading"><div><p className="eyebrow">РАСПРЕДЕЛЕНИЕ</p><h2>Куда ушло время</h2></div></div>
        <div className="distribution-list">{cards.sort((a, b) => b.minutes - a.minutes).map((card) => <div className="distribution-row" key={card.subject.id}><div><strong>{card.subject.icon} {card.subject.name}</strong><span>{card.minutes} мин · {Math.round(card.share * 100)}%</span></div><div className="bar-track"><span style={{ width: `${Math.min(100, card.share * 100)}%` }} /></div></div>)}</div>
      </section>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return <article className="panel stat-card"><strong>{value}</strong><span>{label}</span></article>
}

function MoodPage({ userId }: { userId: string }) {
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [entries, setEntries] = useState<Record<string, MoodEntry>>({})
  const [selectedDate, setSelectedDate] = useState(localDateKey())
  const [mood, setMood] = useState<number | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  const firstKey = localDateKey(first)
  const nextKey = localDateKey(next)

  async function loadMonth() {
    const result = await supabase.from('mood_entries').select('*').eq('user_id', userId).gte('entry_date', firstKey).lt('entry_date', nextKey)
    const rows = (result.data || []) as MoodEntry[]
    setEntries(Object.fromEntries(rows.map((entry) => [entry.entry_date, entry])))
  }

  useEffect(() => { void loadMonth() }, [userId, firstKey])
  useEffect(() => { const entry = entries[selectedDate]; setMood(entry?.mood_value || null); setNote(entry?.note || ''); setReasons([]) }, [selectedDate, entries])

  const calendarDays = useMemo(() => {
    const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const blanks = (first.getDay() + 6) % 7
    return [...Array.from({ length: blanks }, () => null), ...Array.from({ length: count }, (_, index) => index + 1)]
  }, [cursor.getFullYear(), cursor.getMonth()])

  async function save() {
    if (!mood) return
    const { data, error } = await supabase.from('mood_entries').upsert({ user_id: userId, entry_date: selectedDate, mood_value: mood, note: note || null }, { onConflict: 'user_id,entry_date' }).select('*').single()
    if (error) { setMessage(error.message); return }
    await supabase.from('mood_entry_reasons').delete().eq('mood_entry_id', data.id).eq('user_id', userId)
    if (reasons.length) {
      const options = reasonsForMood(mood)
      await supabase.from('mood_entry_reasons').insert(reasons.map((key) => ({ user_id: userId, mood_entry_id: data.id, reason_key: key, reason_label: options.find(([reasonKey]) => reasonKey === key)?.[1] || key })))
    }
    setMessage('Сохранено. И да — завтра отмечать необязательно.')
    await loadMonth()
  }

  return (
    <div className="page">
      <section className="page-heading"><div><p className="eyebrow">НЕОБЯЗАТЕЛЬНО</p><h1>Настроение</h1><p className="muted">Отмечай только когда хочется оставить контекст. Пустой день ничего не портит.</p></div></section>
      <section className="panel calendar-card">
        <div className="calendar-head"><button className="icon-button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={19} /></button><strong>{new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(cursor)}</strong><button className="icon-button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={19} /></button></div>
        <div className="calendar-weekdays">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">{calendarDays.map((day, index) => {
          if (!day) return <span className="calendar-empty" key={`empty-${index}`} />
          const key = localDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), day))
          const entry = entries[key]
          return <button key={key} className={`calendar-day ${selectedDate === key ? 'selected' : ''}`} onClick={() => setSelectedDate(key)}><span>{day}</span><strong>{entry ? MOODS.find((item) => item.value === entry.mood_value)?.emoji : '·'}</strong></button>
        })}</div>
      </section>
      <section className="panel mood-editor"><p className="eyebrow">{formatDateRu(selectedDate).toUpperCase()}</p><h2>Если хочешь — оставь отметку</h2><div className="mood-row">{MOODS.map((item) => <button key={item.value} className={`mood-button ${mood === item.value ? 'selected' : ''}`} onClick={() => { setMood(item.value); setReasons([]) }}>{item.emoji}</button>)}</div>{mood && <><div className="chip-wrap">{reasonsForMood(mood).map(([key, label]) => <button key={key} className={`chip ${reasons.includes(key) ? 'selected' : ''}`} onClick={() => setReasons((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])}>{label}</button>)}</div><label><span>Заметка</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="primary-button" onClick={() => void save()}>Сохранить</button></>}{message && <p className="form-message success">{message}</p>}</section>
    </div>
  )
}

function TutorPage({ profile }: { profile: Profile }) {
  return (
    <div className="page">
      <section className="page-heading"><div><p className="eyebrow">ИИ-НАСТАВНИК</p><h1>Помощник, а не диспетчер</h1><p className="muted">Он будет объяснять ошибки, делать мини-тесты и помогать выбрать следующий узел. Решение заниматься всё равно остаётся твоим.</p></div></section>
      <section className="panel tutor-card"><Brain size={34} /><div><span className="status-badge">Провайдер: {profile.ai_provider}</span><h2>AI-слой готов к подключению модели</h2><p>GigaChat остаётся первым провайдером, OpenAI можно будет добавить позже через тот же интерфейс.</p></div></section>
    </div>
  )
}

function SettingsPage({ userId, profile, reloadProfile }: { userId: string; profile: Profile; reloadProfile: () => Promise<void> }) {
  const [name, setName] = useState(profile.display_name || '')
  const [provider, setProvider] = useState(profile.ai_provider)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [message, setMessage] = useState('')

  useEffect(() => { void supabase.from('subjects').select('*').eq('user_id', userId).order('sort_order').then(({ data }) => setSubjects((data || []) as Subject[])) }, [userId])

  async function save() {
    setMessage('')
    const { error } = await supabase.from('profiles').update({ display_name: name, ai_provider: provider }).eq('id', profile.id)
    if (error) { setMessage(error.message); return }
    for (const subject of subjects) {
      const result = await supabase.from('subjects').update({ attention_weight: subject.attention_weight, recommended_gap_days: subject.recommended_gap_days }).eq('id', subject.id).eq('user_id', userId)
      if (result.error) { setMessage(result.error.message); return }
    }
    setMessage('Сохранено')
    await reloadProfile()
  }

  return (
    <div className="page">
      <section className="page-heading"><div><p className="eyebrow">НАСТРОЙКИ</p><h1>Michi под тебя</h1></div></section>
      <section className="panel settings-card"><label><span>Имя или ник</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>ИИ-провайдер</span><select value={provider} onChange={(event) => setProvider(event.target.value as Profile['ai_provider'])}><option value="gigachat">GigaChat</option><option value="openai">OpenAI — позже</option><option value="auto">Автоматически — позже</option></select></label></section>
      <section className="panel settings-card"><div><p className="eyebrow">КАРТА ВНИМАНИЯ</p><h2>Насколько важны направления сейчас</h2><p className="muted tiny">Это не проценты и не обязательные часы. Вес только помогает Michi замечать долгий перекос.</p></div>{subjects.map((subject, index) => <div className="weight-row" key={subject.id}><div><strong>{subject.icon} {subject.name}</strong><span>Вес {subject.attention_weight} · напомнить о перекосе примерно после {subject.recommended_gap_days} дней без занятий</span></div><div><input type="range" min="1" max="5" value={subject.attention_weight} onChange={(event) => setSubjects((current) => current.map((item, i) => i === index ? { ...item, attention_weight: Number(event.target.value) } : item))} /><input className="gap-input" type="number" min="1" max="30" value={subject.recommended_gap_days} onChange={(event) => setSubjects((current) => current.map((item, i) => i === index ? { ...item, recommended_gap_days: Number(event.target.value) } : item))} /></div></div>)}</section>
      <button className="primary-button" onClick={() => void save()}>Сохранить настройки</button>{message && <p className="form-message success">{message}</p>}
      <section className="panel logout-card"><div><strong>Выйти из аккаунта</strong><span className="muted tiny">Данные останутся в Supabase.</span></div><button className="secondary-button" onClick={() => void supabase.auth.signOut()}><LogOut size={17} /> Выйти</button></section>
    </div>
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)
}

function formatRub(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value)
}

function AuthenticatedApp({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(true)
  const [errorText, setErrorText] = useState('')

  async function loadProfile() {
    setBusy(true)
    setErrorText('')
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    if (error) { setErrorText(error.message); setBusy(false); return }
    if (!data) { setBusy(false); return }

    try {
      await ensureWorkspace(session.user.id)
    } catch (workspaceError) {
      setErrorText(workspaceError instanceof Error ? workspaceError.message : 'Не удалось подготовить пространство Michi')
    }

    setProfile(data as Profile)
    setBusy(false)
  }

  useEffect(() => { void loadProfile() }, [session.user.id])

  if (busy) return <LoadingScreen text="Готовим твой маршрут…" />
  if (!profile) return <div className="center-screen"><h2>Профиль ещё не появился</h2><p className="muted">{errorText || 'Попробуй выйти и войти снова.'}</p><button className="secondary-button" onClick={() => void supabase.auth.signOut()}>Выйти</button></div>
  if (!profile.onboarding_completed) return <OnboardingPage profile={profile} onDone={() => void loadProfile()} />

  return <AppShell userId={session.user.id} profile={profile} reloadProfile={loadProfile} />
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <LoadingScreen />
  if (!session) return <AuthPage />
  return <AuthenticatedApp session={session} />
}
