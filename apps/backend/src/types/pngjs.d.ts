declare module "pngjs" {
  export class PNG {
    constructor(options?: { width?: number; height?: number; colorType?: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      write(png: PNG): Buffer;
      read(buffer: Buffer): PNG;
    };
  }
}
