/**
 * Universal Filter Engine
 * ------------------------
 * A single, reusable, cross-app filtering/query capability so any list of
 * records — events, findings, decisions, memories, or whatever future apps
 * sit on top of this control plane — can be filtered by composable
 * criteria, e.g. the roadmap's own example: "HIGH RISK + changed in the
 * last 24h + confidence < 90%" (see `ROADMAP_EXAMPLE_FILTER` below).
 *
 * Deliberately dependency-free and pure: no `eval`, no external query
 * library. Field access uses a small safe dot-path getter (`getByPath`).
 */

/**
 * Supported comparison operators.
 *
 *  - `eq`       — `getByPath(item, field) === value`
 *  - `neq`      — `getByPath(item, field) !== value`
 *  - `gt`       — `getByPath(item, field) > value` (numeric/string comparable)
 *  - `gte`      — `getByPath(item, field) >= value`
 *  - `lt`       — `getByPath(item, field) < value`
 *  - `lte`      — `getByPath(item, field) <= value`
 *  - `in`       — `value` is an array; matches if the field's value is one of
 *                 its elements. An empty `value` array never matches.
 *  - `notIn`    — inverse of `in`. An empty `value` array always matches
 *                 (vacuously true — nothing to exclude), as long as the
 *                 field is present.
 *  - `contains` — if the field value is a string, `value` (a string) must be
 *                 a substring of it; if the field value is an array,
 *                 `value` must be one of its elements (deep-equal for
 *                 primitives). Any other field type never matches.
 *  - `since`    — special "recency" operator for ISO-datetime fields:
 *                 `value` is a number of milliseconds N; matches when the
 *                 field, parsed as an ISO date, is >= `Date.now() - N`
 *                 (i.e. "the field's timestamp is within the last N ms").
 */
export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "contains"
  | "since";

/**
 * A single filter criterion. `field` supports simple dot-paths for nested
 * objects, e.g. `"metadata.riskLevel"`.
 */
export interface FilterCriterion {
  readonly field: string;
  readonly op: FilterOperator;
  readonly value: unknown;
}

/**
 * Safe, dependency-free dot-path getter. Never throws: any missing
 * intermediate value (undefined/null) short-circuits to `undefined`.
 * Does not use `eval` or any expression parser — just a plain `.` split
 * and sequential property lookups guarded against prototype-pollution
 * footguns (`__proto__`, `constructor`, `prototype` segments are refused).
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined || path === "") {
    return undefined;
  }
  const segments = path.split(".");
  let current: unknown = obj;
  for (const segment of segments) {
    if (
      segment === "__proto__" ||
      segment === "constructor" ||
      segment === "prototype"
    ) {
      return undefined;
    }
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

function comparableOrdering(a: unknown, b: unknown): number | undefined {
  if (typeof a === "number" && typeof b === "number") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() < b.getTime() ? -1 : a.getTime() > b.getTime() ? 1 : 0;
  }
  return undefined;
}

/**
 * Evaluate a single criterion against a single item. Pure and total: a
 * missing/undefined field, or a type mismatch, simply fails the criterion
 * rather than throwing.
 */
