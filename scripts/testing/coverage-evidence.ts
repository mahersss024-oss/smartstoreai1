import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

import type { InventoryItem } from './inventory';
import { routeContract } from './route-contracts';

export type TestSource = {
  file: string;
  kind: 'node' | 'e2e';
  imports: Map<string, Set<string>>;
};

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .flatMap(entry => entry.isDirectory()
      ? walk(join(directory, entry.name))
      : [join(directory, entry.name)]);
}

function testSources(root: string): TestSource[] {
  return [
    ...walk(join(root, 'tests')).filter(file => /\.test\.[cm]?[jt]sx?$/.test(file)),
    ...walk(join(root, 'e2e')).filter(file => /\.spec\.[cm]?[jt]sx?$/.test(file)),
  ].map(absolute => {
    const file = relative(root, absolute).replaceAll('\\', '/');
    const ast = ts.createSourceFile(file, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true,
      /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const imports = new Map<string, Set<string>>();
    const add = (specifier: string, names: Iterable<string> = []) => {
      const current = imports.get(specifier) ?? new Set<string>();
      for (const name of names) current.add(name);
      imports.set(specifier, current);
    };

    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const bindings = node.importClause?.namedBindings;
        const names = bindings && ts.isNamedImports(bindings)
          ? bindings.elements.map(element => element.propertyName?.text ?? element.name.text)
          : bindings && ts.isNamespaceImport(bindings) ? ['*'] : [];
        add(node.moduleSpecifier.text, names);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const names = node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map(element => element.propertyName?.text ?? element.name.text)
          : ['*'];
        add(node.moduleSpecifier.text, names);
      } else if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        add(node.arguments[0].text, ['*']);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    return { file, kind: file.startsWith('tests/') ? 'node' : 'e2e', imports };
  });
}

function resolveImport(root: string, importer: string, specifier: string): string | undefined {
  const alias = specifier.match(/^@(chat-elements|ui)\/(.+)$/);
  const base = specifier.startsWith('@/')
    ? resolve(root, specifier.slice(2))
    : alias ? resolve(root, 'components', alias[1] === 'ui' ? 'ui' : 'chat-elements', alias[2])
      : specifier.startsWith('.') ? resolve(root, dirname(importer), specifier) : undefined;
  if (!base) return undefined;

  const candidates = extname(base)
    ? [base]
    : [base, ...sourceExtensions.map(extension => `${base}${extension}`),
      ...sourceExtensions.map(extension => join(base, `index${extension}`))];
  const found = candidates.find(candidate => existsSync(candidate));
  return found ? relative(root, found).replaceAll('\\', '/') : undefined;
}

