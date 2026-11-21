import { Client } from "seyfert";

const client = new Client();

export { client };

if (import.meta.main) {
  await client.start();
}
