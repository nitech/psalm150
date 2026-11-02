import { announce, setTitle } from "../../../shared/songs/a11y.ts";
import { emptyState, pageHead, type LibraryContext } from "../context.ts";
import { icon } from "../icons.ts";
import { escapeHtml, searchClear, showToast } from "../ui.ts";
import { t, tn } from "../../../shared/songs/i18n.ts";

/**
 * `#/api` (also `/api/docs`): the server's API reference, drawn from its own
 * OpenAPI document (`/api/openapi.json`), so it always matches the server
 * it is read from. Operations are grouped by the document's tags (the
 * sections in `GROUPS` in api.rs); each opens to show its parameters,
 * request body, answers and a curl example. Data types open in place, so
 * reading never leaves the page.
 */

export interface OpenApiDocument {
  info: { title: string; version: string; description?: string };
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema> };
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>;
  security?: Array<Record<string, string[]>>;
}

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Schema;
}

export interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: unknown[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  minimum?: number;
  maximum?: number;
}

const METHODS = ["get", "post", "put", "patch", "delete"];

/** Plain words for the statuses this API answers with. */
function statusText(status: string): string {
  switch (status) {
    case "200": return t("OK");
    case "201": return t("Created");
    case "202": return t("Accepted");
    case "204": return t("Done, no content");
    case "400": return t("The request is not valid");
    case "401": return t("No token, or the token no longer works");
    case "403": return t("The token may not do this");
    case "404": return t("Not found");
    case "409": return t("Conflict: changed in the meantime, or already exists");
    case "429": return t("Too many attempts; wait for Retry-After");
    default: return "";
  }
}

export async function apiDocs(ctx: LibraryContext): Promise<void> {
  setTitle(t("API reference"));
  const back = ctx.session ? "#/settings/about" : "#/songs";
  const doc = await ctx.api.openApi();
  const schemas = doc.components?.schemas ?? {};
  const groups = groupOperations(doc);
  const base = `${location.origin}/api/v1`;

  ctx.main.innerHTML = `${pageHead({ title: t("API reference"), back, church: ctx.libraryName })}
  <section class="card api-intro" aria-labelledby="api-about">
    <h2 id="api-about" class="sr-only">${t("About the API")}</h2>
    <p>${inline(doc.info.description ?? "")}</p>
    <dl class="api-facts">
      <dt>${t("Base address")}</dt><dd><code>${escapeHtml(base)}</code></dd>
      <dt>${t("Signing requests")}</dt><dd>${t("Send <code>Authorization: Bearer &lt;token&gt;</code>.")} ${ctx.session
        ? t("Make a token that acts as you under <a href=\"#/settings/api\">Settings, API</a>.")
        : t("Sign in to make an API token.")} ${t("Operations marked <strong>No token needed</strong> work without one.")}</dd>
      <dt>${t("Version")}</dt><dd>${escapeHtml(doc.info.version)} · ${t("<a href=\"/api/openapi.json\" download=\"psa150-openapi.json\">OpenAPI document (JSON)</a> for tools such as Postman or Swagger")}</dd>
    </dl>
  </section>
  <div class="search-field">${icon("search")}<input type="search" id="api-search" placeholder="${t("Path, method or words")}" aria-label="${t("Search the API")}" autocomplete="off" enterkeyhint="search" />${searchClear}</div>
  <div id="api-groups">
    ${groups.map((group) => `<section class="api-group" data-group aria-labelledby="api-group-${slug(group.name)}">
      <h2 class="list-heading" id="api-group-${slug(group.name)}">${escapeHtml(group.name)}</h2>
      ${group.description ? `<p class="muted">${inline(group.description)}</p>` : ""}
      <ul class="api-ops">${group.operations.map(({ method, path, operation }) => operationHtml(method, path, operation, schemas, base)).join("")}</ul>
    </section>`).join("")}
  </div>
  <div id="api-none" hidden>${emptyState(t("Nothing matches"), t("Try a path such as /songs, a method such as POST, or another word."))}</div>`;

  const search = ctx.main.querySelector<HTMLInputElement>("#api-search")!;
  let timer = 0;
  search.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const shown = filterOperations(ctx.main, search.value);
      announce(search.value.trim() ? tn(shown, "{n} operation found", "{n} operations found") : "");
    }, 200);
  });

  ctx.main.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
    if (!button) return;
    const text = button.closest(".api-example")?.querySelector("code")?.textContent ?? "";
    void navigator.clipboard.writeText(text).then(
      () => showToast(t("Example copied.")),
      () => showToast(t("Could not copy; select the example instead."), true),
    );
  });
}

