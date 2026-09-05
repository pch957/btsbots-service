import { bufferToHex, hexToBuffer } from './utils';
import crypto from 'crypto';

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
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);

    // 使用标准 PBKDF2 派生 256 位密钥
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const dataObj = { account: accountName, keys };
    const plainText = JSON.stringify(dataObj);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    const payload: EncryptedPayload = {
      saltHex: salt.toString('hex'),
      ivHex: iv.toString('hex'),
      tagHex: tag.toString('hex'),
      cipherHex: encrypted,
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
      const salt = Buffer.from(payload.saltHex, 'hex');
      const iv = Buffer.from(payload.ivHex, 'hex');
      const tag = Buffer.from(payload.tagHex, 'hex');

      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(payload.cipherHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch {
      throw new Error('解锁口令错误或金库数据已损坏');
    }
  }

  static clear(): void {
    localStorage.removeItem(KEYSTORE_STORAGE_KEY);
    localStorage.removeItem(SAVED_ACCOUNT_KEY);
  }
}