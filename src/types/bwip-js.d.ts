declare module "bwip-js" {
  export interface ToBufferOptions {
    bcid: string;
    text: string;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    height?: number;
    width?: number;
    includetext?: boolean;
    textxalign?: "offleft" | "left" | "center" | "right" | "offright";
    [key: string]: unknown;
  }

  const bwipjs: {
    toBuffer(options: ToBufferOptions): Promise<Buffer>;
  };

  export default bwipjs;
}