export function matchesCriterion<T>(item: T, criterion: FilterCriterion): boolean {
  const { field, op, value } = criterion;
  const fieldValue = getByPath(item, field);

  switch (op) {
    case "eq":
      return fieldValue === value;
    case "neq":
      return fieldValue !== value;
    case "gt": {
      const cmp = comparableOrdering(fieldValue, value);
      return cmp !== undefined && cmp > 0;
    }
    case "gte": {
      const cmp = comparableOrdering(fieldValue, value);
      return cmp !== undefined && cmp >= 0;
    }
    case "lt": {
      const cmp = comparableOrdering(fieldValue, value);
      return cmp !== undefined && cmp < 0;
    }
    case "lte": {
      const cmp = comparableOrdering(fieldValue, value);
      return cmp !== undefined && cmp <= 0;
    }
    case "in": {
      if (!Array.isArray(value) || fieldValue === undefined) {
        return false;
      }
      return value.includes(fieldValue);
    }
    case "notIn": {
      if (!Array.isArray(value) || fieldValue === undefined) {
        return false;
      }
      return !value.includes(fieldValue);
    }
    case "contains": {
      if (typeof fieldValue === "string" && typeof value === "string") {
        return fieldValue.includes(value);
      }
      if (Array.isArray(fieldValue)) {
        if (isPrimitive(value)) {
          return fieldValue.includes(value);
        }
        return false;
      }
      return false;
    }
    case "since": {
      if (typeof fieldValue !== "string" || typeof value !== "number") {
        return false;
      }
      const fieldTime = Date.parse(fieldValue);
      if (Number.isNaN(fieldTime)) {
        return false;
      }
      const cutoff = Date.now() - value;
      return fieldTime >= cutoff;
    }
    default: {
      // Exhaustiveness guard: if a new FilterOperator is ever added without
      // updating this switch, fail closed rather than throw.
      return false;
    }
  }
}

/** AND-composition: an item must match every criterion. */
export function applyFilters<T>(
  items: readonly T[],
  criteria: readonly FilterCriterion[],
): T[] {
  if (criteria.length === 0) {
    return [...items];
  }
  return items.filter((item) =>
    criteria.every((criterion) => matchesCriterion(item, criterion)),
  );
}

/** OR-composition: an item must match at least one criterion. */
export function applyFiltersAny<T>(
  items: readonly T[],
  criteria: readonly FilterCriterion[],
): T[] {
  if (criteria.length === 0) {
    return [];
  }
  return items.filter((item) =>
    criteria.some((criterion) => matchesCriterion(item, criterion)),
  );
}

function describeCriterion(criterion: FilterCriterion): string {
  const { field, op, value } = criterion;
  switch (op) {
    case "eq":
      return `${field} = ${String(value)}`;
    case "neq":
      return `${field} != ${String(value)}`;
    case "gt":
      return `${field} > ${String(value)}`;
    case "gte":
      return `${field} >= ${String(value)}`;
    case "lt":
      return `${field} < ${String(value)}`;
    case "lte":
      return `${field} <= ${String(value)}`;
    case "in":
      return `${field} in [${Array.isArray(value) ? value.join(", ") : String(value)}]`;
    case "notIn":
      return `${field} not in [${Array.isArray(value) ? value.join(", ") : String(value)}]`;
    case "contains":
      return `${field} contains ${String(value)}`;
    case "since": {
      const ms = typeof value === "number" ? value : Number(value);
      const hours = ms / (60 * 60 * 1000);
      const label = Number.isFinite(hours)
        ? `${Number.isInteger(hours) ? hours : hours.toFixed(2)}h`
        : `${String(value)}ms`;
      return `${field} within last ${label}`;
    }
    default:
      return `${field} ${op} ${String(value)}`;
  }
}

/**
 * Human-readable one-line summary of an AND-composed criteria list, e.g.
 * `"riskLevel = HIGH AND updatedAt within last 24h AND confidence < 0.9"`.
 * Useful for audit-log `reason` fields or UI display.
 */
export function describeFilters(criteria: readonly FilterCriterion[]): string {
  if (criteria.length === 0) {
    return "(no filters)";
  }
  return criteria.map(describeCriterion).join(" AND ");
}

/**
 * Worked example matching the roadmap's own flagship query:
 * "HIGH RISK + changed in the last 24h + confidence < 90%".
 *
 * Usage: `applyFilters(items, ROADMAP_EXAMPLE_FILTER)`.
 */
export const ROADMAP_EXAMPLE_FILTER: readonly FilterCriterion[] = [
  { field: "riskLevel", op: "eq", value: "HIGH" },
  { field: "updatedAt", op: "since", value: 24 * 60 * 60 * 1000 },
  { field: "confidence", op: "lt", value: 0.9 },
];
