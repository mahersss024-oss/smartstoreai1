import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const sourceRoots = ['agent', 'app', 'components', 'hooks', 'lib', 'public', 'scripts'];
const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export type InventoryItem = {
  id: string;
  kind: 'page' | 'endpoint' | 'function' | 'control';
  file: string;
  line: number;
  column: number;
  name: string;
  path?: string;
  method?: string;
  attributes?: Record<string, string>;
};

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .flatMap(entry => entry.isDirectory()
      ? walk(join(directory, entry.name))
      : [join(directory, entry.name)]);
}

export function routePath(file: string) {
  return '/' + file.split('/').slice(1, -1)
    .filter(segment => !segment.startsWith('(') && !segment.startsWith('@'))
    .join('/');
}

export function inspectSource(file: string, source: string): InventoryItem[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const items: InventoryItem[] = [];
  const add = (node: ts.Node, kind: InventoryItem['kind'], name: string,
    extra: Partial<InventoryItem> = {}) => {
    const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    const line = position.line + 1;
    const column = position.character + 1;
    items.push({ id: `${kind}:${file}:${line}:${column}`, kind, file, line, column, name, ...extra });
  };
  const isExported = (node: ts.Node) => ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);

  if (/^app\/.*(?:^|\/)page\.tsx$/.test(file) || file === 'app/page.tsx') {
    add(ast, 'page', routePath(file), { path: routePath(file) });
  }

  const addEndpoint = (node: ts.Node, method: string) => {
    if (/^app\/.*\/route\.ts$/.test(file) && httpMethods.includes(method)) {
      const path = routePath(file);
      add(node, 'endpoint', `${method} ${path}`, { id: `${method} ${path}`, path, method });
    }
  };

  function visit(node: ts.Node) {
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const parent = node.parent;
      const name = 'name' in node && node.name ? node.name.getText(ast)
        : (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent))
          ? parent.name.getText(ast) : '<anonymous>';
      add(node, 'function', name);
    }
    if (ts.isFunctionDeclaration(node) && node.name && isExported(node)) {
      addEndpoint(node, node.name.text);
    }
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) addEndpoint(declaration, declaration.name.text);
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) addEndpoint(element, element.name.text);
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(ast);
      const attributes: Record<string, string> = {};
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) {
          attributes[attribute.name.getText(ast)] = attribute.initializer?.getText(ast) ?? 'true';
        } else {
          attributes['...spread'] = attribute.expression.getText(ast);
        }
      }
      if (/^(button|input|select|textarea|a|form|summary)$/i.test(name) ||
        /(Button|Link|Trigger|MenuItem|Checkbox|Switch|Slider|Radio|Input|Select|Textarea|Toggle)$/.test(name) ||
        Object.keys(attributes).some(key => /^(onClick|onSubmit|onChange|onPointerDown|onKeyDown)$/.test(key)) ||
        /["'](button|link|checkbox|switch|tab|slider)["']/.test(attributes.role ?? '')) {
        add(node, 'control', name, { attributes });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return items;
}

export function buildInventory(root = process.cwd()) {
  const files = [...sourceRoots.flatMap(directory => walk(join(root, directory))),
    ...['proxy.ts', 'next.config.ts'].map(file => join(root, file)).filter(existsSync)]
    .filter(file => /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.ts$/.test(file))
    .map(file => relative(root, file).replaceAll('\\', '/')).sort();
  const items = files.flatMap(file => inspectSource(file, readFileSync(join(root, file), 'utf8')));
  return { schemaVersion: 1, sourceRoots, files, items };
}
