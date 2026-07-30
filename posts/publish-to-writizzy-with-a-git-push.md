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

No plugin, no beta program, nothing custom on our side. It uses the public API that ships with your blog.

## Three things to set up

**1. Generate a write key.** In your blog settings, open **Developer API** and generate a key with write access. Read keys are for pulling content out (a static site build, for example) and they cannot create or change anything. Copy the key: it is shown once.

**2. Store it in GitHub.** In your repository settings, add a secret named `WRITIZZY_API_KEY`, and a variable named `WRITIZZY_SUBDOMAIN` holding your blog subdomain.

**3. Add the workflow.** One workflow file, one script, both in the repository above. Copy them and you are done.

That is the entire installation. The repository layout is deliberately boring:

```
posts/          your articles, one Markdown file each
assets/         images referenced from your articles
scripts/        the publishing script (Node, no dependencies)
.writizzy/      the file that remembers which post is which
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

Only the files you touched are sent. Push a fix to one article and the other twenty are left alone.

## Images come along

Reference an image with a relative path and it gets uploaded to your media library on the way:

```markdown
![A diagram of the flow](../assets/flow.png)
```

The script replaces the path with the CDN URL before saving the post. Images are tracked by content, so pushing the same article again does not upload the same file twice. Change the image, and only that one goes up.

## How the same push knows to update, not duplicate

This is the one part that needed a decision.

Creating a post through the API is not idempotent. Ask twice, get two posts. So something has to remember that `posts/my-article.md` is post `abc123` on your blog. That something is `.writizzy/state.json`, a small file the Action commits back to your repository after each run. Your repository is the memory, which means you can read it, diff it, and fix it by hand if you ever need to.

There is a second path for a post that already exists. If a file carries a slug that is already published on your blog, the script adopts that post instead of creating a new one. An article you started in the dashboard can be moved into the repository without losing its URL.

Deleting a Markdown file unpublishes its post. It does not destroy it. The API deliberately exposes no hard delete, so a bad `git rm` can never take your writing with it. The post goes back to being a draft in your dashboard, and you decide.

## What publishing does not do

Publishing makes a post visible. That is all it does.

It does not send your newsletter, and it does not cross-post to your social accounts. Those are separate actions, on purpose. A publishing script that could email thousands of readers by accident, on a bad merge, is not a publishing script anyone should trust. When you want the email to go out, you send it deliberately.

## Worth knowing

The public API is part of the paid plans, so this needs one of those. The write key is a real key: it can create and change posts on your blog, so keep it in GitHub secrets and nowhere else. And if you rename a Markdown file, keep it in the same push as everything else, since the Action follows renames rather than treating them as a delete plus a create.

The full source is in [the repository](https://github.com/hlassiege/demo-writizzy-post): about two hundred lines of Node with no dependencies, and a workflow file. Fork it, point it at your blog, and your writing lives in git from now on.

Nothing else was needed. This article is the receipt.
