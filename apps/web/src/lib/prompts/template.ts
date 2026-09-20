import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Handlebars from "handlebars";
import { z } from "zod";

// Next runs from apps/web; root-level tooling runs from the workspace root.
const appRoot = existsSync(resolve(process.cwd(), "apps/web/package.json"))
  ? resolve(process.cwd(), "apps/web")
  : process.cwd();
const directory = resolve(appRoot, "prompts");
const engine = Handlebars.create();
const previews = new Map<string, (input: unknown) => string>();

/** Flat, declared variables and if/unless blocks keep the authoring contract inspectable. */
export function compileTemplate<S extends z.ZodObject>(
  name: string,
  source: string,
  schema: S,
): (input: z.input<S>) => string {
  try {
    const ast = engine.parse(source);
    const inspect = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(inspect);
        return;
      }
      const value = node as Record<string, unknown>;
      if (value.type === "PathExpression") {
        const path = String(value.original);
        if (!["if", "unless"].includes(path) && !Object.hasOwn(schema.shape, path))
          throw new Error("Undeclared variable: " + path);
      }
      for (const child of Object.values(value)) inspect(child);
    };
    inspect(ast);
    const options = { strict: true, noEscape: true, knownHelpersOnly: true };
    engine.precompile(ast, options); // Handlebars compile itself is lazy.
    const render = engine.compile<z.output<S>>(ast, options);
    return (input) => {
      try {
        const result = render(schema.parse(input)).trim();
        if (!result) throw new Error("Rendered prompt is blank");
        return result;
      } catch (cause) {
        throw new Error(name + ".prompt: " + (cause instanceof Error ? cause.message : String(cause)), {
          cause,
        });
      }
    };
  } catch (cause) {
    throw new Error(name + ".prompt: " + (cause instanceof Error ? cause.message : String(cause)), { cause });
  }
}

export function template<S extends z.ZodObject>(name: string, schema: S) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Invalid prompt name: " + name);
  const path = resolve(directory, name + ".prompt");
  const read = () => {
    try {
      return readFileSync(path, "utf8");
    } catch (cause) {
      throw new Error("Cannot read " + name + ".prompt at " + path, { cause });
    }
  };
  let source = read();
  let render = compileTemplate(name, source, schema);
  const invoke = (input: z.input<S>): string => {
    if (process.env.NODE_ENV !== "production") {
      const latest = read();
      if (latest !== source) {
        const updated = compileTemplate(name, latest, schema);
        source = latest;
        render = updated;
      }
    }
    return render(input);
  };
  previews.set(name, (input) => invoke(input as z.input<S>));
  return invoke;
}

/** Structured question definitions stay JSON; runtime candidates are attached by the adapter. */
export function jsonPrompt<S extends z.ZodType>(name: string, schema: S) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Invalid prompt name: " + name);
  const filename = name + ".jev.json";
  const read = () => {
    try {
      return schema.parse(JSON.parse(readFileSync(resolve(directory, filename), "utf8")));
    } catch (cause) {
      throw new Error(filename + ": " + (cause instanceof Error ? cause.message : String(cause)), { cause });
    }
  };
  const cached = read();
  const load = () => (process.env.NODE_ENV === "production" ? cached : read());
  previews.set(name, (input) => {
    z.strictObject({}).parse(input);
    return JSON.stringify(load(), null, 2);
  });
  return load;
}

/** Uses the same contracts and loading as the actual model calls. */
export function previewTemplate(name: string, input: unknown): string {
  const render = previews.get(name);
  if (!render) throw new Error("Unknown prompt: " + name + ". Available: " + [...previews.keys()].join(", "));
  return render(input);
}
export const templateNames = () => [...previews.keys()].sort();
