import { createClient } from '@supabase/supabase-js'

const fallbackUrl = 'https://lxqbieudpykfepultidh.supabase.co'
const fallbackPublishableKey = 'sb_publishable_QlaiTxoZwW357O3VKYnqnQ_uokXrLQk'

const url = import.meta.env.VITE_SUPABASE_URL || fallbackUrl
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || fallbackPublishableKey

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
