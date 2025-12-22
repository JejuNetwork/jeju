/**
 * Helm Template Renderer for DWS
 * 
 * Renders Helm charts with values.yaml support without requiring
 * the helm binary (pure TypeScript implementation).
 */

import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import * as yaml from 'yaml';

// ============================================================================
// Types
// ============================================================================

export interface HelmChart {
  apiVersion: string;
  name: string;
  version: string;
  appVersion?: string;
  description?: string;
  type?: 'application' | 'library';
  dependencies?: HelmDependency[];
  keywords?: string[];
  home?: string;
  sources?: string[];
  maintainers?: Array<{ name: string; email?: string; url?: string }>;
}

export interface HelmDependency {
  name: string;
  version: string;
  repository: string;
  condition?: string;
  tags?: string[];
  alias?: string;
}

export interface RenderOptions {
  release: string;
  namespace?: string;
  values?: Record<string, unknown>;
  valuesFiles?: string[];
  set?: Record<string, string>;
  setString?: Record<string, string>;
  apiVersions?: string[];
  kubeVersion?: string;
  includeCRDs?: boolean;
}

export interface KubeManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  data?: Record<string, string>;
  stringData?: Record<string, string>;
  type?: string;
}

// ============================================================================
// Template Engine
// ============================================================================

interface TemplateContextType {
  Release: {
    Name: string;
    Namespace: string;
    IsUpgrade: boolean;
    IsInstall: boolean;
    Revision: number;
    Service: string;
  };
  Chart: HelmChart;
  Values: Record<string, unknown>;
  Capabilities: {
    APIVersions: string[];
    KubeVersion: { Version: string; Major: string; Minor: string };
  };
  Template: {
    Name: string;
    BasePath: string;
  };
  Files: FilesHelper;
  [key: string]: unknown;
}

class TemplateContext implements TemplateContextType {
  Release: {
    Name: string;
    Namespace: string;
    IsUpgrade: boolean;
    IsInstall: boolean;
    Revision: number;
    Service: string;
  };
  
  Chart: HelmChart;
  Values: Record<string, unknown>;
  Capabilities: {
    APIVersions: string[];
    KubeVersion: { Version: string; Major: string; Minor: string };
  };
  
  Template: {
    Name: string;
    BasePath: string;
  };
  
  Files: FilesHelper;
  [key: string]: unknown;
  
  constructor(
    release: string,
    namespace: string,
    chart: HelmChart,
    values: Record<string, unknown>,
    options: RenderOptions
  ) {
    this.Release = {
      Name: release,
      Namespace: namespace,
      IsUpgrade: false,
      IsInstall: true,
      Revision: 1,
      Service: 'Helm',
    };
    
    this.Chart = chart;
    this.Values = values;
    
    this.Capabilities = {
      APIVersions: options.apiVersions || [
        'apps/v1', 'v1', 'batch/v1', 'networking.k8s.io/v1',
        'rbac.authorization.k8s.io/v1', 'autoscaling/v2',
      ],
      KubeVersion: {
        Version: options.kubeVersion || 'v1.28.0',
        Major: '1',
        Minor: '28',
      },
    };
    
    this.Template = {
      Name: '',
      BasePath: 'templates',
    };
    
    this.Files = new FilesHelper();
  }
}

class FilesHelper {
  private files = new Map<string, string>();
  
  Get(name: string): string {
    return this.files.get(name) || '';
  }
  
  GetBytes(name: string): Uint8Array {
    const content = this.files.get(name);
    return content ? new TextEncoder().encode(content) : new Uint8Array();
  }
  
  Lines(name: string): string[] {
    const content = this.files.get(name);
    return content ? content.split('\n') : [];
  }
  
  AsConfig(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
  
  AsSecrets(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.files) {
      result[key] = Buffer.from(value).toString('base64');
    }
    return result;
  }
  
  setFile(name: string, content: string): void {
    this.files.set(name, content);
  }
}

// ============================================================================
// Template Functions (Sprig-compatible subset)
// ============================================================================

