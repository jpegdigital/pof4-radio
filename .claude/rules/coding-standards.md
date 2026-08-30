---
description: Coding, testing, and architectural standards for this repository. Applies to all code changes.
globs:
  - "**/*"
alwaysApply: true
---

## Core Principles

### I. Progressive Complexity

Code MUST earn its abstractions through demonstrated need, following a
phased approach:

1. **WET phase** — Write Everything Twice. Inline and duplicate freely
   until patterns emerge from real usage. Three similar blocks of code
   are better than a premature abstraction.
2. **SOLID phase** — When a third instance of a pattern appears, extract.
   Apply single-responsibility, open/closed, and dependency inversion only
   at this point.
3. **YAGNI phase** — Speculatively adding capability for hypothetical
   future requirements is forbidden. Every abstraction MUST have a
   concrete, current consumer.

Rules:

- Ship a thin vertical slice before broadening scope.
- If a feature can be a single-file script, it MUST remain so until
  complexity forces extraction.
- Delete dead code immediately; do not comment it out.
- No speculative abstractions, no premature generalization. A working
  script that prints output beats a polished framework that isn't wired
  up yet.

**Rationale**: Premature abstraction is one of the most expensive forms
of technical debt. Letting duplication accumulate up to a known threshold
(three occurrences) reveals the true shape of the abstraction the code
actually needs.

### II. Testing Discipline (NON-NEGOTIABLE)

TDD is mandatory for all non-trivial logic. The Red-Green-Refactor cycle
MUST be followed.

- **Write the test first.** Confirm it fails. Then implement.
- Tests MUST be runnable with the project's standard test command.
- Unit tests cover pure logic (parsing, transforming, filtering).
- Integration tests cover API interactions using recorded fixtures or
  mocks — never hit live APIs in CI.
- A feature is not done until its tests pass.

#### Parameterized Testing Convention

Use the test framework's parameterized/table-driven test facility for any
function with more than two meaningful input variations. Structure test
cases using the **give/want** convention with descriptive IDs:

```text
// Pseudocode — adapt to your language's test framework
for each (give, want, id) in [
    ("input_a", "expected_a", "descriptive-case-a"),
    ("input_b", "expected_b", "descriptive-case-b"),
]:
    assert function(give) == want  // labeled with id
```

Examples by ecosystem:

- **pytest**: `@pytest.mark.parametrize("give, want", [...], ids=[...])`
- **Jest/Vitest**: `it.each([...])("case: %s", (give, want) => ...)`
- **Go**: table-driven tests with `t.Run(name, ...)`
- **JUnit**: `@ParameterizedTest` with `@MethodSource`

#### Coverage Strategy

- Happy path + at least one sad path per public function.
- Edge cases (empty input, null/nil/undefined, boundary values) MUST be
  covered for data-transforming functions.
- Mocks MUST be scoped as narrowly as possible — mock the boundary, not
  the internals.

**Rationale**: Tests written after implementation reflect the code as
written, not the contract that was intended. Red-Green-Refactor forces
the contract to be specified independently and keeps the public surface
testable by design.

### III. Fail Fast & Loud

Errors MUST surface immediately with actionable messages. Silent failures
are forbidden.

- Missing environment variables MUST raise on startup, not deep in a call
  stack.
- API errors MUST be caught, logged with context (URL, status code,
  response body), and re-raised or cause a non-zero exit.
- Never swallow errors with catch-all handlers (bare `catch`,
  `except Exception`, empty `rescue`, etc.).
- Use specific error/exception types. Catch only what you can meaningfully
  handle.

**Rationale**: Production debugging cost scales with how far a failure
travels from its origin. Failing at the boundary produces a stack trace
that points at the cause; failing later produces a mystery.

### IV. Configuration as Data

Runtime knobs MUST live in declarative configuration, not scattered
through code.

- Environment variables for secrets and deployment-specific values. Use
  the ecosystem's standard env-loading mechanism.
- Project manifest files for tool configuration and metadata (e.g.,
  `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`).
- No magic constants buried in logic — extract to module-level
  constants, config objects, or dedicated config files.
