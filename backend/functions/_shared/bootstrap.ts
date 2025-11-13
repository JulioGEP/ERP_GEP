// backend/functions/_shared/bootstrap.ts
import Module from 'module';

type PatchedModule = typeof Module & {
  _load(request: string, parent: NodeModule | null, isMain: boolean): unknown;
};

const globalScope = globalThis as typeof globalThis & {
  __erpGepPatchedPunycode?: boolean;
};

if (!globalScope.__erpGepPatchedPunycode) {
  globalScope.__erpGepPatchedPunycode = true;

  const moduleRef = Module as PatchedModule;
  const originalLoad = moduleRef._load.bind(moduleRef);

  moduleRef._load = function patchedModuleLoad(request, parent, isMain) {
    if (request === 'punycode' || request === 'node:punycode') {
      return originalLoad('punycode/', parent, isMain);
    }
    return originalLoad(request, parent, isMain);
  };
}

export {}; // Ensure this file is treated as a module with side effects only.