interface Group {
  name: string;
  description?: string;
  operations: Array<{ method: string; path: string; operation: Operation }>;
}

/** Operations by tag, in the document's tag order; anything untagged last. */
export function groupOperations(doc: OpenApiDocument): Group[] {
  const groups: Group[] = (doc.tags ?? []).map((tag) => ({ name: tag.name, description: tag.description, operations: [] }));
  const other: Group = { name: t("Other"), operations: [] };
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const group = groups.find((candidate) => operation.tags?.includes(candidate.name)) ?? other;
      group.operations.push({ method, path, operation });
    }
  }
  return [...groups, other].filter((group) => group.operations.length);
}

/** Hides operations (and empty sections) that do not match; returns how many show. */
function filterOperations(main: HTMLElement, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  main.querySelectorAll<HTMLElement>("[data-group]").forEach((group) => {
    let inGroup = 0;
    group.querySelectorAll<HTMLElement>("[data-search]").forEach((item) => {
      const match = terms.every((term) => item.dataset.search!.includes(term));
      item.hidden = !match;
      if (match) inGroup++;
    });
    group.hidden = inGroup === 0;
    shown += inGroup;
  });
  main.querySelector<HTMLElement>("#api-none")!.hidden = shown > 0;
  return shown;
}

function operationHtml(method: string, path: string, operation: Operation, schemas: Record<string, Schema>, base: string): string {
  const [summary, ...more] = paragraphs([operation.summary, operation.description].filter(Boolean).join("\n\n"));
  const open = !operation.security?.length;
  const parameters = operation.parameters ?? [];
  const body = firstContent(operation.requestBody?.content);
  const responses = Object.entries(operation.responses ?? {});
  const search = `${method} ${path} ${summary ?? ""} ${more.join(" ")} ${operation.tags?.join(" ") ?? ""}`.toLowerCase();
  return `<li data-search="${escapeHtml(search)}"><details class="api-op">
    <summary>
      <span class="api-method" data-method="${method}">${method.toUpperCase()}</span>
      <code class="api-path">${escapeHtml(path)}</code>
      ${summary ? `<span class="api-summary">${inline(summary)}</span>` : ""}
    </summary>
    <div class="api-op-body">
      ${more.map((paragraph) => `<p>${inline(paragraph)}</p>`).join("")}
      <p class="api-access">${open ? t("No token needed.") : t("Needs a token (<code>Authorization: Bearer</code>).")}</p>
      ${parameters.length ? `<h3>${t("Parameters")}</h3>
        <ul class="api-fields">${parameters.map((parameter) => fieldHtml(parameter.name, parameter.schema ?? {}, parameter.required ?? false, schemas, new Set(), parameter.in === "path" ? t("in the path") : parameter.in === "query" ? t("in the query string") : t("in the {place}", { place: parameter.in }), parameter.description)).join("")}</ul>` : ""}
      ${body ? `<h3>${t("Request body")}</h3>
        <p class="hint"><code>${escapeHtml(body.type)}</code>${operation.requestBody?.required ? `, ${t("required")}` : ""}</p>
        ${schemaHtml(body.schema, schemas, new Set())}` : ""}
      ${responses.length ? `<h3>${t("Answers")}</h3>
        <dl class="api-responses">${responses.map(([status, response]) => {
          const content = firstContent(response.content);
          return `<dt><code>${escapeHtml(status)}</code> ${escapeHtml(response.description || statusText(status))}</dt>
            <dd>${content ? `${content.type === "application/json" ? "" : `<p class="hint"><code>${escapeHtml(content.type)}</code>${content.type === "text/event-stream" ? `: ${t("server-sent events, each carrying this as JSON")}` : ""}</p>`}${schemaHtml(content.schema, schemas, new Set())}` : ""}</dd>`;
        }).join("")}</dl>` : ""}
      <h3>${t("Example")}</h3>
      <div class="api-example">
        <pre tabindex="0" aria-label="${t("Example request")}"><code>${escapeHtml(curlExample(method, path, operation, schemas, base))}</code></pre>
        <button type="button" class="button secondary small" data-copy aria-label="${t("Copy the example for {operation}", { operation: `${method.toUpperCase()} ${escapeHtml(path)}` })}">${icon("copy")}${t("Copy")}</button>
      </div>
    </div>
  </details></li>`;
}

