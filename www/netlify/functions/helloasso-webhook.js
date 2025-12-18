export async function handler(event) {
  console.log("Webhook HelloAsso reçu");

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
}
