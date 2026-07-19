export type GitHubRepository = {
  owner: string
  name: string
  fullName: string
  htmlUrl: string
  defaultBranch: string
  baseCommitSha: string
  isPrivate: boolean
  isArchived: boolean
  openIssues: number
  primaryLanguage: string | null
  pushedAt: string | null
}

export function parseGitHubRepository(value: string): { owner: string; name: string } {
  const input = value.trim()
  const shorthand = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (shorthand) return { owner: shorthand[1], name: shorthand[2].replace(/\.git$/, '') }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('Use https://github.com/owner/repository or owner/repository')
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error('Only HTTPS github.com repositories are supported')
  }
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 2) throw new Error('GitHub URL must identify one repository')
  const [owner, rawName] = segments
  const name = rawName.replace(/\.git$/, '')
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error('Repository owner or name contains unsupported characters')
  }
  return { owner, name }
}
type GitHubApiRepository = {
  full_name: string
  html_url: string
  default_branch: string
  private: boolean
  archived: boolean
  open_issues_count: number
  language: string | null
  pushed_at: string | null
}

export async function inspectGitHubRepository(
  repository: string,
  options: { token?: string; fetchFn?: typeof fetch } = {},
): Promise<GitHubRepository> {
  const { owner, name } = parseGitHubRepository(repository)
  const fetchFn = options.fetchFn ?? fetch
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'PatchBond/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  const response = await fetchFn(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { headers })
  if (response.status === 404) throw new Error('Repository not found or private access is not configured')
  if (response.status === 403) throw new Error('GitHub API rate limit reached; configure GITHUB_TOKEN locally')
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
  const data = await response.json() as GitHubApiRepository
  const commitResponse = await fetchFn(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(data.default_branch)}`,
    { headers },
  )
  if (!commitResponse.ok) throw new Error(`Unable to pin the default branch commit: GitHub returned ${commitResponse.status}`)
  const commit = await commitResponse.json() as { sha: string }
  if (!/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error('GitHub returned an invalid commit SHA')
  return {
    owner,
    name,
    fullName: data.full_name,
    htmlUrl: data.html_url,
    defaultBranch: data.default_branch,
    baseCommitSha: commit.sha,
    isPrivate: data.private,
    isArchived: data.archived,
    openIssues: data.open_issues_count,
    primaryLanguage: data.language,
    pushedAt: data.pushed_at,
  }
}
