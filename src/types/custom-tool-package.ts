export type CustomToolLockfileType = 'bun' | 'npm';

export type CustomToolPackageInfo = {
  rootDir: string;
  entryPath: string;
  packageJsonPath: string;
  lockfilePath: string;
  lockfileType: CustomToolLockfileType;
  packageName?: string;
};

export type CustomToolPackageResolution =
  | { ok: true; info: CustomToolPackageInfo }
  | { ok: false; error: string };
