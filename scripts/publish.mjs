#!/usr/bin/env node
// Publishes the Markdown files of this repository to a Writizzy blog through the
// public v1 API. Node 20+, no dependencies: fetch, FormData and Blob are built in.
//
//   node scripts/publish.mjs                 # only the files changed by the current push
//   node scripts/publish.mjs --all           # every file under posts/
//   node scripts/publish.mjs --dry-run       # parse and report, no network call
//   node scripts/publish.mjs posts/hello.md  # explicit file list
//
// Environment:
//   WRITIZZY_API_KEY    write-scoped API key (Blog Settings -> Developer API)
//   WRITIZZY_SUBDOMAIN  subdomain of the target blog
//   WRITIZZY_API_BASE   defaults to https://api.writizzy.com

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const POSTS_DIR = 'posts'
const STATE_FILE = '.writizzy/state.json'

const API_BASE = (process.env.WRITIZZY_API_BASE || 'https://api.writizzy.com').replace(/\/$/, '')
const API_KEY = process.env.WRITIZZY_API_KEY
const SUBDOMAIN = process.env.WRITIZZY_SUBDOMAIN

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const ALL = args.includes('--all')
const explicitFiles = args.filter((a) => !a.startsWith('--'))

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

// --- Markdown front matter -------------------------------------------------

function unquote(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

// A deliberately small YAML subset: scalars, inline arrays and block lists.
// Enough for post front matter, and readable without pulling a parser in.
function parseFrontMatterBlock(block) {
  const data = {}
  let listKey = null

  for (const line of block.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue

    const listItem = line.match(/^\s*-\s+(.*)$/)
    if (listItem && listKey) {
      data[listKey].push(unquote(listItem[1]))
      continue
    }

    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!pair) continue

    const key = pair[1]
    const value = pair[2].trim()

    if (value === '') {
      data[key] = []
      listKey = key
      continue
    }

    listKey = null
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map(unquote)
        .filter((v) => v.length > 0)
    } else {
      data[key] = unquote(value)
    }
  }

  return data
}

function parsePost(relPath) {
  const raw = readFileSync(join(ROOT, relPath), 'utf8').replace(/\r\n/g, '\n')
  if (!raw.startsWith('---\n')) {
    throw new Error(`${relPath}: missing YAML front matter`)
  }
  const end = raw.indexOf('\n---', 4)
  if (end === -1) {
    throw new Error(`${relPath}: front matter is never closed`)
  }

  const data = parseFrontMatterBlock(raw.slice(4, end))
  const content = raw.slice(raw.indexOf('\n', end + 1) + 1).trim()

  const title = str(data.title)
  if (!title) throw new Error(`${relPath}: 'title' is required`)
  if (!content) throw new Error(`${relPath}: the body is empty`)

  const status = (str(data.status) || 'draft').toLowerCase()
  if (status !== 'draft' && status !== 'published') {
    throw new Error(`${relPath}: 'status' must be 'draft' or 'published', got '${status}'`)
  }

  return {
    path: relPath,
    title,
    content,
    status,
    slug: str(data.slug),
    excerpt: str(data.excerpt),
    cover: str(data.cover),
    publishedAt: str(data.publishedAt),
    accessMode: str(data.accessMode)?.toUpperCase(),
    tags: Array.isArray(data.tags) ? data.tags : str(data.tags) ? [str(data.tags)] : undefined,
  }
}

function str(value) {
  if (typeof value !== 'string') return undefined
  return value.length > 0 ? value : undefined
}

// --- State ----------------------------------------------------------------

// Post creation is not idempotent server-side, and a draft cannot be looked up by
// slug, so the mapping file -> post id lives in the repository. The workflow commits
// it back after each run.
function loadState() {
  const path = join(ROOT, STATE_FILE)
  if (!existsSync(path)) return { version: 1, posts: {}, media: {} }
  const state = JSON.parse(readFileSync(path, 'utf8'))
  return { version: 1, posts: {}, media: {}, ...state }
}

function saveState(state) {
  const path = join(ROOT, STATE_FILE)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

// --- API ------------------------------------------------------------------

async function call(method, path, { json, form, allow404 = false } = {}) {
  const headers = { Authorization: `Bearer ${API_KEY}` }
  if (json) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: json ? JSON.stringify(json) : form,
  })

  if (response.status === 404 && allow404) return null
  if (!response.ok) {
    throw new Error(`${method} ${path} returned ${response.status}: ${(await response.text()).slice(0, 500)}`)
  }
  return response.status === 204 ? null : response.json()
}

