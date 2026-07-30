# demo-writizzy-post

Publish Markdown files from a GitHub repository to a [Writizzy](https://writizzy.com) blog, using the public v1 API. 
No dependencies.

The article in `posts/` describes the mechanism and is published by it.

## Setup

1. **Generate a write key**: in your blog settings, open *Developer API* and generate a key with
   write access.
2. **Add it to the repository**: `Settings → Secrets and variables → Actions`. The key has to be a
   secret; the two others can be either a variable or a secret, whichever tab you land on.
   - secret `WRITIZZY_API_KEY`: the write key
   - variable `WRITIZZY_SUBDOMAIN`: the subdomain of the target blog
   - variable `WRITIZZY_API_BASE` (optional): defaults to `https://api.writizzy.com`
3. **Push**: any change under `posts/` triggers `.github/workflows/publish.yml`.

## Layout

```
posts/               one Markdown file per post
assets/              images referenced with relative paths
scripts/publish.mjs  the publishing script
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
| Edited file | Same post updated in place, publication state follows `status` |
| Renamed file, same slug | Same post, no duplicate |
| Changed slug | New post (the slug is the identity of the post) |
| Deleted file | Post unpublished, kept as a draft (the API has no hard delete) |
| Relative image path | Uploaded to the media library, path rewritten to the CDN URL |

Only the files changed by the push are sent.

Publishing only makes a post visible. It never sends the newsletter and never triggers
cross-posting: those are separate, explicit actions.

## Why it never duplicates

The whole script rests on one API parameter: `POST /v1/blogs/{subdomain}/posts?onConflict=UPDATE`.

The slug becomes the identity of the post. The first push creates it (`201`), every push after
updates it in place (`200`). 
No id to remember, no state, and no lookup before writing. 

## Known rough edge

Images are re-uploaded every time a post that references them is pushed, because the API has no
way to tell that a file it already stores is the same file. Not a problem for a post or two, worth
knowing if you push a heavily illustrated article often.

## Run it locally

```bash
node scripts/publish.mjs --dry-run --all          # parse and report, no network call

export WRITIZZY_API_KEY=wz_yourblog_...
export WRITIZZY_SUBDOMAIN=yourblog
node scripts/publish.mjs posts/my-article.md      # publish one file
node scripts/publish.mjs --all                    # publish everything
```
