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

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const POSTS_DIR = 'posts'

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

function str(value) {
  if (typeof value !== 'string') return undefined
  return value.length > 0 ? value : undefined
}

function parsePost(relPath, raw) {
  const text = raw.replace(/\r\n/g, '\n')
  if (!text.startsWith('---\n')) throw new Error(`${relPath}: missing YAML front matter`)

  const end = text.indexOf('\n---', 4)
  if (end === -1) throw new Error(`${relPath}: front matter is never closed`)

  const data = parseFrontMatterBlock(text.slice(4, end))
  const content = text.slice(text.indexOf('\n', end + 1) + 1).trim()

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

const readPost = (relPath) => parsePost(relPath, readFileSync(join(ROOT, relPath), 'utf8'))

// --- API ------------------------------------------------------------------

async function request(method, path, { json, form, allow404 = false } = {}) {
  const headers = { Authorization: `Bearer ${API_KEY}` }
  if (json) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: json ? JSON.stringify(json) : form,
  })

  if (response.status === 404 && allow404) return { status: 404, body: null }
  if (!response.ok) {
    throw new Error(`${method} ${path} returned ${response.status}: ${(await response.text()).slice(0, 500)}`)
  }
  return { status: response.status, body: response.status === 204 ? null : await response.json() }
}

const call = async (method, path, options) => (await request(method, path, options)).body

const blogPath = (suffix = '') => `/v1/blogs/${encodeURIComponent(SUBDOMAIN)}${suffix}`

// --- Media ----------------------------------------------------------------

// Same image referenced by the cover and the body: upload it once per run.
const uploadedThisRun = new Map()

async function uploadImage(mdPath, imagePath, altText) {
  const candidates = imagePath.startsWith('/')
    ? [join(ROOT, imagePath.slice(1))]
    : [resolve(ROOT, dirname(mdPath), imagePath), resolve(ROOT, imagePath)]

  const filePath = candidates.find((c) => existsSync(c))
  if (!filePath) throw new Error(`${mdPath}: image not found: ${imagePath}`)

  const filename = posix.basename(imagePath.split(/[?#]/)[0])
  if (DRY_RUN) return `https://cdn.example/dry-run/${filename}`
  if (uploadedThisRun.has(filePath)) return uploadedThisRun.get(filePath)

  const form = new FormData()
  form.append(
    'file',
    new Blob([readFileSync(filePath)], {
      type: MIME_TYPES[extname(filename).toLowerCase()] || 'application/octet-stream',
    }),
    filename,
  )
  if (altText) form.append('altText', altText)

  const media = await call('POST', blogPath('/media'), { form })
  uploadedThisRun.set(filePath, media.url)
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
async function uploadLocalImages(post) {
  const pattern = /!\[([^\]]*)\]\(\s*([^)\s]+)([^)]*)\)/g
  const skip = codeRanges(post.content)
  const parts = []
  let cursor = 0

  for (const match of post.content.matchAll(pattern)) {
    const [full, alt, url, trailer] = match
    if (isRemote(url)) continue
    if (skip.some(([from, to]) => match.index >= from && match.index < to)) continue

    const cdnUrl = await uploadImage(post.path, url, alt)
    parts.push(post.content.slice(cursor, match.index), `![${alt}](${cdnUrl}${trailer})`)
    cursor = match.index + full.length
  }

  parts.push(post.content.slice(cursor))

  let coverImageUrl = post.cover
  if (coverImageUrl && !isRemote(coverImageUrl)) {
    coverImageUrl = await uploadImage(post.path, coverImageUrl, post.title)
  }

  return { content: parts.join(''), coverImageUrl }
}

// --- Publishing ------------------------------------------------------------

// The slug is the identity of the post: onConflict=UPDATE creates it the first time
// and updates it every time after, so nothing has to be remembered between runs.
async function syncPost(relPath) {
  const post = readPost(relPath)
  const { content, coverImageUrl } = await uploadLocalImages(post)

  const payload = {
    title: post.title,
    slug: post.slug,
    content,
    excerpt: post.excerpt,
    coverImageUrl,
    tags: post.tags,
    accessMode: post.accessMode,
  }

  if (DRY_RUN) {
    return { path: relPath, action: 'would sync', status: post.status, slug: post.slug || '(from the title)', url: '' }
  }

  const upsert = await request('POST', blogPath('/posts?onConflict=UPDATE'), { json: payload })
  let result = upsert.body
  const action = upsert.status === 201 ? 'created' : 'updated'

  if (post.status === 'published') {
    result = await call('POST', blogPath(`/posts/${result.id}/publish`), {
      json: post.publishedAt ? { publishedAt: post.publishedAt } : {},
    })
  } else if (result.publishedAt) {
    result = await call('POST', blogPath(`/posts/${result.id}/unpublish`))
  }

  return { path: relPath, action, status: post.status, slug: result.slug, url: result.url }
}

// The API exposes no hard delete on purpose. Removing a Markdown file takes the post off
// the public site and leaves it as a draft in the dashboard, so nothing is ever lost.
async function retirePost(relPath, slug) {
  if (!slug) return { path: relPath, action: 'skipped (no slug)', status: '', slug: '', url: '' }
  if (DRY_RUN) return { path: relPath, action: 'would unpublish', status: 'draft', slug, url: '' }

  const published = await call('GET', blogPath(`/posts/${encodeURIComponent(slug)}`), { allow404: true })
  if (!published) return { path: relPath, action: 'nothing to unpublish', status: '', slug, url: '' }

  await call('POST', blogPath(`/posts/${published.id}/unpublish`))
  return { path: relPath, action: 'unpublished', status: 'draft', slug, url: '' }
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

const git = (...cliArgs) => execFileSync('git', cliArgs, { cwd: ROOT, encoding: 'utf8' })

// A deleted file is only known through git history, which is also where its slug is.
function slugOfDeletedFile(relPath, ref) {
  try {
    return parsePost(relPath, git('show', `${ref}:${relPath}`)).slug
  } catch {
    return undefined
  }
}

function changedPostFiles() {
  const before = process.env.GITHUB_EVENT_BEFORE
  const after = process.env.GITHUB_SHA || 'HEAD'
  if (!before || /^0+$/.test(before)) return null

  let output
  try {
    output = git('diff', '--name-status', '--find-renames', before, after)
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

    // A rename keeps the same slug, so it is just an update of the new path.
    const path = parts[parts.length - 1]
    if (!isPostFile(path)) continue
    if (status === 'D') deletions.push({ path, slug: slugOfDeletedFile(path, before) })
    else upserts.push(path)
  }
  return { upserts, deletions }
}

// --- Reporting -------------------------------------------------------------

function report(results) {
  const rows = results.map(
    (r) => `| \`${r.path}\` | ${r.action} | ${r.status} | ${r.url ? `[${r.slug}](${r.url})` : r.slug} |`,
  )
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

  let work
  if (explicitFiles.length > 0) {
    work = { upserts: explicitFiles, deletions: [] }
  } else if (ALL) {
    work = { upserts: allPostFiles(), deletions: [] }
  } else {
    work = changedPostFiles() || { upserts: allPostFiles(), deletions: [] }
  }

  if (work.upserts.length === 0 && work.deletions.length === 0) {
    console.log('Nothing to publish.')
    return
  }

  const results = []
  for (const path of work.upserts) results.push(await syncPost(path))
  for (const { path, slug } of work.deletions) results.push(await retirePost(path, slug))

  report(results)
}

main().catch((error) => {
  console.error(`\nPublish failed: ${error.message}`)
  process.exit(1)
})
