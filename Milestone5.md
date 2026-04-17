## Milestone 5 - LLM-Assisted Development Workflow

### Status

Milestone 5 adds an LLM into the team's GitHub development workflow. A GitHub Actions workflow
triggers on every Pull Request and posts an AI-generated summary of the proposed changes as a PR
comment, using the OpenAI API.

The workflow requires no local tooling — it runs entirely inside GitHub Actions and uses the
`OPENAI_API_KEY` repository secret to authenticate with the OpenAI API.

### Environment

- CI environment: GitHub Actions (`ubuntu-latest`)
- LLM service: OpenAI API (`gpt-4o`)
- Trigger: Pull Request events (`opened`, `synchronize`, `reopened`)
- No local setup required beyond adding the API key secret

### LLM service choice

The project uses OpenAI GPT-4o for the PR summary workflow.

Reasoning:

1. GPT-4o produces well-structured plain-English summaries of code diffs with minimal prompt
   engineering.
2. The OpenAI REST API is callable directly from a bash step using `curl` and `jq` — no extra
   dependencies or Node.js scripts needed.
3. `gpt-4o` has a large enough context window to handle the full diff of typical feature branches.

### Implemented Milestone 5 artifacts

Workflow:

- `.github/workflows/pr-summary.yml`

Documentation:

- `Milestone5.md`

### How the workflow operates

1. A contributor opens a PR or pushes new commits to an existing PR branch.
2. GitHub Actions triggers the `PR Summary` workflow.
3. The runner checks out the repo with full history (`fetch-depth: 0`).
4. A `git diff origin/<base>...HEAD` produces the full unified diff for the branch.
5. The diff is sent to the OpenAI API (`gpt-4o`) with the prompt:
   > Summarize the following PR diff in plain English. Focus on: what changed, why it matters,
   > and any potential risks.
6. The API response is parsed with `jq` to extract the summary text.
7. The GitHub CLI (`gh pr comment`) posts the summary as a comment on the PR.

### Setup

Add the OpenAI API key as a repository secret before the workflow can run:

1. Go to the repository on GitHub.
2. Navigate to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret**.
4. Name: `OPENAI_API_KEY`
5. Value: your OpenAI API key (starts with `sk-...`).
6. Click **Add secret**.

`GITHUB_TOKEN` is provided automatically by GitHub Actions — no additional setup is needed for
the PR comment step.

### How to verify

1. Ensure `OPENAI_API_KEY` is set as described above.
2. Push a branch with any code change and open a PR against `main`.
3. After ~30 seconds, the **Comments** tab on the PR should show a comment with the heading
   **AI PR Summary** followed by a plain-English description of the changes.
4. To debug a failed run, go to the **Actions** tab on the repository and open the
   `PR Summary` workflow run for the relevant commit.

### Findings

1. The workflow handles the full diff for feature-sized branches within GPT-4o's context window
   without truncation.
2. Keeping the diff generation and API call in a single step avoids the multiline output
   escaping issues that arise when passing large diffs through `$GITHUB_OUTPUT`.
3. `gh pr comment` using `GH_TOKEN` (the automatic `GITHUB_TOKEN`) is sufficient for posting
   comments — no additional OAuth scopes are needed.
