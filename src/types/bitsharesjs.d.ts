declare module 'bitsharesjs' {
  export class PrivateKey {
    static fromWif(wif: string): PrivateKey;
    static fromSeed(seed: string): PrivateKey;
    toWif(): string;
    toPublicKey(): PublicKey;
  }

  export class PublicKey {
    toString(prefix?: string): string;
  }

  export class Signature {
    static sign(string: string, privateKey: PrivateKey): Signature;
    toHex(): string;
  }

  export namespace hash {
    function sha256(data: string | Uint8Array | ArrayBuffer | any): any;
  }

  export class TransactionBuilder {
    constructor();
    add_type_operation(name: string, data: any): void;
    set_required_fees(): Promise<any>;
    add_signer(privateKey: PrivateKey, pubkey?: string): void;
    sign(): void;
    broadcast(): Promise<any>;
  }
}