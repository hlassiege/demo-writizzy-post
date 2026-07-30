---
title: "Write your blog in Markdown on GitHub, publish with a push"
slug: publish-to-writizzy-with-a-git-push
excerpt: "Write your posts in a GitHub repository, push, and sync it on your blog. Discover how to setup your code and workflow."
tags: [API, Automation]
status: published
---

Today I write almost exclusively in Writizzy, the blogging platform behind this blog. Plenty of people would rather write Markdown in a file, and I admit it has real advantages. The file is versioned, you can read its history and see what changed from one version to the next, and it stays a plain file that lives on your machine, so you never lose ownership of your writing if the platform dies.

Git is not for everybody. The interface is less convenient, handling images is more painful, but the appeal makes sense to me. It is not the experience an online editor gives you, and I still wanted that way of working to be possible inside Writizzy, through an API.

That is exactly what this article is about. It is one of the rare ones I wrote directly in Markdown, then synced to Writizzy with a GitHub Action. This article lives in a public GitHub repository: [hlassiege/demo-writizzy-post](https://github.com/hlassiege/demo-writizzy-post).

Let me show you how to do it.

## Setting it up

**1. Generate a write key.** In your blog settings, open **Developer API** and generate a key with write access. Read keys are for pulling content out (a static site build, for example) and they cannot create or change anything.

**2. Store it in GitHub.** In your repository settings, add a secret named `WRITIZZY_API_KEY`, and a variable named `WRITIZZY_SUBDOMAIN` holding your blog subdomain.

**3. Add the workflow.** One workflow file, one script, both in the repository above. Copy them and you are done.

The repository layout is deliberately simple:

```
posts/      your articles, one Markdown file each
assets/     images referenced from your articles
scripts/    the publishing script (Node, no dependencies)
```

## What a post looks like

A post is a Markdown file with a small header. I went with front matter, the format most static site generators already use.

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

Notice that this post is in `status: draft`. Nothing goes out immediately, so you can reread it in context before anyone else sees it. Switching it to `status: published` puts it online.

I made sure the script only republishes the article you actually touched. Fix a typo in one article and the other twenty are left alone.

## How updates are handled

The slug is the identity of the post. Change it and you get a new post, keep it and you update the same one.
Under the hood, it uses the `onConflict=UPDATE` parameter of the API, so you do not have to store any ID or bookkeeping file in your repository. The slug is what identifies the post.

Publishing is still its own call, and it only makes the post visible. It does not send your newsletter and it does not cross-post anywhere. I decided that this kind of action should not be tied to the publish API.

## Watch out for images

Reference an image with a relative path and it gets uploaded to your media library on the way:

```markdown
![A diagram of the flow](../assets/flow.png)
```

The script replaces the path with the CDN URL before saving the post, so what readers get is served from the CDN and what you keep in git is the file.

Image handling does come with a limitation. Every push of an article uploads its images again, which recreates the same files. Publishing an article once or twice is no big deal, but it is not optimal. If your content is heavy on images, you probably want to adapt the script so that it sends published versions only rather than every draft, to keep the duplicates down.

## That's all

And that is all. Have a look at [`publish.mjs`](https://github.com/hlassiege/demo-writizzy-post/blob/main/scripts/publish.mjs), the script the GitHub Action runs to publish. It is the heart of this demo, and it is what put the article you are reading online.

If you have any questions, ask away.
