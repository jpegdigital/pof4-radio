# Prompt templates

Edit prompts in `apps/web/prompts/`. The directory is flat; names identify the job:

| Files | Purpose |
| --- | --- |
| `write-system`, `write-brief` | DJ identity and slot instructions, including the weather section |
| `fill-system`, `fill-brief` | Music programming and the current rundown |
| `recording.prompt` | Recording selection instructions |
| `headlines.jev.json` | Both headline Choice questions, including count option descriptions |
| `chart.jev.json` | Five track questions and all their choice descriptions |
| `mix.jev.json` | Delivery question and all transition descriptions |
| `news-prepare`, `news-review` | Evidence preparation and checking |

Each `.prompt` file is plain text with Handlebars variables (`{{name}}`) and `if`/`unless`
conditionals. No YAML frontmatter or model settings are needed. This is ordinary
Handlebars, not the Dotprompt/Genkit execution format.

## Authoring contract

- Variables are flat and explicitly declared with Zod beside each adapter in
  `apps/web/src/lib/prompts/`. Add a variable there when the prose needs new context.
- Missing, misspelled and undeclared variables fail with the template filename.
  References in inactive branches are checked when the template compiles.
- Input types and unexpected fields are validated before rendering. Output schemas
  continue to validate model results independently.
- Templates support plain variables and `if`/`unless`; formatting, calculations and
  selection decisions stay in code. Context adapters serialize history and evidence.
- Values are inserted once, as plain text: no HTML escaping and no recursive template
  evaluation. Braces inside a song title or listener direction remain literal data.
- Keep illustrative artists, songs, genres and sample DJ lines out of templates.
  Concrete content comes from the current show.

`headlines.jev.json` contains explicit `ranking` and `count` questions with their
instructions and fixed choice descriptions together. It is ordinary JSON, with no
Handlebars interpolation or conditional branches. Code supplies the ranking candidates
from the feed, omits unavailable count options, and validates the assembled questions
with Zod. State is supplied separately. Other adapters still keep short choice labels
in their typed modules; long writing briefs live in `.prompt` files.

`chart.jev.json` holds the DJ finish-point question (0–5 seconds or beyond 5), plus
ending, energy, tempo, and mood. The finish point is relative to song start, not a delay
before speaking. Code removes options outside the recording's duration.

`mix.jev.json` contains the delivery question and every choice description: uninterrupted
music, dry station sweeper, station tag into the opening, brief talk-up, and scheduled
break transitions. Code filters choices by the clock, post and recent station tags;
it handles word budgets and aligns the measured voice clip in playback. All editorial
instructions remain in the JSON. Zod validates both files against supported option keys.

## Preview

From the repository root:

```sh
pnpm prompt:preview --list
pnpm prompt:preview write-system variables.json
pnpm prompt:preview mix
pnpm prompt:preview headlines
pnpm prompt:preview chart
```

`variables.json` contains the named template variables, not the raw database row.
Paths are relative to the working directory. The command uses the actual renderer
and Zod contract, prints the rendered text, and makes no model or database calls.
A template with no variables can be previewed without a JSON file.
The `headlines` preview prints the validated JSON question definitions; runtime
headline candidates are attached when a session assembles the request.

## Runtime and deployment

`src/lib/prompts/index.ts` remains the typed registry. Callers supply context and
own API execution, timeouts and persistence. The renderer loads from `apps/web/prompts`
when run from the repo root, or `prompts` when run from the app root.
Templates are compiled and validated when their modules load. Development renders
reload changed template files; production caches them for the process lifetime.
Restart or redeploy production after editing a template.

`next.config.ts` explicitly includes the flat template files in API route traces.
Plain-Node workers must deploy the `prompts` directory beside the app package too.
Git versions templates and contracts together. Existing generation receipts still
retain the exact rendered instructions and context. Legacy `settings.prompt.*` rows
are unused; session direction, settings and prepared facts remain database context.

Run `pnpm test`, `pnpm typecheck`, and `pnpm --filter web build` after changes to loading
or rendering. Template tests cover strictness, literal substitution and malformed
input; existing domain tests cover the assembled prompts and decisions.
