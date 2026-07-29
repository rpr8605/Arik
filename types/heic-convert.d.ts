// heic-convert ships no TypeScript types (no @types package exists).
// This declaration covers exactly the one call the intake pipeline makes.
declare module 'heic-convert' {
  function convert(options: {
    buffer: Buffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }): Promise<Uint8Array>;
  export default convert;
}
