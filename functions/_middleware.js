// All platforms use the same routing and authentication checks.
export async function onRequest(context) {
  return context.next();
}
