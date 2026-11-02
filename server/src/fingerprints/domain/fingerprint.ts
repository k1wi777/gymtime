/** Template already encrypted; see TemplateCipher for the layout of `template`. */
export interface Fingerprint {
  id: string;
  studentId: string;
  template: Buffer;
  iv: Buffer;
  active: boolean;
  createdAt: Date;
}
