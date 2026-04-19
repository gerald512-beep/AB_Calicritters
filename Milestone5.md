## Milestone 5 - Software Development with LLMs

### Overview

This milestone documents how the team integrated Code Assistants and LLMs into the software
development workflow across two repositories: this backend/infrastructure repo and the frontend
application repo.

---

## Task 1 - GitHub Actions PR Summary Workflow

### Status

Completed. A GitHub Actions workflow triggers on every Pull Request and posts an AI-generated
summary of the proposed changes as a PR comment, using the Anthropic Claude API
(`claude-sonnet-4-6`).

### Environment

- CI environment: GitHub Actions (`ubuntu-latest`)
- LLM service: Anthropic Claude API (`claude-sonnet-4-6`)
- Trigger: Pull Request events (`opened`, `synchronize`, `reopened`)
- No local setup required beyond adding the API key secret

### LLM service choice

The project uses Anthropic Claude (`claude-sonnet-4-6`) for the PR summary workflow.

Reasoning:

1. Claude produces well-structured plain-English summaries of code diffs with minimal prompt
   engineering.
2. The Anthropic REST API is callable directly from a bash step using `curl` and `jq` — no extra
   dependencies or Node.js scripts needed.
3. `claude-sonnet-4-6` has a large enough context window to handle the full diff of typical
   feature branches.

### Implemented artifacts

Workflow:

- `.github/workflows/pr-summary.yml`

### How the workflow operates

1. A contributor opens a PR or pushes new commits to an existing PR branch.
2. GitHub Actions triggers the `PR Summary` workflow.
3. The runner checks out the repo with full history (`fetch-depth: 0`).
4. A `git diff origin/<base>...HEAD` produces the full unified diff for the branch.
5. The diff is sent to the Anthropic Claude API with the prompt:
   > Summarize the following PR diff in plain English. Focus on: what changed, why it matters,
   > and any potential risks.
6. The API response is parsed with `jq` to extract the summary text.
7. The GitHub CLI (`gh pr comment`) posts the summary as a comment on the PR.

### Setup

Add the Anthropic API key as a repository secret before the workflow can run:

1. Go to the repository on GitHub.
2. Navigate to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret**.
4. Name: `ANTHROPIC_API_KEY`
5. Value: your Anthropic API key (starts with `sk-ant-...`).
6. Click **Add secret**.

`GITHUB_TOKEN` is provided automatically by GitHub Actions — no additional setup is needed for
the PR comment step.

### Challenges met

- The `DATABASE_URL` secret for the existing Analytics Rollup workflow was missing, causing
  daily failures. It was fixed by adding the Neon PostgreSQL connection string as a repository
  secret.
- Neon does not support PostgreSQL advisory locks (`pg_try_advisory_lock`). The rollup job used
  these as a concurrency guard, which caused the job to fail on every run. The lock was removed
  since the scheduled workflow runs serially and does not need distributed locking.
- The OpenAI API key was initially used but found to be invalid. The workflow was switched to
  the Anthropic Claude API.

### Findings

1. The workflow handles the full diff for feature-sized branches within Claude's context window
   without truncation.
2. Keeping the diff generation and API call in a single step avoids the multiline output
   escaping issues that arise when passing large diffs through `$GITHUB_OUTPUT`.
3. `gh pr comment` using `GH_TOKEN` (the automatic `GITHUB_TOKEN`) is sufficient for posting
   comments — no additional OAuth scopes are needed.

---

## Task 2 - AI-Assisted PR Review

### Status

Completed as part of Task 1. The `PR Summary` workflow automatically reviews every PR by
generating an AI summary of the diff and posting it as a comment. The team used this output to
review PR #2 (`fix/nodejs-24-actions`), which fixed the Node.js 20 deprecation warning in both
GitHub Actions workflows.

### Findings

- The AI summary correctly identified what changed (adding `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`
  to both workflows), why it matters (avoiding the forced migration breaking change on June 2,
  2026), and that the risk was low.
- The reviewing task was made easier: the summary gave an immediate plain-English explanation
  without needing to read the raw diff.
- The assistant did not miss any important changes in this PR. For small, focused diffs the
  output was accurate and useful.

---

## Task 3 - AI-Assisted Feature Implementation

I tried a few different agents for this assignment. I'm very used to using ChatGPT for
coding small features, getting a second opinion on how I plan to set up my backend, or figuring
out how to fix errors. However, ChatGPT has some significant shortcomings.

ChatGPT occasionally causes new errors or does not solve the existing problem(s). This
is infrequent, but wastes time. Copy pasting from the browser or the app is also slow when the
changes suggested span files or different code sections. Additionally, it has limited context
across a large codebase and writes far more error / uncertainty checks than are actually
required.

Considering these issues, I figured the best solution was finding an AI that had access to
my codebase. I first tried to use Continue, but it required a subscription to OpenAI's API plan.
Codex, however, allowed me to connect my current ChatGPT plan. Excited, especially with its
strong recommendation from my "vibe coding" friend, I prompted edits to my app. It was so bad.
It mis-interpretted my requests, did not do a great job of telling me what it was doing and
where, and most importantly, BROKE EVERYTHING. The app wouldn't run anymore- just one big error
screen. When I complained to Codex and asked it to revert its changes, it responded with
"reverting to last commit". Unfortunately, the last commit was god knows how long ago. I stopped
the process before it could enact further damage.

I first heard about Cursor during my last internship, in a weekly skills & software tutorial
meeting. I decided I would try it next. Cursor has been absolutely brilliant. After testing the
app once again, I had a long list of small UX/UI changes. I wrote them all out, and asked Cursor
to fix them. After thinking for a moment, it laid out a plan of what it wanted to accomplish,
incorporating all of my changes. It showed me what it was updating in real time, and finished
with a summary of changes and how they were implemented. Emboldened, I asked it to implement
some more complex features.

This is now one of my favorite features in the app. The idea was mine, but I didn't really
think it'd be possible to implement. Cursor created a little human that represents which muscles
you've exercised today, in the last week, in the last month, or in the time you've used the app.
It was not immediately ready to go– there were a few small corrections such as how things were
framed and the week function being Mon-Sun instead of the last seven days. I think I used one
more query to fix the bigger issues and fixed formatting (some stuff was coming off the page,
some things I wanted in different places) manually. But I like this feature a lot because it
gives people both an idea of what they're training and the impression that they're making
progress.

I've been using cursor in two main ways- testing big new features and implementing a list of
small fixes for pain points I find testing. So far, it has been extraordinarily effective and
allows for a lot more creative freedom. Instead of worrying about how long a feature might take,
I very quickly am able to test it in some halfway decent capacity. It allows for a lot more
flexibility in the software engineering process, and I notice I'm also more able to (hesitantly)
delete features that I realize are not effective.

---

## Task 4 - Playwright / Browser Use LLM Assistant

### Status

**Pending**



Planned artifacts:

- `scripts/playwright/` — Playwright test scripts
- `scripts/playwright/browser-agent.ts` — LLM-driven browser interaction agent

---

## MGT 697 Deliverables

### Status

**Pending**


### MGT 697.1 - User Persona Development



### MGT 697.2 - Persona-to-Test Mapping



### MGT 697.3 - Findings and Reflection


