import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crosshair } from 'lucide-react'
import { getPreferredNode, loadNavigationData, setPreferredNode } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import type { LearningNode, Subject } from '../types'
import './RouteSelectionPortal.css'

type RouteTarget = {
  element: HTMLElement
  subject: Subject
}

export function RouteSelectionPortal() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [nodes, setNodes] = useState<LearningNode[]>([])
  const [targets, setTargets] = useState<RouteTarget[]>([])
  const [selected, setSelected] = useState<Record<string, string>>({})
  const targetSignature = useRef('')

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

    function syncTargets() {
      if (!window.location.hash.includes('/route')) {
        if (targetSignature.current) {
          targetSignature.current = ''
          setTargets([])
        }
        return
      }

      const next = [...document.querySelectorAll<HTMLElement>('.route-card')]
        .map((element) => {
          const heading = element.querySelector('h2')?.textContent || ''
          const subject = subjects.find((item) => heading.includes(item.name))
          return subject ? { element, subject } : null
        })
        .filter((item): item is RouteTarget => Boolean(item))

      const signature = next.map((item) => `${item.subject.id}:${item.element.dataset.michiRouteKey || ''}`).join('|') + `:${next.length}`
      if (signature !== targetSignature.current || next.some((item, index) => targets[index]?.element !== item.element)) {
        targetSignature.current = signature
        setTargets(next)
      }
    }

    syncTargets()
    const observer = new MutationObserver(syncTargets)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('hashchange', syncTargets)
    return () => {
      observer.disconnect()
      window.removeEventListener('hashchange', syncTargets)
    }
  }, [subjects, targets])

  const nodesBySubject = useMemo(() => {
    const result = new Map<string, LearningNode[]>()
    for (const subject of subjects) {
      result.set(subject.id, nodes.filter((node) => node.subject_id === subject.id).sort((a, b) => a.sort_order - b.sort_order))
    }
    return result
  }, [subjects, nodes])

  useEffect(() => {
    if (!subjects.length) return
    const next: Record<string, string> = {}
    for (const subject of subjects) {
      const subjectNodes = nodesBySubject.get(subject.id) || []
      const preferred = getPreferredNode(subject.id, subjectNodes)
      if (preferred) next[subject.id] = preferred.id
    }
    setSelected(next)
  }, [subjects, nodesBySubject])

  useEffect(() => {
    for (const { element, subject } of targets) {
      element.classList.add('route-selection-managed')
      const subjectNodes = nodesBySubject.get(subject.id) || []
      const selectedId = selected[subject.id] || getPreferredNode(subject.id, subjectNodes)?.id
      const selectedNode = subjectNodes.find((node) => node.id === selectedId) || null
      const rows = [...element.querySelectorAll<HTMLElement>('.learning-node')]

      for (const row of rows) row.classList.remove('current-node', 'michi-selected-node')
      if (selectedNode) {
        const row = rows.find((item) => item.querySelector('.node-copy strong')?.textContent?.trim() === selectedNode.title)
        row?.classList.add('current-node', 'michi-selected-node')
      }
    }
  }, [targets, selected, nodesBySubject])

  function choose(subjectId: string, nodeId: string) {
    setPreferredNode(subjectId, nodeId)
    setSelected((current) => ({ ...current, [subjectId]: nodeId }))
  }

  return (
    <>
      {targets.map(({ element, subject }) => {
        const header = element.querySelector<HTMLElement>('.route-header') || element
        const subjectNodes = nodesBySubject.get(subject.id) || []
        const preferred = subjectNodes.find((node) => node.id === selected[subject.id]) || getPreferredNode(subject.id, subjectNodes)
        if (!preferred) return null

        return createPortal(
          <div className="route-study-selector" key={subject.id}>
            <div className="route-study-selector-title">
              <Crosshair size={16} />
              <span>Выбрано для занятия</span>
            </div>
            <select value={preferred.id} onChange={(event) => choose(subject.id, event.target.value)} aria-label={`Выбранный раздел: ${subject.name}`}>
              {subjectNodes.map((node) => <option value={node.id} key={node.id}>{node.title}</option>)}
            </select>
            <small>Этот же пункт будет выбран на странице «Куда дальше».</small>
          </div>,
          header,
        )
      })}
    </>
  )
}
