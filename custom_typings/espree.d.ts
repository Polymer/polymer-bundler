declare module 'espree' {
  interface ParseOpts2 {
    ecmaVersion?: number;
    loc?: boolean;
    sourceType?: 'script' | 'module';
  }

  interface Token {
    type: string,
    value: string,
    start: number,
    end: number,
    loc: {
      start: {
        line: number,
        column: number
      },
      end: {
        line: number,
        column: number
      }
    }
  }

  export function tokenize(text: string, opts?: ParseOpts2): Token[];
}
