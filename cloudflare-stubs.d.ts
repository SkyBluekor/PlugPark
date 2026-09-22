type D1Result<T=unknown> = { results: T[] };
declare interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T=any>(): Promise<T | null>;
  all<T=any>(): Promise<D1Result<T>>;
  run(): Promise<any>;
}
declare interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<any[]>;
}
declare interface Fetcher { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>; }
declare interface ExecutionContext { waitUntil(promise: Promise<any>): void; }
declare var caches: { default: Cache };
