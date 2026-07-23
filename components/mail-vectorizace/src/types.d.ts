declare module "html-to-text" {
  export function convert(
    value: string,
    options?: {
      wordwrap?: false | number;
      selectors?: Array<{
        selector: string;
        options?: Record<string, unknown>;
      }>;
    }
  ): string;
}

declare module "mailparser" {
  export type ParsedMail = {
    html?: string | false | null;
    text?: string | null;
    messageId?: string | null;
    subject?: string | null;
    date?: Date | null;
  };

  export function simpleParser(input: string): Promise<ParsedMail>;
}
