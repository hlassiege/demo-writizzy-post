# demo-writizzy-post

Publish Markdown files from a GitHub repository to a [Writizzy](https://writizzy.com) blog on
every push, using the public v1 API. No dependencies, one script, one workflow.

The article in `posts/` describes the mechanism and is published by it.

## Setup

1. **Generate a write key**: in your blog settings, open *Developer API* and generate a key with
   write access. It is shown once.
2. **Add it to the repository**: `Settings → Secrets and variables → Actions`
   - secret `WRITIZZY_API_KEY`: the write key
   - variable `WRITIZZY_SUBDOMAIN`: the subdomain of the target blog
   - variable `WRITIZZY_API_BASE` (optional): defaults to `https://api.writizzy.com`
3. **Push**: any change under `posts/` triggers `.github/workflows/publish.yml`.

## Layout

```
posts/               one Markdown file per post
assets/              images referenced with relative paths
scripts/publish.mjs  the publishing script
.writizzy/state.json file path -> post id, committed back by the workflow
```

## Front matter

```yaml
---
title: "Publish to your blog with a git push"   # required
slug: publish-to-writizzy-with-a-git-push       # optional, generated from the title otherwise
excerpt: "Shown in listings and previews."      # optional
tags: [API, Automation]                         # optional, created on the fly
cover: ../assets/cover.png                      # optional, local path or absolute URL
status: published                               # published | draft (default: draft)
publishedAt: 2026-08-01                         # optional, a future date schedules the post
accessMode: FREE                                # FREE | PAID (default: FREE)
---
```

## Behaviour

| Action in the repository | Effect on the blog |
|---|---|
| New file, `status: published` | Post created, then published |
| New file, `status: draft` | Draft created, invisible to readers |
| Edited file | Post updated in place, publication state follows `status` |
| Renamed file | Same post, no duplicate |
| Deleted file | Post unpublished, kept as a draft (the API has no hard delete) |
| Relative image path | Uploaded to the media library, path rewritten to the CDN URL |

Only the files changed by the push are sent. Images are keyed by content hash, so unchanged
images are never re-uploaded.

Publishing only makes a post visible. It never sends the newsletter and never triggers
cross-posting: those are separate, explicit actions.

## Run it locally

```bash
node scripts/publish.mjs --dry-run --all          # parse and report, no network call

export WRITIZZY_API_KEY=wz_yourblog_...
export WRITIZZY_SUBDOMAIN=yourblog
node scripts/publish.mjs posts/my-article.md      # publish one file
node scripts/publish.mjs --all                    # publish everything
```

## Why the state file

Creating a post through the API is not idempotent: two calls create two posts. And a draft
cannot be looked up by slug, so the repository has to remember which file maps to which post id.
That mapping is `.writizzy/state.json`, committed back by the workflow with `[skip ci]`.

If a file's slug is already published on the blog, the script adopts that post instead of
creating a new one, so a post started in the dashboard can be moved into the repository.
