interface AdoptCreatedPtyOptions {
  isActive: () => boolean;
  adopt: (ptyId: number) => void;
  destroy: (ptyId: number) => Promise<void>;
}

export async function adoptCreatedPty(
  ptyId: number,
  options: AdoptCreatedPtyOptions,
): Promise<boolean> {
  if (!options.isActive()) {
    await options.destroy(ptyId);
    return false;
  }

  options.adopt(ptyId);
  return true;
}