const blogPath = (suffix = '') => `/v1/blogs/${encodeURIComponent(SUBDOMAIN)}${suffix}`

// --- Media ----------------------------------------------------------------

// Uploaded files are keyed by content hash: pushing a post again does not
// re-upload its images, and editing an image uploads the new version.
async function uploadImage(state, mdPath, imagePath, altText) {
  const candidates = imagePath.startsWith('/')
    ? [join(ROOT, imagePath.slice(1))]
    : [resolve(ROOT, dirname(mdPath), imagePath), resolve(ROOT, imagePath)]

  const filePath = candidates.find((c) => existsSync(c))
  if (!filePath) throw new Error(`${mdPath}: image not found: ${imagePath}`)

  const bytes = readFileSync(filePath)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const known = state.media[hash]
  if (known) return known.url

  const filename = posix.basename(imagePath.split(/[?#]/)[0])
  const contentType = MIME_TYPES[extname(filename).toLowerCase()] || 'application/octet-stream'

  if (DRY_RUN) return `https://cdn.example/dry-run/${filename}`

  const form = new FormData()
  form.append('file', new Blob([bytes], { type: contentType }), filename)
  if (altText) form.append('altText', altText)

  const media = await call('POST', blogPath('/media'), { form })
  state.media[hash] = { url: media.url, filename }
  return media.url
}

const isRemote = (url) => /^(https?:)?\/\//.test(url) || url.startsWith('data:')

// Code blocks and inline code are documentation, not references: an image path shown
// as an example must not be uploaded, and must not be rewritten.
function codeRanges(text) {
  const ranges = []
  let offset = 0
  let fence = null

  for (const line of text.split('\n')) {
    const start = offset
    offset += line.length + 1
    const marker = line.match(/^\s*(`{3,}|~{3,})/)

    if (fence) {
      ranges.push([start, offset])
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
      continue
    }
    if (marker) {
      fence = marker[1]
      ranges.push([start, offset])
      continue
    }
    for (const code of line.matchAll(/`[^`]*`/g)) {
      ranges.push([start + code.index, start + code.index + code[0].length])
    }
  }

  return ranges
}

// Rewrites every local image reference to the CDN URL returned by the upload.
async function uploadLocalImages(state, post) {
  const pattern = /!\[([^\]]*)\]\(\s*([^)\s]+)([^)]*)\)/g
  const skip = codeRanges(post.content)
  const parts = []
  let cursor = 0

  for (const match of post.content.matchAll(pattern)) {
    const [full, alt, url, trailer] = match
    if (isRemote(url)) continue
    if (skip.some(([from, to]) => match.index >= from && match.index < to)) continue

    const cdnUrl = await uploadImage(state, post.path, url, alt)
    parts.push(post.content.slice(cursor, match.index), `![${alt}](${cdnUrl}${trailer})`)
    cursor = match.index + full.length
  }

  parts.push(post.content.slice(cursor))
  const content = parts.join('')

  let coverImageUrl = post.cover
  if (coverImageUrl && !isRemote(coverImageUrl)) {
    coverImageUrl = await uploadImage(state, post.path, coverImageUrl, post.title)
  }

  return { content, coverImageUrl }
}

// --- Publishing ------------------------------------------------------------

async function findPublishedBySlug(slug) {
  if (!slug || DRY_RUN) return null
  return call('GET', blogPath(`/posts/${encodeURIComponent(slug)}`), { allow404: true })
}

async function syncPost(state, relPath) {
  const post = parsePost(relPath)
  const { content, coverImageUrl } = await uploadLocalImages(state, post)

  const payload = {
    title: post.title,
    content,
    excerpt: post.excerpt,
    coverImageUrl,
    tags: post.tags,
    accessMode: post.accessMode,
  }
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key]
  }

  // Known id first, then an already-published post with the same slug (so a post
  // written in the dashboard can be adopted by the repository), then create.
  let known = state.posts[relPath]
  if (!known && post.slug) {
    const existing = await findPublishedBySlug(post.slug)
    if (existing) known = { id: existing.id, slug: existing.slug }
  }

  if (DRY_RUN) {
    return {
      path: relPath,
      action: known ? 'would update' : 'would create',
      status: post.status,
      slug: post.slug || '(generated from the title)',
      url: '',
    }
  }

  let result
  let action
  if (known) {
    if (post.slug && post.slug !== known.slug) payload.slug = post.slug
    result = await call('PATCH', blogPath(`/posts/${known.id}`), { json: payload })
    action = 'updated'
  } else {
    result = await call('POST', blogPath('/posts'), { json: { ...payload, slug: post.slug } })
    action = 'created'
  }

  if (post.status === 'published') {
    result = await call('POST', blogPath(`/posts/${result.id}/publish`), {
      json: post.publishedAt ? { publishedAt: post.publishedAt } : {},
    })
  } else if (action === 'updated') {
    result = await call('POST', blogPath(`/posts/${result.id}/unpublish`), { json: {} })
  }

  state.posts[relPath] = { id: result.id, slug: result.slug }
  return { path: relPath, action, status: post.status, slug: result.slug, url: result.url }
}

