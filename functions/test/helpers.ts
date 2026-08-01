/**
 * Awaits a promise that is expected to reject and returns the thrown error,
 * correctly typed. Avoids `.catch(e => e)`, which widens the result to a union
 * with the resolved value and defeats type checking on the error.
 */
export async function rejection<T = Error>(promise: Promise<unknown>): Promise<T> {
  let caught: unknown;
  let threw = false;
  try {
    await promise;
  } catch (err) {
    caught = err;
    threw = true;
  }
  if (!threw) {
    throw new Error("Expected promise to reject, but it resolved.");
  }
  return caught as T;
}