const templateFuncs: Record<string, (...args: unknown[]) => unknown> = {
  // String functions
  upper: (s: unknown) => String(s).toUpperCase(),
  lower: (s: unknown) => String(s).toLowerCase(),
  title: (s: unknown) => String(s).replace(/\b\w/g, c => c.toUpperCase()),
  trim: (s: unknown) => String(s).trim(),
  trimPrefix: (prefix: unknown, s: unknown) => String(s).replace(new RegExp(`^${prefix}`), ''),
  trimSuffix: (suffix: unknown, s: unknown) => String(s).replace(new RegExp(`${suffix}$`), ''),
  replace: (old: unknown, newStr: unknown, s: unknown) => String(s).split(String(old)).join(String(newStr)),
  quote: (s: unknown) => `"${String(s)}"`,
  squote: (s: unknown) => `'${String(s)}'`,
  indent: (spaces: unknown, s: unknown) => String(s).split('\n').map(line => ' '.repeat(Number(spaces)) + line).join('\n'),
  nindent: (spaces: unknown, s: unknown) => '\n' + templateFuncs.indent(spaces, s),
  contains: (substr: unknown, s: unknown) => String(s).includes(String(substr)),
  hasPrefix: (prefix: unknown, s: unknown) => String(s).startsWith(String(prefix)),
  hasSuffix: (suffix: unknown, s: unknown) => String(s).endsWith(String(suffix)),
  repeat: (count: unknown, s: unknown) => String(s).repeat(Number(count)),
  
  // Type conversion
  toString: (v: unknown) => String(v),
  toInt: (v: unknown) => parseInt(String(v), 10),
  toInt64: (v: unknown) => parseInt(String(v), 10),
  toFloat64: (v: unknown) => parseFloat(String(v)),
  toBool: (v: unknown) => v === true || v === 'true' || v === '1',
  toJson: (v: unknown) => JSON.stringify(v),
  toYaml: (v: unknown) => yaml.stringify(v),
  fromJson: (s: unknown) => JSON.parse(String(s)) as unknown,
  fromYaml: (s: unknown) => yaml.parse(String(s)) as unknown,
  
  // List/Dict functions
  list: (...args: unknown[]) => args,
  dict: (...args: unknown[]) => {
    const result: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i += 2) {
      result[String(args[i])] = args[i + 1];
    }
    return result;
  },
  first: (arr: unknown) => Array.isArray(arr) ? arr[0] : undefined,
  last: (arr: unknown) => Array.isArray(arr) ? arr[arr.length - 1] : undefined,
  rest: (arr: unknown) => Array.isArray(arr) ? arr.slice(1) : [],
  initial: (arr: unknown) => Array.isArray(arr) ? arr.slice(0, -1) : [],
  append: (arr: unknown, item: unknown) => Array.isArray(arr) ? [...arr, item] : [item],
  prepend: (arr: unknown, item: unknown) => Array.isArray(arr) ? [item, ...arr] : [item],
  concat: (...arrs: unknown[]) => arrs.flat(),
  reverse: (arr: unknown) => Array.isArray(arr) ? [...arr].reverse() : arr,
  uniq: (arr: unknown) => Array.isArray(arr) ? Array.from(new Set(arr)) : arr,
  keys: (obj: unknown) => typeof obj === 'object' && obj ? Object.keys(obj) : [],
  values: (obj: unknown) => typeof obj === 'object' && obj ? Object.values(obj) : [],
  pick: (obj: unknown, ...keys: unknown[]) => {
    if (typeof obj !== 'object' || !obj) return {};
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const keyStr = String(key);
      if (keyStr in (obj as Record<string, unknown>)) {
        result[keyStr] = (obj as Record<string, unknown>)[keyStr];
      }
    }
    return result;
  },
  omit: (obj: unknown, ...keys: unknown[]) => {
    if (typeof obj !== 'object' || !obj) return {};
    const result = { ...(obj as Record<string, unknown>) };
    for (const key of keys) {
      delete result[String(key)];
    }
    return result;
  },
  merge: (...objs: unknown[]) => Object.assign({}, ...objs.filter(o => typeof o === 'object')),
  
  // Math functions
  add: (a: unknown, b: unknown) => Number(a) + Number(b),
  sub: (a: unknown, b: unknown) => Number(a) - Number(b),
  mul: (a: unknown, b: unknown) => Number(a) * Number(b),
  div: (a: unknown, b: unknown) => Number(a) / Number(b),
  mod: (a: unknown, b: unknown) => Number(a) % Number(b),
  max: (...args: unknown[]) => Math.max(...args.map(Number)),
  min: (...args: unknown[]) => Math.min(...args.map(Number)),
  floor: (n: unknown) => Math.floor(Number(n)),
  ceil: (n: unknown) => Math.ceil(Number(n)),
  round: (n: unknown) => Math.round(Number(n)),
  
  // Date functions
  now: () => new Date(),
  date: (fmt: unknown, t: unknown) => {
    const d = t instanceof Date ? t : new Date();
    return d.toISOString().split('T')[0];
  },
  dateModify: (mod: unknown, t: unknown) => {
    const d = t instanceof Date ? new Date(t) : new Date();
    // Simple modifier like "+1h", "-2d"
    const match = String(mod).match(/^([+-]?\d+)([hdwmy])$/);
    if (match) {
      const [, num, unit] = match;
      const n = parseInt(num, 10);
      switch (unit) {
        case 'h': d.setHours(d.getHours() + n); break;
        case 'd': d.setDate(d.getDate() + n); break;
        case 'w': d.setDate(d.getDate() + n * 7); break;
        case 'm': d.setMonth(d.getMonth() + n); break;
        case 'y': d.setFullYear(d.getFullYear() + n); break;
      }
    }
    return d;
  },
  
  // Crypto functions
  sha256sum: (s: unknown) => {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(String(s));
    return hasher.digest('hex');
  },
  sha1sum: (s: unknown) => {
    const hasher = new Bun.CryptoHasher('sha1');
    hasher.update(String(s));
    return hasher.digest('hex');
  },
  b64enc: (s: unknown) => Buffer.from(String(s)).toString('base64'),
  b64dec: (s: unknown) => Buffer.from(String(s), 'base64').toString(),
  
  // Logic functions
  default: (defaultVal: unknown, val: unknown) => val ?? defaultVal,
  empty: (v: unknown) => !v || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && Object.keys(v as object).length === 0),
  coalesce: (...args: unknown[]) => args.find(a => a !== null && a !== undefined),
  ternary: (trueVal: unknown, falseVal: unknown, cond: unknown) => cond ? trueVal : falseVal,
  required: (msg: unknown, val: unknown) => {
    if (val === undefined || val === null) {
      throw new Error(String(msg));
    }
    return val;
  },
  
  // Path functions
  base: (s: unknown) => basename(String(s)),
  dir: (s: unknown) => String(s).split('/').slice(0, -1).join('/'),
  ext: (s: unknown) => {
    const parts = String(s).split('.');
    return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
  },
  
  // Kubernetes helpers
  include: () => '', // Placeholder - handled separately
  toYaml_nindent: (indent: unknown, v: unknown) => {
    const y = yaml.stringify(v);
    return y.split('\n').map(line => ' '.repeat(Number(indent)) + line).join('\n');
  },
  
  // Helm-specific
  lookup: () => null, // Can't do real lookups without API server
  tpl: (template: unknown, _ctx: unknown) => String(template), // Simplified
};

