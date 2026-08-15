interface ServiceContainerLike {
  has(key: string): boolean;
  resolve<T>(key: string): T;
}

export type { ServiceContainerLike };
