import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { LEARNING_STATUS_OPTIONS } from '../data/presets'
import { getPreferredNode, loadNavigationData, setPreferredNode } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import type { LearningNode, Subject } from '../types'
import './StudyPartSelectorPortal.css'

const statusLabels = Object.fromEntries(LEARNING_STATUS_OPTIONS) as Record<string, string>

function actionFor(node: LearningNode) {
  if (node.status === 'not_started') return `Разобрать: ${node.title}`
  if (node.status === 'learning') return `Продолжить: ${node.title}`
  if (node.status === 'assisted') return `Попробовать без подсказки: ${node.title}`
  if (node.status === 'independent') return `Проверить и закрепить: ${node.title}`
  return `Повторить: ${node.title}`
}

export function StudyPartSelectorPortal() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [nodes, setNodes] = useState<LearningNode[]>([])
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user.id
      if (!userId) return
      const navigation = await loadNavigationData(userId)
      setSubjects(navigation.subjects)
      setNodes(navigation.nodes)
    })()
  }, [])

  useEffect(() => {
    if (!subjects.length) return

    function syncFromPage() {
      const card = document.querySelector<HTMLElement>('.recommendation-card')
      const body = card?.querySelector<HTMLElement>('.recommendation-body-v2') || null
      const heading = card?.querySelector('h2')?.textContent || ''
      const subject = subjects.find((item) => heading.includes(item.name)) || null
      setTarget(body)
      setSubjectId(subject?.id || null)
    }

    syncFromPage()
    const observer = new MutationObserver(syncFromPage)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    window.addEventListener('hashchange', syncFromPage)
    return () => {
      observer.disconnect()
      window.removeEventListener('hashchange', syncFromPage)
    }
  }, [subjects])

  const subjectNodes = useMemo(
    () => nodes.filter((node) => node.subject_id === subjectId).sort((a, b) => a.sort_order - b.sort_order),
    [nodes, subjectId],
  )

  useEffect(() => {
    if (!subjectId || !subjectNodes.length) {
      setSelectedNodeId(null)
      return
    }
    setSelectedNodeId(getPreferredNode(subjectId, subjectNodes)?.id || null)
  }, [subjectId, subjectNodes])

  const selectedNode = subjectNodes.find((node) => node.id === selectedNodeId) || null
  const selectedIndex = selectedNode ? subjectNodes.findIndex((node) => node.id === selectedNode.id) : -1

  function syncVisibleLabels(node: LearningNode) {
    if (!subjectId) return
    const subject = subjects.find((item) => item.id === subjectId)
    if (!subject) return

    const attentionCards = [...document.querySelectorAll<HTMLElement>('.attention-card')]
    const card = attentionCards.find((item) => (item.querySelector('.attention-title strong')?.textContent || '').includes(subject.name))
    const nextNode = card?.querySelector<HTMLElement>('.next-node strong')
    if (nextNode) nextNode.textContent = node.title
  }

  function choose(nodeId: string) {
    if (!subjectId) return
    const node = subjectNodes.find((item) => item.id === nodeId)
    setPreferredNode(subjectId, nodeId)
    setSelectedNodeId(nodeId)
    if (node) syncVisibleLabels(node)
  }

  function move(delta: number) {
    if (!subjectNodes.length) return
    const nextIndex = Math.min(subjectNodes.length - 1, Math.max(0, selectedIndex + delta))
    choose(subjectNodes[nextIndex].id)
  }

  if (!target || !subjectId || !selectedNode) return null

  return createPortal(
    <div className="study-part-selector">
      <div className="study-part-selector-head">
        <div>
          <span className="study-part-kicker">ЧТО ИМЕННО</span>
          <strong>{actionFor(selectedNode)}</strong>
        </div>
        <span className="study-part-status">{statusLabels[selectedNode.status] || selectedNode.status}</span>
      </div>

      <div className="study-part-controls">
        <button type="button" className="study-part-arrow" onClick={() => move(-1)} disabled={selectedIndex <= 0} aria-label="Предыдущая часть">
          <ChevronLeft size={18} />
        </button>
        <label>
          <span>Часть / номер</span>
          <select value={selectedNode.id} onChange={(event) => choose(event.target.value)}>
            {subjectNodes.map((node) => (
              <option value={node.id} key={node.id}>{node.title}</option>
            ))}
          </select>
        </label>
        <button type="button" className="study-part-arrow" onClick={() => move(1)} disabled={selectedIndex >= subjectNodes.length - 1} aria-label="Следующая часть">
          <ChevronRight size={18} />
        </button>
      </div>

      {selectedNode.description && (
        <p className="study-part-description"><BookOpen size={17} /> {selectedNode.description}</p>
      )}
      <p className="study-part-note">Выбранный пункт общий для «Куда дальше» и «Маршрута». Michi предлагает первый незакреплённый, но ты можешь в любой момент выбрать другой.</p>
    </div>,
    target,
  )
}