// The API exposes no hard delete on purpose. Removing a Markdown file takes the post
// off the public site and leaves it as a draft in the dashboard.
async function retirePost(state, relPath) {
  const known = state.posts[relPath]
  if (!known) return { path: relPath, action: 'skipped (unknown file)', status: '', slug: '', url: '' }

  if (!DRY_RUN) await call('POST', blogPath(`/posts/${known.id}/unpublish`), { json: {} })
  return {
    path: relPath,
    action: DRY_RUN ? 'would unpublish' : 'unpublished',
    status: 'draft',
    slug: known.slug,
    url: '',
  }
}

// --- File discovery --------------------------------------------------------

const isPostFile = (path) => path.startsWith(`${POSTS_DIR}/`) && path.endsWith('.md')

function allPostFiles() {
  const dir = join(ROOT, POSTS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true })
    .map((entry) => posix.join(POSTS_DIR, entry.split(/[\\/]/).join('/')))
    .filter(isPostFile)
}

function changedPostFiles(state) {
  const before = process.env.GITHUB_EVENT_BEFORE
  const after = process.env.GITHUB_SHA || 'HEAD'
  if (!before || /^0+$/.test(before)) return null

  let output
  try {
    output = execFileSync('git', ['diff', '--name-status', '--find-renames', before, after], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  } catch {
    // Shallow clone, force push or rewritten history: fall back to a full sync.
    return null
  }

  const upserts = []
  const deletions = []
  for (const line of output.split('\n')) {
    const parts = line.split('\t')
    const status = parts[0]?.[0]
    if (!status) continue

    if (status === 'R') {
      const [, from, to] = parts
      // A renamed file must keep pointing at the same post, not create a second one.
      if (isPostFile(from) && isPostFile(to) && state.posts[from]) {
        state.posts[to] = state.posts[from]
        delete state.posts[from]
      } else if (isPostFile(from)) {
        deletions.push(from)
      }
      if (isPostFile(to)) upserts.push(to)
      continue
    }

    const path = parts[parts.length - 1]
    if (!isPostFile(path)) continue
    if (status === 'D') deletions.push(path)
    else upserts.push(path)
  }
  return { upserts, deletions }
}

// --- Reporting -------------------------------------------------------------

function report(results) {
  const rows = results.map((r) => `| \`${r.path}\` | ${r.action} | ${r.status} | ${r.url ? `[${r.slug}](${r.url})` : r.slug} |`)
  const table = ['| File | Action | Status | Post |', '|---|---|---|---|', ...rows].join('\n')

  console.log(table)
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## Writizzy\n\n${table}\n`, { flag: 'a' })
  }
}

// --- Main ------------------------------------------------------------------

async function main() {
  if (!DRY_RUN && (!API_KEY || !SUBDOMAIN)) {
    throw new Error('WRITIZZY_API_KEY and WRITIZZY_SUBDOMAIN must be set')
  }

  const state = loadState()

  let work
  if (explicitFiles.length > 0) {
    work = { upserts: explicitFiles, deletions: [] }
  } else if (ALL) {
    work = { upserts: allPostFiles(), deletions: [] }
  } else {
    work = changedPostFiles(state) || { upserts: allPostFiles(), deletions: [] }
  }

  if (work.upserts.length === 0 && work.deletions.length === 0) {
    console.log('Nothing to publish.')
    return
  }

  const results = []

  for (const path of work.upserts) results.push(await syncPost(state, path))
  for (const path of work.deletions) results.push(await retirePost(state, path))

  if (!DRY_RUN) saveState(state)
  report(results)
}

main().catch((error) => {
  console.error(`\nPublish failed: ${error.message}`)
  process.exit(1)
})