// ============================================================================
// Template Rendering
// ============================================================================

function renderTemplate(template: string, context: TemplateContext): string {
  let result = template;
  
  // Process defines and includes
  const defines = new Map<string, string>();
  
  // Extract {{- define "name" }} ... {{- end }}
  const defineRegex = /\{\{-?\s*define\s+"([^"]+)"\s*-?\}\}([\s\S]*?)\{\{-?\s*end\s*-?\}\}/g;
  let match;
  while ((match = defineRegex.exec(template)) !== null) {
    defines.set(match[1], match[2]);
  }
  result = result.replace(defineRegex, '');
  
  // Process includes: {{ include "name" . }}
  result = result.replace(/\{\{\s*include\s+"([^"]+)"\s+\.?\s*\}\}/g, (_, name) => {
    const def = defines.get(name);
    return def ? renderTemplate(def, context) : '';
  });
  
  // Process {{ template "name" . }}
  result = result.replace(/\{\{\s*template\s+"([^"]+)"\s+\.?\s*\}\}/g, (_, name) => {
    const def = defines.get(name);
    return def ? renderTemplate(def, context) : '';
  });
  
  // Process comments {{/* */}}
  result = result.replace(/\{\{\/\*[\s\S]*?\*\/\}\}/g, '');
  
  // Process conditionals: {{- if }} ... {{- else }} ... {{- end }}
  result = processConditionals(result, context);
  
  // Process range: {{- range }} ... {{- end }}
  result = processRange(result, context);
  
  // Process with: {{- with }} ... {{- end }}
  result = processWith(result, context);
  
  // Process simple expressions: {{ .Values.foo }}
  result = result.replace(/\{\{-?\s*(.*?)\s*-?\}\}/g, (_, expr) => {
    return evaluateExpression(expr.trim(), context);
  });
  
  // Clean up whitespace from {{- and -}}
  result = result.replace(/^\s*\n/gm, '');
  
  return result;
}

