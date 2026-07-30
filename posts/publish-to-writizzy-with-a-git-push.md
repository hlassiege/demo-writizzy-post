---
title: "Publish to your blog with a git push"
slug: publish-to-writizzy-with-a-git-push
excerpt: "Write your posts in a GitHub repository, push, and they appear on your blog. Here is the whole setup, and this article is the proof it works."
tags: [API, Automation]
status: draft
accessMode: FREE
---

Some writers do not want a text editor in a browser tab. They want their own editor, their own files, version control, pull requests, and a branch when an article is not ready. If that is you, you can keep all of it and still publish on Writizzy.

This article lives in a public GitHub repository: [hlassiege/demo-writizzy-post](https://github.com/hlassiege/demo-writizzy-post). It was not written in the Writizzy editor. It was written in a Markdown file, committed, and pushed. A GitHub Action did the rest. Every correction you may read later arrived the same way: an edit, a commit, a push.

It uses the public API that comes with your blog.

## Three things to set up

**1. Generate a write key.** In your blog settings, open **Developer API** and generate a key with write access. Read keys are for pulling content out (a static site build, for example) and they cannot create or change anything.

**2. Store it in GitHub.** In your repository settings, add a secret named `WRITIZZY_API_KEY`, and a variable named `WRITIZZY_SUBDOMAIN` holding your blog subdomain.

**3. Add the workflow.** One workflow file, one script, both in the repository above. Copy them and you are done.

The repository layout is deliberately boring:

```
posts/      your articles, one Markdown file each
assets/     images referenced from your articles
scripts/    the publishing script (Node, no dependencies)
```

## What a post looks like

A post is a Markdown file with a small header:

```markdown
---
title: "Publish to your blog with a git push"
slug: publish-to-writizzy-with-a-git-push
excerpt: "Write in a GitHub repository, push, and it appears on your blog."
tags: [API, Automation]
status: published
---

Some writers do not want a text editor in a browser tab...
```

`status: draft` sends the post to your dashboard and leaves it invisible, so you can reread it in context before anyone else sees it. `status: published` puts it online. Flip one to the other, push, and the post appears or goes back to being a draft.

Only the files you touched in that push are sent. Fix a typo in one article and the other twenty are left alone.

## The slug is the post

Push the same file twice and you get one post, not two. That is a property of the API rather than something the script works around: a create call can carry `onConflict=UPDATE`, and from then on the slug is what identifies the post. First push creates it, every push after updates it in place. Nothing to remember between two runs, no id to store, no bookkeeping file in your repository.

Which is why the script stays small. The part that talks to Writizzy is about fifty lines. The rest reads your Markdown.

Publishing is still its own call, and it only makes the post visible. It does not send your newsletter and it does not cross-post anywhere. A publishing pipeline that could email thousands of readers on a bad merge is not one anybody should trust, so those stay deliberate actions you take when you mean them.

## Images come along

Reference an image with a relative path and it gets uploaded to your media library on the way:

```markdown
![A diagram of the flow](../assets/flow.png)
```

The script replaces the path with the CDN URL before saving the post, so what readers get is served from the CDN and what you keep in git is the file.

## Deleting is safe

Delete a Markdown file and its post is unpublished. It is not destroyed. The API exposes no hard delete, so a careless `git rm` cannot take your writing with it. The post goes back to being a draft in your dashboard, and you decide what happens next.

## Take it

The full source is in [the repository](https://github.com/hlassiege/demo-writizzy-post): one Node script with no dependencies, and one workflow file. Fork it, point it at your blog, and your writing lives in git from now on.