- Feature flags (if ever needed) MUST be data-driven, not `if`-branches
  in business logic.

**Rationale**: Configuration mixed into logic forces a code change for
every behavior tweak and obscures the surface area that operators and
deployers actually need to reason about.

### V. Code Style

Write code that is idiomatic, explicit, and composable.

- **Idiomatic** — Follow the target language's community conventions and
  standard library idioms. Use built-in facilities over hand-rolled
  equivalents.
- **Explicit over implicit** — No metaprogramming tricks, no dynamic
  property injection, no catch-all parameter forwarding unless the API
  genuinely requires it.
- **Composition over inheritance** — Prefer functions, interfaces, and
  protocols over class hierarchies. Inheritance depth MUST NOT exceed
  2 levels.
- **Colocation & single responsibility** — Each file MUST have one clear
  job. If you cannot summarize what a file does in one sentence, split
  it. Shared utilities go in a dedicated location only when two or more
  modules genuinely need them. No god-modules, no catch-all utility
  files.
- **Type safety** — Use the strongest type system available. Prefer
  structured types (interfaces, structs, typed records) for complex data
  over untyped maps/dictionaries. Use type annotations on all public
  function signatures when the language supports them.

**Rationale**: Idiomatic, explicit code is greppable, reviewable, and
analyzable by tooling. Cleverness is debt the next reader pays.

### VI. Anti-Patterns (Banned)

The following patterns are banned by default. Each row pairs the
prohibition with the prescribed remedy:

| Pattern | Why Banned | Remedy |
|---------|------------|--------|
| Catch-all error handlers | Hides bugs, masks real errors | Catch specific types |
| `TODO` without issue link | TODOs rot; no accountability | File an issue or fix now |
| God module / catch-all utils | Violates single responsibility | Split by domain |
| Deep inheritance (>2 levels) | Cognitive overhead, fragile coupling | Composition / interfaces |
| Magic strings / numbers in logic | Ungreppable, error-prone | Named constants or config |
| Wildcard / glob imports | Pollutes namespace, breaks tooling | Explicit imports only |
| Mutable shared default state | Shared state bugs across calls | Immutable defaults or fresh init |

**Rationale**: These patterns recur often enough that calling them out
by name is cheaper than re-litigating each case in review. Introducing
any of them requires an explicit justification entry in the plan's
Complexity Tracking table.

## Core Acronyms

These are the design-pattern and principle abbreviations used throughout
this constitution and in code review. Use them consistently to keep
architecture and implementation discussions explicit.

| Principle | Meaning |
|-----------|---------|
| **SOLID** | Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion |
| **DI** | Dependency Injection |
| **IoC** | Inversion of Control |
| **DRY** | Don't Repeat Yourself |
| **WET** | Write Everything Twice |
| **SLAP** | Single Level of Abstraction Principle |
| **KISS** | Keep It Simple, Stupid |
| **AHA** | Avoid Hasty Abstraction |
| **YAGNI** | You Ain't Gonna Need It |

## Development Workflow

The following workflow is the default for every change. Steps are
numbered to preserve the canonical ordering from the source standards.

2. **Write test first** — even a minimal assertion that the function
   exists and returns the expected type.
3. **Implement until green** — smallest change to make the test pass.
4. **Refactor** — clean up only what you just touched.
5. **Commit granularly** — one logical change per commit with a clear
   message.
6. **Run full suite before push** — the project's test command MUST
   pass.
7. **Lint before push** — the project's lint and format checks MUST
   pass.

### Error Handling Standards

- Use specific error/exception types; define custom types when the
  domain requires it.
- Every error handler MUST either handle, log-and-reraise, or translate
  the error — never silently swallow.
- External API calls MUST have timeouts and structured error responses.

### Idempotency & Retries

- Operations that touch external services SHOULD be idempotent where
  feasible.
- Retries (if added) MUST use exponential backoff with jitter.
- Non-idempotent side effects MUST be clearly documented.

### Audit Trail

- All external API calls SHOULD be logged at DEBUG level with request
  context (URL, method, relevant params — never secrets).
- State-changing operations SHOULD produce a log entry that allows
  reconstruction of what happened.
