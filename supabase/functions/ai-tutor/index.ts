import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: cors,
    })
  }

  const body = await req.json().catch(() => null)
  const provider = body?.provider === "openai" ? "openai" : "gigachat"
  const action = body?.action

  if (!action) {
    return new Response(JSON.stringify({ error: "action_required" }), {
      status: 400,
      headers: cors,
    })
  }

  const credentialName = provider === "openai" ? "OPENAI_API_KEY" : "GIGACHAT_AUTH_KEY"
  const credential = Deno.env.get(credentialName)

  if (!credential) {
    return new Response(
      JSON.stringify({
        error: "provider_not_configured",
        provider,
        message: "AI-провайдер ещё не подключён к Michi.",
      }),
      { status: 503, headers: cors },
    )
  }

  return new Response(
    JSON.stringify({
      error: "provider_adapter_pending",
      provider,
      action,
      message: "Ключ найден. Адаптер провайдера будет подключён следующим этапом.",
    }),
    { status: 501, headers: cors },
  )
})
