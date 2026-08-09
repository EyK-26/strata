type StrataCommand = (...args: string[]) => Promise<void> | void;
type StrataCommandLoader = () => Promise<StrataCommand>;
type StrataCommandMap = Record<string, StrataCommandLoader>;

type StrataFileConfig = {
  preload?: string;
  server?: string;
  modulesDirectory?: string;
  commands?: string;
  migrate?: string;
  fresh?: string;
};

type StrataAppConfig = {
  root: string;
  preload?: string;
  server?: string;
  modulesDirectory?: string;
  commandsModule?: string;
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
