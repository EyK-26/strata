type StrataCommand = (...args: string[]) => Promise<void> | void;
type StrataCommandLoader = () => Promise<StrataCommand>;
type StrataCommandMap = Record<string, StrataCommandLoader>;

type StrataFileConfig = {
  application?: string;
  schedule?: string;
  preload?: string;
  server?: string;
  modulesDirectory?: string;
  commands?: string;
  migrateStatus?: string;
  rollback?: string;
  migrate?: string;
  fresh?: string;
};

type StrataAppConfig = {
  root: string;
  application?: string;
  schedule?: string;
  preload?: string;
  server?: string;
  modulesDirectory?: string;
  commandsModule?: string;
  migrateStatus?: string;
  rollback?: string;
  migrate?: string;
  fresh?: string;
};

type RunCliOptions = {
  argv?: string[];
  cwd?: string;
  commands?: StrataCommandMap;
  skipBoot?: boolean;
  exitProcess?: boolean;
};

export type {
  RunCliOptions,
  StrataAppConfig,
  StrataCommand,
  StrataCommandLoader,
  StrataCommandMap,
  StrataFileConfig,
};