function processConditionals(template: string, context: TemplateContext): string {
  // Match if/else/end blocks (non-greedy, innermost first)
  const ifRegex = /\{\{-?\s*if\s+(.*?)\s*-?\}\}([\s\S]*?)(?:\{\{-?\s*else\s*-?\}\}([\s\S]*?))?\{\{-?\s*end\s*-?\}\}/;
  
  let result = template;
  let safetyCounter = 0;
  
  while (ifRegex.test(result) && safetyCounter++ < 100) {
    result = result.replace(ifRegex, (_, condition, trueBranch, falseBranch) => {
      const condValue = evaluateCondition(condition, context);
      if (condValue) {
        return renderTemplate(trueBranch, context);
      }
      return falseBranch ? renderTemplate(falseBranch, context) : '';
    });
  }
  
  return result;
}

function processRange(template: string, context: TemplateContext): string {
  const rangeRegex = /\{\{-?\s*range\s+(.*?)\s*-?\}\}([\s\S]*?)\{\{-?\s*end\s*-?\}\}/;
  
  let result = template;
  let safetyCounter = 0;
  
  while (rangeRegex.test(result) && safetyCounter++ < 100) {
    result = result.replace(rangeRegex, (_, rangeExpr, body) => {
      // Parse: $key, $value := .Values.list or .Values.list
      const assignMatch = rangeExpr.match(/^\$(\w+),?\s*\$?(\w*)\s*:=\s*(.*)$/);
      let items: unknown[];
      let keyVar = '$key';
      let valVar = '$value';
      
      if (assignMatch) {
        keyVar = `$${assignMatch[1]}`;
        valVar = assignMatch[2] ? `$${assignMatch[2]}` : '$value';
        items = evaluateExpressionValue(assignMatch[3].trim(), context) as unknown[];
      } else {
        items = evaluateExpressionValue(rangeExpr.trim(), context) as unknown[];
      }
      
      if (!Array.isArray(items) && typeof items === 'object' && items) {
        items = Object.entries(items);
      }
      
      if (!Array.isArray(items)) return '';
      
      return items.map((item, index) => {
        const subContext: TemplateContext = Object.assign(Object.create(Object.getPrototypeOf(context)), context);
        if (Array.isArray(item) && item.length === 2) {
          subContext[keyVar] = item[0];
          subContext[valVar] = item[1];
        } else {
          subContext[keyVar] = index;
          subContext[valVar] = item;
        }
        // Replace $key and $value references
        const renderedBody = body
          .replace(new RegExp(`\\{\\{\\s*${keyVar.replace('$', '\\$')}\\s*\\}\\}`, 'g'), String(subContext[keyVar]))
          .replace(new RegExp(`\\{\\{\\s*${valVar.replace('$', '\\$')}\\s*\\}\\}`, 'g'), String(subContext[valVar]));
        return renderTemplate(renderedBody, subContext);
      }).join('');
    });
  }
  
  return result;
}

function processWith(template: string, context: TemplateContext): string {
  const withRegex = /\{\{-?\s*with\s+(.*?)\s*-?\}\}([\s\S]*?)\{\{-?\s*end\s*-?\}\}/;
  
  let result = template;
  let safetyCounter = 0;
  
  while (withRegex.test(result) && safetyCounter++ < 100) {
    result = result.replace(withRegex, (_, withExpr, body) => {
      const value = evaluateExpressionValue(withExpr.trim(), context);
      if (!value || (typeof value === 'object' && Object.keys(value as object).length === 0)) {
        return '';
      }
      // Create new context where . refers to the value
      const subContext: TemplateContext = Object.assign(Object.create(Object.getPrototypeOf(context)), context, { _dot: value });
      return renderTemplate(body, subContext);
    });
  }
  
  return result;
}

