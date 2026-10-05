import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Layers3 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CardsPageV2 } from '../pages/CardsPageV2'
import { supabase } from '../lib/supabase'
import './CardsAnalyticsPortal.css'

export function CardsAnalyticsPortal() {
  const location = useLocation()
  const navigate = useNavigate()
  const [userId, setUserId] = useState<string | null>(null)
  const [navTarget, setNavTarget] = useState<HTMLElement | null>(null)
  const [contentTarget, setContentTarget] = useState<HTMLElement | null>(null)

  const cardsMode = location.pathname === '/navigate' && new URLSearchParams(location.search).get('view') === 'cards'

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id || null))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id || null))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    function findTargets() {
      setNavTarget(document.querySelector<HTMLElement>('.bottom-nav'))
      setContentTarget(document.querySelector<HTMLElement>('.app-content'))
    }
    findTargets()
    const observer = new MutationObserver(findTargets)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!navTarget || !contentTarget) return
    navTarget.classList.toggle('cards-nav-mode', cardsMode)
    contentTarget.classList.toggle('cards-view-active', cardsMode)
    return () => {
      navTarget.classList.remove('cards-nav-mode')
      contentTarget.classList.remove('cards-view-active')
    }
  }, [navTarget, contentTarget, cardsMode])

  if (!navTarget || !contentTarget || !userId) return null

  return (
    <>
      {createPortal(
        <button
          type="button"
          className={`bottom-link cards-bottom-link${cardsMode ? ' active' : ''}`}
          onClick={() => navigate('/navigate?view=cards')}
          aria-label="Карточки"
        >
          <Layers3 size={20} />
          <span>Карточки</span>
        </button>,
        navTarget,
      )}
      {cardsMode && createPortal(
        <div className="cards-route-root">
          <CardsPageV2 userId={userId} />
        </div>,
        contentTarget,
      )}
    </>
  )
}
