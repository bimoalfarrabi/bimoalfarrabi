# Count private contributions in the stats card

The stats card reads `STATS_TOKEN` from the repository secrets. When that secret
is set, the card counts private repositories too, so commits made in private
work show up. When it is absent, the card falls back to public data and still
renders normally.

## One-time setup

1. Create a fine-grained personal access token at
   <https://github.com/settings/personal-access-tokens/new>

   | Field | Value |
   |---|---|
   | Token name | `readme-stats` |
   | Expiration | 90 days (renew when it lapses) |
   | Resource owner | your own account |
   | Repository access | All repositories |
   | Permissions | Repository permissions, **Metadata: Read-only** |

   Search APIs (`/search/commits`, `/search/issues`) need only Metadata read,
   which is the minimum scope that makes private counts visible.

2. Add it as a repository secret:

   ```bash
   gh secret set STATS_TOKEN --repo bimoalfarrabi/bimoalfarrabi
   ```

   Paste the token when prompted.

3. Trigger the workflow once:

   ```bash
   gh workflow run stats.yml --repo bimoalfarrabi/bimoalfarrabi
   ```

## Verify

```bash
gh run list --workflow=stats.yml --limit 1
```

The run log prints the collected numbers. `"includesPrivate": true` means the
secret is being read and private activity is counted.

## What each number means

| Label | Source |
|---|---|
| `TOTAL COMMITS` | `search/commits` as author, private included |
| `PUBLIC COMMITS` | same query restricted with `is:public` (used when no PAT) |
| `PULL REQUESTS` | `search/issues` type:pr as author |
| `ISSUES OPENED` | `search/issues` type:issue as author |
| `TOTAL STARS` | sum of `stargazers_count` over owned repos |
| `FOLLOWERS` | `users/:login.followers` |

The card shows an `INCL PRIVATE` badge in the header whenever private data is
included, so the scope is never ambiguous.

## Security notes

- The token is read only in the `Generate cards` step and is never echoed. The
  script never prints it.
- Nothing is written to the repository except the two SVG files.
- Rotate the token when it expires, or the card silently falls back to public
  counts (the badge disappears, which is the signal).