function evaluateCondition(condition: string, context: TemplateContext): boolean {
  // Handle: .Values.enabled, eq .Values.foo "bar", not .Values.disabled
  const trimmed = condition.trim();
  
  // not X
  if (trimmed.startsWith('not ')) {
    return !evaluateCondition(trimmed.slice(4), context);
  }
  
  // and X Y
  if (trimmed.startsWith('and ')) {
    const parts = trimmed.slice(4).split(/\s+/);
    return parts.every(p => evaluateCondition(p, context));
  }
  
  // or X Y
  if (trimmed.startsWith('or ')) {
    const parts = trimmed.slice(3).split(/\s+/);
    return parts.some(p => evaluateCondition(p, context));
  }
  
  // eq X Y
  if (trimmed.startsWith('eq ')) {
    const rest = trimmed.slice(3);
    const [a, b] = parseArgs(rest, context);
    return a === b;
  }
  
  // ne X Y
  if (trimmed.startsWith('ne ')) {
    const rest = trimmed.slice(3);
    const [a, b] = parseArgs(rest, context);
    return a !== b;
  }
  
  // gt, ge, lt, le
  for (const [op, fn] of [
    ['gt ', (a: number, b: number) => a > b],
    ['ge ', (a: number, b: number) => a >= b],
    ['lt ', (a: number, b: number) => a < b],
    ['le ', (a: number, b: number) => a <= b],
  ] as const) {
    if (trimmed.startsWith(op)) {
      const rest = trimmed.slice(3);
      const [a, b] = parseArgs(rest, context);
      return fn(Number(a), Number(b));
    }
  }
  
  // Simple value check
  const value = evaluateExpressionValue(trimmed, context);
  return Boolean(value);
}

function parseArgs(argsStr: string, context: TemplateContext): [unknown, unknown] {
  // Parse two arguments, handling quoted strings
  const match = argsStr.match(/^(\S+|"[^"]*")\s+(\S+|"[^"]*")$/);
  if (!match) return [undefined, undefined];
  
  const parseArg = (s: string): unknown => {
    if (s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1);
    }
    return evaluateExpressionValue(s, context);
  };
  
  return [parseArg(match[1]), parseArg(match[2])];
}

