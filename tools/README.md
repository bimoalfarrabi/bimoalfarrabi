# Count private contributions in the stats card

The stats card reads `STATS_TOKEN` from the repository secrets. When that secret
is set and the token can actually see private repositories, the card counts
private work too. Otherwise it falls back to public data and shows a
`PUBLIC ONLY` badge.

## Use a classic token, not fine-grained

This matters and is easy to get wrong.

The commit count comes from `GET /search/commits`. GitHub filters search results
down to what the token is allowed to index, and a **fine-grained** token with
`Metadata: Read-only` still returns public commits only. Verified on this repo:
the fine-grained token returned 1,431 commits (the public figure), while a
**classic** token with the `repo` scope returned 4,322.

A classic token is broader than ideal, so give it an expiration date and rotate
it.

## One-time setup

1. Create a **classic** personal access token at
   <https://github.com/settings/tokens/new>

   | Field | Value |
   |---|---|
   | Note | `readme-stats` |
   | Expiration | 90 days |
   | Scopes | **`repo`** (nothing else needed) |

2. Store it as a repository secret:

   ```bash
   gh secret set STATS_TOKEN --repo bimoalfarrabi/bimoalfarrabi
   ```

3. Run the workflow:

   ```bash
   gh workflow run stats.yml --repo bimoalfarrabi/bimoalfarrabi
   ```

## Verify it actually worked

```bash
gh run list --workflow=stats.yml --limit 1
gh run view --log <run-id> | grep -E "commitsAll|commitsPublic|privateVisible"
```

With `STATS_DEBUG` unset the workflow prints only the final numbers. To see the
diagnostic block, add `STATS_DEBUG: "1"` to the `Generate cards` step env.
Expected with a working token:

```
commitsAll: 4322      commitsPublic: 1431      privateVisible: true
```

`privateVisible: false` means the token cannot see private commits, and the card
correctly falls back to public counts.

## What each number means

| Label | Source |
|---|---|
| `TOTAL COMMITS` | `search/commits` as author, private included |
| `PUBLIC COMMITS` | same query with `is:public` (used when private is not visible) |
| `PULL REQUESTS` | `search/issues` type:pr as author |
| `ISSUES OPENED` | `search/issues` type:issue as author |
| `TOTAL STARS` | sum of `stargazers_count` over owned repos |
| `FOLLOWERS` | `users/:login.followers` |

The card shows `INCL PRIVATE` only when private commits are genuinely visible,
so the badge can never overstate the scope.

## Security notes

- The token is read only in the `Generate cards` step and is never echoed.
- Nothing is written to the repository except the two SVG files.
- When the token expires the badge disappears and counts return to public, which
  is the visible signal to rotate it.
