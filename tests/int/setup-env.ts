import "dotenv/config";

// Point every service at the test database before anything imports the client.
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.MESSAGING_DRIVER = "console";
process.env.PAYMENT_ONLINE_PROVIDER = "mock";
