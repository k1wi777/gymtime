/** Template already encrypted; see TemplateCipher for the layout of `template`. */
export interface Fingerprint {
  id: string;
  studentId: string;
  template: Buffer;
  iv: Buffer;
  /** Version of the key that sealed `template` (H11). */
  keyVersion: number;
  active: boolean;
  createdAt: Date;
}
