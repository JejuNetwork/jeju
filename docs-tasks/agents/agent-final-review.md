# Agent Task: Final Review

## Scope
Review all documentation for consistency, completeness, and quality.

## Dependencies
- All other agent tasks completed
- All docs written to `apps/documentation/`

## Review Checklist

### Consistency
- [ ] All pages use consistent heading structure
- [ ] Code examples use TypeScript (not JavaScript)
- [ ] CLI commands use `bun` (not npm/npx)
- [ ] All links are valid
- [ ] All addresses/values are up-to-date

### Completeness
- [ ] Every app has documentation
- [ ] Every package has documentation
- [ ] All user paths have clear guides
- [ ] All API endpoints are documented
- [ ] All contract addresses are listed

### Quality
- [ ] No verbose/wordy sections
- [ ] Clear, friendly tone
- [ ] Working code examples
- [ ] Proper cross-linking
- [ ] Copy-as-context blocks on all pages

### Technical Accuracy
- [ ] Contract addresses match deployments
- [ ] RPC endpoints are correct
- [ ] Chain IDs are correct
- [ ] SDK examples are current

## Review Process

1. Read each page in order
2. Verify code examples compile/run
3. Check all links work
4. Ensure consistent terminology
5. Add missing cross-references

## Output

### Fix List
Create `docs-tasks/research/review-fixes.md` with:
- List of issues found
- Suggested fixes
- Priority (high/medium/low)

### Navigation Config
Ensure `apps/documentation/.vitepress/config.ts` has correct sidebar configuration.

## Final Validation

```bash
cd apps/documentation
bun run dev
# Verify all pages load
# Verify all links work
# Verify code blocks render
```

