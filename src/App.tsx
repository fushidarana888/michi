import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  BarChart3,
  Brain,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Home,
  LoaderCircle,
  LogOut,
  Settings,
  Smile,
  Sparkles,
  Target,
} from 'lucide-react'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { ensureTodayPlan, taskVisibleAtTier } from './lib/planner'
import { formatDateRu, localDateKey, monthStartKey } from './lib/date'
import {
  MOODS,
  STUDY_PRESETS,
  reasonsForMood,
} from './data/presets'
import type {
  Goal,
  MoodEntry,
  Profile,
  StudyTask,
  Subject,
  Tier,
  Topic,
} from './types'

const tierLabels: Record<Tier, string> = {
  minimum: 'Минимум',
  normal: 'Норма',
  boost: 'Усиленный',
}

const difficultyLabels = [
  { value: 1, label: 'Легко' },
  { value: 2, label: 'Нормально' },
  { value: 3, label: 'Тяжело' },
  { value: 4, label: 'Не понял' },
]

function LoadingScreen() {
  return (
    <div className="center-screen">
      <div className="brand-mark">M</div>
      <LoaderCircle className="spin" size={24} />
      <p>Загружаем Michi…</p>
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

  async function submit(event: React.FormEvent) {
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
          options: {
            data: { display_name: name || 'Ученик' },
          },
        })
        if (error) throw error
        if (!data.session) {
          setMessage('Аккаунт создан. Если Supabase попросил подтверждение почты, открой письмо и вернись сюда.')
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
      <section className="auth-hero">
        <div className="brand-mark large">M</div>
        <p className="eyebrow">MICHI</p>
        <h1>Большая цель.<br />Следующий шаг.</h1>
        <p className="muted">
          Учебный план, который разбивает длинные цели на маленькие задачи и не превращает каждый вечер в пять часов зубрёжки.
        </p>
      </section>

      <section className="auth-card panel">
        <div className="segmented">
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Войти</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Создать аккаунт</button>
        </div>

        <form onSubmit={submit} className="form-stack">
          {mode === 'signup' && (
            <label>
              <span>Как тебя называть</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя или ник" />
            </label>
          )}
          <label>
            <span>Email</span>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            <span>Пароль</span>
            <input required minLength={6} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Минимум 6 символов" />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Подождите…' : mode === 'signin' ? 'Войти в Michi' : 'Начать путь'}
          </button>
        </form>

        {message && <p className="form-message">{message}</p>}
      </section>
    </main>
  )
}

