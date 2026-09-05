import { PrivateKey, Signature } from 'bitsharesjs';

export class KeyManager {
  private keyStore: Map<string, PrivateKey> = new Map(); // pubKeyStr -> PrivateKey

  public clear(): void {
    this.keyStore.clear();
  }

  public addKeyByWif(wifStr: string): string | null {
    const clean = wifStr.trim();
    if (!clean) return null;
    try {
      const pKey = PrivateKey.fromWif(clean);
      const pubKey = pKey.toPublicKey().toString('BTS');
      this.keyStore.set(pubKey, pKey);
      return pubKey;
    } catch (e) {
      console.error('Failed to parse WIF key:', e);
      return null;
    }
  }

  public hasKey(pubKey: string): boolean {
    return this.keyStore.has(pubKey.trim());
  }

  public getAvailablePubkeys(): string[] {
    return Array.from(this.keyStore.keys());
  }

  public signMessage(pubKey: string, messageStr: string): { data: string; pubkey: string; signature: string } {
    const cleanPub = pubKey.trim();
    const pKey = this.keyStore.get(cleanPub);
    if (!pKey) {
      throw new Error(`密钥库中未找到公钥 [${cleanPub}] 对应的私钥`);
    }

    const sig = Signature.sign(messageStr, pKey);
    return {
      data: messageStr,
      pubkey: cleanPub,
      signature: sig.toHex(),
    };
  }

  public getPrivateKey(pubKey: string): PrivateKey | undefined {
    return this.keyStore.get(pubKey.trim());
  }
}