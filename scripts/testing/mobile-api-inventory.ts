import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

export type MobileApiCallsite = {
  id: string;
  file: string;
  line: number;
  column: number;
  transport: string;
  method: string | null;
  path: string | null;
  query: string | null;
  rawExpression: string;
  requestArguments: string[];
  resolution: 'resolved' | 'unresolved' | 'external';
  role: 'operation' | 'transport';
  reason?: string;
};

const placeholder = '[param]';
const originPlaceholder = 'https://mobile-api.invalid';
const apiMethods: Record<string, string> = {
  get: 'GET', post: 'POST', patch: 'PATCH', put: 'PUT', delete: 'DELETE', upload: 'POST',
};
const httpMethods = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']);

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)])
    .filter(file => /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.ts$/.test(file));
}

function enclosingScope(node: ts.Node): ts.Node {
  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current) && !ts.isBlock(current) &&
    !ts.isFunctionLike(current) && !ts.isClassLike(current)) current = current.parent;
  return current;
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}

export function inspectMobileApiSource(file: string, source: string): MobileApiCallsite[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const declarations = new Map<string, Array<ts.VariableDeclaration | ts.ParameterDeclaration | ts.FunctionDeclaration>>();
  const apiNames = new Set(['api']);
  const apiFetchNames = new Set(['apiFetch']);
  const fetchNames = new Set(['fetch']);
  const calls: ts.CallExpression[] = [];
  function collect(node: ts.Node) {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const binding of node.importClause.namedBindings.elements) {
        const imported = binding.propertyName?.text ?? binding.name.text;
        if (imported === 'api') apiNames.add(binding.name.text);
        if (imported === 'apiFetch') apiFetchNames.add(binding.name.text);
        if (imported === 'fetch') fetchNames.add(binding.name.text);
      }
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) &&
      node.name && ts.isIdentifier(node.name)) {
      const values = declarations.get(node.name.text) ?? [];
      values.push(node);
      declarations.set(node.name.text, values);
    }
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, collect);
  }
  collect(ast);

  function findDeclaration(name: string, usage: ts.Node) {
    const values = declarations.get(name) ?? [];
    for (let current: ts.Node | undefined = usage; current; current = current.parent) {
      const found = values.find(declaration => enclosingScope(declaration.parent) === current);
      if (found) return found;
    }
    return undefined;
  }

  function returnExpression(node: ts.Node): ts.Expression | undefined {
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !ts.isBlock(node.body)) return node.body;
    let result: ts.Expression | undefined;
    const visit = (child: ts.Node) => {
      if (result || (child !== node && ts.isFunctionLike(child))) return;
      if (ts.isReturnStatement(child) && child.expression) result = child.expression;
      else ts.forEachChild(child, visit);
    };
    visit(node);
    return result;
  }

  function resolveStrings(expression: ts.Expression, seen = new Set<ts.Node>()): string[] {
    const node = unwrap(expression);
    if (seen.has(node) || seen.size > 35) return [placeholder];
    const nextSeen = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isTemplateExpression(node)) {
      let values = [node.head.text];
      for (const span of node.templateSpans) {
        const additions = resolveStrings(span.expression, nextSeen);
        values = values.flatMap(prefix => additions.map(value => prefix + value + span.literal.text));
      }
      return [...new Set(values)];
    }
    if (ts.isConditionalExpression(node)) return [...new Set([
      ...resolveStrings(node.whenTrue, nextSeen), ...resolveStrings(node.whenFalse, nextSeen),
    ])];
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return resolveStrings(node.left, nextSeen).flatMap(left =>
        resolveStrings(node.right, nextSeen).map(right => left + right));
    }
    if (ts.isIdentifier(node)) {
      const declaration = findDeclaration(node.text, node);
      if (declaration && !ts.isFunctionDeclaration(declaration)) {
        if (declaration.initializer) return resolveStrings(declaration.initializer, nextSeen);
        if (ts.isParameter(declaration) && declaration.type && ts.isUnionTypeNode(declaration.type)) {
          const values = declaration.type.types.flatMap(type => ts.isLiteralTypeNode(type) &&
            ts.isStringLiteral(type.literal) ? [type.literal.text] : []);
          if (values.length) return values;
        }
      }
      return [placeholder];
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        if (node.expression.text === 'getApiBaseUrl') return [originPlaceholder];
        if (node.expression.text === 'encodeURIComponent') return [placeholder];
        const declaration = findDeclaration(node.expression.text, node);
        const returned = declaration && returnExpression(declaration);
        if (returned) return resolveStrings(returned, nextSeen);
      }
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
        let owner: ts.Node | undefined = node.parent;
        while (owner && !ts.isClassLike(owner)) owner = owner.parent;
        if (owner && ts.isClassLike(owner)) {
          const member = owner.members.find(item => ts.isMethodDeclaration(item) && item.name.getText(ast) === node.expression.getText(ast).slice(5));
          const returned = member && returnExpression(member);
          if (returned) return resolveStrings(returned, nextSeen);
        }
      }
    }
    return [placeholder];
  }

  function methodsForOptions(options: ts.Expression | undefined): Array<string | null> {
    if (!options) return ['GET'];
    const value = unwrap(options);
    if (!ts.isObjectLiteralExpression(value)) return [null];
    const property = value.properties.find(item => (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && item.name.getText(ast).replace(/['"]/g, '') === 'method');
    if (!property) return value.properties.some(ts.isSpreadAssignment) ? [null] : ['GET'];
    const expression = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
    const methods = expression ? resolveStrings(expression).map(value => value.toUpperCase()).filter(value => httpMethods.has(value)) : [];
    return methods.length ? methods : [null];
  }

  const result: MobileApiCallsite[] = [];
  for (const call of calls) {
    let transport: string | undefined;
    let methods: Array<string | null> = [];
    let role: MobileApiCallsite['role'] = 'operation';
    let reason: string | undefined;
    let urlArgument = 0;
    const target = call.expression;
    if (file === 'src/core/listing-publication.ts' &&
      ((ts.isIdentifier(target) && target.text === 'request') || target.getText(ast) === 'this.dependencies.request')) {
      transport = target.getText(ast);
      methods = resolveStrings(call.arguments[0]).map(value => value.toUpperCase()).filter(value => httpMethods.has(value));
      urlArgument = 1;
      if (target.getText(ast) === 'this.dependencies.request' && call.arguments[1]?.getText(ast) === 'path') {
        role = 'transport';
        reason = 'Injected publication HTTP adapter; concrete operation calls in this coordinator are inventoried separately.';
      }
    } else if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) &&
      apiNames.has(target.expression.text) && apiMethods[target.name.text]) {
      transport = target.getText(ast);
      methods = [apiMethods[target.name.text]];
      if (file === 'src/core/listing-publication-context.tsx' && call.arguments[0]?.getText(ast) === 'path') {
        role = 'transport';
        reason = 'Publication provider HTTP adapter; concrete operations are reviewed in src/core/listing-publication.ts.';
      }
    } else if (ts.isIdentifier(target) && apiFetchNames.has(target.text)) {
      transport = target.text;
      methods = methodsForOptions(call.arguments[1]);
      for (let owner: ts.Node | undefined = call.parent; owner; owner = owner.parent) {
        if (ts.isNewExpression(owner) && owner.expression.getText(ast) === 'DefaultChatTransport') {
          methods = ['POST'];
          reason = 'Custom fetch inside DefaultChatTransport: outbound chat submissions use POST; provider behavior remains a separately reviewed transport contract.';
          break;
        }
      }
    } else if ((ts.isIdentifier(target) && fetchNames.has(target.text)) ||
      (ts.isPropertyAccessExpression(target) && target.name.text === 'fetch')) {
      transport = target.getText(ast);
      methods = methodsForOptions(call.arguments[1]);
      role = 'transport';
    }
    if (!transport || !call.arguments[urlArgument]) continue;
    if (!methods.length) methods = [null];
    const urls = resolveStrings(call.arguments[urlArgument]);
    const position = ast.getLineAndCharacterOfPosition(call.getStart(ast));
    let variant = 0;
    for (const url of [...new Set(urls)]) {
      const apiStart = url.startsWith('/api/') ? 0 : /^https?:\/\/[^/]+\/api\//.test(url) ? url.indexOf('/api/') : -1;
      const knownApi = apiStart >= 0;
      const apiUrl = knownApi ? url.slice(apiStart) : null;
      const queryIndex = apiUrl?.indexOf('?') ?? -1;
      const path = apiUrl ? (queryIndex >= 0 ? apiUrl.slice(0, queryIndex) : apiUrl).split('#')[0] : null;
      const query = apiUrl && queryIndex >= 0 ? apiUrl.slice(queryIndex + 1).split('#')[0] : null;
      for (const method of methods) {
        const isApiWrapper = file === 'src/core/api.ts' && role === 'transport' && !knownApi && target.getText(ast) !== 'fetch';
        const resolution = knownApi ? method ? 'resolved' : 'unresolved' : role === 'transport' && !isApiWrapper ? 'external' : 'unresolved';
        result.push({
          id: `${file}:${position.line + 1}:${position.character + 1}:${variant++}`,
          file, line: position.line + 1, column: position.character + 1, transport,
          method, path, query, rawExpression: call.arguments[urlArgument].getText(ast),
          requestArguments: call.arguments.slice(urlArgument + 1).map(argument => argument.getText(ast)),
          resolution, role: knownApi ? 'operation' : role,
          reason: reason ?? (resolution === 'unresolved'
            ? 'Destination or HTTP method depends on runtime values; this call must be reviewed rather than counted as matched.'
            : resolution === 'external' ? 'Runtime media/local-file or signed-storage URL; not a server API operation.' : undefined),
        });
      }
    }
  }
  return result;
}

export function buildMobileApiInventory(mobileRoot: string) {
  if (!existsSync(join(mobileRoot, 'src'))) throw new Error('Mobile source root must contain src/.');
  const files = walk(join(mobileRoot, 'src')).map(file => relative(mobileRoot, file).replaceAll('\\', '/'));
  const callsites = files.flatMap(file => inspectMobileApiSource(file, readFileSync(join(mobileRoot, file), 'utf8')));
  return {
    schemaVersion: 1 as const,
    interpretation: 'Source inventory only. API callsites and dynamic route shapes are not evidence of successful behavior, live service delivery, or device UI verification.',
    limitations: [
      'Resolves same-file literals, templates, scoped bindings, conditional branches, simple return helpers and literal-union method parameters; it does not perform general inter-module data-flow analysis.',
      'Runtime path segments use [param]. Conditional branches are inventoried independently rather than presumed to execute.',
      'DefaultChatTransport custom fetch uses the reviewed POST transport contract; runtime RequestInit cannot establish its method by itself.',
      'Generic fetch implementations and media/local-file/signed-storage transfers are retained separately from concrete server API operation callsites.',
    ],
    files,
    callsites,
  };
}
