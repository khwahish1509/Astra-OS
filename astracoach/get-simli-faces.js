/**
 * get-simli-faces.js
 * ==================
 * Run this once to list all Simli face IDs available on your account.
 *
 * Usage (from the astracoach/ root):
 *   node get-simli-faces.js
 *
 * It reads VITE_SIMLI_API_KEY from your .env file automatically.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

// ── Read .env ────────────────────────────────────────────────────────────────
let apiKey = process.env.VITE_SIMLI_API_KEY
if (!apiKey) {
  try {
    const env = readFileSync(resolve(__dir, '.env'), 'utf8')
    const match = env.match(/^VITE_SIMLI_API_KEY\s*=\s*(.+)$/m)
    apiKey = match?.[1]?.trim()
  } catch { /* .env not found */ }
}

if (!apiKey) {
  console.error('❌  VITE_SIMLI_API_KEY not found in .env or environment.')
  process.exit(1)
}

// ── Fetch faces ───────────────────────────────────────────────────────────────
console.log('Fetching your Simli faces...\n')
const resp = await fetch('https://api.simli.ai/getFaces', {
  headers: { Authorization: `Bearer ${apiKey}` },
})

if (!resp.ok) {
  const body = await resp.text()
  console.error(`❌  API error ${resp.status}:`, body)
  process.exit(1)
}

const faces = await resp.json()

if (!Array.isArray(faces) || faces.length === 0) {
  console.log('No faces found on your account.')
  console.log('Create one at https://app.simli.com → Faces → Create Avatar')
  process.exit(0)
}

console.log(`Found ${faces.length} face(s):\n`)
faces.forEach((f, i) => {
  const id   = f.face_id   || f.faceId   || f.id   || '(unknown id field)'
  const name = f.face_name || f.faceName || f.name || '(unnamed)'
  console.log(`  ${i + 1}. ${name.padEnd(30)} ID: ${id}`)
})

console.log('\n── How to use ───────────────────────────────────────────────────────')
console.log('Add to astracoach/.env:\n')
console.log('  VITE_SIMLI_FACE_ID=<paste face ID here>         # default for all personas')
console.log('  VITE_SIMLI_FACE_INTERVIEW=<face ID>             # interview persona')
console.log('  VITE_SIMLI_FACE_LANGUAGE=<face ID>              # language tutor persona')
console.log('  VITE_SIMLI_FACE_SOCRATES=<face ID>              # socratic tutor persona')
console.log('  VITE_SIMLI_FACE_SALES=<face ID>                 # sales coach persona')
console.log('  VITE_SIMLI_FACE_DOCTOR=<face ID>                # medical tutor persona')
console.log('  VITE_SIMLI_FACE_THERAPIST=<face ID>             # reflective listener persona')
console.log('  VITE_SIMLI_FACE_CUSTOM=<face ID>                # custom persona')
console.log('\nOr just use the Settings tab in the app to paste a face ID per session.')
