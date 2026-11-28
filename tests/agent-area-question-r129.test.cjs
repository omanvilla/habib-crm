'use strict';
// R129 (28 Nov 2026): a question about the surroundings (distance, near a place) gets a visit invitation, not silence.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs');
const brain = fs.readFileSync(require('node:path').join(__dirname, '../supabase/functions/whatsapp-reply-agent/brain.ts'), 'utf8');
test('R129 exception to R41 for area questions', () => {
  assert.match(brain, /استثناء R41 \(R129/);
  assert.match(brain, /"الافضل تشوف المنطقة بنفسك لما تزور عشان تتأكد اذا تناسبك" و"متى يناسبك تزور ؟" و action=none/);
  // R41 itself (questions about the property) stays
  assert.match(brain, /سؤال من العميل جوابه مو مكتوب قدامك أبداً \(R41/);
});
