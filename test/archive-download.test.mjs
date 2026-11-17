import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { MAX_ARCHIVE_BYTES, SkillHarborClient } from '../dist/core.js';

const slug = 'fixture-skill';
const version = '1.0.0';
const markdown = '# Fixture skill';
const zip = zipSync({ [slug + '/SKILL.md']: strToU8(markdown) });
const sha256 = createHash('sha256').update(zip).digest('hex');

test('download verifies a streamed ZIP with or without Content-Length', async (t) => {
  const client = new SkillHarborClient('http://127.0.0.1:4310', 'fixture-token');
  const fetch = t.mock.method(globalThis, 'fetch');

  function respond(body, headers = {}) {
    fetch.mock.mockImplementationOnce(async () => new Response(body, {
      headers: {
        'Content-Type': 'application/zip',
        'X-Skill-Slug': slug,
        'X-Skill-Version': version,
        'X-Archive-Sha256': sha256,
        ...headers,
      },
    }));
  }

  const streamedZip = new ReadableStream({
    start(controller) {
      controller.enqueue(zip.subarray(0, 16));
      controller.enqueue(zip.subarray(16));
      controller.close();
    },
  });
  respond(streamedZip);
  const archive = await client.download(slug, version);
  assert.equal(archive.sha256, sha256);
  assert.equal(Buffer.from(archive.files[0].data).toString(), markdown);
  respond(zip, { 'Content-Length': String(zip.byteLength) });
  assert.equal((await client.download(slug, version)).sha256, sha256);

  respond(zip, { 'X-Archive-Sha256': '0'.repeat(64) });
  await assert.rejects(client.download(slug, version));
  respond(zip, { 'Content-Length': '0' });
  await assert.rejects(client.download(slug, version), { code: 'archive_length_invalid' });
  respond(zip, { 'Content-Length': String(zip.byteLength - 1) });
  await assert.rejects(client.download(slug, version), { code: 'archive_length_mismatch' });
  respond(zip, { 'Content-Length': String(MAX_ARCHIVE_BYTES + 1) });
  await assert.rejects(client.download(slug, version), { code: 'archive_too_large' });

  let canceled = false;
  const chunk = new Uint8Array(1024 * 1024);
  respond(new ReadableStream({
    pull(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      canceled = true;
    },
  }));
  await assert.rejects(client.download(slug, version), { code: 'archive_too_large' });
  assert.equal(canceled, true);
});
