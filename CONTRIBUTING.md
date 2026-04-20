# Contributing to TermCanvas

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/blueberrycongee/termcanvas.git
cd termcanvas
pnpm install
pnpm dev
```

## Workflow

1. Fork the repository and create a feature branch from `main`.
2. Make your changes with clear, atomic commits.
3. Run type checking before submitting:

```bash
pnpm typecheck
pnpm build
```

4. Open a Pull Request against `main`.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: resolve bug
docs: update documentation
refactor: restructure code without behavior change
```

## Code Style

- TypeScript strict mode
- 2-space indentation
- Tailwind CSS for styling
- Zustand for state management
- Prefer inline Tailwind over CSS classes

## Reporting Issues

Open an issue at [github.com/blueberrycongee/termcanvas/issues](https://github.com/blueberrycongee/termcanvas/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- OS and Node.js version

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
