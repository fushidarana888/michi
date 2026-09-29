import { supabase } from './supabase'

export type AiAction =
  | 'explain_mistake'
  | 'generate_quiz'
  | 'adapt_plan'
  | 'tutor_session'
  | 'chat'

export type AiProvider = 'gigachat' | 'openai' | 'auto'

export interface AiRequest {
  action: AiAction
  provider?: AiProvider
  payload: Record<string, unknown>
}

export async function invokeAiTutor(request: AiRequest) {
  const { data, error } = await supabase.functions.invoke('ai-tutor', {
    body: request,
  })

  if (error) throw error
  return data
}