function OnboardingPage({
  userId,
  profile,
  onDone,
}: {
  userId: string
  profile: Profile
  onDone: () => void
}) {
  const [displayName, setDisplayName] = useState(profile.display_name || '')
  const [targetDate, setTargetDate] = useState('2028-06-01')
  const [light, setLight] = useState(profile.daily_minutes_light || 30)
  const [normal, setNormal] = useState(profile.daily_minutes_normal || 75)
  const [boost, setBoost] = useState(profile.daily_minutes_boost || 110)
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState('')

  async function finish() {
    setBusy(true)
    setErrorText('')

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const subjectRows = STUDY_PRESETS.map((preset, index) => ({
        user_id: userId,
        name: preset.name,
        slug: preset.slug,
        icon: preset.icon,
        sort_order: index,
      }))

      const { data: subjects, error: subjectError } = await supabase
        .from('subjects')
        .upsert(subjectRows, { onConflict: 'user_id,slug' })
        .select('*')

      if (subjectError) throw subjectError

      for (const preset of STUDY_PRESETS) {
        const subject = subjects?.find((item) => item.slug === preset.slug)
        if (!subject) continue

        const { data: existingGoal } = await supabase
          .from('goals')
          .select('*')
          .eq('user_id', userId)
          .eq('subject_id', subject.id)
          .eq('title', preset.goalTitle)
          .maybeSingle()

        let goal = existingGoal

        if (!goal) {
          const { data, error } = await supabase
            .from('goals')
            .insert({
              user_id: userId,
              subject_id: subject.id,
              title: preset.goalTitle,
              description: preset.goalDescription,
              target_date: targetDate,
            })
            .select('*')
            .single()
          if (error) throw error
          goal = data
        }

        const topicRows = preset.topics.map(([topicName, priority]) => ({
          user_id: userId,
          subject_id: subject.id,
          name: topicName,
          priority,
          mastery: 10,
        }))

        const { error: topicError } = await supabase
          .from('topics')
          .upsert(topicRows, { onConflict: 'user_id,subject_id,name' })
        if (topicError) throw topicError

        const { count: stageCount, error: stageCountError } = await supabase
          .from('goal_stages')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('goal_id', goal.id)

        if (stageCountError) throw stageCountError

        if (!stageCount) {
          const { error: stageError } = await supabase.from('goal_stages').insert(
            preset.stages.map((stage, index) => ({
              user_id: userId,
              goal_id: goal.id,
              title: stage,
              sort_order: index,
              status: index === 0 ? 'active' : 'planned',
            })),
          )
          if (stageError) throw stageError
        }

        const { error: milestoneError } = await supabase
          .from('monthly_milestones')
          .upsert(
            {
              user_id: userId,
              goal_id: goal.id,
              month_start: monthStartKey(),
              title: 'Первый месяц: войти в ритм',
              description: 'Начать регулярно заниматься без перегруза и собрать первые данные о слабых местах.',
              status: 'active',
            },
            { onConflict: 'goal_id,month_start' },
          )
        if (milestoneError) throw milestoneError
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          display_name: displayName || 'Ученик',
          timezone,
          daily_minutes_light: light,
          daily_minutes_normal: normal,
          daily_minutes_boost: boost,
          onboarding_completed: true,
        })
        .eq('id', userId)

      if (profileError) throw profileError
      onDone()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось закончить настройку')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-card panel">
        <p className="eyebrow">ПЕРВЫЙ ЗАПУСК</p>
        <h1>Настроим твой путь</h1>
        <p className="muted">
          Сейчас создадим три большие цели. Потом Michi будет превращать их в короткие ежедневные занятия.
        </p>

        <div className="goal-preview-grid">
          {STUDY_PRESETS.map((preset) => (
            <div className="goal-preview" key={preset.slug}>
              <span className="subject-icon">{preset.icon}</span>
              <strong>{preset.goalTitle}</strong>
              <small>{preset.goalDescription}</small>
            </div>
          ))}
        </div>

        <div className="form-grid">
          <label>
            <span>Имя или ник</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            <span>Ориентир по сроку</span>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </label>
        </div>

        <h3>Сколько времени нормально тратить на учёбу дома?</h3>
        <div className="time-budget-grid">
          <TimeBudget label="Тяжёлый день" value={light} onChange={setLight} hint="минимум" />
          <TimeBudget label="Обычный день" value={normal} onChange={setNormal} hint="норма" />
          <TimeBudget label="Есть силы" value={boost} onChange={setBoost} hint="по желанию" />
        </div>

        <button className="primary-button wide" onClick={finish} disabled={busy}>
          {busy ? 'Создаём маршрут…' : 'Создать мой план'}
        </button>
        {errorText && <p className="form-message error">{errorText}</p>}
      </section>
    </main>
  )
}

