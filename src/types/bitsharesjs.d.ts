declare module 'bitsharesjs-ws' {
  export class ChainConfig {
    static address_prefix: string;
    static setPrefix(prefix: string): void;
  }
}

declare module 'bitsharesjs' {
  export class ChainConfig {
    static address_prefix: string;
    static setPrefix(prefix: string): void;
  }

  export class PrivateKey {
    static fromWif(wif: string): PrivateKey;
    static fromHex(hex: string): PrivateKey;
    static fromSeed(seed: string): PrivateKey;
    toWif(): string;
    toHex(): string;
    toPublicKey(): PublicKey;
  }

  export class PublicKey {
    static fromPublicKeyString(pubkey: string, address_prefix?: string): PublicKey | null;
    static fromStringOrThrow(pubkey: string, address_prefix?: string): PublicKey;
    static fromBuffer(buffer: any): PublicKey;
    toString(prefix?: string): string;
    toPublicKeyString(prefix?: string): string;
  }

  export class Signature {
    static sign(string: string, privateKey: PrivateKey): Signature;
    static signBuffer(buffer: any, privateKey: PrivateKey): Signature;
    toHex(): string;
  }

  export namespace hash {
    function sha256(data: string | Uint8Array | ArrayBuffer | any): any;
  }

  export namespace ops {
    export const operation: {
      toObject(op: any): any;
      fromObject(op: any): any;
    };
    export const transaction: {
      toBuffer(tx: any): Uint8Array;
      toObject(tx: any): any;
    };
    export const signed_transaction: {
      toBuffer(tx: any): Uint8Array;
      toObject(tx: any): any;
    };
  }

  export namespace Aes {
    function fromSeed(seed: string): any;
    function encrypt_with_checksum(privateKey: PrivateKey, publicKey: PublicKey, nonce: string, message: string): any;
    function decrypt_with_checksum(privateKey: PrivateKey, publicKey: PublicKey, nonce: string, message: any): string;
  }

  export class TransactionBuilder {
    ref_block_num: number;
    ref_block_prefix: number;
    expiration: number | string;
    operations: any[];
    signatures: string[];
    tr_buffer?: Uint8Array;
    constructor();
    add_type_operation(name: string, data: any): void;
    set_required_fees(): Promise<any>;
    add_signer(privateKey: PrivateKey, pubkey?: string): void;
    sign(chain_id?: string): void;
    finalize(): Promise<void>;
    toObject(): any;
  }
}