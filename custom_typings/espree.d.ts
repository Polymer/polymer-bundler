declare module 'espree' {
  interface ParseOpts {
    attachComment: boolean;
    comment: boolean;
    loc: boolean;
    ecmaVersion?: number;
    ecmaFeatures?: {
      arrowFunctions: boolean;
      blockBindings: boolean;
      destructuring: boolean;
      regexYFlag: boolean;
      regexUFlag: boolean;
      templateStrings: boolean;
      binaryLiterals: boolean;
      unicodeCodePointEscapes: boolean;
      defaultParams: boolean;
      restParams: boolean;
      forOf: boolean;
      objectLiteralComputedProperties: boolean;
      objectLiteralShorthandMethods: boolean;
      objectLiteralShorthandProperties: boolean;
      objectLiteralDuplicateProperties: boolean;
      generators: boolean;
      spread: boolean;
      classes: boolean;
      modules: boolean;
      jsx: boolean;
      globalReturn: boolean;
    };
    sourceType: 'script' | 'module';
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

  export function tokenize(text: string, opts?: ParseOpts): Token[];
}