function TimeBudget({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  hint: string
}) {
  return (
    <label className="time-budget">
      <span>{label}</span>
      <strong>{value} мин</strong>
      <small>{hint}</small>
      <input
        type="range"
        min={15}
        max={180}
        step={5}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function AppShell({
  userId,
  profile,
  reloadProfile,
}: {
  userId: string
  profile: Profile
  reloadProfile: () => Promise<void>
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-inline">
          <div className="brand-mark small">M</div>
          <div>
            <strong>Michi</strong>
            <span>Большая цель. Следующий шаг.</span>
          </div>
        </div>
        <NavLink to="/settings" className="icon-button" aria-label="Настройки">
          <Settings size={20} />
        </NavLink>
      </header>

      <main className="app-content">
        <Routes>
          <Route path="/today" element={<TodayPage userId={userId} profile={profile} />} />
          <Route path="/goals" element={<GoalsPage userId={userId} />} />
          <Route path="/mood" element={<MoodPage userId={userId} />} />
          <Route path="/progress" element={<ProgressPage userId={userId} />} />
          <Route path="/tutor" element={<TutorPage profile={profile} />} />
          <Route path="/settings" element={<SettingsPage profile={profile} reloadProfile={reloadProfile} />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>

      <nav className="bottom-nav">
        <BottomLink to="/today" icon={<Home size={20} />} label="Сегодня" />
        <BottomLink to="/goals" icon={<Target size={20} />} label="Цели" />
        <BottomLink to="/mood" icon={<Smile size={20} />} label="Настроение" />
        <BottomLink to="/progress" icon={<BarChart3 size={20} />} label="Прогресс" />
        <BottomLink to="/tutor" icon={<Sparkles size={20} />} label="ИИ" />
      </nav>
    </div>
  )
}

function BottomLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => 'bottom-link' + (isActive ? ' active' : '')}>
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}

function TodayPage({ userId, profile }: { userId: string; profile: Profile }) {
  const [tier, setTier] = useState<Tier>('normal')
  const [tasks, setTasks] = useState<StudyTask[]>([])
  const [subjects, setSubjects] = useState<Record<string, Subject>>({})
  const [results, setResults] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(true)
  const [errorText, setErrorText] = useState('')
  const [moodEntry, setMoodEntry] = useState<MoodEntry | null>(null)
  const [quickMood, setQuickMood] = useState<number | null>(null)
  const [quickReasons, setQuickReasons] = useState<string[]>([])

  async function load() {
    setBusy(true)
    setErrorText('')
    try {
      const [{ tasks: loadedTasks }, subjectsResult, moodResult] = await Promise.all([
        ensureTodayPlan(userId, profile),
        supabase.from('subjects').select('*').eq('user_id', userId),
        supabase.from('mood_entries').select('*').eq('user_id', userId).eq('entry_date', localDateKey()).maybeSingle(),
      ])

      setTasks(loadedTasks)
      const map = Object.fromEntries((subjectsResult.data || []).map((subject) => [subject.id, subject]))
      setSubjects(map)
      setMoodEntry((moodResult.data as MoodEntry | null) || null)

      if (loadedTasks.length) {
        const resultRows = await supabase
          .from('task_results')
          .select('task_id, perceived_difficulty')
          .eq('user_id', userId)
          .in('task_id', loadedTasks.map((task) => task.id))
        setResults(
          Object.fromEntries((resultRows.data || []).map((row) => [row.task_id, row.perceived_difficulty])),
        )
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось собрать план')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [userId])

  const visibleTasks = useMemo(
    () => tasks.filter((task) => taskVisibleAtTier(task.tier, tier)),
    [tasks, tier],
  )

  const totalMinutes = visibleTasks.reduce((sum, task) => sum + task.estimated_minutes, 0)
  const doneCount = visibleTasks.filter((task) => task.status === 'done').length
  const progress = visibleTasks.length ? Math.round((doneCount / visibleTasks.length) * 100) : 0

  async function toggleTask(task: StudyTask) {
    const done = task.status !== 'done'
    const { error } = await supabase
      .from('study_tasks')
      .update({
        status: done ? 'done' : 'planned',
        completed_at: done ? new Date().toISOString() : null,
      })
      .eq('id', task.id)
      .eq('user_id', userId)

    if (error) {
      setErrorText(error.message)
      return
    }

    if (!done) {
      await supabase.from('task_results').delete().eq('task_id', task.id).eq('user_id', userId)
      setResults((current) => {
        const next = { ...current }
        delete next[task.id]
        return next
      })
    }

    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? { ...item, status: done ? 'done' : 'planned', completed_at: done ? new Date().toISOString() : null }
          : item,
      ),
    )
  }

  async function rateTask(task: StudyTask, value: number) {
    const { error } = await supabase
      .from('task_results')
      .upsert(
        {
          user_id: userId,
          task_id: task.id,
          perceived_difficulty: value,
        },
        { onConflict: 'task_id' },
      )

    if (error) {
      setErrorText(error.message)
      return
    }

    if (task.topic_id) {
      const topicResult = await supabase
        .from('topics')
        .select('mastery')
        .eq('id', task.topic_id)
        .eq('user_id', userId)
        .single()

      if (topicResult.data) {
        const delta = value === 1 ? 4 : value === 2 ? 2 : value === 3 ? 1 : -2
        const mastery = Math.max(0, Math.min(100, Number(topicResult.data.mastery) + delta))
        await supabase
          .from('topics')
          .update({ mastery, last_practiced_at: new Date().toISOString() })
          .eq('id', task.topic_id)
          .eq('user_id', userId)
      }
    }

    setResults((current) => ({ ...current, [task.id]: value }))
  }

  async function saveQuickMood() {
    if (!quickMood) return
    const { data, error } = await supabase
      .from('mood_entries')
      .upsert(
        { user_id: userId, entry_date: localDateKey(), mood_value: quickMood },
        { onConflict: 'user_id,entry_date' },
      )
      .select('*')
      .single()

    if (error) {
      setErrorText(error.message)
      return
    }

    await supabase.from('mood_entry_reasons').delete().eq('mood_entry_id', data.id).eq('user_id', userId)

    if (quickReasons.length) {
      const options = reasonsForMood(quickMood)
      await supabase.from('mood_entry_reasons').insert(
        quickReasons.map((key) => ({
          user_id: userId,
          mood_entry_id: data.id,
          reason_key: key,
          reason_label: options.find(([reasonKey]) => reasonKey === key)?.[1] || key,
        })),
      )
    }

    setMoodEntry(data as MoodEntry)
  }

  if (busy) {
    return <PageLoader label="Собираю план на сегодня…" />
  }

  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">{new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(new Date()).toUpperCase()}</p>
          <h1>Сегодня</h1>
          <p className="muted">Не надо делать всё. Надо сделать следующий шаг.</p>
        </div>
        <div className="progress-ring" style={{ '--progress': progress } as React.CSSProperties}>
          <strong>{progress}%</strong>
        </div>
      </section>

      {!moodEntry && (
        <section className="panel mood-quick">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">СОСТОЯНИЕ</p>
              <h2>Как ты сегодня?</h2>
            </div>
          </div>
          <div className="mood-row">
            {MOODS.map((mood) => (
              <button
                key={mood.value}
                className={'mood-button' + (quickMood === mood.value ? ' selected' : '')}
                title={mood.label}
                onClick={() => {
                  setQuickMood(mood.value)
                  setQuickReasons([])
                }}
              >
                {mood.emoji}
              </button>
            ))}
          </div>

          {quickMood && (
            <>
              <div className="chip-wrap compact">
                {reasonsForMood(quickMood).map(([key, label]) => (
                  <button
                    key={key}
                    className={'chip' + (quickReasons.includes(key) ? ' selected' : '')}
                    onClick={() =>
                      setQuickReasons((current) =>
                        current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
                      )
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button className="secondary-button" onClick={saveQuickMood}>Сохранить настроение</button>
            </>
          )}
        </section>
      )}

      <section className="tier-section">
        <div className="segmented tier-picker">
          {(['minimum', 'normal', 'boost'] as Tier[]).map((value) => (
            <button key={value} className={tier === value ? 'active' : ''} onClick={() => setTier(value)}>
              {tierLabels[value]}
            </button>
          ))}
        </div>
        <p className="muted tiny">План на этот режим: примерно {totalMinutes} мин</p>
      </section>

      <section className="task-list">
        {visibleTasks.map((task) => {
          const subject = task.subject_id ? subjects[task.subject_id] : undefined
          const done = task.status === 'done'

          return (
            <article key={task.id} className={'task-card panel' + (done ? ' done' : '')}>
              <button className={'task-check' + (done ? ' checked' : '')} onClick={() => toggleTask(task)}>
                {done && <Check size={18} />}
              </button>
              <div className="task-main">
                <div className="task-meta">
                  <span className="subject-pill">{subject?.icon || '•'} {subject?.name || 'Учёба'}</span>
                  <span>{task.estimated_minutes} мин</span>
                </div>
                <h3>{task.title}</h3>
                <p>{task.description || 'Практика'}</p>

                {done && !results[task.id] && (
                  <div className="rating-block">
                    <span>Как прошло?</span>
                    <div className="rating-buttons">
                      {difficultyLabels.map((option) => (
                        <button key={option.value} onClick={() => rateTask(task, option.value)}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {results[task.id] && (
                  <small className="success-text">
                    Отмечено: {difficultyLabels.find((item) => item.value === results[task.id])?.label}
                  </small>
                )}
              </div>
            </article>
          )
        })}
      </section>

      <section className="panel ai-nudge">
        <Brain size={24} />
        <div>
          <strong>Переделать план с ИИ</strong>
          <p>Скоро здесь можно будет написать: «я сегодня вообще не вывожу матешу».</p>
        </div>
        <NavLink className="icon-button" to="/tutor"><ChevronRight size={20} /></NavLink>
      </section>

      {errorText && <p className="form-message error">{errorText}</p>}
    </div>
  )
}

function GoalsPage({ userId }: { userId: string }) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [subjects, setSubjects] = useState<Record<string, Subject>>({})
  const [stages, setStages] = useState<any[]>([])
  const [milestones, setMilestones] = useState<any[]>([])
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    async function load() {
      const [goalResult, subjectResult, stageResult, milestoneResult] = await Promise.all([
        supabase.from('goals').select('*').eq('user_id', userId).order('created_at'),
        supabase.from('subjects').select('*').eq('user_id', userId),
        supabase.from('goal_stages').select('*').eq('user_id', userId).order('sort_order'),
        supabase.from('monthly_milestones').select('*').eq('user_id', userId).eq('month_start', monthStartKey()),
      ])
      setGoals((goalResult.data || []) as Goal[])
      setSubjects(Object.fromEntries((subjectResult.data || []).map((subject) => [subject.id, subject])))
      setStages(stageResult.data || [])
      setMilestones(milestoneResult.data || [])
      setBusy(false)
    }
    void load()
  }, [userId])

  if (busy) return <PageLoader label="Открываю большие цели…" />

  return (
    <div className="page">
      <section className="page-heading simple">
        <div>
          <p className="eyebrow">МАРШРУТ</p>
          <h1>Большие цели</h1>
          <p className="muted">Смотри сюда иногда. Каждый день важнее экран «Сегодня».</p>
        </div>
      </section>

      <div className="goal-cards">
        {goals.map((goal) => {
          const subject = goal.subject_id ? subjects[goal.subject_id] : undefined
          const goalStages = stages.filter((stage) => stage.goal_id === goal.id)
          const milestone = milestones.find((item) => item.goal_id === goal.id)
          const currentStage = goalStages.find((stage) => stage.status === 'active') || goalStages[0]

          return (
            <article className="goal-card panel" key={goal.id}>
              <div className="goal-card-top">
                <span className="subject-icon big">{subject?.icon || '•'}</span>
                <div>
                  <h2>{goal.title}</h2>
                  {goal.target_date && <span className="muted tiny">Ориентир: {formatDateRu(goal.target_date)}</span>}
                </div>
              </div>
              <p>{goal.description}</p>
              <div className="goal-progress">
                <div><span style={{ width: Number(goal.progress) + '%' }} /></div>
                <strong>{Math.round(Number(goal.progress))}%</strong>
              </div>
              {currentStage && (
                <div className="mini-section">
                  <span className="eyebrow">ТЕКУЩИЙ ЭТАП</span>
                  <strong>{currentStage.title}</strong>
                </div>
              )}
              {milestone && (
                <div className="milestone-box">
                  <CalendarDays size={18} />
                  <div>
                    <span>Этот месяц</span>
                    <strong>{milestone.title}</strong>
                    <small>{milestone.description}</small>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}

function MoodPage({ userId }: { userId: string }) {
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [entries, setEntries] = useState<Record<string, MoodEntry>>({})
  const [reasonMap, setReasonMap] = useState<Record<string, string[]>>({})
  const [selectedDate, setSelectedDate] = useState(localDateKey())
  const [mood, setMood] = useState<number | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')

  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  const firstKey = localDateKey(firstDay)
  const nextKey = localDateKey(nextMonth)

  async function loadMonth() {
    const result = await supabase
      .from('mood_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('entry_date', firstKey)
      .lt('entry_date', nextKey)
      .order('entry_date')

    const rows = (result.data || []) as MoodEntry[]
    setEntries(Object.fromEntries(rows.map((entry) => [entry.entry_date, entry])))

    if (rows.length) {
      const reasonResult = await supabase
        .from('mood_entry_reasons')
        .select('mood_entry_id, reason_key')
        .eq('user_id', userId)
        .in('mood_entry_id', rows.map((entry) => entry.id))

      const byEntry: Record<string, string[]> = {}
      for (const row of reasonResult.data || []) {
        if (!byEntry[row.mood_entry_id]) byEntry[row.mood_entry_id] = []
        byEntry[row.mood_entry_id].push(row.reason_key)
      }

      const byDate: Record<string, string[]> = {}
      for (const entry of rows) byDate[entry.entry_date] = byEntry[entry.id] || []
      setReasonMap(byDate)
    } else {
      setReasonMap({})
    }
  }

  useEffect(() => {
    void loadMonth()
  }, [userId, firstKey])

  useEffect(() => {
    const entry = entries[selectedDate]
    setMood(entry?.mood_value || null)
    setNote(entry?.note || '')
    setReasons(reasonMap[selectedDate] || [])
  }, [selectedDate, entries, reasonMap])

  const days = useMemo(() => {
    const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const start = (firstDay.getDay() + 6) % 7
    return [
      ...Array.from({ length: start }, () => null),
      ...Array.from({ length: count }, (_, index) => index + 1),
    ]
  }, [cursor.getFullYear(), cursor.getMonth()])

  async function save() {
    if (!mood) return
    setMessage('')

    const { data, error } = await supabase
      .from('mood_entries')
      .upsert(
        { user_id: userId, entry_date: selectedDate, mood_value: mood, note: note || null },
        { onConflict: 'user_id,entry_date' },
      )
      .select('*')
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    await supabase.from('mood_entry_reasons').delete().eq('mood_entry_id', data.id).eq('user_id', userId)

    if (reasons.length) {
      const options = reasonsForMood(mood)
      await supabase.from('mood_entry_reasons').insert(
        reasons.map((key) => ({
          user_id: userId,
          mood_entry_id: data.id,
          reason_key: key,
          reason_label: options.find(([reasonKey]) => reasonKey === key)?.[1] || key,
        })),
      )
    }

    setMessage('Сохранено')
    await loadMonth()
  }

  function chooseDate(day: number) {
    setSelectedDate(localDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), day)))
    setMessage('')
  }

  return (
    <div className="page">
      <section className="page-heading simple">
        <div>
          <p className="eyebrow">КАЛЕНДАРЬ</p>
          <h1>Настроение</h1>
          <p className="muted">Отмечай состояние без оценок. Позже мы посмотрим, что реально влияет на учёбу.</p>
        </div>
      </section>

      <section className="panel calendar-card">
        <div className="calendar-head">
          <button className="icon-button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            <ChevronLeft size={20} />
          </button>
          <strong>{new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(cursor)}</strong>
          <button className="icon-button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="calendar-weekdays">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-grid">
          {days.map((day, index) => {
            if (!day) return <span className="calendar-empty" key={'e' + index} />
            const key = localDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), day))
            const entry = entries[key]
            const moodInfo = entry ? MOODS.find((item) => item.value === entry.mood_value) : null
            return (
              <button
                key={key}
                className={'calendar-day' + (selectedDate === key ? ' selected' : '')}
                onClick={() => chooseDate(day)}
              >
                <span>{day}</span>
                <strong>{moodInfo?.emoji || '·'}</strong>
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel mood-editor">
        <p className="eyebrow">{formatDateRu(selectedDate).toUpperCase()}</p>
        <h2>Как прошёл день?</h2>
        <div className="mood-row">
          {MOODS.map((item) => (
            <button
              key={item.value}
              title={item.label}
              className={'mood-button' + (mood === item.value ? ' selected' : '')}
              onClick={() => {
                setMood(item.value)
                setReasons([])
              }}
            >
              {item.emoji}
            </button>
          ))}
        </div>

        {mood && (
          <>
            <h3>Почему так?</h3>
            <div className="chip-wrap">
              {reasonsForMood(mood).map(([key, label]) => (
                <button
                  key={key}
                  className={'chip' + (reasons.includes(key) ? ' selected' : '')}
                  onClick={() =>
                    setReasons((current) =>
                      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              <span>Заметка — необязательно</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Что сегодня произошло?" rows={3} />
            </label>
            <button className="primary-button" onClick={save}>Сохранить день</button>
            {message && <span className="success-text">{message}</span>}
          </>
        )}
      </section>
    </div>
  )
}

function ProgressPage({ userId }: { userId: string }) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [tasks, setTasks] = useState<StudyTask[]>([])
  const [moods, setMoods] = useState<MoodEntry[]>([])
  const [plans, setPlans] = useState<any[]>([])
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    async function load() {
      const start = new Date()
      start.setDate(start.getDate() - 13)
      const startKey = localDateKey(start)

      const [topicResult, planResult, moodResult] = await Promise.all([
        supabase.from('topics').select('*').eq('user_id', userId).eq('is_active', true),
        supabase.from('daily_plans').select('*').eq('user_id', userId).gte('plan_date', startKey).order('plan_date'),
        supabase.from('mood_entries').select('*').eq('user_id', userId).gte('entry_date', startKey).order('entry_date'),
      ])

      const loadedPlans = planResult.data || []
      let loadedTasks: StudyTask[] = []
      if (loadedPlans.length) {
        const taskResult = await supabase
          .from('study_tasks')
          .select('*')
          .eq('user_id', userId)
          .in('daily_plan_id', loadedPlans.map((plan) => plan.id))
        loadedTasks = (taskResult.data || []) as StudyTask[]
      }

      setTopics((topicResult.data || []) as Topic[])
      setPlans(loadedPlans)
      setTasks(loadedTasks)
      setMoods((moodResult.data || []) as MoodEntry[])
      setBusy(false)
    }
    void load()
  }, [userId])

  if (busy) return <PageLoader label="Собираю статистику…" />

  const doneTasks = tasks.filter((task) => task.status === 'done')
  const minutes = doneTasks.reduce((sum, task) => sum + task.estimated_minutes, 0)
  const completedPercent = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0
  const activeDays = new Set(
    doneTasks
      .map((task) => plans.find((plan) => plan.id === task.daily_plan_id)?.plan_date)
      .filter(Boolean),
  ).size
  const moodAverage = moods.length
    ? moods.reduce((sum, entry) => sum + entry.mood_value, 0) / moods.length
    : 0
  const weakest = [...topics].sort((a, b) => Number(a.mastery) - Number(b.mastery)).slice(0, 5)

  return (
    <div className="page">
      <section className="page-heading simple">
        <div>
          <p className="eyebrow">ПОСЛЕДНИЕ 14 ДНЕЙ</p>
          <h1>Прогресс</h1>
          <p className="muted">Не серия дней, а то, насколько устойчиво ты двигаешься.</p>
        </div>
      </section>

      <div className="stats-grid">
        <StatCard value={String(activeDays)} label="учебных дней" />
        <StatCard value={minutes + ' мин'} label="выполнено" />
        <StatCard value={completedPercent + '%'} label="плана закрыто" />
        <StatCard
          value={moodAverage ? (MOODS.find((item) => item.value === Math.round(moodAverage))?.emoji || '😐') : '—'}
          label="среднее настроение"
        />
      </div>

      <section className="panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">КУДА СМОТРЕТЬ</p>
            <h2>Слабые темы</h2>
          </div>
        </div>
        <div className="mastery-list">
          {weakest.map((topic) => (
            <div className="mastery-row" key={topic.id}>
              <div>
                <strong>{topic.name}</strong>
                <span>{Math.round(Number(topic.mastery))}%</span>
              </div>
              <div className="mastery-track">
                <span style={{ width: Number(topic.mastery) + '%' }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel insight-card">
        <Sparkles size={22} />
        <div>
          <strong>Позже здесь появятся закономерности</strong>
          <p>
            Например: «в дни после плохого сна ты чаще выбираешь минимум» — без медицинских выводов и без давления.
          </p>
        </div>
      </section>
    </div>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <article className="stat-card panel">
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  )
}

function TutorPage({ profile }: { profile: Profile }) {
  return (
    <div className="page">
      <section className="page-heading simple">
        <div>
          <p className="eyebrow">ИИ-НАСТАВНИК</p>
          <h1>Репетитор Michi</h1>
          <p className="muted">AI-слой уже заложен в базу и настройки. Следом подключим GigaChat.</p>
        </div>
      </section>

      <section className="panel tutor-hero">
        <div className="tutor-orb"><Brain size={34} /></div>
        <div>
          <span className="status-badge">Провайдер: {profile.ai_provider === 'gigachat' ? 'GigaChat' : profile.ai_provider}</span>
          <h2>Пока без API-ключа</h2>
          <p>
            Когда подключим GigaChat, здесь можно будет просить объяснить ошибку, создать мини-тест или провести занятие на 30 минут.
          </p>
        </div>
      </section>

      <div className="prompt-grid">
        {[
          ['Объясни ошибку', 'Покажет, где сломалась логика, и даст похожую задачу.'],
          ['Сделай мини-тест', 'Соберёт вопросы по конкретной теме и твоим слабым местам.'],
          ['Переделай сегодня', 'Упростит или переставит план, если сил мало.'],
          ['Позанимайся со мной', 'Пошаговая сессия: задача → ответ → объяснение → следующая сложность.'],
        ].map(([title, text]) => (
          <article className="panel prompt-card" key={title}>
            <Sparkles size={18} />
            <strong>{title}</strong>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </div>
  )
}

function SettingsPage({
  profile,
  reloadProfile,
}: {
  profile: Profile
  reloadProfile: () => Promise<void>
}) {
  const [name, setName] = useState(profile.display_name || '')
  const [light, setLight] = useState(profile.daily_minutes_light)
  const [normal, setNormal] = useState(profile.daily_minutes_normal)
  const [boost, setBoost] = useState(profile.daily_minutes_boost)
  const [provider, setProvider] = useState(profile.ai_provider)
  const [message, setMessage] = useState('')

  async function save() {
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: name,
        daily_minutes_light: light,
        daily_minutes_normal: normal,
        daily_minutes_boost: boost,
        ai_provider: provider,
      })
      .eq('id', profile.id)

    setMessage(error ? error.message : 'Настройки сохранены')
    if (!error) await reloadProfile()
  }

  return (
    <div className="page">
      <section className="page-heading simple">
        <div>
          <p className="eyebrow">MICHI</p>
          <h1>Настройки</h1>
        </div>
      </section>

      <section className="panel settings-section">
        <h2>Профиль</h2>
        <label>
          <span>Имя или ник</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <h3>Нагрузка</h3>
        <div className="time-budget-grid">
          <TimeBudget label="Минимум" value={light} onChange={setLight} hint="тяжёлый день" />
          <TimeBudget label="Норма" value={normal} onChange={setNormal} hint="обычный день" />
          <TimeBudget label="Усиленный" value={boost} onChange={setBoost} hint="когда есть силы" />
        </div>

        <h3>ИИ-провайдер</h3>
        <select value={provider} onChange={(event) => setProvider(event.target.value as Profile['ai_provider'])}>
          <option value="gigachat">GigaChat — основной</option>
          <option value="openai">OpenAI — позже</option>
          <option value="auto">Автоматически — позже</option>
        </select>
        <p className="muted tiny">Ключи API будут храниться только на серверной стороне, не в браузере.</p>

        <button className="primary-button" onClick={save}>Сохранить</button>
        {message && <span className="success-text">{message}</span>}
      </section>

      <section className="panel danger-zone">
        <div>
          <strong>Выйти из аккаунта</strong>
          <span className="muted tiny">Данные останутся в Supabase.</span>
        </div>
        <button className="secondary-button" onClick={() => supabase.auth.signOut()}>
          <LogOut size={18} /> Выйти
        </button>
      </section>
    </div>
  )
}

function PageLoader({ label }: { label: string }) {
  return (
    <div className="page-loader">
      <LoaderCircle className="spin" size={24} />
      <span>{label}</span>
    </div>
  )
}

function AuthenticatedApp({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(true)
  const [errorText, setErrorText] = useState('')

  async function loadProfile() {
    setBusy(true)
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    if (error) setErrorText(error.message)
    setProfile((data as Profile | null) || null)
    setBusy(false)
  }

  useEffect(() => {
    void loadProfile()
  }, [session.user.id])

  if (busy) return <LoadingScreen />

  if (!profile) {
    return (
      <div className="center-screen">
        <h2>Профиль ещё не появился</h2>
        <p className="muted">{errorText || 'Попробуй выйти и войти снова.'}</p>
        <button className="secondary-button" onClick={() => supabase.auth.signOut()}>Выйти</button>
      </div>
    )
  }

  if (!profile.onboarding_completed) {
    return <OnboardingPage userId={session.user.id} profile={profile} onDone={() => void loadProfile()} />
  }

  return <AppShell userId={session.user.id} profile={profile} reloadProfile={loadProfile} />
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <LoadingScreen />
  if (!session) return <AuthPage />
  return <AuthenticatedApp session={session} />
}
