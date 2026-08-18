# Start Here

Use this in the first Codex session on the new computer:

```text
We are working on the On Par Beverage Recipes dashboard.

Please read these files first:
- scratchpad.md
- SETUP-CHECKLIST.md
- OPERATIONS.md

Then inspect the repo and summarize:
1. current project structure
2. current major features
3. any uncommitted local changes
4. any obvious setup issues

After that, wait for my next instruction before making changes.
```

## Important local notes

- Current production guide: `PRODUCTION-PM2.md`
- Production source checkout: `/Users/onpar/OnParBeverageRecipes-source`
- Persistent runtime directory: `/Users/onpar/OnParBeverageRecipes-service`
- Dashboard supervisor: PM2 app `onpar-dashboard`
- Main local site: `http://localhost:3000`
- Run the complete check before proposing a production release:

```bash
npm run check
```

- Production is the on-site Mac behind the Cloudflare tunnel. Vercel builds are
  previews only because they cannot reach the venue's PourMyBeer service.
- Follow `PRODUCTION-PM2.md`. Do not use the legacy LaunchAgent deployment
  scripts on the current service Mac.
