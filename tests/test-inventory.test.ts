import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInventory, inspectSource, routePath } from '@/scripts/testing/inventory';
import { guestContracts, routeContract } from '@/scripts/testing/route-contracts';

test('inventory parses executable functions, aliases, route groups and interactive JSX without matching comments', () => {
  const routes = inspectSource('app/(public)/api/sample/route.ts', `
    // export function DELETE() {} is not a real endpoint.
    export async function GET() { return Response.json({}); }
    export const POST = async () => Response.json({});
    export { POST as PATCH };
    type Handler = () => void;
  `);
  assert.deepEqual(routes.filter(item => item.kind === 'endpoint').map(item => item.id),
    ['GET /api/sample', 'POST /api/sample', 'PATCH /api/sample']);
  assert.equal(routes.filter(item => item.kind === 'function').length, 2);
  assert.equal(routePath('app/(private)/account/@modal/page.tsx'), '/account');
  const ui = inspectSource('app/sample/page.tsx', `
    export default function Page() {
      const run = () => {};
      return <><Button aria-label="Save" onClick={run} /><a href="/account">Account</a>
        <input type="checkbox" /><div role="button" onKeyDown={run} />
        <DialogTrigger /><span>button onClick</span></>;
    }
  `);
  assert.equal(ui.filter(item => item.kind === 'page').length, 1);
  assert.deepEqual(ui.filter(item => item.kind === 'control').map(item => item.name),
    ['Button', 'a', 'input', 'div', 'DialogTrigger']);
  assert.equal(ui.find(item => item.name === 'Button')?.attributes?.['aria-label'], '"Save"');
  assert.equal(new Set(ui.map(item => item.id)).size, ui.length);
  assert.ok(ui.every(item => item.line > 0 && item.column > 0));
});

test('every discovered endpoint has an explicit access contract and guest exemptions cannot become stale', () => {
  const endpoints = buildInventory().items.filter(item => item.kind === 'endpoint');
  assert.ok(endpoints.length > 0);
  assert.deepEqual(endpoints.filter(endpoint => !routeContract(endpoint)).map(endpoint => endpoint.id), []);
  assert.deepEqual(Object.keys(guestContracts).filter(id => !endpoints.some(endpoint => endpoint.id === id)), []);
  assert.equal(new Set(endpoints.map(endpoint => endpoint.id)).size, endpoints.length);
});
