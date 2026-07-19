import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const PREVIEW_ASSET_SCHEME = 'htmlpoint-asset';

type TokenFactory = () => string;
type CanonicalizePath = (candidate: string) => Promise<string>;

interface PreviewAssetRegistration {
  ownerId: number;
  rootPath: string;
  token: string;
}

const lexicalCanonicalize: CanonicalizePath = async (candidate) => path.resolve(candidate);

export function previewBaseUrlForToken(token: string): string {
  return `${PREVIEW_ASSET_SCHEME}://${encodeURIComponent(token)}/`;
}

export class PreviewAssetRegistry {
  private readonly byToken = new Map<string, PreviewAssetRegistration>();
  private readonly tokenByOwner = new Map<number, string>();
  private readonly generationByOwner = new Map<number, number>();
  private nextGeneration = 0;

  constructor(
    private readonly createToken: TokenFactory = randomUUID,
    private readonly canonicalize: CanonicalizePath = lexicalCanonicalize
  ) {}

  get size(): number {
    return this.byToken.size;
  }

  async register(ownerId: number, sourcePath: string): Promise<string> {
    const generation = ++this.nextGeneration;
    this.generationByOwner.set(ownerId, generation);
    const rootPath = await this.canonicalize(path.dirname(path.resolve(sourcePath)));
    if (this.generationByOwner.get(ownerId) !== generation) {
      throw new Error('Preview source registration was superseded.');
    }
    this.removeOwnerRegistration(ownerId);

    const token = this.createUniqueToken();
    this.byToken.set(token, { ownerId, rootPath, token });
    this.tokenByOwner.set(ownerId, token);
    return previewBaseUrlForToken(token);
  }

  async resolve(requestUrl: string): Promise<string | undefined> {
    let request: URL;
    try {
      request = new URL(requestUrl);
    } catch {
      return undefined;
    }
    if (request.protocol !== `${PREVIEW_ASSET_SCHEME}:`) {
      return undefined;
    }

    const registration = this.byToken.get(request.hostname);
    if (!registration) {
      return undefined;
    }

    let relativePath: string;
    try {
      relativePath = decodeURIComponent(request.pathname).replace(/^[/\\]+/, '');
    } catch {
      return undefined;
    }
    if (!relativePath || relativePath.includes('\0')) {
      return undefined;
    }

    const candidatePath = path.resolve(
      registration.rootPath,
      relativePath.replace(/[\\/]+/g, path.sep)
    );
    if (!isWithinRoot(registration.rootPath, candidatePath)) {
      return undefined;
    }

    let realCandidatePath: string;
    try {
      realCandidatePath = await this.canonicalize(candidatePath);
    } catch {
      return undefined;
    }
    return isWithinRoot(registration.rootPath, realCandidatePath)
      ? realCandidatePath
      : undefined;
  }

  revokeOwner(ownerId: number): void {
    this.generationByOwner.set(ownerId, ++this.nextGeneration);
    this.removeOwnerRegistration(ownerId);
  }

  private removeOwnerRegistration(ownerId: number): void {
    const token = this.tokenByOwner.get(ownerId);
    if (!token) {
      return;
    }
    this.tokenByOwner.delete(ownerId);
    this.byToken.delete(token);
  }

  clear(): void {
    this.generationByOwner.clear();
    this.tokenByOwner.clear();
    this.byToken.clear();
  }

  private createUniqueToken(): string {
    let token = this.createToken();
    while (this.byToken.has(token)) {
      token = this.createToken();
    }
    return token;
  }
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath))
  );
}
