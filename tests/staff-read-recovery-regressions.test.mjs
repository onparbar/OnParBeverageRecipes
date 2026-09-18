import assert from 'node:assert/strict';
import test from 'node:test';
import { createResilientStaffFetch } from '../public/staff-resilience.mjs';
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('coalesced staff reads provide independently readable response bodies', async () => {
  let reads = 0;
  const fetch = createResilientStaffFetch({ fetcher: async () => { reads++; return json({ available: true }); } });
  const responses = await Promise.all([fetch('/api/staff-prep-plan'), fetch('/api/staff-prep-plan')]);
  assert.deepEqual(await Promise.all(responses.map(response => response.json())), [{ available: true }, { available: true }]);
  assert.equal(reads, 1);
});

test('successful checklist saves invalidate older fallback data', async () => {
  let offline = false;
  const fetch = createResilientStaffFetch({ maxAttempts: 1, fetcher: async (_, options) => {
    if (options.method === 'POST') return json({ completed: true });
    if (offline) throw new Error('offline');
    return json({ completed: false });
  } });
  await fetch('/api/staff-prep-plan');
  await fetch('/api/staff-prep-plan', { method: 'POST' });
  offline = true;
  const response = await fetch('/api/staff-prep-plan');
  assert.equal(response.status, 503, 'must not restore unchecked state after a confirmed save');
});

test('a read started before a successful save cannot recreate an outdated fallback', async () => {
  let finishRead;
  let offline = false;
  const fetch = createResilientStaffFetch({ maxAttempts: 1, fetcher: async (_, options) => {
    if (options.method === 'POST') return json({ completed: true });
    if (offline) throw new Error('offline');
    return new Promise(resolve => { finishRead = () => resolve(json({ completed: false })); });
  } });
  const oldRead = fetch('/api/staff-prep-plan');
  await fetch('/api/staff-prep-plan', { method: 'POST' });
  finishRead();
  await oldRead;
  offline = true;
  assert.equal((await fetch('/api/staff-prep-plan')).status, 503);
});

test('an uncertain save cannot restore an older checklist from fallback', async () => {
  for (const saveOutcome of ['server-error', 'network-error']) {
    let offline = false;
    const fetch = createResilientStaffFetch({ maxAttempts: 1, fetcher: async (_, options) => {
      if (options.method === 'POST') {
        if (saveOutcome === 'network-error') throw new Error('connection lost after write');
        return new Response('inventory update unavailable', { status: 503 });
      }
      if (offline) throw new Error('offline');
      return json({ completed: false });
    } });
    await fetch('/api/staff-prep-plan');
    if (saveOutcome === 'network-error') {
      await assert.rejects(fetch('/api/staff-prep-plan', { method: 'POST' }), /connection lost/);
    } else {
      assert.equal((await fetch('/api/staff-prep-plan', { method: 'POST' })).status, 503);
    }
    offline = true;
    assert.equal((await fetch('/api/staff-prep-plan')).status, 503, saveOutcome);
  }
});

test('reads begun during a save cannot survive as fallback after it finishes', async () => {
  let finishSave;
  let offline = false;
  const fetch = createResilientStaffFetch({ maxAttempts: 1, fetcher: async (_, options) => {
    if (options.method === 'POST') return new Promise(resolve => { finishSave = () => resolve(json({ completed: true })); });
    if (offline) throw new Error('offline');
    return json({ completed: false });
  } });
  const save = fetch('/api/staff-prep-plan', { method: 'POST' });
  await fetch('/api/staff-prep-plan');
  finishSave();
  await save;
  offline = true;
  assert.equal((await fetch('/api/staff-prep-plan')).status, 503);
});
