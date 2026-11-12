// The HTTP client the provider adapters use. It is an injection token so tests can
// replace the network with scripted provider responses.
export const FETCH = Symbol('FETCH');