function evaluateExpression(expr: string, context: TemplateContext): string {
  const value = evaluateExpressionValue(expr, context);
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function evaluateExpressionValue(expr: string, context: TemplateContext): unknown {
  // Handle pipes: .Values.foo | quote | indent 2
  const parts = expr.split('|').map(p => p.trim());
  
  let value = evaluateSingleExpr(parts[0], context);
  
  for (let i = 1; i < parts.length; i++) {
    const funcCall = parts[i].trim();
    const funcMatch = funcCall.match(/^(\w+)(?:\s+(.*))?$/);
    if (funcMatch) {
      const [, funcName, argsStr] = funcMatch;
      const func = templateFuncs[funcName];
      if (func) {
        const args = argsStr ? argsStr.split(/\s+/).map(a => {
          if (a.startsWith('"') && a.endsWith('"')) return a.slice(1, -1);
          if (a.match(/^\d+$/)) return parseInt(a, 10);
          return evaluateSingleExpr(a, context);
        }) : [];
        value = func(...args, value);
      }
    }
  }
  
  return value;
}

function evaluateSingleExpr(expr: string, context: TemplateContext): unknown {
  const trimmed = expr.trim();
  
  // Quoted string
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  
  // Number
  if (trimmed.match(/^-?\d+\.?\d*$/)) {
    return parseFloat(trimmed);
  }
  
  // Boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  
  // nil
  if (trimmed === 'nil') return null;
  
  // Variable access: $var
  if (trimmed.startsWith('$')) {
    return (context as Record<string, unknown>)[trimmed];
  }
  
  // Dot path: .Values.foo.bar
  if (trimmed.startsWith('.')) {
    const path = trimmed.slice(1).split('.');
    let current: unknown = context;
    
    for (const segment of path) {
      if (!segment) continue;
      if (typeof current !== 'object' || current === null) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    
    return current;
  }
  
  // Function call: funcName args...
  const funcMatch = trimmed.match(/^(\w+)(?:\s+(.*))?$/);
  if (funcMatch) {
    const [, funcName, argsStr] = funcMatch;
    const func = templateFuncs[funcName];
    if (func) {
      const args = argsStr ? argsStr.split(/\s+/).map(a => evaluateSingleExpr(a, context)) : [];
      return func(...args);
    }
  }
  
  return undefined;
}

// ============================================================================
// Chart Loading
// ============================================================================

export async function loadChart(chartPath: string): Promise<{
  chart: HelmChart;
  templates: Map<string, string>;
  values: Record<string, unknown>;
  crds: Map<string, string>;
}> {
  const chartYaml = await readFile(join(chartPath, 'Chart.yaml'), 'utf-8');
  const chart = yaml.parse(chartYaml) as HelmChart;
  
  const valuesPath = join(chartPath, 'values.yaml');
  let values: Record<string, unknown> = {};
  if (existsSync(valuesPath)) {
    const valuesYaml = await readFile(valuesPath, 'utf-8');
    values = yaml.parse(valuesYaml) || {};
  }
  
  const templates = new Map<string, string>();
  const templatesDir = join(chartPath, 'templates');
  if (existsSync(templatesDir)) {
    const files = await readdir(templatesDir, { recursive: true });
    for (const file of files) {
      const filePath = join(templatesDir, file.toString());
      if (file.toString().endsWith('.yaml') || file.toString().endsWith('.yml') || file.toString().endsWith('.tpl')) {
        const content = await readFile(filePath, 'utf-8');
        templates.set(file.toString(), content);
      }
    }
  }
  
  const crds = new Map<string, string>();
  const crdsDir = join(chartPath, 'crds');
  if (existsSync(crdsDir)) {
    const files = await readdir(crdsDir);
    for (const file of files) {
      const filePath = join(crdsDir, file.toString());
      if (file.toString().endsWith('.yaml') || file.toString().endsWith('.yml')) {
        const content = await readFile(filePath, 'utf-8');
        crds.set(file.toString(), content);
      }
    }
  }
  
  return { chart, templates, values, crds };
}

// ============================================================================
// Main Render Function
// ============================================================================

export async function renderChart(
  chartPath: string,
  options: RenderOptions
): Promise<KubeManifest[]> {
  const { chart, templates, values: defaultValues, crds } = await loadChart(chartPath);
  
  // Merge values
  let mergedValues = { ...defaultValues };
  
  // Load values files
  if (options.valuesFiles) {
    for (const vf of options.valuesFiles) {
      const content = await readFile(vf, 'utf-8');
      const parsed = yaml.parse(content);
      mergedValues = deepMerge(mergedValues, parsed);
    }
  }
  
  // Merge inline values
  if (options.values) {
    mergedValues = deepMerge(mergedValues, options.values);
  }
  
  // Apply --set overrides
  if (options.set) {
    for (const [key, value] of Object.entries(options.set)) {
      setNestedValue(mergedValues, key, value);
    }
  }
  
  // Create context
  const context = new TemplateContext(
    options.release,
    options.namespace || 'default',
    chart,
    mergedValues,
    options
  );
  
  const manifests: KubeManifest[] = [];
  
  // Include CRDs first
  if (options.includeCRDs) {
    for (const [, content] of Array.from(crds.entries())) {
      const docs = yaml.parseAllDocuments(content);
      for (const doc of docs) {
        if (doc.contents) {
          manifests.push(doc.toJSON() as KubeManifest);
        }
      }
    }
  }
  
  // Render templates
  for (const [name, content] of Array.from(templates.entries())) {
    // Skip helpers/partials
    if (name.startsWith('_')) continue;
    
    context.Template.Name = name;
    
    const rendered = renderTemplate(content, context);
    
    // Parse as YAML (may be multi-document)
    const docs = yaml.parseAllDocuments(rendered);
    for (const doc of docs) {
      if (doc.contents && typeof doc.toJSON() === 'object') {
        const manifest = doc.toJSON() as KubeManifest;
        if (manifest.apiVersion && manifest.kind) {
          // Add default namespace
          if (!manifest.metadata.namespace && options.namespace) {
            manifest.metadata.namespace = options.namespace;
          }
          manifests.push(manifest);
        }
      }
    }
  }
  
  return manifests;
}

// ============================================================================
// Utilities
// ============================================================================

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
        result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split('.');
  let current = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  
  const lastPart = parts[parts.length - 1];
  
  // Try to parse value as JSON, number, or boolean
  if (value === 'true') {
    current[lastPart] = true;
  } else if (value === 'false') {
    current[lastPart] = false;
  } else if (value.match(/^-?\d+$/)) {
    current[lastPart] = parseInt(value, 10);
  } else if (value.match(/^-?\d+\.\d+$/)) {
    current[lastPart] = parseFloat(value);
  } else {
    current[lastPart] = value;
  }
}