function firstContent(content?: Record<string, { schema?: Schema }>): { type: string; schema: Schema } | null {
  const [type, value] = Object.entries(content ?? {})[0] ?? [];
  return type ? { type, schema: value?.schema ?? {} } : null;
}

/** A schema's fields, or for a list or a value, what it holds. */
function schemaHtml(schema: Schema, schemas: Record<string, Schema>, seen: Set<string>): string {
  const resolved = resolve(schema, schemas);
  const description = resolved.description && !schema.$ref ? "" : resolved.description;
  const intro = `<p class="hint">${escapeHtml(typeLabel(schema, schemas))}${description ? ` · ${inline(oneLine(description))}` : ""}</p>`;
  const fields = objectOf(schema, schemas);
  if (!fields) return intro;
  const name = refName(fields.$ref ?? schema.$ref ?? schema.items?.$ref);
  const inner = new Set(seen);
  if (name) inner.add(name);
  const object = resolve(fields, schemas);
  return `${intro}<ul class="api-fields">${Object.entries(object.properties ?? {}).map(([field, value]) =>
    fieldHtml(field, value, object.required?.includes(field) ?? false, schemas, inner)).join("")}</ul>`;
}

function fieldHtml(name: string, schema: Schema, required: boolean, schemas: Record<string, Schema>, seen: Set<string>, where = "", description = schema.description): string {
  const nested = objectOf(schema, schemas);
  const nestedName = nested ? refName(nested.$ref) : null;
  const expandable = nested && !(nestedName && seen.has(nestedName));
  const values = enumValues(schema, schemas);
  const meta = [typeLabel(schema, schemas), required ? t("required") : t("optional"), where].filter(Boolean).join(", ");
  return `<li>
    <code class="api-field">${escapeHtml(name)}</code> <span class="api-type">${escapeHtml(meta)}</span>
    ${description ? `<div class="api-field-text">${inline(oneLine(description))}</div>` : ""}
    ${values ? `<div class="api-field-text">${t("One of {values}.", { values: values.map((value) => `<code>${escapeHtml(String(value))}</code>`).join(", ") })}</div>` : ""}
    ${expandable ? `<details class="api-nested"><summary>${t("Fields of {name}", { name: escapeHtml(nestedName ?? name) })}</summary>${schemaHtml(nested, schemas, seen)}</details>` : ""}
  </li>`;
}

/** The object a schema holds: itself, its `$ref`, or what its list holds. */
function objectOf(schema: Schema, schemas: Record<string, Schema>): Schema | null {
  const target = schema.items ?? nonNull(schema) ?? schema;
  const resolved = resolve(target, schemas);
  return resolved.properties ? target : null;
}

/** For "X or null" written as oneOf, the X. */
function nonNull(schema: Schema): Schema | undefined {
  const options = schema.oneOf ?? schema.anyOf;
  return options?.find((option) => option.type !== "null");
}

