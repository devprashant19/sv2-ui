import assert from 'node:assert/strict';
import test from 'node:test';

import { getLogDiagnostics } from './diagnostics.js';
import type { ContainerLogLine, LogContainerRole } from './types.js';

const SAMPLE_JDC_LINE: ContainerLogLine = {
  container: 'jdc',
  stream: 'stderr',
  timestamp: '2026-04-14T12:00:00.000Z',
  message: 'JDC started',
  raw: '2026-04-14T12:00:00.000Z JDC started',
};

function createMissingContainerError(containerName: string): Error {
  const dockerError = Object.assign(new Error(`No such container: ${containerName}`), {
    statusCode: 404,
    reason: 'no such container',
    json: { message: `No such container: ${containerName}` },
  });

  return new Error('Failed to read logs for translator container', {
    cause: dockerError,
  });
}

test('skips missing containers while collecting diagnostics', async () => {
  const response = await getLogDiagnostics(
    'jd',
    true,
    async (container: LogContainerRole) => {
      if (container === 'translator') {
        throw createMissingContainerError('sv2-translator');
      }

      return [SAMPLE_JDC_LINE];
    }
  );

  assert.equal(response.configured, true);
  assert.equal(response.mode, 'jd');
  assert.equal(response.streams.length, 1);
  assert.deepEqual(response.streams[0]?.containers, ['translator', 'jdc']);
  assert.deepEqual(response.diagnostics, []);
});

test('rethrows non-missing-container log failures', async () => {
  await assert.rejects(
    () =>
      getLogDiagnostics('no-jd', true, async () => {
        throw new Error('docker socket disappeared');
      }),
    /docker socket disappeared/
  );
});
