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

- Production service checkout: `/Users/onpar/OnParBeverageRecipes-service`
- Main local site: `http://localhost:3000`
- Run the complete check before proposing a production release:

```bash
npm run check
```

- Production is the on-site Mac behind the Cloudflare tunnel. Vercel builds are
  previews only because they cannot reach the venue's PourMyBeer service.
- Use the scripts and rollback procedure in `OPERATIONS.md`; do not deploy from
  an arbitrary development checkout.