function resolve(schema: Schema, schemas: Record<string, Schema>): Schema {
  const name = refName(schema.$ref);
  return name ? schemas[name] ?? {} : schema;
}

function refName(ref?: string): string | null {
  return ref ? ref.split("/").pop() ?? null : null;
}

function enumValues(schema: Schema, schemas: Record<string, Schema>): unknown[] | null {
  const resolved = resolve(nonNull(schema) ?? schema, schemas);
  return resolved.enum?.length ? resolved.enum : null;
}

/** "string (uuid) or null", "SongSummary list", "integer, at least 0". */
export function typeLabel(schema: Schema, schemas: Record<string, Schema>): string {
  if (schema.$ref) {
    const name = refName(schema.$ref)!;
    const target = schemas[name];
    return target?.enum ? t("{name} (text)", { name }) : name;
  }
  if (schema.items) return t("list of {type}", { type: typeLabel(schema.items, schemas) });
  const options = schema.oneOf ?? schema.anyOf;
  if (options) return either(options.map((option) => option.type === "null" ? "null" : typeLabel(option, schemas)));
  const format = schema.format && !["int32", "int64"].includes(schema.format) ? schema.format : null;
  const types = (Array.isArray(schema.type) ? schema.type : [schema.type ?? (schema.properties ? "object" : "any")])
    .map((type, index) => (type === "string"
      ? (index === 0 && format ? t("text ({format})", { format }) : t("text"))
      : type === "integer" ? t("whole number") : type === "boolean" ? t("true or false") : type));
  let label = either(types);
  if (schema.minimum !== undefined) label = t("{type}, at least {minimum}", { type: label, minimum: schema.minimum });
  return label;
}

/** "a or b or c". */
function either(labels: string[]): string {
  return labels.length ? labels.reduce((all, label) => t("{a} or {b}", { a: all, b: label })) : "";
}

/** A sample value a schema accepts, for the curl example. */
export function sample(schema: Schema, schemas: Record<string, Schema>, depth = 0): unknown {
  if (depth > 4) return null;
  const name = refName(schema.$ref);
  if (name) return sample(schemas[name] ?? {}, schemas, depth + 1);
  if (schema.enum?.length) return schema.enum[0];
  const option = nonNull(schema);
  if (option) return sample(option, schemas, depth);
  if (schema.items) return [sample(schema.items, schemas, depth + 1)];
  if (schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties).map(([field, value]) => [field, sample(value, schemas, depth + 1)]));
  }
  const type = (Array.isArray(schema.type) ? schema.type.find((candidate) => candidate !== "null") : schema.type) ?? "string";
  if (type === "integer" || type === "number") return schema.minimum ?? 0;
  if (type === "boolean") return false;
  if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (schema.format === "date") return "2026-01-01";
  if (schema.format === "date-time") return "2026-01-01T09:00:00Z";
  return "…";
}

export function curlExample(method: string, path: string, operation: Operation, schemas: Record<string, Schema>, base: string): string {
  const query = (operation.parameters ?? []).filter((parameter) => parameter.in === "query" && parameter.required);
  const url = `${base}${path.replace(/^\/api\/v1/, "")}${query.length ? `?${query.map((parameter) => `${parameter.name}=…`).join("&")}` : ""}`;
  const lines = [`curl${method === "get" ? "" : ` -X ${method.toUpperCase()}`} "${url}"`];
  if (operation.security?.length) lines.push(`  -H "Authorization: Bearer $PSA150_TOKEN"`);
  const body = firstContent(operation.requestBody?.content);
  if (body?.type === "application/json") {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${JSON.stringify(sample(body.schema, schemas)).replace(/'/g, "'\\''")}'`);
  }
  if (firstContent(operation.responses?.["200"]?.content)?.type === "text/event-stream") lines.push("  -N");
  return lines.join(" \\\n");
}

/** Doc comments arrive wrapped; paragraphs are split by a blank line. */
function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map(oneLine).filter(Boolean);
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/** Escaped text with `code` spans. */
export function inline(text: string): string {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
