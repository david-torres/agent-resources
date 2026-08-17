const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

// bun test runs every *.test.js file in one shared process, and bun's
// `mock.module(path, factory)` permanently rebinds that resolved path the
// first time it's called anywhere in the process: once that happens,
// deleting require.cache[path] and calling require(path) again no longer
// re-executes the real file -- it just keeps returning whatever
// mock.module last registered for that path, regardless of cache state or
// file load order. That's fine for files that only ever want the mock, but
// it breaks any OTHER test file that needs to genuinely re-run the real
// module (e.g. against a different fake dependency per test file), if some
// third file elsewhere has mock.module'd that same path for its own
// purposes.
//
// freshRequire sidesteps bun's mock.module registry entirely by loading a
// CommonJS file's source and evaluating it directly (via vm + Module.wrap)
// instead of going through bun's require(). It resolves and follows
// relative requires itself, substituting `overrides` (keyed by resolved
// absolute path, e.g. from require.resolve('./_base')) in place of the
// real file at that path. Non-relative requires (node builtins, npm
// packages) fall through to the normal, real require -- those aren't
// subject to the same poisoning since nothing mocks them.
//
// Each call to freshRequire gets its own private module cache, so the
// returned module (and everything it pulls in transitively) is a fresh
// instance wired to `overrides`, unaffected by whatever any other test
// file has done to bun's global module registry.
//
// `entryPath` must be an already-resolved absolute path (e.g. the
// caller's own `require.resolve('./rules')`) -- this module can't resolve
// a relative specifier on the caller's behalf, since "relative" would mean
// relative to this file, not the caller's directory.
const freshRequire = (entryPath, overrides) => {
    const cache = new Map();

    const load = (filename) => {
        if (overrides.has(filename)) return overrides.get(filename);
        if (cache.has(filename)) return cache.get(filename);

        const src = fs.readFileSync(filename, 'utf8');
        const mod = { exports: {} };
        // Register before evaluating so circular requires resolve to the
        // (possibly still-empty) exports object, matching CommonJS semantics.
        cache.set(filename, mod.exports);

        const dirname = path.dirname(filename);
        const localRequire = (spec) => {
            if (!spec.startsWith('.')) return require(spec);
            const resolved = require.resolve(spec, { paths: [dirname] });
            return overrides.has(resolved) ? overrides.get(resolved) : load(resolved);
        };

        const wrapper = vm.runInThisContext(Module.wrap(src), { filename });
        wrapper.call(mod.exports, mod.exports, localRequire, mod, filename, dirname);

        cache.set(filename, mod.exports);
        return mod.exports;
    };

    return load(entryPath);
};

module.exports = { freshRequire };