function selectedE2eSpecs(root: string) {
  const config = readFileSync(join(root, 'playwright.config.ts'), 'utf8');
  const browserBlock = config.match(/const\s+adminBrowserSpecs\s*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
  const browserNames = new Set([...browserBlock.matchAll(/['"]\*\*\/([^'"]+\.spec\.[cm]?[jt]sx?)['"]/g)]
    .map(match => match[1]));
  const apiNames = new Set(['api-contracts.spec.ts', 'listing-reference.spec.ts']);
  return { browserNames, apiNames };
}

export function buildCoverageEvidence(root = process.cwd(), inventoryItems: InventoryItem[] = []) {
  const tests = testSources(root);
  const selected = selectedE2eSpecs(root);
  const references = new Map<string, Array<{ testFile: string; importedNames: string[]; testKind: string }>>();
  for (const testFile of tests) {
    for (const [specifier, importedNames] of testFile.imports) {
      const target = resolveImport(root, testFile.file, specifier);
      if (!target) continue;
      const values = references.get(target) ?? [];
      values.push({ testFile: testFile.file, importedNames: [...importedNames].sort(), testKind: testFile.kind });
      references.set(target, values);
    }
  }

  const orderedReferences = (file: string) => (references.get(file) ?? [])
    .sort((left, right) => left.testFile.localeCompare(right.testFile, 'en'));
  const endpoints = inventoryItems.filter(item => item.kind === 'endpoint').map(endpoint => {
    const moduleReferences = orderedReferences(endpoint.file);
    const handlerReferences = moduleReferences.filter(reference =>
      reference.importedNames.includes(endpoint.method ?? ''));
    const accessContract = routeContract(endpoint);
    return {
      id: endpoint.id,
      file: endpoint.file,
      method: endpoint.method,
      path: endpoint.path,
      accessContract: accessContract ?? 'unclassified',
      moduleTestReferences: moduleReferences,
      directHandlerImportReferences: handlerReferences,
      configuredRequestContract: {
        methodAndUnsupportedMethod: true,
        guestRejection: ['session', 'staff'].includes(accessContract ?? ''),
        customerDeniedForStaff: accessContract === 'staff',
        evidenceFile: 'e2e/api-contracts.spec.ts',
        note: 'This is configured suite coverage, not evidence that the latest run passed.' +
          ' Guest-access endpoints are not included in the generic auth-denial loop.',
      },
    };
  });

  const pages = inventoryItems.filter(item => item.kind === 'page').map(page => {
    const isAdmin = page.path === '/admin' || page.path?.startsWith('/admin/');
    return {
      path: page.path,
      file: page.file,
      moduleTestReferences: orderedReferences(page.file),
      configuredRenderAccessBaseline: isAdmin ? {
        evidenceFile: 'e2e/route-contracts.spec.ts',
        roles: ['guest', 'customer'],
        checks: ['HTTP 200', 'admin entry visible', 'protected content absent', 'no client error'],
        note: 'Only admin page presentation/access baseline; not successful admin workflows.',
      } : null,
    };
  });

  const controls = inventoryItems.filter(item => item.kind === 'control').map(control => ({
    id: control.id,
    file: control.file,
    line: control.line,
    name: control.name,
    moduleTestReferences: orderedReferences(control.file),
    note: 'A source-module reference does not prove this control was rendered, clicked, or had its result asserted.',
  }));

  const allE2e = tests.filter(test => test.kind === 'e2e').map(test => {
    const name = test.file.split('/').at(-1)!;
    const configuredProjects = [
      ...(selected.browserNames.has(name) ? ['desktop-chromium', 'mobile-chromium-layout'] : []),
      ...(selected.apiNames.has(name) ? ['api-contracts'] : []),
    ];
    return { file: test.file, configuredProjects, selectedByDefault: configuredProjects.length > 0 };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    interpretation: 'Evidence index only. A test importing a module is not proof its behavior was exercised or passed. Configured Playwright projects are not proof a run completed. No item is automatically marked fully behavior-covered.',
    evidenceDefinitions: {
      directHandlerImport: 'A test file imports the endpoint method symbol from its route module; this is a useful pointer, not assertion-level proof.',
      moduleImport: 'Relative imports and the configured @/, @ui/ and @chat-elements/ aliases are resolved. A test file importing a source module is a pointer only; the module may only be mocked or inspected.',
      requestContract: 'The configured API contract suite checks method routing and selected access boundaries.',
      adminPageBaseline: 'The configured browser suite checks basic guest/customer presentation for discovered admin pages.',
      completeBehavior: 'Not inferred. Requires a reviewed scenario with asserted result, permissions, failure and repeat/cancel cases appropriate to the feature.',
    },
    testFiles: {
      node: tests.filter(test => test.kind === 'node').map(test => test.file),
      e2e: allE2e,
    },
    endpoints,
    pages,
    controls,
    sourceModuleReferenceSummary: {
      referencedSourceFiles: references.size,
      nodeReferencedSourceFiles: new Set(tests.filter(test => test.kind === 'node')
        .flatMap(test => [...test.imports.keys()].map(specifier => resolveImport(root, test.file, specifier))
          .filter((target): target is string => Boolean(target)))).size,
      e2eReferencedSourceFiles: new Set(tests.filter(test => test.kind === 'e2e')
        .flatMap(test => [...test.imports.keys()].map(specifier => resolveImport(root, test.file, specifier))
          .filter((target): target is string => Boolean(target)))).size,
      controlsWithTestFileModuleReference: controls.filter(control => control.moduleTestReferences.length > 0).length,
      pagesWithTestFileModuleReference: pages.filter(page => page.moduleTestReferences.length > 0).length,
      endpointsWithDirectHandlerImportReference: endpoints.filter(endpoint => endpoint.directHandlerImportReferences.length > 0).length,
    },
  };
}
