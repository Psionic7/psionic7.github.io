import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';

const MAGIC = Buffer.from('HOME-RECORDS-STATE-1\n');
export const MAX_STATE_BYTES = 1024 * 1024 * 1024;
function stateKey(value) {
  if (!/^[a-f\d]{64}$/i.test(value || '')) throw new Error('자동 수집 DB 암호화 키를 확인하세요.');
  return Buffer.from(value, 'hex');
}
export function encryptState(database, key) {
  if (!Buffer.isBuffer(database) || database.length > MAX_STATE_BYTES || !database.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')))
    throw new Error('보관할 작업 DB를 확인하세요.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', stateKey(key), iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(gzipSync(database, {level: 6})), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}
export function decryptState(bytes, key) {
  if (!Buffer.isBuffer(bytes) || bytes.length < MAGIC.length + 29 || bytes.length > MAX_STATE_BYTES || !bytes.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('암호화한 DB 파일 형식이 올바르지 않습니다.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', stateKey(key), bytes.subarray(MAGIC.length, MAGIC.length + 12));
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(bytes.subarray(MAGIC.length + 12, MAGIC.length + 28));
    const compressed = Buffer.concat([decipher.update(bytes.subarray(MAGIC.length + 28)), decipher.final()]);
    const raw = gunzipSync(compressed, {maxOutputLength: MAX_STATE_BYTES});
    if (!raw.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) throw new Error();
    return raw;
  } catch {throw new Error('DB 복호화에 실패했습니다. 암호화 키와 저장 파일을 확인하세요.');}
}
