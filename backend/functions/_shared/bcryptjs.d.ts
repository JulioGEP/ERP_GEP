declare module 'bcryptjs' {
  export function hashSync(data: string, salt: string | number): string;
  export function compareSync(data: string, hash: string): boolean;
  export function genSaltSync(rounds: number): string;
  const _default: {
    hashSync: typeof hashSync;
    compareSync: typeof compareSync;
    genSaltSync: typeof genSaltSync;
  };
  export default _default;
}
