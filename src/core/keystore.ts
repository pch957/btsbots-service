import { Buffer } from 'buffer';

const KEYSTORE_STORAGE_KEY = 'btsbots_keystore_v1';
const SAVED_ACCOUNT_KEY = 'btsbots_saved_account';

interface EncryptedPayload {
  saltHex: string;
  ivHex: string;
  tagHex: string;
  cipherHex: string;
}

export class KeystoreManager {
  static exists(): boolean {
    return !!localStorage.getItem(KEYSTORE_STORAGE_KEY);
  }

  static getSavedAccountName(): string | null {
    return localStorage.getItem(SAVED_ACCOUNT_KEY);
  }

  static async saveCredentials(password: string, accountName: string, keys: string[]): Promise<void> {
    const enc = new TextEncoder();
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const passwordKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const aesKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const dataObj = { account: accountName, keys };
    const plainText = JSON.stringify(dataObj);

    const cipherBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      enc.encode(plainText)
    );

    const cipherArray = new Uint8Array(cipherBuffer);
    const cipherHex = Buffer.from(cipherArray).toString('hex');

    const payload: EncryptedPayload = {
      saltHex: Buffer.from(salt).toString('hex'),
      ivHex: Buffer.from(iv).toString('hex'),
      tagHex: '',
      cipherHex,
    };

    localStorage.setItem(KEYSTORE_STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem(SAVED_ACCOUNT_KEY, accountName);
  }

  static async loadCredentials(password: string): Promise<{ account: string; keys: string[] }> {
    const rawStr = localStorage.getItem(KEYSTORE_STORAGE_KEY);
    if (!rawStr) {
      throw new Error('未检测到本地加密凭据金库');
    }

    try {
      const payload: EncryptedPayload = JSON.parse(rawStr);
      const salt = Uint8Array.from(Buffer.from(payload.saltHex, 'hex'));
      const iv = Uint8Array.from(Buffer.from(payload.ivHex, 'hex'));
      const cipherBytes = Uint8Array.from(Buffer.from(payload.cipherHex, 'hex'));

      const enc = new TextEncoder();
      const passwordKey = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );

      const aesKey = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt,
          iterations: 100000,
          hash: 'SHA-256',
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        cipherBytes
      );

      const dec = new TextDecoder();
      return JSON.parse(dec.decode(decryptedBuffer));
    } catch {
      throw new Error('解锁口令错误或金库数据已损坏');
    }
  }

  static clear(): void {
    localStorage.removeItem(KEYSTORE_STORAGE_KEY);
    localStorage.removeItem(SAVED_ACCOUNT_KEY);
  }
}