## Summary

Describe the user-visible or maintenance outcome.

## Validation

- [ ] `bun run check`
- [ ] `bun run test`
- [ ] `bun run test:http` (when routes changed)
- [ ] `bun run test:integration` (when database writes or migrations changed)

## Database and risk

- [ ] No migration required
- [ ] Migration added and local rollback/repair considerations documented
- [ ] Authorization, sensitive data, and compatibility impacts reviewed
