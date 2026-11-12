declare module 'node-shazam' {
  export class Shazam {
    constructor(timeZone?: string);
    recognise(
      filePath: string,
      language?: string,
      minimal?: boolean
    ): Promise<Record<string, any> | null>;
    fromFilePath(
      filePath: string,
      minimal?: boolean,
      language?: string
    ): Promise<Record<string, any> | null>;
    top_tracks_global(
      language?: string,
      endpoint_country?: string,
      limit?: string,
      offset?: string
    ): Promise<any>;
  }
}
