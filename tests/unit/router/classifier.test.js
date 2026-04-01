'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { CommandClassifier } = require('../../../src/daemon/router/classifier');

describe('CommandClassifier', () => {
  const registryPath = path.join(__dirname, '../../../src/daemon/router/command-registry.json');
  const classifier = new CommandClassifier(registryPath);

  describe('passthrough (regular messages)', () => {
    it('classifies regular text as passthrough', () => {
      const result = classifier.classify('Build a React dashboard');
      assert.equal(result.category, 'passthrough');
      assert.equal(result.cliText, 'Build a React dashboard');
    });

    it('classifies empty-ish text as passthrough', () => {
      const result = classifier.classify('  hello  ');
      assert.equal(result.category, 'passthrough');
      assert.equal(result.cliText, 'hello');
    });
  });

  describe('text_safe commands (CL-02)', () => {
    it('forwards /memory add as text_safe', () => {
      const result = classifier.classify('/memory add Always use TypeScript');
      assert.equal(result.category, 'text_safe');
      assert.equal(result.cliText, '/memory add Always use TypeScript');
    });

    it('forwards /compress as text_safe', () => {
      const result = classifier.classify('/compress');
      assert.equal(result.category, 'text_safe');
    });

    it('forwards /tools as text_safe', () => {
      const result = classifier.classify('/tools');
      assert.equal(result.category, 'text_safe');
    });

    it('forwards /stats as text_safe', () => {
      const result = classifier.classify('/stats');
      assert.equal(result.category, 'text_safe');
    });

    it('forwards /help as text_safe', () => {
      const result = classifier.classify('/help');
      assert.equal(result.category, 'text_safe');
    });

    it('forwards /version as text_safe', () => {
      const result = classifier.classify('/version');
      assert.equal(result.category, 'text_safe');
    });

    it('forwards /chat save as text_safe', () => {
      const result = classifier.classify('/chat save before-refactor');
      assert.equal(result.category, 'text_safe');
    });
  });

  describe('custom .toml commands (CL-05)', () => {
    it('treats unknown slash commands as text_safe', () => {
      const result = classifier.classify('/review check all files');
      assert.equal(result.category, 'text_safe');
      assert.equal(result.cliText, '/review check all files');
    });

    it('treats custom commands as text_safe', () => {
      const result = classifier.classify('/deploy production');
      assert.equal(result.category, 'text_safe');
    });
  });

  describe('parameterized_safe commands (CL-03)', () => {
    it('returns interactive selection for bare /resume', () => {
      const result = classifier.classify('/resume');
      assert.equal(result.category, 'parameterized_safe');
      assert.equal(result.adapter, 'session_picker');
    });

    it('forwards /resume with args as text_safe', () => {
      const result = classifier.classify('/resume session-abc');
      assert.equal(result.category, 'text_safe');
      assert.equal(result.cliText, '/resume session-abc');
    });
  });

  describe('unsupported commands (CL-04)', () => {
    it('returns explanation for /clear', () => {
      const result = classifier.classify('/clear');
      assert.equal(result.category, 'unsupported');
      assert.ok(result.explanation);
      assert.ok(result.explanation.includes('terminal'));
    });

    it('returns explanation for /copy', () => {
      const result = classifier.classify('/copy');
      assert.equal(result.category, 'unsupported');
      assert.ok(result.explanation);
    });

    it('returns explanation for /theme', () => {
      const result = classifier.classify('/theme');
      assert.equal(result.category, 'unsupported');
    });

    it('returns explanation for /settings', () => {
      const result = classifier.classify('/settings');
      assert.equal(result.category, 'unsupported');
    });
  });

  describe('meta commands', () => {
    it('classifies ::new as meta with create_conversation handler', () => {
      const result = classifier.classify('::new');
      assert.equal(result.category, 'meta');
      assert.equal(result.handler, 'create_conversation');
    });

    it('classifies ::list as meta', () => {
      const result = classifier.classify('::list');
      assert.equal(result.category, 'meta');
      assert.equal(result.handler, 'list_conversations');
    });

    it('classifies ::costs as meta', () => {
      const result = classifier.classify('::costs');
      assert.equal(result.category, 'meta');
      assert.equal(result.handler, 'show_costs');
    });

    it('classifies ::apps as meta', () => {
      const result = classifier.classify('::apps');
      assert.equal(result.category, 'meta');
      assert.equal(result.handler, 'list_apps');
    });

    it('passes through unknown :: commands', () => {
      const result = classifier.classify('::unknown');
      assert.equal(result.category, 'passthrough');
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase commands', () => {
      const result = classifier.classify('/MEMORY add test');
      assert.equal(result.category, 'text_safe');
    });

    it('handles mixed case meta commands', () => {
      const result = classifier.classify('::NEW');
      assert.equal(result.category, 'meta');
    });
  });
});
