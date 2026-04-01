// FastAPI AI microservice HTTP client
// Used by Next.js API routes to communicate with eventvico-ai service
// Implemented fully in Story 4.2

const FASTAPI_URL = process.env.FASTAPI_SERVICE_URL ?? 'http://localhost:8000'
const FASTAPI_KEY = process.env.FASTAPI_SERVICE_KEY ?? ''

export async function generateRecipe(payload: unknown) {
  const res = await fetch(`${FASTAPI_URL}/generate-recipe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Key': FASTAPI_KEY,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`FastAPI error: ${res.status}`)
  return res.json()
}

export async function suggestSubstitutions(payload: unknown) {
  const res = await fetch(`${FASTAPI_URL}/suggest-substitutions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Key': FASTAPI_KEY,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`FastAPI error: ${res.status}`)
  return res.json()
}
