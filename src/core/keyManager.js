import { PrivateKey, Signature } from 'bitsharesjs';
export class KeyManager {
    keyStore = new Map(); // pubKeyStr -> PrivateKey
    clear() {
        this.keyStore.clear();
    }
    addKeyByWif(wifStr) {
        const clean = wifStr.trim();
        if (!clean)
            return null;
        try {
            const pKey = PrivateKey.fromWif(clean);
            const pubKey = pKey.toPublicKey().toString('BTS');
            this.keyStore.set(pubKey, pKey);
            return pubKey;
        }
        catch (e) {
            console.error('Failed to parse WIF key:', e);
            return null;
        }
    }
    hasKey(pubKey) {
        return this.keyStore.has(pubKey.trim());
    }
    getAvailablePubkeys() {
        return Array.from(this.keyStore.keys());
    }
    signMessage(pubKey, messageStr) {
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
    getPrivateKey(pubKey) {
        return this.keyStore.get(pubKey.trim());
    }
}
