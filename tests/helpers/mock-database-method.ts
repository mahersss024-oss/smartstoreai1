import type { TestContext } from 'node:test';

/** Prisma delegates expose virtual methods, so Node's method mock cannot find their descriptors. */
export function mockDatabaseMethod(t: TestContext, target: object, name: string, implementation: unknown) {
  const previous = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value: implementation });
  t.after(() => {
    if (previous) Object.defineProperty(target, name, previous);
    else Reflect.deleteProperty(target, name);
  });
}
