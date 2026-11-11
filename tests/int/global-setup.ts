import { execSync } from "node:child_process";
import "dotenv/config";

/** Brings the test database schema up to date once per run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  if (!/_test\b/.test(new URL(url).pathname)) throw new Error("Refusing to migrate a database whose name doesn't end in _test");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
